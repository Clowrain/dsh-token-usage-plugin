// dsh-token-usage-plugin —— Client 半端（静态 web 插件形态，ModuleLoader bundle）
// 供 `dsh plugin --profile web add <package>` 安装后经 /plugins/dsh-token-usage-plugin/client.js 加载。
// 仅保留用量统计；RPC 通过 fetch POST /tusage/api/<name>。

window.__ModuleLoader__.load({
  id: 'dsh-token-usage-plugin',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    async function apiCall(name, args) {
      const res = await fetch('/tusage/api/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    }

    function insertStyles(css) {
      try {
        const style = document.createElement('style')
        style.textContent = css
        document.head.appendChild(style)
        return () => { try { style.remove() } catch (e) { /* ignore */ } }
      } catch (e) {
        return () => {}
      }
    }

    const inject = ['timer']

    function apply(ctx) {
      // 主题适配：DSH 通过 body[data-ds-dark-theme] 属性（而非 prefers-color-scheme）
      // 标记深色主题，因此配色跟随该属性，而不是跟随系统设置。
      insertStyles(`:root{
  --bmon-c1:#6b87d9;--bmon-c2:#b08427;--bmon-c3:#c65f7f;--bmon-c4:#8d7ce4;
  --bmon-h0:#262a3e;--bmon-h1:#303c66;--bmon-h2:#42549b;--bmon-h3:#5a71c4;--bmon-h4:#82a1ea;
  --bmon-track:rgba(255,255,255,.14);
}
body[data-ds-dark-theme]{
  --bmon-c1:#6b87d9;--bmon-c2:#b08427;--bmon-c3:#c65f7f;--bmon-c4:#8d7ce4;
  --bmon-h0:#262a3e;--bmon-h1:#303c66;--bmon-h2:#42549b;--bmon-h3:#5a71c4;--bmon-h4:#82a1ea;
  --bmon-track:rgba(255,255,255,.14);
}
body:not([data-ds-dark-theme]){
  --bmon-c1:#5d6cc4;--bmon-c2:#8f6b1e;--bmon-c3:#c2426e;--bmon-c4:#6d51c4;
  --bmon-h0:#ece4d1;--bmon-h1:#cdc7e8;--bmon-h2:#a8a0d6;--bmon-h3:#837ac0;--bmon-h4:#5b4fa0;
  --bmon-track:rgba(0,0,0,.10);
}
.bmon-ibar{width:28px;height:28px;border-radius:8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0;}
.bmon-ibar:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);}
.bmon-ibar-on{color:var(--dsw-alias-brand-primary);}
.bmon-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px;}
body:not([data-ds-dark-theme]) .bmon-overlay{background:rgba(0,0,0,.28);}
.bmon-overlay-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;width:min(780px,100%);max-height:84vh;display:flex;flex-direction:column;box-shadow:0 14px 44px rgba(0,0,0,.38);}
body:not([data-ds-dark-theme]) .bmon-overlay-card{box-shadow:0 14px 44px rgba(0,0,0,.22);}
.bmon-overlay-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.bmon-overlay-title{font-weight:600;font-size:14px;}
.bmon-overlay-body{padding:14px;overflow:auto;}
.bmon-btn{border:none;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:12px;padding:2px 6px;border-radius:6px;text-decoration:none;font-family:inherit;}
.bmon-btn:hover{background:var(--dsw-alias-bg-layer-1);}
.bmon-tip{position:relative;}
.bmon-tip[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 7px);transform:translateX(-50%);z-index:100;min-width:max-content;max-width:260px;padding:5px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 4px 12px rgba(0,0,0,.24);font-size:11px;font-weight:400;line-height:1.35;white-space:pre-line;pointer-events:none;}
.bmon-page{font-size:13px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;min-width:0;}
.bmon-hint{font-size:11px;color:var(--dsw-alias-label-secondary);}
.bmon-table{border-collapse:collapse;width:100%;font-size:12px;}
.bmon-table th,.bmon-table td{border-bottom:1px solid var(--dsw-alias-border-l1);padding:4px 6px;text-align:left;vertical-align:top;}
.bmon-err{color:var(--dsw-alias-state-error-primary);}
.bmon-input{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:13px;font-family:inherit;}
.bmon-input:focus{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent);outline-offset:1px;border-color:var(--dsw-alias-brand-primary);}
body[data-ds-dark-theme] .bmon-input{color-scheme:dark;}
body:not([data-ds-dark-theme]) .bmon-input{color-scheme:light;}
.bmon-u-table-scroll{max-width:100%;overflow-x:auto;}
.bmon-u-table-scroll .bmon-table{min-width:560px;}
.bmon-u-record-scroll{max-width:100%;overflow-x:auto;}
.bmon-u-record-scroll .bmon-table{min-width:680px;}
.bmon-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.bmon-u-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.bmon-u-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;}
.bmon-u-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 12px;font-size:12px;cursor:pointer;font-family:inherit;}
.bmon-u-seg button.on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand,var(--dsw-alias-bg-layer-1));}
.bmon-u-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}
.bmon-u-tile{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;min-width:0;}
.bmon-u-tile-label{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;}
.bmon-u-tile-value{font-size:20px;font-weight:600;line-height:1.2;}
.bmon-u-tile-value small{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:4px;}
.bmon-u-tile-sub{font-size:11px;color:var(--dsw-alias-label-secondary);}
.bmon-u-ringwrap{display:flex;align-items:center;gap:12px;}
.bmon-u-ring{width:56px;height:56px;border-radius:50%;position:relative;flex:none;}
.bmon-u-ring::after{content:'';position:absolute;inset:9px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);}
.bmon-u-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;z-index:1;}
.bmon-u-live{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;}
.bmon-u-heat-wrap{position:relative;padding-top:16px;}
.bmon-u-heat-months{position:absolute;top:0;left:0;right:0;height:14px;}
.bmon-u-heat-month{position:absolute;top:0;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.bmon-u-heat-body{display:flex;gap:5px;}
.bmon-u-heat-weekdays{display:flex;flex-direction:column;gap:3px;font-size:9px;color:var(--dsw-alias-label-secondary);}
.bmon-u-heat-weekdays span{height:10px;line-height:10px;}
.bmon-u-heat-cols{display:flex;gap:3px;}
.bmon-u-heat-col{display:flex;flex-direction:column;gap:3px;}
.bmon-u-heat-cell{position:relative;width:10px;height:10px;border-radius:3px;background:var(--bmon-h0);cursor:help;}
.bmon-u-heat-cell:hover{outline:1.5px solid var(--dsw-alias-border-l2);outline-offset:1px;z-index:10;}
.bmon-u-heat-cell[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 7px);transform:translateX(-50%);z-index:20;min-width:max-content;max-width:220px;padding:5px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 4px 12px rgba(0,0,0,.24);font-size:11px;font-style:normal;font-weight:400;line-height:1.35;white-space:nowrap;pointer-events:none;}
.bmon-u-heat-cell[data-l="1"]{background:var(--bmon-h1);}
.bmon-u-heat-cell[data-l="2"]{background:var(--bmon-h2);}
.bmon-u-heat-cell[data-l="3"]{background:var(--bmon-h3);}
.bmon-u-heat-cell[data-l="4"]{background:var(--bmon-h4);}
.bmon-u-heat-total{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:8px;}
.bmon-u-bars-wrap{position:relative;padding-top:22px;}
.bmon-u-bars{position:relative;height:200px;display:flex;align-items:flex-end;gap:3px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-left:36px;}
.bmon-u-bar-slot{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:200px;}
.bmon-u-bar-col{display:flex;flex-direction:column;justify-content:flex-end;width:62%;max-width:38px;min-width:5px;gap:2px;}
.bmon-u-bar-col:hover{filter:brightness(1.12);}
body:not([data-ds-dark-theme]) .bmon-u-bar-col:hover{filter:brightness(.92);}
.bmon-u-bar-col i{display:block;width:100%;min-height:1px;}
.bmon-u-bar-col i:last-child{border-radius:3px 3px 0 0;}
.bmon-u-s1{background:var(--bmon-c1);}
.bmon-u-s2{background:var(--bmon-c2);}
.bmon-u-s3{background:var(--bmon-c3);}
.bmon-u-gridline{position:absolute;left:36px;right:0;border-top:1px dashed var(--dsw-alias-border-l1);}
.bmon-u-y{position:absolute;left:0;transform:translateY(50%);font-size:9px;color:var(--dsw-alias-label-secondary);}
.bmon-u-x{display:flex;gap:3px;margin-top:2px;padding-left:36px;}
.bmon-u-x span{flex:1;min-width:0;font-size:9px;color:var(--dsw-alias-label-secondary);text-align:left;white-space:nowrap;overflow:hidden;}
.bmon-u-empty{padding:14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;}
.bmon-u-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;}
.bmon-u-card-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}
.bmon-u-modelbody{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;}
.bmon-u-donut{width:110px;height:110px;border-radius:50%;position:relative;flex:none;margin:6px auto;}
.bmon-u-donut::after{content:'';position:absolute;inset:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);}
.bmon-u-donut b{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1;font-size:14px;}
.bmon-u-donut b small{font-size:9px;color:var(--dsw-alias-label-secondary);}
.bmon-u-num{text-align:right;}`)

      const POLL_MS = 15000

      function useUsageState(range) {
        const pair = React.useState(null)
        const snapshot = pair[0]
        const setSnapshot = pair[1]
        const lastVersion = React.useRef(-1)
        React.useEffect(() => {
          let alive = true
          let timer = null
          lastVersion.current = -1 // 切换 range 后强制渲染一次（版本是全局的）
          const schedule = (ms) => {
            if (!alive) return
            if (timer) clearTimeout(timer)
            timer = setTimeout(tick, ms)
          }
          const tick = () => {
            // 面板不可见（GUI 标签页切走/最小化）时暂停轮询，回来自动续上
            if (document.hidden) return
            apiCall('get-usage', { range: range }).then((value) => {
              if (!alive) return
              if (value && typeof value === 'object') {
                // 数据版本未变则跳过 setState，避免整棵面板重渲染
                if (value.version !== lastVersion.current) {
                  lastVersion.current = value.version
                  setSnapshot(value)
                }
              }
              // 历史扫描未就绪时快速重试，就绪后回落到常规刷新间隔
              schedule(value && value.ready ? POLL_MS : 1200)
            }).catch(() => { if (alive) schedule(5000) })
          }
          tick()
          const onVisible = () => { if (!document.hidden) schedule(0) }
          document.addEventListener('visibilitychange', onVisible)
          return () => {
            alive = false
            if (timer) clearTimeout(timer)
            document.removeEventListener('visibilitychange', onVisible)
          }
        }, [range])
        return pair
      }

      function fmtTokens(value) {
        const n = Number(value) || 0
        if (n >= 1000000000) return (n / 1000000000).toFixed(2) + 'B'
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
        return String(Math.round(n))
      }

      function fmtDur(ms) {
        if (!(ms > 0)) return '—'
        const s = Math.round(ms / 1000)
        if (s < 60) return s + 's'
        if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60 ? (s % 60) + 's' : '')
        return Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60) + 'm'
      }

      function parseDate(key) {
        const parts = String(key).split('-').map(Number)
        return new Date(parts[0], parts[1] - 1, parts[2])
      }

      function Icon({ paths, size }) {
        return React.createElement('svg', { viewBox: '0 0 24 24', width: size || 17, height: size || 17, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: paths } })
      }

      function OverlayContent({ onClose }) {
        return React.createElement('div', { className: 'bmon-overlay', onClick: onClose },
          React.createElement('div', { className: 'bmon-overlay-card', onClick: (e) => e.stopPropagation() },
            React.createElement('div', { className: 'bmon-overlay-head' },
              React.createElement('span', { className: 'bmon-overlay-title' }, '用量统计'),
              React.createElement('button', { type: 'button', className: 'bmon-btn', onClick: onClose }, '✕ 关闭'),
            ),
            React.createElement('div', { className: 'bmon-overlay-body' }, React.createElement(UsagePage, null)),
          ),
        )
      }

      function IconBarButton({ paths, label }) {
        const pair = React.useState(false)
        const open = pair[0]
        const setOpen = pair[1]
        const children = [
          React.createElement('button', { key: 'b', type: 'button', className: 'bmon-ibar bmon-tip' + (open ? ' bmon-ibar-on' : ''), onClick: () => setOpen(!open), 'data-tip': label, 'aria-label': label },
            React.createElement(Icon, { paths: paths, size: 16 })),
        ]
        if (open) {
          children.push(React.createElement(OverlayContent, { key: 'o', onClose: () => setOpen(false) }))
        }
        return React.createElement('div', { className: 'bmon-ibar-wrap' }, ...children)
      }

      function UsageTiles({ stats, range }) {
        const totals = stats.totals
        const prev = stats.prevTotals
        const delta = (current, previous) => {
          if (!prev || !previous) return null
          const value = ((current || 0) / previous - 1) * 100
          return React.createElement('span', { key: 'd', className: 'bmon-tip', 'data-tip': '对比上一周期' },
            value >= 0 ? '▲' : '▼', ' ', Math.abs(value).toFixed(0) + '%')
        }
        const hit = totals.prompt > 0 ? (totals.cache_read / totals.prompt) * 100 : null
        const days = Math.max(1, stats.daily.length)
        const dailyAvg = range === '1d' ? '' : ' · 日均 ' + (totals.requests / days).toFixed(1) + ' 次'
        const fresh = Math.max(0, totals.prompt - totals.cache_read)
        const ringBg = hit === null
          ? 'var(--bmon-track)'
          : 'conic-gradient(var(--bmon-c3) ' + hit + '%, var(--bmon-track) 0)'
        const tiles = [
          React.createElement('div', { key: 't1', className: 'bmon-u-tile' },
            React.createElement('div', { className: 'bmon-u-tile-label' }, '总消耗', delta(totals.total, prev && prev.total)),
            React.createElement('div', { className: 'bmon-u-tile-value' }, fmtTokens(totals.total), React.createElement('small', null, 'tokens')),
            React.createElement('div', { className: 'bmon-u-tile-sub' }, '输入 ' + fmtTokens(totals.prompt) + ' · 输出 ' + fmtTokens(totals.completion)),
          ),
          React.createElement('div', { key: 't2', className: 'bmon-u-tile' },
            React.createElement('div', { className: 'bmon-u-tile-label' }, '轮次 / 步数'),
            React.createElement('div', { className: 'bmon-u-tile-value' }, String(totals.turns), React.createElement('small', null, '轮'), ' · ', String(totals.steps), React.createElement('small', null, '步')),
            React.createElement('div', { className: 'bmon-u-tile-sub' }, '工具调用 ' + totals.tools + ' 次'),
          ),
          React.createElement('div', { key: 't3', className: 'bmon-u-tile' },
            React.createElement('div', { className: 'bmon-u-tile-label' }, '请求数', delta(totals.requests, prev && prev.requests)),
            React.createElement('div', { className: 'bmon-u-tile-value' }, Number(totals.requests || 0).toLocaleString()),
            React.createElement('div', { className: 'bmon-u-tile-sub' }, '全部模型调用' + dailyAvg),
          ),
          React.createElement('div', { key: 't4', className: 'bmon-u-tile' },
            React.createElement('div', { className: 'bmon-u-tile-label' }, '缓存命中率'),
            React.createElement('div', { className: 'bmon-u-ringwrap' },
              React.createElement('div', { className: 'bmon-u-ring', style: { background: ringBg } },
                React.createElement('b', null, hit === null ? '—' : Math.round(hit) + '%')),
              React.createElement('div', { className: 'bmon-u-tile-sub' },
                React.createElement('div', null, '命中 ' + fmtTokens(totals.cache_read)),
                React.createElement('div', null, '新输入 ' + fmtTokens(fresh)),
              ),
            ),
          ),
        ]
        return React.createElement('div', { className: 'bmon-u-tiles' }, ...tiles)
      }

      function UsageHeatmap({ daily }) {
        if (!daily || !daily.length) return null
        const max = Math.max(1, ...daily.map((d) => d.total))
        const first = parseDate(daily[0].date)
        const lead = (first.getDay() + 6) % 7
        const columns = Math.ceil((lead + daily.length) / 7)
        const cols = []
        for (let col = 0; col < columns; col += 1) {
          const cells = []
          for (let row = 0; row < 7; row += 1) {
            const idx = col * 7 + row - lead
            const day = idx >= 0 && idx < daily.length ? daily[idx] : null
            if (day) {
              const level = day.total === 0 ? 0 : Math.min(4, 1 + Math.floor((day.total / max) * 3.99))
              const tip = day.date + '：' + fmtTokens(day.total) + ' tokens · ' + day.requests + ' 次请求'
              cells.push(React.createElement('i', { key: row, className: 'bmon-u-heat-cell', 'data-l': String(level),
                'data-tip': tip }))
            } else {
              cells.push(React.createElement('i', { key: row, className: 'bmon-u-heat-cell' }))
            }
          }
          cols.push(React.createElement('div', { key: col, className: 'bmon-u-heat-col' }, ...cells))
        }
        const monthLabels = []
        let previousMonth = -1
        for (let col = 0; col < columns; col += 1) {
          const idx = Math.min(Math.max(0, col * 7 - lead), daily.length - 1)
          const month = parseDate(daily[idx].date).getMonth()
          if (month !== previousMonth) {
            monthLabels.push(React.createElement('span', { key: col, className: 'bmon-u-heat-month', style: { left: ((col / columns) * 100) + '%' } }, (month + 1) + '月'))
            previousMonth = month
          }
        }
        const weekdays = ['一', '', '三', '', '五', '', ''].map((label, row) =>
          React.createElement('span', { key: row }, label))
        const requests = daily.reduce((sum, d) => sum + d.requests, 0)
        const tokens = daily.reduce((sum, d) => sum + d.total, 0)
        return React.createElement('div', { className: 'bmon-u-card' },
          React.createElement('div', { className: 'bmon-u-card-head' },
            React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '用量日历'),
            React.createElement('span', { className: 'bmon-hint' }, 'GitHub 贡献图风格 · 悬停看明细'),
          ),
          React.createElement('div', { className: 'bmon-u-heat-wrap' },
            React.createElement('div', { className: 'bmon-u-heat-months' }, ...monthLabels),
            React.createElement('div', { className: 'bmon-u-heat-body' },
              React.createElement('div', { className: 'bmon-u-heat-weekdays' }, ...weekdays),
              React.createElement('div', { className: 'bmon-u-heat-cols' }, ...cols),
            ),
          ),
          React.createElement('div', { className: 'bmon-u-heat-total' }, '共 ' + requests.toLocaleString() + ' 次调用 · ' + fmtTokens(tokens) + ' tokens'),
        )
      }

      function UsageBars({ daily, range }) {
        let slice = daily || []
        let weekly = false
        if (range === '1d') slice = slice.slice(-2)
        else if (range === '7d') slice = slice.slice(-7)
        else if (range === '30d') slice = slice.slice(-30)
        else {
          weekly = true
          const merged = []
          const weeks = Math.floor(slice.length / 7)
          for (let week = 0; week < weeks; week += 1) {
            const chunk = slice.slice(slice.length - (weeks - week) * 7, slice.length - (weeks - week - 1) * 7)
            if (!chunk.length) continue
            const m = { date: chunk[0].date, requests: 0, prompt: 0, completion: 0, cache_read: 0, total: 0 }
            for (const day of chunk) {
              m.requests += day.requests; m.prompt += day.prompt; m.completion += day.completion
              m.cache_read += day.cache_read; m.total += day.total
            }
            merged.push(m)
          }
          slice = merged
        }
        const HEIGHT = 200
        const max = Math.max(...slice.map((d) => d.total), 0)
        const children = []
        if (!max) {
          children.push(React.createElement('div', { key: 'empty', className: 'bmon-u-empty' }, '该范围内没有调用记录'))
          return React.createElement('div', { className: 'bmon-u-card' }, ...children)
        }
        const rawStep = max / 4
        const stepPow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))))
        const stepUnit = rawStep / stepPow
        const step = (stepUnit <= 1 ? 1 : stepUnit <= 2 ? 2 : stepUnit <= 5 ? 5 : 10) * stepPow
        const grid = [React.createElement('div', { key: 'g0', className: 'bmon-u-gridline', style: { bottom: 0 } }),
          React.createElement('span', { key: 'y0', className: 'bmon-u-y', style: { bottom: 0 } }, '0')]
        for (let value = step; value <= max; value += step) {
          grid.push(React.createElement('div', { key: 'g' + value, className: 'bmon-u-gridline', style: { bottom: (value / max) * HEIGHT + 'px' } }))
          grid.push(React.createElement('span', { key: 'y' + value, className: 'bmon-u-y', style: { bottom: (value / max) * HEIGHT + 'px' } }, fmtTokens(value)))
        }
        const bars = []
        const xlabels = []
        slice.forEach((day, index) => {
          const fresh = Math.max(0, day.prompt - day.cache_read)
          const segments = []
          for (const pair of [[fresh, 'bmon-u-s1'], [day.completion, 'bmon-u-s2'], [day.cache_read, 'bmon-u-s3']]) {
            segments.push(React.createElement('i', { key: pair[1], className: pair[1], style: { height: Math.max(pair[0] > 0 ? 1 : 0, (pair[0] / max) * HEIGHT) + 'px' } }))
          }
          const tip = day.date + (weekly ? ' 起当周' : '') + '\n新输入 ' + fmtTokens(fresh) + ' · 输出 ' + fmtTokens(day.completion) + ' · 缓存命中 ' + fmtTokens(day.cache_read) + '\n请求 ' + day.requests + ' · 合计 ' + fmtTokens(day.total)
          bars.push(React.createElement('div', { key: day.date, className: 'bmon-u-bar-slot bmon-tip', 'data-tip': tip },
            React.createElement('div', { className: 'bmon-u-bar-col' }, ...segments)))
          let labelText = ''
          if (weekly) labelText = index % 4 ? '' : day.date.slice(5)
          else if (slice.length > 16) labelText = index % 5 ? '' : day.date.slice(5)
          else if (slice.length === 1) labelText = day.date.slice(5)
          else labelText = day.date.slice(8)
          xlabels.push(React.createElement('span', { key: day.date }, labelText))
        })
        children.push(React.createElement('div', { key: 'head', className: 'bmon-u-card-head' },
          React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '消耗趋势'),
          React.createElement('span', { className: 'bmon-hint' }, weekly ? '按周聚合 · 悬停看明细' : '悬停看明细'),
        ))
        children.push(React.createElement('div', { key: 'legend', className: 'bmon-row', style: { marginBottom: 4 } },
          React.createElement('span', { className: 'bmon-hint' }, React.createElement('i', { style: { display: 'inline-block', width: 8, height: 8, background: 'var(--bmon-c1)', borderRadius: 2, marginRight: 4 } }), '新输入'),
          React.createElement('span', { className: 'bmon-hint' }, React.createElement('i', { style: { display: 'inline-block', width: 8, height: 8, background: 'var(--bmon-c2)', borderRadius: 2, marginRight: 4 } }), '输出'),
          React.createElement('span', { className: 'bmon-hint' }, React.createElement('i', { style: { display: 'inline-block', width: 8, height: 8, background: 'var(--bmon-c3)', borderRadius: 2, marginRight: 4 } }), '缓存命中'),
        ))
        children.push(React.createElement('div', { key: 'chart', className: 'bmon-u-bars-wrap' },
          React.createElement('div', { className: 'bmon-u-bars' }, ...grid, ...bars),
          React.createElement('div', { className: 'bmon-u-x' }, ...xlabels),
        ))
        return React.createElement('div', { className: 'bmon-u-card' }, ...children)
      }

      function UsageModels({ stats }) {
        const models = stats.models || []
        const totalTokens = stats.totals.total
        const colors = ['var(--bmon-c1)', 'var(--bmon-c2)', 'var(--bmon-c3)', 'var(--bmon-c4)']
        const children = []
        children.push(React.createElement('div', { key: 'head', className: 'bmon-u-card-head' },
          React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '模型消耗明细'),
          React.createElement('span', { className: 'bmon-hint' }, '同一模型全页同色'),
        ))
        if (!models.length || !totalTokens) {
          children.push(React.createElement('div', { key: 'empty', className: 'bmon-u-empty' }, '该范围内没有调用记录'))
          return React.createElement('div', { className: 'bmon-u-card' }, ...children)
        }
        const segments = []
        let acc = 0
        models.forEach((model, index) => {
          const share = (model.total / totalTokens) * 100
          segments.push(colors[index % colors.length] + ' ' + acc + '% ' + (acc + share) + '%')
          acc += share
        })
        const rows = models.map((model, index) => {
          const share = totalTokens ? ((model.total / totalTokens) * 100) : 0
          const cells = [
            React.createElement('td', { key: 'm' }, React.createElement('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: colors[index % colors.length], marginRight: 6 } }), model.model),
            React.createElement('td', { key: 'share', className: 'bmon-u-num' }, share.toFixed(1) + '%'),
            React.createElement('td', { key: 'req', className: 'bmon-u-num' }, model.requests),
            React.createElement('td', { key: 'in', className: 'bmon-u-num' }, fmtTokens(model.input)),
            React.createElement('td', { key: 'out', className: 'bmon-u-num' }, fmtTokens(model.output)),
            React.createElement('td', { key: 'cache', className: 'bmon-u-num' }, model.cacheRead ? fmtTokens(model.cacheRead) : '—'),
          ]
          return React.createElement('tr', { key: model.model }, ...cells)
        })
        const donut = React.createElement('div', { className: 'bmon-u-donut', style: { background: 'conic-gradient(' + segments.join(',') + ')' } },
          React.createElement('b', null, Number(stats.totals.requests || 0).toLocaleString(), React.createElement('small', null, '次请求')))
        const table = React.createElement('div', { className: 'bmon-u-table-scroll' },
          React.createElement('table', { className: 'bmon-table' },
            React.createElement('thead', null, React.createElement('tr', { key: 'h' },
              React.createElement('th', { key: 'm' }, '模型'),
              React.createElement('th', { key: 's', className: 'bmon-u-num' }, '占比'),
              React.createElement('th', { key: 'r', className: 'bmon-u-num' }, '请求'),
              React.createElement('th', { key: 'i', className: 'bmon-u-num' }, '输入'),
              React.createElement('th', { key: 'o', className: 'bmon-u-num' }, '输出'),
              React.createElement('th', { key: 'c', className: 'bmon-u-num' }, '缓存命中'),
            )),
            React.createElement('tbody', null, ...rows),
          ),
        )
        children.push(React.createElement('div', { key: 'body', className: 'bmon-u-modelbody' }, donut, table))
        return React.createElement('div', { className: 'bmon-u-card' }, ...children)
      }

      function UsageRecords({ stats, modelFilter, onModelFilter }) {
        const models = stats.models || []
        const records = stats.records || []
        const children = []
        children.push(React.createElement('div', { key: 'head', className: 'bmon-u-card-head' },
          React.createElement('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '调用明细'),
          React.createElement('span', { className: 'bmon-hint' }, '最近 50 条'),
          React.createElement('select', { className: 'bmon-input', style: { marginLeft: 'auto' }, value: modelFilter, onChange: (e) => onModelFilter(e.target.value) },
            React.createElement('option', { value: '' }, '全部模型'),
            ...models.map((m) => React.createElement('option', { key: m.model, value: m.model }, m.model)),
          ),
        ))
        const filtered = modelFilter ? records.filter((r) => r.model === modelFilter) : records
        if (!filtered.length) {
          children.push(React.createElement('div', { key: 'empty', className: 'bmon-u-empty' }, '该范围内没有调用记录'))
          return React.createElement('div', { className: 'bmon-u-card' }, ...children)
        }
        const rows = filtered.map((record, index) => {
          const d = new Date(record.time)
          const time = d.toLocaleDateString() + ' ' + d.toLocaleTimeString()
          const cells = [
            React.createElement('td', { key: 't' }, time),
            React.createElement('td', { key: 's' }, record.sessionId),
            React.createElement('td', { key: 'm' }, record.model),
            React.createElement('td', { key: 'i', className: 'bmon-u-num' }, fmtTokens(record.input)),
            React.createElement('td', { key: 'o', className: 'bmon-u-num' }, fmtTokens(record.output)),
            React.createElement('td', { key: 'c', className: 'bmon-u-num' }, record.cacheRead ? fmtTokens(record.cacheRead) : '—'),
          ]
          return React.createElement('tr', { key: index + '-' + record.time }, ...cells)
        })
        children.push(React.createElement('div', { key: 'table-scroll', className: 'bmon-u-record-scroll' },
          React.createElement('table', { className: 'bmon-table' },
            React.createElement('thead', null, React.createElement('tr', { key: 'h' },
              React.createElement('th', { key: 't' }, '时间'),
              React.createElement('th', { key: 's' }, '会话'),
              React.createElement('th', { key: 'm' }, '模型'),
              React.createElement('th', { key: 'i', className: 'bmon-u-num' }, '输入'),
              React.createElement('th', { key: 'o', className: 'bmon-u-num' }, '输出'),
              React.createElement('th', { key: 'c', className: 'bmon-u-num' }, '缓存命中'),
            )),
            React.createElement('tbody', null, ...rows),
          ),
        ))
        return React.createElement('div', { className: 'bmon-u-card' }, ...children)
      }

      function UsagePage() {
        const [range, setRange] = React.useState('7d')
        const [modelFilter, setModelFilter] = React.useState('')
        const pair = useUsageState(range)
        const snapshot = pair[0]
        const children = []
        const ranges = [['1d', '1天'], ['7d', '7天'], ['30d', '30天'], ['all', '至今']]
        children.push(React.createElement('div', { key: 'toolbar', className: 'bmon-u-toolbar' },
          React.createElement('div', { className: 'bmon-u-seg' },
            ...ranges.map((r) => React.createElement('button', { key: r[0], type: 'button', className: r[0] === range ? 'on' : '', onClick: () => setRange(r[0]) }, r[1])),
          ),
          React.createElement('span', { className: 'bmon-hint' }, snapshot ? '更新于 ' + new Date(snapshot.updatedAt).toLocaleTimeString() : '正在载入…'),
          React.createElement('button', { type: 'button', className: 'bmon-btn', onClick: () => { apiCall('get-usage', { range: range }).then((value) => { if (value && typeof value === 'object') pair[1](value) }).catch(() => {}) } }, '↻'),
        ))
        if (!snapshot) {
          children.push(React.createElement('div', { key: 'loading', className: 'bmon-hint' }, '正在连接 Host…'))
          return React.createElement('div', { className: 'bmon-page' }, ...children)
        }
        if (snapshot.error) {
          children.push(React.createElement('div', { key: 'err', className: 'bmon-err' }, '用量统计不可用：' + snapshot.error))
          return React.createElement('div', { className: 'bmon-page' }, ...children)
        }
        if (!snapshot.ready) {
          children.push(React.createElement('div', { key: 'loading', className: 'bmon-hint' }, '正在扫描会话历史…'))
          return React.createElement('div', { className: 'bmon-page' }, ...children)
        }
        const stats = snapshot.stats
        const live = stats.live
        const liveText = '轮 ' + live.turns + ' · 步 ' + live.steps +
          ' | LLM ' + fmtDur(live.llmMs) + ' · 工具调用 ' + fmtDur(live.toolMs) +
          ' | 首 token 平均 ' + (live.firstTokenCount ? live.firstTokenMs.toFixed(1) + 's' : '—') + ' · ' + live.tokPerSec.toFixed(0) + ' tok/s'
        children.push(React.createElement(UsageTiles, { key: 'tiles', stats: stats, range: range }))
        children.push(React.createElement('div', { key: 'live', className: 'bmon-u-live bmon-tip', 'data-tip': '轮次 / 步数 / LLM 时长 / 工具调用时长 / 首 token 延迟 / 生成速度（首 token 仅统计插件运行后）' }, liveText))
        children.push(React.createElement(UsageHeatmap, { key: 'heat', daily: stats.daily }))
        children.push(React.createElement(UsageBars, { key: 'bars', daily: stats.daily, range: range }))
        children.push(React.createElement(UsageModels, { key: 'models', stats: stats }))
        children.push(React.createElement(UsageRecords, { key: 'records', stats: stats, modelFilter: modelFilter, onModelFilter: setModelFilter }))
        return React.createElement('div', { className: 'bmon-page' }, ...children)
      }

      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'tusage-usage', order: 100, label: '用量统计' },
        () => React.createElement(IconBarButton, { paths: '<path d="M6 20V10"/><path d="M12 20V4"/><path d="M18 20v-6"/>', label: '用量统计' }),
      ))
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
