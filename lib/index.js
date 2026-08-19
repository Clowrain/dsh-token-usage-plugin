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
  }

  let db = null
  let stmts = null
  let writeScheduled = false
  let pendingPersistScheduled = false
  const pendingWatermarks = new Map()
  const pendingDayStats = new Map()
  const liveSeqs = new Map()
  const liveSeqAt = new Map()

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
      CREATE TABLE IF NOT EXISTS day_totals (
        day TEXT PRIMARY KEY,
        requests INTEGER NOT NULL DEFAULT 0,
        input INTEGER NOT NULL DEFAULT 0,
        output INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', '2');
    `)
    // 兼容旧库：day_totals 为空时由 calls 全量回填（全新安装 calls 也为空，为 no-op）
    const dtCount = db.prepare('SELECT COUNT(*) AS n FROM day_totals').get()
    if (dtCount.n === 0) {
      db.exec('INSERT INTO day_totals(day, requests, input, output, cache_read) SELECT day, COUNT(*), IFNULL(SUM(input),0), IFNULL(SUM(output),0), IFNULL(SUM(cache_read),0) FROM calls GROUP BY day')
    }
    stmts = {
      insertCall: db.prepare('INSERT INTO calls(session_id, time, day, model, input, output, cache_read) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      bumpCallAgg: db.prepare('INSERT INTO day_totals(day, requests, input, output, cache_read) VALUES (?, 1, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET requests = requests + 1, input = input + excluded.input, output = output + excluded.output, cache_read = cache_read + excluded.cache_read'),
      bumpDayStat: db.prepare('INSERT INTO day_stats(day, turns, steps, tools) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET turns = turns + excluded.turns, steps = steps + excluded.steps, tools = tools + excluded.tools'),
      getWatermark: db.prepare('SELECT seq, at FROM sessions WHERE session_id = ?'),
      setWatermark: db.prepare('INSERT INTO sessions(session_id, seq, at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET seq = excluded.seq, at = excluded.at'),
      pruneSessions: db.prepare('DELETE FROM sessions WHERE at < ?'),
      totalsRange: db.prepare('SELECT IFNULL(SUM(requests),0) AS requests, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM day_totals WHERE day >= ? AND day <= ?'),
      dailyRange: db.prepare('SELECT day, requests, input, output, cache_read FROM day_totals WHERE day >= ? AND day <= ? ORDER BY day'),
      statsRange: db.prepare('SELECT day, turns, steps, tools FROM day_stats WHERE day >= ? AND day <= ?'),
      modelsRange: db.prepare('SELECT model, COUNT(*) AS requests, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM calls WHERE day >= ? AND day <= ? GROUP BY model'),
      minCallDay: db.prepare('SELECT MIN(day) AS d FROM calls'),
      callCount: db.prepare('SELECT COUNT(*) AS n FROM calls'),
      getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)'),
      setDayStats: db.prepare('INSERT INTO day_stats(day, turns, steps, tools) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET turns = excluded.turns, steps = excluded.steps, tools = excluded.tools'),
      setDayTotals: db.prepare('INSERT INTO day_totals(day, requests, input, output, cache_read) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET requests = excluded.requests, input = excluded.input, output = excluded.output, cache_read = excluded.cache_read'),
    }
  }

  function flushPending() {
    if (!db || (!pendingWatermarks.size && !pendingDayStats.size)) return
    db.exec('BEGIN')
    try {
      for (const [id, row] of pendingWatermarks) stmts.setWatermark.run(id, row.seq, row.at)
      for (const [day, stats] of pendingDayStats) stmts.bumpDayStat.run(day, stats.turns, stats.steps, stats.tools)
      db.exec('COMMIT')
      pendingWatermarks.clear()
      pendingDayStats.clear()
    } catch (e) {
      try { db.exec('ROLLBACK') } catch (ignored) { /* ignore */ }
    }
  }

  function schedulePersist() {
    if (pendingPersistScheduled) return
    pendingPersistScheduled = true
    setTimeout(() => {
      pendingPersistScheduled = false
      flushPending()
      scheduleFlush()
    }, 1000)
  }

  function queueDayStat(day, turns, steps, tools) {
    const current = pendingDayStats.get(day) || { turns: 0, steps: 0, tools: 0 }
    current.turns += turns
    current.steps += steps
    current.tools += tools
    pendingDayStats.set(day, current)
    schedulePersist()
  }

  function flush() {
    if (!db) return
    flushPending()
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch (e) { /* ignore */ }
  }

  function scheduleFlush() {
    if (writeScheduled) return
    writeScheduled = true
    setTimeout(() => { writeScheduled = false; flush() }, 5000)
  }

  const usageCache = new Map() // key: range|heatYear|version → stats
  const CACHE_LIMIT = 8

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
          stmts.setDayTotals.run(day, t.requests || 0, t.input || 0, t.output || 0, t.cacheRead || 0)
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
    if (event.type === 'assistant/message') {
      const usageInfo = data.usage
      if (usageInfo) {
        const model = data.message && data.message.source ? String(data.message.source.model || 'unknown') : 'unknown'
        const day = dayKeyOf(time)
        const input = usageInfo.inputTokens || 0
        const output = usageInfo.outputTokens || 0
        const cacheRead = usageInfo.cacheReadTokens || 0
        stmts.insertCall.run(String(sessionId).slice(0, 8), time, day, model, input, output, cacheRead)
        stmts.bumpCallAgg.run(day, input, output, cacheRead)
        bumpUsage()
        scheduleFlush()
      }
      return
    }
    if (event.type === 'turn/end') {
      queueDayStat(dayKeyOf(time), 1, 0, 0)
      bumpUsage()
      return
    }
    if (event.type === 'step/end') {
      queueDayStat(dayKeyOf(time), 0, 1, 0)
      bumpUsage()
      return
    }
    if (event.type === 'tool/result') {
      queueDayStat(dayKeyOf(time), 0, 0, 1)
      bumpUsage()
      return
    }
    // step/start、tool/call、assistant/chunk 仅服务于 live 性能指标，已随该功能移除
  }

  function advanceWatermark(id, seq) {
    const prev = liveSeqs.get(id)
    if (prev === undefined) {
      const row = stmts.getWatermark.get(id)
      liveSeqs.set(id, row ? row.seq : 0)
      liveSeqAt.set(id, row && typeof row.at === 'number' ? row.at : 0)
    }
    const cur = liveSeqs.get(id) || 0
    if (typeof seq === 'number' && seq > cur) {
      const at = Date.now()
      liveSeqs.set(id, seq)
      liveSeqAt.set(id, at)
      pendingWatermarks.set(id, { seq: seq, at: at })
      schedulePersist()
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

  function watermarkAt(id) {
    // 该会话水位线最近推进时间（liveSeqs 缓存或 DB 持久值）
    if (liveSeqAt.has(id)) return liveSeqAt.get(id)
    const row = stmts.getWatermark.get(id)
    const at = row && typeof row.at === 'number' ? row.at : 0
    liveSeqAt.set(id, at)
    return at
  }

  // 定期清理 90 天未更新的会话水位线，防止 sessions 表无限膨胀
  function pruneSessions() {
    if (!db) return
    try { stmts.pruneSessions.run(Date.now() - 90 * 86400000) } catch (e) { /* ignore */ }
  }

  async function scanHistory() {
    if (!sessionQuery) return
    try {
      const sessions = await sessionQuery.listSessions()
      let scanned = 0
      let skipped = 0
      for (const record of sessions) {
        if (!record || !record.header) continue
        const id = String(record.header.id || '')
        if (!id) continue
        // 廉价跳过：若会话最后更新时间不晚于水位线推进时间，必然没有新事件，
        // 免去整会话解压（这是补扫的主要开销）
        const headerAt = Number(record.header.updatedAt || record.header.lastEventAt || record.updatedAt || record.mtimeMs || 0)
        if (headerAt && headerAt <= watermarkAt(id)) { skipped += 1; continue }
        try {
          const snapshot = await sessionQuery.readSession(id)
          const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
          const maxSeq = advanceWatermark(id, undefined) || 0
          // 事务批处理：单会话可能上万事件，避免逐条 autocommit（每条一次 fsync）
          db.exec('BEGIN')
          try {
            for (const event of events) {
              if (!event || typeof event.time !== 'number') continue
              if (typeof event.seq === 'number' && event.seq <= maxSeq) continue
              ingestEvent(id, event)
              advanceWatermark(id, event.seq)
            }
            db.exec('COMMIT')
          } catch (inner) {
            db.exec('ROLLBACK')
            throw inner
          }
          scanned += 1
        } catch (e) { /* 单会话读取失败则跳过 */ }
        if (scanned >= 1000) break
        // 会话间让出事件循环，避免连续解压/写库阻塞 host
        await new Promise((resolve) => setImmediate(resolve))
      }
      if (skipped) console.log('[用量统计] ' + skipped + ' 个会话已追平，跳过解压')
    } catch (e) {
      usage.error = String(e && e.message || e).slice(0, 300)
    }
    bumpUsage()
    flush()
    console.log('[用量统计] 增量扫描完成：累计 ' + stmts.callCount.get().n + ' 条调用记录')
  }
  // 查询（all 含）纯读 SQLite、开库即 ready；补扫仅用于追回离线期间用量，
  // 延后启动，避免与 DSH 启动首屏/首批 RPC 抢 IO。
  setTimeout(() => { scanHistory() }, 3000)
  // 启动时 + 每天清理过期会话水位线
  pruneSessions()
  ctx.interval(() => { pruneSessions() }, 86400000)

  // ===== 范围查询 =====
  function dayOffset(n) {
    const d = new Date(Date.now() - n * 86400000)
    const pad = (v) => String(v).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function computeUsage(range, heatYear) {
    if (!db) return null
    // 结果缓存：数据版本未变（无新事件入库）时直接复用，避免每次轮询重复聚合
    const nowYear = new Date().getFullYear()
    const heatYearNum = Number(heatYear)
    const y = Number.isInteger(heatYearNum) && heatYearNum >= 2000 && heatYearNum <= nowYear ? heatYearNum : nowYear
    const cacheKey = range + '|' + y + '|' + usage.version
    const cached = usageCache.get(cacheKey)
    if (cached) return cached
    // 查询前同步提交内存缓冲，保证刚发生的实时事件立即可见
    flushPending()
    let since = '0000-00-00'
    let prevSince = null
    // 范围语义：1d=今天；7d=最近7天（含今天）；30d=最近30天；all=全部。
    // 上一周期与之对齐且不重叠：1d→昨天，7d→前7天，30d→前30天。
    if (range === '1d') { since = dayOffset(0); prevSince = { from: dayOffset(1), to: dayOffset(1) } }
    else if (range === '7d') { since = dayOffset(6); prevSince = { from: dayOffset(13), to: dayOffset(7) } }
    else if (range === '30d') { since = dayOffset(29); prevSince = { from: dayOffset(59), to: dayOffset(30) } }
    const sinceTo = range === 'all' ? '9999-12-31' : dayOffset(0)
    const yearFrom = y + '-01-01'
    const yearTo = y + '-12-31'

    // 日聚合与汇总全部走 day_totals（每日一行），不再对 calls 明细表全表 GROUP BY
    const totals = stmts.totalsRange.get(since, sinceTo)
    let prevTotals = null
    if (prevSince) {
      const prev = stmts.totalsRange.get(prevSince.from, prevSince.to)
      if (prev && prev.requests > 0) {
        prevTotals = { total: prev.input + prev.output + prev.cache_read, requests: prev.requests }
      }
    }

    const callsByDay = new Map(stmts.dailyRange.all(since, sinceTo).map((row) => [row.day, row]))
    const statsByDay = new Map(stmts.statsRange.all(since, sinceTo).map((row) => [row.day, row]))
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

    // all-time 的总量/模型统计覆盖全历史；图表日序列限制最近 365 天，
    // 避免历史越长导致前端生成成千上万个 DOM 节点。
    const dailyForView = range === 'all' ? daily.slice(-365) : daily

    // 用量日历（自然年 1/1~12/31）：heat = 指定年份的完整日序列
    const heatCalls = new Map(stmts.dailyRange.all(yearFrom, yearTo).map((row) => [row.day, row]))
    const heatStats = new Map(stmts.statsRange.all(yearFrom, yearTo).map((row) => [row.day, row]))
    const heatDays = [...new Set([...heatCalls.keys(), ...heatStats.keys()])].sort().map((day) => {
      const c = heatCalls.get(day) || { requests: 0, input: 0, output: 0, cache_read: 0 }
      const st = heatStats.get(day) || { turns: 0, steps: 0, tools: 0 }
      return {
        date: day,
        requests: c.requests,
        prompt: c.input + c.cache_read,
        completion: c.output,
        cache_read: c.cache_read,
        total: c.input + c.cache_read + c.output,
        tools: st.tools,
        turns: st.turns,
        steps: st.steps,
      }
    })
    const minDayRow = stmts.minCallDay.get()
    const minDay = minDayRow && minDayRow.d ? String(minDayRow.d) : ''
    const minYear = minDay ? Number(minDay.slice(0, 4)) : nowYear
    const heatYears = []
    for (let yy = Math.min(minYear, nowYear); yy <= nowYear; yy += 1) heatYears.push(yy)

    const models = stmts.modelsRange.all(since, sinceTo).map((row) => ({
      model: row.model,
      requests: row.requests,
      input: row.input + row.cache_read,
      output: row.output,
      cacheRead: row.cache_read,
      total: row.input + row.output + row.cache_read,
    }))
    models.sort((a, b) => b.total - a.total)

    const totalsPrompt = totals.input + totals.cache_read
    const result = {
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
      daily: dailyForView,
      heat: heatDays,
      heatYear: y,
      heatYears: heatYears,
      models: models,
    }
    // 简单 LRU：超限时清掉最旧的条目
    if (usageCache.size >= CACHE_LIMIT) {
      const firstKey = usageCache.keys().next().value
      usageCache.delete(firstKey)
    }
    usageCache.set(cacheKey, result)
    return result
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
    const heatYear = args && args.heatYear
    return {
      version: usage.version,
      ready: usage.ready,
      error: usage.error,
      updatedAt: Date.now(),
      range: range,
      stats: computeUsage(range, heatYear),
    }
  })
}
