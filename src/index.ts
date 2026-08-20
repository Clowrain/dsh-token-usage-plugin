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
//
// 迁移 TS 说明：所有 DSH 类型均以 `import type` 引入（编译后擦除，不产生运行时依赖），
// 运行时只依赖 DSH 通过 ctx 注入的服务；SQLite 用 node:sqlite 内置类型。

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import os from 'node:os'
import type { Context } from '@deepseek-ai/cordis'

// ===== 运行时只依赖 DSH 注入的窄接口（编译期对齐 @deepseek-ai/* 类型）=====
type PluginContext = Context & {
  webServer?: WebServerLike
  interval(fn: () => void, ms: number): () => void
  on(event: string, listener: (...args: any[]) => void): () => void
}

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

interface SessionRecord {
  header: Record<string, unknown>
}
interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  readSession(sessionId: string): Promise<{ events: Array<Record<string, unknown>> }>
}

// 我们消费的 session 事件形状（对齐 dsh-session 的 SessionEventMap 子集）
interface UsageEvent {
  type: string
  time: number
  seq: number
  data: Record<string, unknown>
}
interface SessionLike {
  id: unknown
}

// node:sqlite 预编译语句（run/all/get 结果按语句收窄）
interface AnyStmt {
  run(...args: Array<string | number | null>): void
  all(...args: Array<string | number | null>): Array<Record<string, unknown>>
  get(...args: Array<string | number | null>): Record<string, unknown> | undefined
}
interface Statements {
  insertCall: AnyStmt
  bumpCallAgg: AnyStmt
  bumpDayStat: AnyStmt
  getWatermark: AnyStmt
  setWatermark: AnyStmt
  pruneSessions: AnyStmt
  totalsRange: AnyStmt
  dailyRange: AnyStmt
  statsRange: AnyStmt
  modelsRange: AnyStmt
  dailyModelTokens: AnyStmt
  minCallDay: AnyStmt
  callCount: AnyStmt
  countDayTotals: AnyStmt
  listModels: AnyStmt
  allPrices: AnyStmt
  upsertPrice: AnyStmt
  countPrices: AnyStmt
  getMeta: AnyStmt
  setMeta: AnyStmt
  setDayStats: AnyStmt
  setDayTotals: AnyStmt
}

export const inject = ['timer', 'webServer']

// ===== 行收窄辅助 =====
const num = (v: unknown, d = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
const str = (v: unknown, d = ''): string => (v == null ? d : String(v))

export function apply(ctx: PluginContext) {
  const webServer = ctx.webServer
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined

  // ===== SQLite 存储 =====
  const dataDir = path.join(os.homedir(), '.dsh', 'plugins', 'dsh-token-usage-plugin')
  const dbFile = path.join(dataDir, 'usage.db')

  const usage = {
    ready: false,
    error: null as string | null,
    version: 0,
  }

  let db: DatabaseSync | null = null
  let stmts: Statements | null = null
  let writeScheduled = false
  let pendingPersistScheduled = false
  const pendingWatermarks = new Map<string, { seq: number; at: number }>()
  const pendingDayStats = new Map<string, { turns: number; steps: number; tools: number }>()
  const liveSeqs = new Map<string, number>()
  const liveSeqAt = new Map<string, number>()

  function bumpUsage() { usage.version += 1 }

  function dayKeyOf(time: number) {
    const d = new Date(time)
    const pad = (n: number) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  const anyStmt = (s: unknown): AnyStmt => s as AnyStmt

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
      CREATE TABLE IF NOT EXISTS model_prices (
        model TEXT PRIMARY KEY,
        prompt_price REAL NOT NULL DEFAULT 0,
        completion_price REAL NOT NULL DEFAULT 0,
        cache_read_price REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', '3');
    `)
    // day_totals 兼容回填（旧库为空时全量聚合）已移到延后维护任务（deferredMaintenance），
    // 不在启动同步阶段做全表 GROUP BY，避免阻塞 DSH Desktop 启动。
    stmts = {
      insertCall: anyStmt(db.prepare('INSERT INTO calls(session_id, time, day, model, input, output, cache_read) VALUES (?, ?, ?, ?, ?, ?, ?)')),
      bumpCallAgg: anyStmt(db.prepare('INSERT INTO day_totals(day, requests, input, output, cache_read) VALUES (?, 1, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET requests = requests + 1, input = input + excluded.input, output = output + excluded.output, cache_read = cache_read + excluded.cache_read')),
      bumpDayStat: anyStmt(db.prepare('INSERT INTO day_stats(day, turns, steps, tools) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET turns = turns + excluded.turns, steps = steps + excluded.steps, tools = tools + excluded.tools')),
      getWatermark: anyStmt(db.prepare('SELECT seq, at FROM sessions WHERE session_id = ?')),
      setWatermark: anyStmt(db.prepare('INSERT INTO sessions(session_id, seq, at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET seq = excluded.seq, at = excluded.at')),
      pruneSessions: anyStmt(db.prepare('DELETE FROM sessions WHERE at < ?')),
      totalsRange: anyStmt(db.prepare('SELECT IFNULL(SUM(requests),0) AS requests, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM day_totals WHERE day >= ? AND day <= ?')),
      dailyRange: anyStmt(db.prepare('SELECT day, requests, input, output, cache_read FROM day_totals WHERE day >= ? AND day <= ? ORDER BY day')),
      statsRange: anyStmt(db.prepare('SELECT day, turns, steps, tools FROM day_stats WHERE day >= ? AND day <= ?')),
      modelsRange: anyStmt(db.prepare('SELECT model, COUNT(*) AS requests, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM calls WHERE day >= ? AND day <= ? GROUP BY model')),
      dailyModelTokens: anyStmt(db.prepare('SELECT day, model, IFNULL(SUM(input),0) AS input, IFNULL(SUM(output),0) AS output, IFNULL(SUM(cache_read),0) AS cache_read FROM calls WHERE day >= ? AND day <= ? GROUP BY day, model')),
      minCallDay: anyStmt(db.prepare('SELECT MIN(day) AS d FROM calls')),
      callCount: anyStmt(db.prepare('SELECT COUNT(*) AS n FROM calls')),
      countDayTotals: anyStmt(db.prepare('SELECT COUNT(*) AS n FROM day_totals')),
      listModels: anyStmt(db.prepare('SELECT DISTINCT model FROM calls')),
      allPrices: anyStmt(db.prepare('SELECT model, prompt_price, completion_price, cache_read_price, source, updated_at FROM model_prices')),
      upsertPrice: anyStmt(db.prepare('INSERT INTO model_prices(model, prompt_price, completion_price, cache_read_price, source, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(model) DO UPDATE SET prompt_price = excluded.prompt_price, completion_price = excluded.completion_price, cache_read_price = excluded.cache_read_price, source = excluded.source, updated_at = excluded.updated_at')),
      countPrices: anyStmt(db.prepare('SELECT COUNT(*) AS n FROM model_prices')),
      getMeta: anyStmt(db.prepare('SELECT value FROM meta WHERE key = ?')),
      setMeta: anyStmt(db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')),
      setDayStats: anyStmt(db.prepare('INSERT INTO day_stats(day, turns, steps, tools) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET turns = excluded.turns, steps = excluded.steps, tools = excluded.tools')),
      setDayTotals: anyStmt(db.prepare('INSERT INTO day_totals(day, requests, input, output, cache_read) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET requests = excluded.requests, input = excluded.input, output = excluded.output, cache_read = excluded.cache_read')),
    }
  }

  function flushPending() {
    if (!db || !stmts || (!pendingWatermarks.size && !pendingDayStats.size)) return
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

  function queueDayStat(day: string, turns: number, steps: number, tools: number) {
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

  const usageCache = new Map<string, UsageResult>()
  const CACHE_LIMIT = 8

  // —— v1.x JSON 分片缓存迁移（一次性）——
  function migrateLegacyCache() {
    if (!stmts) return
    const shardDir = path.join(dataDir, 'usage-cache')
    const legacyFile = path.join(dataDir, 'usage-cache.json')
    try {
      if (existsSync(shardDir) && !stmts.getMeta.get('migratedShards')) {
        let days = 0
        for (const name of readdirSync(shardDir)) {
          const m = /^day-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)
          if (!m) continue
          let shard: Record<string, unknown> | null = null
          try { shard = JSON.parse(readFileSync(path.join(shardDir, name), 'utf8')) as Record<string, unknown> } catch (e) { continue }
          if (!shard || typeof shard !== 'object') continue
          const day = m[1]
          const t = (shard.total && typeof shard.total === 'object' ? shard.total : {}) as Record<string, number>
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
          const meta = JSON.parse(readFileSync(path.join(shardDir, 'meta.json'), 'utf8')) as { sessions?: Record<string, unknown> }
          if (meta && meta.sessions) {
            for (const [id, entry] of Object.entries(meta.sessions)) {
              const seq = entry && typeof entry === 'object' ? (entry as { seq?: unknown }).seq : entry
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

  // 启动同步段只保留「必需且轻量」的开库/建表/注册；所有一次性重活
  // （旧缓存迁移、day_totals 回填、COUNT(*) 日志）延后到 DSH 启动完成后再跑，
  // 避免与 DSH 启动首屏/首批 RPC 抢 IO。
  function deferredMaintenance() {
    if (!stmts) return
    try { migrateLegacyCache() } catch (e) { /* 迁移失败不影响运行 */ }
    try {
      // 兼容旧库：day_totals 为空时由 calls 全量回填（全新安装 calls 也为空，为 no-op）
      const dtCount = num(stmts.countDayTotals.get()?.n)
      if (dtCount === 0) {
        db && db.exec('INSERT INTO day_totals(day, requests, input, output, cache_read) SELECT day, COUNT(*), IFNULL(SUM(input),0), IFNULL(SUM(output),0), IFNULL(SUM(cache_read),0) FROM calls GROUP BY day')
        console.log('[用量统计] 已完成 day_totals 全量回填')
      }
    } catch (e) { /* 回填失败不影响运行 */ }
    try { console.log('[用量统计] 当前累计 ' + num(stmts.callCount.get()?.n) + ' 条调用记录') } catch (e) { /* ignore */ }
    bumpUsage()
  }

  try {
    openDb()
    usage.ready = true
    bumpUsage()
    console.log('[用量统计] SQLite 就绪：' + dbFile)
  } catch (e) {
    usage.error = 'SQLite 初始化失败：' + String(e && (e as Error).message || e).slice(0, 200)
    usage.ready = true
    bumpUsage()
    return
  }

  // ===== 价格与成本（参考 cpa-usage-keeper 定价模型）=====
  // 价格单位：USD / 1M tokens（models.dev 同款）。手动触发同步 → 写入 model_prices 缓存，
  // 显示时按缓存价格实时换算成本，价格更新后历史金额自动生效。
  // 内置 DeepSeek 常见模型价格作为离线兜底（手动同步前即可出金额）。
  const BUILTIN_PRICES: Record<string, [number, number, number]> = {
    // 模型 → [prompt(未命中输入), completion, cache_read(命中)]
    'deepseek-v4-flash': [0.44, 1.32, 0.014],
    'deepseek-v4-pro': [1.32, 3.96, 0.044],
    'deepseek-chat': [0.14, 0.28, 0.014],
    'deepseek-reasoner': [0.55, 2.19, 0.14],
  }
  type Price = [number, number, number]

  function computeCost(input: number, output: number, cacheRead: number, price: Price | undefined): number | null {
    if (!price) return null
    const normalInput = Math.max(0, input - cacheRead)
    return (normalInput / 1e6) * price[0] + (cacheRead / 1e6) * price[2] + (output / 1e6) * price[1]
  }

  function loadPrices(): Map<string, Price> {
    const map = new Map<string, Price>()
    if (!stmts) return map
    for (const row of stmts.allPrices.all()) {
      map.set(str(row.model), [num(row.prompt_price), num(row.completion_price), num(row.cache_read_price)])
    }
    return map
  }

  // 模型匹配（沿用 cpa-usage-keeper：去 /: 前缀 → 归一化 → 官方 provider 优先）
  function normalizeModelKey(value: unknown) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  }
  function stripModelPrefix(model: string) {
    const trimmed = String(model || '').trim()
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf(':'))
    return idx >= 0 && idx < trimmed.length - 1 ? trimmed.slice(idx + 1).trim() : trimmed
  }
  interface CatalogEntry { input: number; output: number; cacheRead: number; providerID: string }
  function matchModelPrice(model: string, catalogModels: Map<string, CatalogEntry>) {
    const suffix = stripModelPrefix(model)
    const candidates: Array<{ model: string; price: CatalogEntry; score: number }> = []
    const add = (model: string, price: CatalogEntry | undefined, score: number) => { if (price) candidates.push({ model, price, score }) }
    // catalogModels: Map<normalizedKey, priceEntry>
    const exact = (name: string) => catalogModels.get(normalizeModelKey(name))
    if (suffix !== model) {
      add(suffix, exact(suffix), 100)
      add(model, exact(model), 90)
    } else {
      add(model, exact(model), 100)
    }
    candidates.sort((a, b) => b.score - a.score)
    return candidates.length ? candidates[0] : null
  }

  async function syncPricesFromCatalog() {
    if (!stmts) return { ok: false, error: '存储未就绪', source: 'models.dev' }
    const source = 'models.dev'
    const url = 'https://models.dev/api.json'
    let catalog: Record<string, unknown> | null = null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      clearTimeout(timer)
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const json = await resp.json()
      catalog = json && typeof json === 'object' ? json as Record<string, unknown> : null
    } catch (e) {
      return { ok: false, error: '价格源不可达：' + String(e && (e as Error).message || e).slice(0, 120), source: source }
    }
    // 展平 catalog：provider → models
    const entries: Array<{ id: string; providerID: string; input: number; output: number; cacheRead: number }> = []
    if (catalog) {
      for (const providerKey of Object.keys(catalog)) {
      const provider = catalog[providerKey] as { id?: unknown; models?: Record<string, { id?: unknown; cost?: { input?: unknown; output?: unknown; cache_read?: unknown } }> } | null
      if (!provider || typeof provider !== 'object') continue
      const providerID = String(provider.id || providerKey || '').trim()
      if (!providerID) continue
      const models = provider.models || {}
      for (const modelKey of Object.keys(models)) {
        const model = models[modelKey]
        const cost = model && model.cost
        if (!cost || cost.input == null || cost.output == null) continue
        const id = String(model.id || modelKey || '').trim()
        if (!id) continue
        entries.push({
          id: id,
          providerID: providerID,
          input: Number(cost.input),
          output: Number(cost.output),
          cacheRead: cost.cache_read != null ? Number(cost.cache_read) : 0,
        })
      }
      }
    }
    // 建立归一化索引：同一模型可能多 provider，保留官方优先（deepseek 官方在前）
    const index = new Map<string, CatalogEntry>()
    const familyRank = (p: string) => (p === 'deepseek' ? 0 : p.indexOf('deepseek') >= 0 ? 1 : 100)
    for (const entry of entries) {
      const key = normalizeModelKey(stripModelPrefix(entry.id))
      if (!key) continue
      const existing = index.get(key)
      if (!existing || familyRank(entry.providerID) < familyRank(existing.providerID)) {
        index.set(key, { input: entry.input, output: entry.output, cacheRead: entry.cacheRead, providerID: entry.providerID })
      }
    }
    // 同步我们 calls 中出现过的模型
    const models = stmts.listModels.all().map((r) => str(r.model))
    let synced = 0
    const unmatched: string[] = []
    const now = Date.now()
    for (const model of models) {
      const match = matchModelPrice(model, index)
      if (!match) { unmatched.push(model); continue }
      stmts.upsertPrice.run(model, match.price.input, match.price.output, match.price.cacheRead, source, now)
      synced += 1
    }
    stmts.setMeta.run('priceSyncedAt', String(now))
    return {
      ok: true,
      source: source,
      synced: synced,
      unmatched: unmatched,
      total: num(stmts.countPrices.get()?.n),
    }
  }

  // 启动时：写入内置兜底价格（仅当 model_prices 为空）
  ;((S: Statements) => {
    try {
      if (num(S.countPrices.get()?.n) === 0) {
        const now = Date.now()
        for (const [model, prices] of Object.entries(BUILTIN_PRICES)) {
          S.upsertPrice.run(model, prices[0], prices[1], prices[2], 'builtin', now)
        }
      }
    } catch (e) { /* 价格初始化失败不影响启动 */ }
  })(stmts as unknown as Statements)

  // ===== 事件摄取 =====
  function ingestEvent(sessionId: string, event: UsageEvent) {
    if (!stmts) return
    const time = event.time
    const data = event.data || {}
    if (event.type === 'assistant/message') {
      const usageInfo = data.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } | undefined
      if (usageInfo) {
        const message = data.message as { source?: { model?: unknown } } | undefined
        const model = message && message.source ? String(message.source.model || 'unknown') : 'unknown'
        const day = dayKeyOf(time)
        const input = num(usageInfo.inputTokens)
        const output = num(usageInfo.outputTokens)
        const cacheRead = num(usageInfo.cacheReadTokens)
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

  function advanceWatermark(id: string, seq: number | undefined): number | undefined {
    if (!stmts) return undefined
    const prev = liveSeqs.get(id)
    if (prev === undefined) {
      const row = stmts.getWatermark.get(id)
      liveSeqs.set(id, row ? num(row.seq) : 0)
      liveSeqAt.set(id, row ? num(row.at) : 0)
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

  ctx.on('session/event', (session: SessionLike, event: UsageEvent) => {
    if (!session || !event || typeof event.time !== 'number') return
    const id = String(session.id || '')
    if (!id) return
    const prev = advanceWatermark(id, event.seq)
    if (prev === undefined) return
    ingestEvent(id, event)
  })

  function watermarkAt(id: string): number {
    if (!stmts) return 0
    // 该会话水位线最近推进时间（liveSeqs 缓存或 DB 持久值）
    if (liveSeqAt.has(id)) return liveSeqAt.get(id)!
    const row = stmts.getWatermark.get(id)
    const at = row ? num(row.at) : 0
    liveSeqAt.set(id, at)
    return at
  }

  // 定期清理 90 天未更新的会话水位线，防止 sessions 表无限膨胀
  function pruneSessions() {
    if (!db || !stmts) return
    try { stmts.pruneSessions.run(Date.now() - 90 * 86400000) } catch (e) { /* ignore */ }
  }

  async function scanHistory() {
    if (!sessionQuery || !stmts) return
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
        const headerAt = Number(record.header.updatedAt || record.header.lastEventAt || record.header.mtimeMs || 0)
        if (headerAt && headerAt <= watermarkAt(id)) { skipped += 1; continue }
        try {
          const snapshot = await sessionQuery.readSession(id)
          const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
          const maxSeq = advanceWatermark(id, undefined) || 0
          // 事务批处理：单会话可能上万事件，避免逐条 autocommit（每条一次 fsync）
          db!.exec('BEGIN')
          try {
            for (const event of events) {
              if (!event || typeof event.time !== 'number') continue
              const eseq = typeof event.seq === 'number' ? event.seq : 0
              if (eseq > 0 && eseq <= maxSeq) continue
              ingestEvent(id, event as unknown as UsageEvent)
              advanceWatermark(id, eseq || undefined)
            }
            db!.exec('COMMIT')
          } catch (inner) {
            db!.exec('ROLLBACK')
            throw inner
          }
          scanned += 1
        } catch (e) { /* 单会话读取失败则跳过 */ }
        if (scanned >= 1000) break
        // 时间片让出：每扫 10 个会话让出事件循环更久，避免连续解压/写库
        // 长时间占用 host（补扫本身就是低优先级后台任务，不应挤占 DSH 主流程）
        if (scanned % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        } else {
          await new Promise((resolve) => setImmediate(resolve))
        }
      }
      if (skipped) console.log('[用量统计] ' + skipped + ' 个会话已追平，跳过解压')
    } catch (e) {
      usage.error = String(e && (e as Error).message || e).slice(0, 300)
    }
    bumpUsage()
    flush()
    console.log('[用量统计] 增量扫描完成：累计 ' + num(stmts.callCount.get()?.n) + ' 条调用记录')
  }
  // 一次性维护（迁移/回填/日志）延后到 DSH 启动完成后再跑
  setTimeout(() => { deferredMaintenance() }, 5000)
  // 查询（all 含）纯读 SQLite、开库即 ready；补扫仅用于追回离线期间用量，
  // 大幅延后启动（等待 DSH 完成启动与首批 RPC），并对扫描做时间片让出，
  // 避免与 DSH 启动首屏/首批 RPC 抢 IO。
  setTimeout(() => { scanHistory() }, 20000)
  // 过期会话水位线清理：首次延后 60s，此后每天一次
  setTimeout(() => { pruneSessions() }, 60000)
  ctx.interval(() => { pruneSessions() }, 86400000)

  // ===== 范围查询 =====
  function dayOffset(n: number) {
    const d = new Date(Date.now() - n * 86400000)
    const pad = (v: number) => String(v).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function computeUsage(range: string, heatYear?: unknown): UsageResult | null {
    if (!db || !stmts) return null
    // 结果缓存：数据版本未变（无新事件入库）时直接复用，避免每次轮询重复聚合；
    // 价格同步版本也纳入 key，同步价格后强制重算金额。
    const nowYear = new Date().getFullYear()
    const heatYearNum = Number(heatYear)
    const y = Number.isInteger(heatYearNum) && heatYearNum >= 2000 && heatYearNum <= nowYear ? heatYearNum : nowYear
    let priceRev = ''
    try {
      const m = stmts.getMeta.get('priceSyncedAt')
      priceRev = m && m.value != null ? String(m.value) : ''
    } catch (e) { /* ignore */ }
    const cacheKey = range + '|' + y + '|' + usage.version + '|' + priceRev
    const cached = usageCache.get(cacheKey)
    if (cached) return cached
    // 查询前同步提交内存缓冲，保证刚发生的实时事件立即可见
    flushPending()
    let since = '0000-00-00'
    let prevSince: { from: string; to: string } | null = null
    // 范围语义：1d=今天；7d=最近7天（含今天）；30d=最近30天；all=全部。
    // 上一周期与之对齐且不重叠：1d→昨天，7d→前7天，30d→前30天。
    if (range === '1d') { since = dayOffset(0); prevSince = { from: dayOffset(1), to: dayOffset(1) } }
    else if (range === '7d') { since = dayOffset(6); prevSince = { from: dayOffset(13), to: dayOffset(7) } }
    else if (range === '30d') { since = dayOffset(29); prevSince = { from: dayOffset(59), to: dayOffset(30) } }
    const sinceTo = range === 'all' ? '9999-12-31' : dayOffset(0)
    const yearFrom = y + '-01-01'
    const yearTo = y + '-12-31'

    // 日聚合与汇总全部走 day_totals（每日一行），不再对 calls 明细表全表 GROUP BY
    const totalsRow = stmts.totalsRange.get(since, sinceTo) || {}
    const totals = {
      requests: num(totalsRow.requests),
      input: num(totalsRow.input),
      output: num(totalsRow.output),
      cache_read: num(totalsRow.cache_read),
    }
    let prevTotals: { total: number; requests: number } | null = null
    if (prevSince) {
      const prevRow = stmts.totalsRange.get(prevSince.from, prevSince.to) || {}
      const prev = {
        requests: num(prevRow.requests),
        input: num(prevRow.input),
        output: num(prevRow.output),
        cache_read: num(prevRow.cache_read),
      }
      if (prev.requests > 0) {
        prevTotals = { total: prev.input + prev.output + prev.cache_read, requests: prev.requests }
      }
    }

    const callsByDay = new Map<string, DailyRow>(stmts.dailyRange.all(since, sinceTo).map((row) => [str(row.day), toDailyRow(row)]))
    const statsByDay = new Map<string, StatsRow>(stmts.statsRange.all(since, sinceTo).map((row) => [str(row.day), toStatsRow(row)]))
    // 按日×模型聚合 token，用于精确计算每日/总量金额（不同模型价格不同）
    const prices = loadPrices()
    const dayCost = new Map<string, number>()
    const modelCost = new Map<string, number>()
    for (const row of stmts.dailyModelTokens.all(since, sinceTo)) {
      const model = str(row.model)
      const price = prices.get(model)
      if (!price) continue
      const cost = computeCost(num(row.input), num(row.output), num(row.cache_read), price)
      if (cost == null) continue
      const day = str(row.day)
      dayCost.set(day, (dayCost.get(day) || 0) + cost)
      modelCost.set(model, (modelCost.get(model) || 0) + cost)
    }
    const days = [...new Set([...callsByDay.keys(), ...statsByDay.keys()])].sort()
    const daily: DayStat[] = days.map((day) => {
      const c = callsByDay.get(day)
      const st = statsByDay.get(day)
      const prompt = (c ? c.input : 0) + (c ? c.cache_read : 0)
      return {
        date: day,
        requests: c ? c.requests : 0,
        prompt: prompt,
        completion: c ? c.output : 0,
        cache_read: c ? c.cache_read : 0,
        total: prompt + (c ? c.output : 0),
        cost: dayCost.get(day) || 0,
        tools: st ? st.tools : 0,
        turns: st ? st.turns : 0,
        steps: st ? st.steps : 0,
      }
    })

    // all-time 的总量/模型统计覆盖全历史；图表日序列限制最近 365 天，
    // 避免历史越长导致前端生成成千上万个 DOM 节点。
    const dailyForView = range === 'all' ? daily.slice(-365) : daily

    // 用量日历（自然年 1/1~12/31）：heat = 指定年份的完整日序列
    const heatCalls = new Map<string, DailyRow>(stmts.dailyRange.all(yearFrom, yearTo).map((row) => [str(row.day), toDailyRow(row)]))
    const heatStats = new Map<string, StatsRow>(stmts.statsRange.all(yearFrom, yearTo).map((row) => [str(row.day), toStatsRow(row)]))
    const heatCost = new Map<string, number>()
    for (const row of stmts.dailyModelTokens.all(yearFrom, yearTo)) {
      const model = str(row.model)
      const price = prices.get(model)
      if (!price) continue
      const cost = computeCost(num(row.input), num(row.output), num(row.cache_read), price)
      if (cost != null) {
        const day = str(row.day)
        heatCost.set(day, (heatCost.get(day) || 0) + cost)
      }
    }
    const heatDays: DayStat[] = [...new Set([...heatCalls.keys(), ...heatStats.keys()])].sort().map((day) => {
      const c = heatCalls.get(day)
      const st = heatStats.get(day)
      return {
        date: day,
        requests: c ? c.requests : 0,
        prompt: (c ? c.input : 0) + (c ? c.cache_read : 0),
        completion: c ? c.output : 0,
        cache_read: c ? c.cache_read : 0,
        total: (c ? c.input : 0) + (c ? c.cache_read : 0) + (c ? c.output : 0),
        cost: heatCost.get(day) || 0,
        tools: st ? st.tools : 0,
        turns: st ? st.turns : 0,
        steps: st ? st.steps : 0,
      }
    })
    const minDayRow = stmts.minCallDay.get()
    const minDay = minDayRow && minDayRow.d ? String(minDayRow.d) : ''
    const minYear = minDay ? Number(minDay.slice(0, 4)) : nowYear
    const heatYears: number[] = []
    for (let yy = Math.min(minYear, nowYear); yy <= nowYear; yy += 1) heatYears.push(yy)

    const models: ModelStat[] = stmts.modelsRange.all(since, sinceTo).map((row) => {
      const model = str(row.model)
      const input = num(row.input) + num(row.cache_read)
      const output = num(row.output)
      const cacheRead = num(row.cache_read)
      return {
        model: model,
        requests: num(row.requests),
        input: input,
        output: output,
        cacheRead: cacheRead,
        total: input + output + cacheRead,
        cost: modelCost.get(model) || 0,
      }
    })
    models.sort((a, b) => b.total - a.total)

    const totalCost = daily.reduce((s, d) => s + d.cost, 0)
    const totalsPrompt = totals.input + totals.cache_read
    const result: UsageResult = {
      totals: {
        total: totalsPrompt + totals.output,
        prompt: totalsPrompt,
        completion: totals.output,
        cache_read: totals.cache_read,
        requests: totals.requests,
        cost: totalCost,
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
      pricing: {
        available: prices.size > 0,
        syncedAt: priceRev ? Number(priceRev) : 0,
      },
    }
    // 简单 LRU：超限时清掉最旧的条目
    if (usageCache.size >= CACHE_LIMIT) {
      const firstKey = usageCache.keys().next().value
      if (firstKey !== undefined) usageCache.delete(firstKey)
    }
    usageCache.set(cacheKey, result)
    return result
  }

  // ===== 私有 RPC：webServer 路由（POST /tusage/api/<name>，JSON in/out）=====
  function registerRoute(name: string, handler: (args: Record<string, unknown>) => unknown | Promise<unknown>) {
    if (!webServer) return
    webServer.register({
      kind: 'exact',
      path: '/tusage/api/' + name,
      handler: async (req, res) => {
        let body = ''
        try {
          for await (const chunk of req) body += chunk
        } catch (e) { /* 忽略读流错误 */ }
        let args: Record<string, unknown> = {}
        try { args = body ? JSON.parse(body) : {} } catch (e) { args = {} }
        let result: unknown
        try {
          result = await handler(args)
        } catch (e) {
          result = { error: String(e && (e as Error).message || e).slice(0, 500) }
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

  // 手动触发价格同步（从 models.dev 拉取并缓存到 model_prices）
  registerRoute('sync-prices', async () => {
    const result = await syncPricesFromCatalog()
    if (result.ok) bumpUsage() // 触发价格版本变化，前端强制刷新金额
    return result
  })

  // 返回缓存的单价表（model_prices 全量，USD / 1M tokens）
  registerRoute('get-prices', async () => {
    if (!stmts) return { prices: [] }
    const rows = stmts.allPrices.all().map((row) => ({
      model: str(row.model),
      prompt: num(row.prompt_price),
      completion: num(row.completion_price),
      cacheRead: num(row.cache_read_price),
      source: str(row.source),
      updatedAt: num(row.updated_at),
    }))
    rows.sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
    return { prices: rows }
  })
}

// ===== 查询结果 / 行类型 =====
interface DailyRow { requests: number; input: number; output: number; cache_read: number }
interface StatsRow { turns: number; steps: number; tools: number }
function toDailyRow(row: Record<string, unknown>): DailyRow {
  return { requests: num(row.requests), input: num(row.input), output: num(row.output), cache_read: num(row.cache_read) }
}
function toStatsRow(row: Record<string, unknown>): StatsRow {
  return { turns: num(row.turns), steps: num(row.steps), tools: num(row.tools) }
}

interface DayStat {
  date: string
  requests: number
  prompt: number
  completion: number
  cache_read: number
  total: number
  cost: number
  tools: number
  turns: number
  steps: number
}
interface ModelStat {
  model: string
  requests: number
  input: number
  output: number
  cacheRead: number
  total: number
  cost: number
}
interface UsageResult {
  totals: {
    total: number
    prompt: number
    completion: number
    cache_read: number
    requests: number
    cost: number
    turns: number
    steps: number
    tools: number
  }
  prevTotals: { total: number; requests: number } | null
  daily: DayStat[]
  heat: DayStat[]
  heatYear: number
  heatYears: number[]
  models: ModelStat[]
  pricing: { available: boolean; syncedAt: number }
}
