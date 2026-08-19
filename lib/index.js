// dsh-token-usage-plugin —— Host 半端（静态 cordis 插件形态）
// 供 `dsh plugin --profile web add <package>` 安装。
// 仅保留用量统计：session/event 实时监听 + 历史扫描（按 seq 去重）。
// 存储使用 SQLite（node:sqlite DatabaseSync）：
//   ~/.dsh/plugins/dsh-token-usage-plugin/usage.db
//     calls(session_id, time, day, model, input, output, cache_read) —— 每次模型调用
//     day_stats(day, turns, steps, tools)                            —— 每日非请求计数
//     sessions(session_id, seq, at)                                  —— 每会话水位线
// 「至今」tab 直接 SQL 全量聚合，历史不再受内存/天数限制。
// RPC 通过 ctx.webServer 提供 HTTP 路由（POST /tusage/api/<name>），Client 用 fetch 调用。

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const inject = ['timer', 'webServer']

export function apply(ctx) {
  const webServer = ctx.webServer
  const sessionQuery = ctx.get('sessionQuery')

  // ===== SQLite 存储 =====
  const dataDir = path.join(os.homedir(), '.dsh', 'plugins', 'dsh-token-usage-plugin')
  const dbFile = path.join(dataDir, 'usage.db')

  const usage = {
    ready: false,
    error: null,
    version: 0,
    live: {
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      toolCalls: 0,
      firstTokenSum: 0,
      firstTokenCount: 0,
      outputTokens: 0,
      stepStart: new Map(),
      stepToolAccum: new Map(),
      toolStart: new Map(),
      firstChunk: new Map(),
    },
  }

  let db = null
  let stmts = null
  let writeScheduled = false
  const liveSeqs = new Map()

  function bumpUsage() { usage.version += 1 }

  function dayKeyOf(time) {
    const d = new Date(time)
    const pad = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function openDb() {
    mkdirSync(dataDir, { recursive: true })
    db = new DatabaseSync(dbFile)
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS calls (
        session_id TEXT NOT NULL,
        time INTEGER NOT NULL,
        day TEXT NOT NULL,
        model TEXT NOT NULL,
        input INTEGER NOT NULL DEFAULT 0,
        output INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_calls_day ON calls(day);
      CREATE INDEX IF NOT EXISTS idx_calls_time ON calls(time DESC);
      CREATE INDEX IF NOT EXISTS idx_calls_model ON calls(model);
      CREATE TABLE IF NOT EXISTS day_stats (
        day TEXT PRIMARY KEY,
        turns INTEGER NOT NULL DEFAULT 0,
        steps INTEGER NOT NULL DEFAULT 0,
        tools INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', '1');
    `)
    stmts = {
      insertCall: db.prepare('INSERT INTO calls(session_id, time, day, model, input, output, cache_read) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      bumpDayStat: db.prepare('INSERT INTO day_stats(day, turns, steps, tools) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET turns = turns + excluded.turns, steps = steps + excluded.steps, tools = tools + excluded.tools'),
      getWatermark: db.prepare('SELECT seq FROM sessions WHERE session_id = ?'),
      setWatermark: db.prepare('INSERT INTO sessions(session_id, seq, at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET seq = excluded.seq, at = excluded.at'),
      callsTotals: db.prepare('SELECT COUNT(*) AS requests, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM calls WHERE day >= ?'),
      callsDaily: db.prepare('SELECT day, COUNT(*) AS requests, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM calls WHERE day >= ? GROUP BY day ORDER BY day'),
      callsModels: db.prepare('SELECT model, COUNT(*) AS requests, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM calls WHERE day >= ? GROUP BY model'),
      statsDaily: db.prepare('SELECT day, turns, steps, tools FROM day_stats WHERE day >= ?'),
      recentRecords: db.prepare('SELECT time, session_id, model, input, output, cache_read FROM calls ORDER BY time DESC LIMIT 50'),
      callCount: db.prepare('SELECT COUNT(*) AS n FROM calls'),
      getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)'),
      setDayStats: db.prepare('INSERT INTO day_stats(day, turns, steps, tools) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET turns = excluded.turns, steps = excluded.steps, tools = excluded.tools'),
    }
  }

  function flush() {
    if (!db) return
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch (e) { /* ignore */ }
  }

  function scheduleFlush() {
    if (writeScheduled) return
    writeScheduled = true
    setTimeout(() => { writeScheduled = false; flush() }, 5000)
  }

  // —— v1.x JSON 分片缓存迁移（一次性）——
  function migrateLegacyCache() {
    const shardDir = path.join(dataDir, 'usage-cache')
    const legacyFile = path.join(dataDir, 'usage-cache.json')
    try {
      if (existsSync(shardDir) && !stmts.getMeta.get('migratedShards')) {
        let days = 0
        for (const name of readdirSync(shardDir)) {
          const m = /^day-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)
          if (!m) continue
          let shard = null
          try { shard = JSON.parse(readFileSync(path.join(shardDir, name), 'utf8')) } catch (e) { continue }
          if (!shard || typeof shard !== 'object') continue
          const day = m[1]
          const t = shard.total || {}
          stmts.setDayStats.run(day, t.turns || 0, t.steps || 0, t.tools || 0)
          if (t.requests) {
            // 分片只有聚合值：以单行调用记录形式导入（time 用当日正午，模型标记 legacy-aggregate）
            stmts.insertCall.run('legacy', Date.parse(day + 'T12:00:00'), day, 'legacy-aggregate',
              t.input || 0, t.output || 0, t.cacheRead || 0)
          }
          days += 1
        }
        // 水位线迁移
        try {
          const meta = JSON.parse(readFileSync(path.join(shardDir, 'meta.json'), 'utf8'))
          if (meta && meta.sessions) {
            for (const [id, entry] of Object.entries(meta.sessions)) {
              const seq = entry && typeof entry === 'object' ? entry.seq : entry
              if (typeof seq === 'number' && seq > 0) stmts.setWatermark.run(id, seq, Date.now())
            }
          }
        } catch (e) { /* meta 缺失 */ }
        stmts.setMeta.run('migratedShards', String(Date.now()))
        if (days) console.log('[用量统计] 已迁移 ' + days + ' 天分片缓存 → SQLite（聚合以 legacy-aggregate 记录导入）')
      }
      // 删除旧目录与 v1 单文件（幂等）
      try { rmSync(shardDir, { recursive: true, force: true }) } catch (e) { /* 目录不存在 */ }
      try { unlinkSync(legacyFile) } catch (e) { /* v1 单文件不存在 */ }
    } catch (e) { /* 迁移失败不影响启动 */ }
  }

  try {
    openDb()
    migrateLegacyCache()
    usage.ready = true
    bumpUsage()
    console.log('[用量统计] SQLite 就绪：' + dbFile + ' · ' + stmts.callCount.get().n + ' 条调用记录')
  } catch (e) {
    usage.error = 'SQLite 初始化失败：' + String(e && e.message || e).slice(0, 200)
    usage.ready = true
    bumpUsage()
    return
  }

  // ===== 事件摄取 =====
  function ingestEvent(sessionId, event) {
    const time = event.time
    const data = event.data || {}
    const live = usage.live
    if (event.type === 'assistant/message') {
      const usageInfo = data.usage
      if (usageInfo) {
        const model = data.message && data.message.source ? String(data.message.source.model || 'unknown') : 'unknown'
        stmts.insertCall.run(String(sessionId).slice(0, 8), time, dayKeyOf(time), model,
          usageInfo.inputTokens || 0, usageInfo.outputTokens || 0, usageInfo.cacheReadTokens || 0)
        live.outputTokens += usageInfo.outputTokens || 0
        bumpUsage()
        scheduleFlush()
      }
      return
    }
    if (event.type === 'turn/end') {
      stmts.bumpDayStat.run(dayKeyOf(time), 1, 0, 0)
      live.turns += 1
      bumpUsage()
      scheduleFlush()
      return
    }
    if (event.type === 'step/start') {
      live.stepStart.set(sessionId + ':' + data.turn + ':' + data.step, time)
      return
    }
    if (event.type === 'step/end') {
      const key = sessionId + ':' + data.turn + ':' + data.step
      const start = live.stepStart.get(key)
      const toolAccum = live.stepToolAccum.get(key) || 0
      if (typeof start === 'number') live.llmMs += Math.max(0, time - start - toolAccum)
      live.stepStart.delete(key)
      live.stepToolAccum.delete(key)
      stmts.bumpDayStat.run(dayKeyOf(time), 0, 1, 0)
      live.steps += 1
      bumpUsage()
      scheduleFlush()
      return
    }
    if (event.type === 'tool/call') {
      live.toolStart.set(String(data.callId), time)
      return
    }
    if (event.type === 'tool/result') {
      const callId = data.message && data.message.source ? String(data.message.source.callId || '') : ''
      const start = live.toolStart.get(callId)
      if (typeof start === 'number') {
        const duration = Math.max(0, time - start)
        live.toolMs += duration
        live.toolCalls += 1
        const stepKey = sessionId + ':' + data.turn + ':' + data.step
        live.stepToolAccum.set(stepKey, (live.stepToolAccum.get(stepKey) || 0) + duration)
      }
      if (callId) live.toolStart.delete(callId)
      stmts.bumpDayStat.run(dayKeyOf(time), 0, 0, 1)
      bumpUsage()
      scheduleFlush()
      return
    }
    if (event.type === 'assistant/chunk') {
      const key = sessionId + ':' + data.turn + ':' + data.step
      if (!live.firstChunk.has(key)) {
        live.firstChunk.set(key, time)
        const start = live.stepStart.get(key)
        if (typeof start === 'number') {
          live.firstTokenSum += Math.max(0, time - start)
          live.firstTokenCount += 1
        }
      }
      return
    }
  }

  function advanceWatermark(id, seq) {
    const prev = liveSeqs.get(id)
    if (prev === undefined) {
      const row = stmts.getWatermark.get(id)
      liveSeqs.set(id, row ? row.seq : 0)
    }
    const cur = liveSeqs.get(id) || 0
    if (typeof seq === 'number' && seq > cur) {
      liveSeqs.set(id, seq)
      stmts.setWatermark.run(id, seq, Date.now())
    }
    return liveSeqs.get(id)
  }

  ctx.on('session/event', (session, event) => {
    if (!session || !event || typeof event.time !== 'number') return
    const id = String(session.id || '')
    if (!id) return
    const prev = advanceWatermark(id, event.seq)
    if (prev === undefined) return
    ingestEvent(id, event)
  })

  async function scanHistory() {
    if (!sessionQuery) return
    try {
      const sessions = await sessionQuery.listSessions()
      let scanned = 0
      for (const record of sessions) {
        if (!record || !record.header) continue
        const id = String(record.header.id || '')
        if (!id) continue
        try {
          const snapshot = await sessionQuery.readSession(id)
          const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
          const maxSeq = advanceWatermark(id, undefined) || 0
          for (const event of events) {
            if (!event || typeof event.time !== 'number') continue
            if (typeof event.seq === 'number' && event.seq <= maxSeq) continue
            ingestEvent(id, event)
            advanceWatermark(id, event.seq)
          }
          scanned += 1
        } catch (e) { /* 单会话读取失败则跳过 */ }
        if (scanned >= 1000) break
      }
    } catch (e) {
      usage.error = String(e && e.message || e).slice(0, 300)
    }
    bumpUsage()
    flush()
    console.log('[用量统计] 增量扫描完成：累计 ' + stmts.callCount.get().n + ' 条调用记录')
  }
  scanHistory()

  // ===== 范围查询 =====
  function dayOffset(n) {
    const d = new Date(Date.now() - n * 86400000)
    const pad = (v) => String(v).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function computeUsage(range) {
    if (!db) return null
    let since = '0000-00-00'
    let prevSince = null
    if (range === '1d') { since = dayOffset(1); prevSince = { from: dayOffset(3), to: dayOffset(1) } }
    else if (range === '7d') { since = dayOffset(6); prevSince = { from: dayOffset(13), to: dayOffset(6) } }
    else if (range === '30d') { since = dayOffset(29); prevSince = { from: dayOffset(59), to: dayOffset(29) } }

    const totals = stmts.callsTotals.get(since)
    let prevTotals = null
    if (prevSince) {
      const prev = stmts.callsDaily.all(prevSince.from).filter((row) => row.day < prevSince.to)
      if (prev.length) {
        prevTotals = {
          total: prev.reduce((s, r) => s + r.input + r.output + r.cache_read, 0),
          requests: prev.reduce((s, r) => s + r.requests, 0),
        }
      }
    }

    const callsByDay = new Map(stmts.callsDaily.all(since).map((row) => [row.day, row]))
    const statsByDay = new Map(stmts.statsDaily.all(since).map((row) => [row.day, row]))
    const days = [...new Set([...callsByDay.keys(), ...statsByDay.keys()])].sort()
    const daily = days.map((day) => {
      const c = callsByDay.get(day) || { requests: 0, input: 0, output: 0, cache_read: 0 }
      const st = statsByDay.get(day) || { turns: 0, steps: 0, tools: 0 }
      const prompt = c.input + c.cache_read
      return {
        date: day,
        requests: c.requests,
        prompt: prompt,
        completion: c.output,
        cache_read: c.cache_read,
        total: prompt + c.output,
        tools: st.tools,
        turns: st.turns,
        steps: st.steps,
      }
    })

    const models = stmts.callsModels.all(since).map((row) => ({
      model: row.model,
      requests: row.requests,
      input: row.input + row.cache_read,
      output: row.output,
      cacheRead: row.cache_read,
      total: row.input + row.output + row.cache_read,
    }))
    models.sort((a, b) => b.total - a.total)

    const records = stmts.recentRecords.all().map((row) => ({
      time: row.time,
      sessionId: String(row.session_id || '').slice(0, 8),
      model: row.model,
      input: row.input + row.cache_read,
      output: row.output,
      cacheRead: row.cache_read,
    })).filter((r) => r.time > 0)

    const live = usage.live
    const totalsPrompt = totals.input + totals.cache_read
    return {
      totals: {
        total: totalsPrompt + totals.output,
        prompt: totalsPrompt,
        completion: totals.output,
        cache_read: totals.cache_read,
        requests: totals.requests,
        turns: daily.reduce((s, d) => s + d.turns, 0),
        steps: daily.reduce((s, d) => s + d.steps, 0),
        tools: daily.reduce((s, d) => s + d.tools, 0),
      },
      prevTotals: prevTotals,
      daily: daily,
      models: models,
      records: records,
      live: {
        turns: live.turns,
        steps: live.steps,
        llmMs: live.llmMs,
        toolMs: live.toolMs,
        toolCalls: live.toolCalls,
        firstTokenMs: live.firstTokenCount ? live.firstTokenSum / live.firstTokenCount : 0,
        firstTokenCount: live.firstTokenCount,
        tokPerSec: live.llmMs > 0 ? (live.outputTokens / live.llmMs) * 1000 : 0,
      },
    }
  }

  // ===== 私有 RPC：webServer 路由（POST /tusage/api/<name>，JSON in/out）=====
  function registerRoute(name, handler) {
    if (!webServer) return
    webServer.register({
      kind: 'exact',
      path: '/tusage/api/' + name,
      handler: async (req, res) => {
        let body = ''
        try {
          for await (const chunk of req) body += chunk
        } catch (e) { /* 忽略读流错误 */ }
        let args = {}
        try { args = body ? JSON.parse(body) : {} } catch (e) { args = {} }
        let result
        try {
          result = await handler(args)
        } catch (e) {
          result = { error: String(e && e.message || e).slice(0, 500) }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(result))
      },
    })
  }

  registerRoute('get-usage', async (args) => {
    const range = args && typeof args.range === 'string' && ['1d', '7d', '30d', 'all'].indexOf(args.range) !== -1 ? args.range : '7d'
    return {
      version: usage.version,
      ready: usage.ready,
      error: usage.error,
      updatedAt: Date.now(),
      range: range,
      stats: computeUsage(range),
    }
  })
}
