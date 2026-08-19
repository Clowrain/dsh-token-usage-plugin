// dsh-token-usage-plugin —— Host 半端（静态 cordis 插件形态）
// 供 `dsh plugin --profile web add <package>` 安装。
// 仅保留用量统计：session/event 实时监听 + 90 天历史扫描（按 seq 去重）。
// 聚合结果与每会话 seq 水位线持久化到 ~/.dsh/plugins/dsh-token-usage-plugin/，
// 重启后先回放缓存（面板秒开），再后台增量补扫，不重复计数。
// RPC 通过 ctx.webServer 提供 HTTP 路由（POST /tusage/api/<name>），Client 用 fetch 调用。

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const inject = ['timer', 'webServer']

const CACHE_VERSION = 1

export function apply(ctx) {
  const webServer = ctx.webServer
  const sessionQuery = ctx.get('sessionQuery')

  // ===== 持久化缓存 =====
  const cacheDir = path.join(os.homedir(), '.dsh', 'plugins', 'dsh-token-usage-plugin')
  const cacheFile = path.join(cacheDir, 'usage-cache.json')
  let saveTimer = null
  let saving = false

  function aggToPlain(agg) {
    return {
      requests: agg.requests, input: agg.input, output: agg.output,
      cacheRead: agg.cacheRead, tools: agg.tools, turns: agg.turns, steps: agg.steps, total: agg.total,
    }
  }

  function plainToAgg(p) {
    return {
      requests: p.requests || 0, input: p.input || 0, output: p.output || 0,
      cacheRead: p.cacheRead || 0, tools: p.tools || 0, turns: p.turns || 0, steps: p.steps || 0, total: p.total || 0,
    }
  }

  function serializeUsage() {
    const cut = Date.now() - USAGE_KEEP_MS
    const perDay = {}
    for (const [day, agg] of usage.perDay) {
      if (day >= dayKeyOf(cut)) perDay[day] = aggToPlain(agg)
    }
    const perModel = {}
    for (const [model, byDay] of usage.perModel) {
      const days = {}
      for (const [day, agg] of byDay) {
        if (day >= dayKeyOf(cut)) days[day] = aggToPlain(agg)
      }
      if (Object.keys(days).length) perModel[model] = days
    }
    const records = usage.records.filter((r) => r.time >= cut)
    return {
      cacheVersion: CACHE_VERSION,
      savedAt: Date.now(),
      perDay: perDay,
      perModel: perModel,
      records: records,
      sessions: Object.fromEntries(liveSeqs),
    }
  }

  async function saveCache() {
    if (saving) return
    saving = true
    const tmp = cacheFile + '.tmp'
    try {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(tmp, JSON.stringify(serializeUsage()), 'utf8')
      await rename(tmp, cacheFile)
    } catch (e) { /* 磁盘写入失败不影响内存统计 */ }
    finally { saving = false }
  }

  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveCache()
    }, 3000)
  }


  async function loadCache() {
    let raw = ''
    try { raw = await readFile(cacheFile, 'utf8') } catch (e) { return false }
    let obj = null
    try { obj = JSON.parse(raw) } catch (e) { return false }
    if (!obj || obj.cacheVersion !== CACHE_VERSION || typeof obj.perDay !== 'object' || !obj.perDay) return false
    try {
      for (const [day, agg] of Object.entries(obj.perDay)) {
        usage.perDay.set(day, plainToAgg(agg))
      }
      for (const [model, days] of Object.entries(obj.perModel || {})) {
        const byDay = new Map()
        for (const [day, agg] of Object.entries(days)) byDay.set(day, plainToAgg(agg))
        usage.perModel.set(model, byDay)
      }
      if (Array.isArray(obj.records)) {
        usage.records = obj.records.filter((r) => r && typeof r.time === 'number' && typeof r.model === 'string')
        if (usage.records.length > 50) usage.records.length = 50
      }
      if (obj.sessions && typeof obj.sessions === 'object') {
        for (const [id, seq] of Object.entries(obj.sessions)) {
          if (typeof seq === 'number' && seq > 0) liveSeqs.set(id, seq)
        }
      }
      return true
    } catch (e) { return false }
  }

  // ===== 用量统计（复刻 Miyu 用量页数据）=====
  const USAGE_KEEP_MS = 90 * 86400000
  const usage = {
    ready: false,
    error: null,
    version: 0,
    perDay: new Map(),
    perModel: new Map(),
    records: [],
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
  const liveSeqs = new Map()

  function dayKeyOf(time) {
    const d = new Date(time)
    const pad = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function emptyAgg() {
    return { requests: 0, input: 0, output: 0, cacheRead: 0, tools: 0, turns: 0, steps: 0, total: 0 }
  }

  function mergeAgg(target, source) {
    target.requests += source.requests || 0
    target.input += source.input || 0
    target.output += source.output || 0
    target.cacheRead += source.cacheRead || 0
    target.tools += source.tools || 0
    target.turns += source.turns || 0
    target.steps += source.steps || 0
    target.total = target.input + target.output
  }

  function bumpUsage() { usage.version += 1; scheduleSave() }

  function ingestEvent(sessionId, event) {
    const time = event.time
    const data = event.data || {}
    const live = usage.live
    if (event.type === 'assistant/message') {
      const usageInfo = data.usage
      if (usageInfo) {
        const model = data.message && data.message.source ? String(data.message.source.model || 'unknown') : 'unknown'
        const day = dayKeyOf(time)
        const agg = {
          requests: 1,
          input: usageInfo.inputTokens || 0,
          output: usageInfo.outputTokens || 0,
          cacheRead: usageInfo.cacheReadTokens || 0,
          tools: 0,
          turns: 0,
          steps: 0,
        }
        const dayAgg = usage.perDay.get(day) || emptyAgg()
        mergeAgg(dayAgg, agg)
        usage.perDay.set(day, dayAgg)
        let modelMap = usage.perModel.get(model)
        if (!modelMap) { modelMap = new Map(); usage.perModel.set(model, modelMap) }
        const modelAgg = modelMap.get(day) || emptyAgg()
        mergeAgg(modelAgg, agg)
        modelMap.set(day, modelAgg)
        live.outputTokens += usageInfo.outputTokens || 0
        usage.records.unshift({ time: time, sessionId: String(sessionId).slice(0, 8), model: model, input: agg.input + agg.cacheRead, output: agg.output, cacheRead: agg.cacheRead })
        if (usage.records.length > 50) usage.records.length = 50
        bumpUsage()
      }
      return
    }
    if (event.type === 'turn/end') {
      const day = dayKeyOf(time)
      const dayAgg = usage.perDay.get(day) || emptyAgg()
      dayAgg.turns += 1
      usage.perDay.set(day, dayAgg)
      live.turns += 1
      bumpUsage()
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
      const day = dayKeyOf(time)
      const dayAgg = usage.perDay.get(day) || emptyAgg()
      dayAgg.steps += 1
      usage.perDay.set(day, dayAgg)
      live.steps += 1
      bumpUsage()
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
      const day = dayKeyOf(time)
      const dayAgg = usage.perDay.get(day) || emptyAgg()
      dayAgg.tools += 1
      usage.perDay.set(day, dayAgg)
      bumpUsage()
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

  ctx.on('session/event', (session, event) => {
    if (!session || !event || typeof event.time !== 'number') return
    const id = String(session.id || '')
    if (!id) return
    const prev = liveSeqs.get(id) || 0
    if (typeof event.seq === 'number' && event.seq > prev) liveSeqs.set(id, event.seq)
    if (event.time >= Date.now() - USAGE_KEEP_MS) ingestEvent(id, event)
  })

  async function scanHistory() {
    // 1) 先回放持久化缓存：命中即 ready，面板无需等待扫描
    const cached = await loadCache()
    if (cached) {
      usage.ready = true
      bumpUsage()
      console.log('[用量统计] 已加载缓存：' + usage.perDay.size + ' 天 · ' + usage.records.length + ' 条明细')
    }
    // 2) 后台增量补扫：只 ingest seq > 水位线的事件，与缓存合并不重复计数
    if (!sessionQuery) {
      usage.ready = true
      bumpUsage()
      return
    }
    try {
      const sessions = await sessionQuery.listSessions()
      const cut = Date.now() - USAGE_KEEP_MS
      let scanned = 0
      for (const record of sessions) {
        if (!record || !record.header) continue
        const id = String(record.header.id || '')
        if (!id) continue
        // 缓存里已有且水位线是近期更新的会话可跳过；无法判定时统一补扫（靠 seq 过滤兜底）
        try {
          const snapshot = await sessionQuery.readSession(id)
          const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
          const maxSeq = liveSeqs.get(id) || 0
          for (const event of events) {
            if (!event || typeof event.time !== 'number' || event.time < cut) continue
            if (typeof event.seq === 'number' && event.seq <= maxSeq) continue
            ingestEvent(id, event)
            if (typeof event.seq === 'number' && event.seq > (liveSeqs.get(id) || 0)) liveSeqs.set(id, event.seq)
          }
          scanned += 1
        } catch (e) { /* 单会话读取失败则跳过 */ }
        if (scanned >= 120) break
      }
    } catch (e) {
      usage.error = String(e && e.message || e).slice(0, 300)
    }
    usage.ready = true
    bumpUsage()
    saveCache()
    console.log('[用量统计] 增量扫描完成：' + usage.perDay.size + ' 天 · ' + usage.records.length + ' 条明细 · ' + usage.live.turns + ' 轮 / ' + usage.live.steps + ' 步')
  }
  scanHistory()

  function computeUsage(range) {
    const dayList = []
    for (const [key, agg] of usage.perDay) dayList.push({ date: key, agg: agg })
    dayList.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const totalFor = (list) => {
      const t = emptyAgg()
      for (const d of list) mergeAgg(t, d.agg)
      return t
    }
    let current = dayList
    let previous = []
    if (range === '1d') { current = dayList.slice(-2); previous = dayList.slice(-4, -2) }
    else if (range === '7d') { current = dayList.slice(-7); previous = dayList.slice(-14, -7) }
    else if (range === '30d') { current = dayList.slice(-30); previous = dayList.slice(-60, -30) }
    const totals = totalFor(current)
    const prevTotals = previous.length ? totalFor(previous) : null
    const models = []
    for (const [model, byDay] of usage.perModel) {
      let sum = null
      for (const day of current) {
        const agg = byDay.get(day.date)
        if (agg) { if (!sum) sum = emptyAgg(); mergeAgg(sum, agg) }
      }
      if (sum) models.push({
        model: model,
        requests: sum.requests,
        input: sum.input + sum.cacheRead,
        output: sum.output,
        cacheRead: sum.cacheRead,
        total: sum.input + sum.output + sum.cacheRead,
      })
    }
    models.sort((a, b) => b.total - a.total)
    const live = usage.live
    const totalsPrompt = totals.input + totals.cacheRead
    return {
      totals: {
        total: totalsPrompt + totals.output,
        prompt: totalsPrompt,
        completion: totals.output,
        cache_read: totals.cacheRead,
        requests: totals.requests,
        turns: totals.turns,
        steps: totals.steps,
        tools: totals.tools,
      },
      prevTotals: prevTotals ? { total: prevTotals.input + prevTotals.output + prevTotals.cacheRead, requests: prevTotals.requests } : null,
      daily: current.map((d) => {
        const prompt = d.agg.input + d.agg.cacheRead
        return {
          date: d.date,
          requests: d.agg.requests,
          prompt: prompt,
          completion: d.agg.output,
          cache_read: d.agg.cacheRead,
          total: prompt + d.agg.output,
          tools: d.agg.tools,
          turns: d.agg.turns,
          steps: d.agg.steps,
        }
      }),
      models: models,
      records: usage.records,
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
