// dsh-token-usage-plugin —— Client 半端（静态 web 插件形态，ModuleLoader bundle）
// 供 `dsh plugin --profile web add <package>` 安装后经 /plugins/dsh-token-usage-plugin/client.js 加载。
// 仅保留用量统计；RPC 通过 fetch POST /tusage/api/<name>。
// 弹窗布局：Header（标题/范围/年份/操作）→ 概览统计（可折叠）→ 图表区（可折叠，≥1000px 双栏）
// → 模型消耗明细（可折叠，饼图+表格；仅表格区内部滚动）。响应式走容器查询。

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
}
body[data-ds-dark-theme]{
  --bmon-c1:#6b87d9;--bmon-c2:#b08427;--bmon-c3:#c65f7f;--bmon-c4:#8d7ce4;
  --bmon-h0:#262a3e;--bmon-h1:#303c66;--bmon-h2:#42549b;--bmon-h3:#5a71c4;--bmon-h4:#82a1ea;
}
body:not([data-ds-dark-theme]){
  --bmon-c1:#5d6cc4;--bmon-c2:#8f6b1e;--bmon-c3:#c2426e;--bmon-c4:#6d51c4;
  --bmon-h0:#ece4d1;--bmon-h1:#cdc7e8;--bmon-h2:#a8a0d6;--bmon-h3:#837ac0;--bmon-h4:#5b4fa0;
}
.bmon-ibar{width:28px;height:28px;border-radius:8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0;}
.bmon-ibar:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);}
.bmon-ibar-on{color:var(--dsw-alias-brand-primary);}
.bmon-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px;}
body:not([data-ds-dark-theme]) .bmon-overlay{background:rgba(0,0,0,.28);}
.bmon-overlay-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;width:min(1080px,100%);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 14px 44px rgba(0,0,0,.38);container-type:inline-size;}
body:not([data-ds-dark-theme]) .bmon-overlay-card{box-shadow:0 14px 44px rgba(0,0,0,.22);}
/* —— Header：标题 | 范围组+年份 | 操作 —— */
.bmon-overlay-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}
.bmon-overlay-title{font-weight:600;font-size:14px;flex:none;}
.bmon-head-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.bmon-head-actions{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.bmon-head-updated{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.bmon-iconbtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1;padding:4px 6px;border-radius:6px;font-family:inherit;}
.bmon-iconbtn:hover{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);}
.bmon-closebtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;font-family:inherit;}
.bmon-closebtn:hover{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);}
.bmon-u-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;}
.bmon-u-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 12px;font-size:12px;cursor:pointer;font-family:inherit;}
.bmon-u-seg button.on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand,var(--dsw-alias-bg-layer-1));}
.bmon-head-select{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 8px;font-size:12px;font-family:inherit;cursor:pointer;}
body[data-ds-dark-theme] .bmon-head-select{color-scheme:dark;}
body:not([data-ds-dark-theme]) .bmon-head-select{color-scheme:light;}
.bmon-head-msg{font-size:11px;color:var(--dsw-alias-label-secondary);}
/* —— Body 与折叠模块 —— */
.bmon-overlay-body{padding:12px 14px;overflow:auto;display:flex;flex-direction:column;gap:12px;flex:1;min-height:0;}
.bmon-sec{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;}
.bmon-sec-head{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;border-bottom:1px solid var(--dsw-alias-border-l1);}
.bmon-sec-title{font-size:13px;font-weight:600;}
.bmon-sec-extra{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bmon-sec-arrow{font-size:10px;color:var(--dsw-alias-label-secondary);flex:none;}
.bmon-sec-body{padding:10px 12px;}
.bmon-sec-collapsed .bmon-sec-body{display:none;}
.bmon-sec-collapsed .bmon-sec-head{border-bottom:none;}
/* —— 概览卡片 —— */
.bmon-ov-grid{display:grid;gap:8px;grid-template-columns:repeat(2,1fr);}
.bmon-u-tile{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;min-width:0;}
.bmon-u-tile-label{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;}
.bmon-u-tile-value{font-size:20px;font-weight:600;line-height:1.2;color:var(--dsw-alias-label-primary);}
.bmon-u-tile-value small{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:4px;}
.bmon-u-tile-sub{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:2px;}
.bmon-dot-ok{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none;}
.bmon-dot-warn{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none;}
.bmon-dot-err{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-error-primary);flex:none;}
.bmon-value-ok{color:var(--dsw-alias-state-success-primary);}
.bmon-value-warn{color:var(--dsw-alias-state-warn-primary);}
.bmon-value-err{color:var(--dsw-alias-state-error-primary);}
.bmon-tip{position:relative;}
.bmon-tip[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 7px);transform:translateX(-50%);z-index:100;min-width:max-content;max-width:280px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 4px 12px rgba(0,0,0,.24);font-size:11px;font-weight:400;line-height:1.4;white-space:pre-line;pointer-events:none;}
.bmon-price-link{color:var(--dsw-alias-brand-primary);cursor:pointer;white-space:nowrap;}
.bmon-price-link:hover{text-decoration:underline;}
.bmon-price-pop-wrap{position:fixed;z-index:2147483002;pointer-events:none;}
.bmon-price-pop{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.28);padding:8px 10px;max-width:340px;overflow:auto;max-height:260px;}
.bmon-price-pop-title{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:6px;white-space:nowrap;}
.bmon-price-pop .bmon-table{font-size:11px;}
.bmon-price-pop .bmon-table th,.bmon-price-pop .bmon-table td{padding:2px 6px;white-space:nowrap;}
/* —— 图表区 —— */
.bmon-charts-grid{display:flex;flex-direction:column;gap:12px;}
.bmon-gh-card{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;overflow:hidden;min-width:0;}
.bmon-gh-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}
.bmon-gh-title{font-size:12px;font-weight:600;margin:0;}
.bmon-gh-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto;white-space:nowrap;}
.bmon-gh-scroll{overflow-x:auto;overflow-y:hidden;padding:14px 0 4px;position:relative;}
.bmon-gh-months{position:absolute;top:0;left:18px;right:0;height:14px;pointer-events:none;}
.bmon-gh-month{position:absolute;top:0;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.bmon-gh-body{display:flex;gap:2px;box-sizing:border-box;width:100%;align-items:stretch;padding-right:4px;margin-top:8px;}
.bmon-gh-days{display:flex;flex-direction:column;gap:2px;flex:none;width:16px;font-size:9px;color:var(--dsw-alias-label-secondary);}
.bmon-gh-days span{flex:1 1 0;line-height:10px;display:flex;align-items:center;justify-content:center;min-height:0;}
.bmon-gh-week{display:flex;flex-direction:column;gap:2px;flex:1 1 0;min-width:0;align-items:stretch;}
.bmon-gh-cell{flex:none;width:100%;aspect-ratio:1/1;border-radius:3px;background:var(--bmon-h0);}
.bmon-gh-cell-blank{background:transparent !important;pointer-events:none;}
.bmon-gh-cell:hover{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;z-index:5;position:relative;}
.bmon-gh-cell[data-l="1"]{background:var(--bmon-h1);}
.bmon-gh-cell[data-l="2"]{background:var(--bmon-h2);}
.bmon-gh-cell[data-l="3"]{background:var(--bmon-h3);}
.bmon-gh-cell[data-l="4"]{background:var(--bmon-h4);}
.bmon-gh-tooltip{position:fixed;z-index:2147483001;pointer-events:none;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 4px 14px rgba(0,0,0,.26);font-size:11px;font-weight:400;line-height:1.4;white-space:nowrap;}
.bmon-gh-footer{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:8px;font-size:10px;color:var(--dsw-alias-label-secondary);}
.bmon-gh-footer i{width:10px;height:10px;border-radius:2px;display:inline-block;background:var(--bmon-h0);}
.bmon-gh-footer i[data-l="1"]{background:var(--bmon-h1);}
.bmon-gh-footer i[data-l="2"]{background:var(--bmon-h2);}
.bmon-gh-footer i[data-l="3"]{background:var(--bmon-h3);}
.bmon-gh-footer i[data-l="4"]{background:var(--bmon-h4);}
/* —— 趋势柱状图 —— */
.bmon-u-card-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}
.bmon-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.bmon-hint{font-size:11px;color:var(--dsw-alias-label-secondary);}
.bmon-u-bars-wrap{position:relative;padding-top:22px;}
.bmon-u-bars{position:relative;height:180px;display:flex;align-items:flex-end;gap:3px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-left:36px;}
.bmon-u-bar-slot{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:180px;}
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
/* —— 模型明细 —— */
.bmon-models-grid{display:flex;flex-direction:column;gap:12px;}
.bmon-pie-panel{flex:none;display:flex;flex-direction:column;gap:8px;min-width:0;}
.bmon-pie-wrap{position:relative;width:170px;height:170px;margin:0 auto;cursor:pointer;}
.bmon-pie-wrap svg{width:100%;height:100%;display:block;}
.bmon-pie-sector{cursor:pointer;transition:stroke-width .12s;}
.bmon-pie-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;}
.bmon-pie-center b{font-size:18px;font-weight:600;color:var(--dsw-alias-label-primary);}
.bmon-pie-center small{font-size:10px;color:var(--dsw-alias-label-secondary);}
.bmon-pie-legend{display:flex;flex-direction:column;gap:4px;}
.bmon-pie-legend-item{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 4px;border-radius:4px;min-width:0;}
.bmon-pie-legend-item:hover{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));}
.bmon-pie-legend-item.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));}
.bmon-pie-legend-dot{width:8px;height:8px;border-radius:2px;flex:none;}
.bmon-pie-legend-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;}
.bmon-pie-legend-pct{margin-left:auto;flex:none;font-variant-numeric:tabular-nums;}
.bmon-table-panel{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;}
.bmon-table-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.bmon-search-input{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;flex:1 1 140px;min-width:0;}
.bmon-search-input:focus{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent);outline-offset:1px;border-color:var(--dsw-alias-brand-primary);}
.bmon-btn{border:none;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:12px;padding:2px 6px;border-radius:6px;text-decoration:none;font-family:inherit;white-space:nowrap;}
.bmon-btn:hover{background:var(--dsw-alias-bg-layer-1);}
.bmon-btn:disabled{opacity:.6;cursor:default;}
.bmon-col-toggle{font-size:11px;}
.bmon-col-toggle.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent);}
.bmon-table{border-collapse:collapse;width:100%;font-size:12px;}
.bmon-table th,.bmon-table td{border-bottom:1px solid var(--dsw-alias-border-l1);padding:4px 6px;text-align:left;vertical-align:top;white-space:nowrap;}
.bmon-table-scrollbox{overflow:auto;max-height:280px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;}
.bmon-table-scrollbox .bmon-table{min-width:520px;}
.bmon-th-sort{cursor:pointer;user-select:none;}
.bmon-th-sort:hover{color:var(--dsw-alias-label-primary);}
.bmon-u-num{text-align:right;font-variant-numeric:tabular-nums;}
.bmon-money{color:var(--bmon-c2);font-variant-numeric:tabular-nums;}
.bmon-model-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6;vertical-align:middle;flex:none;}
.bmon-pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;font-size:11px;color:var(--dsw-alias-label-secondary);}
.bmon-page{font-size:12px;padding:2px 8px;}
.bmon-err{color:var(--dsw-alias-state-error-primary);}
/* —— 响应式（容器查询：以弹窗卡片宽度为准）—— */
@container (min-width:1000px){
  .bmon-ov-grid{grid-template-columns:repeat(3,1fr);}
  .bmon-charts-grid{display:grid;grid-template-columns:1fr 1fr;align-items:start;}
  .bmon-models-grid{display:grid;grid-template-columns:210px 1fr;align-items:start;}
}
@container (max-width:999px){
  .bmon-ov-grid{grid-template-columns:repeat(2,1fr);}
}
@container (max-width:599px){
  .bmon-ov-grid{grid-template-columns:1fr;}
  .bmon-col-cache{display:none;}
}`)

      const POLL_MS = 15000

      function useUsageState(range, heatYear) {
        const pair = React.useState(null)
        const snapshot = pair[0]
        const setSnapshot = pair[1]
        const lastVersion = React.useRef(-1)
        const lastHeatYear = React.useRef(-1)
        React.useEffect(() => {
          let alive = true
          let timer = null
          lastVersion.current = -1
          lastHeatYear.current = -1
          const schedule = (ms) => {
            if (!alive) return
            if (timer) clearTimeout(timer)
            timer = setTimeout(tick, ms)
          }
          const tick = () => {
            if (document.hidden) return
            apiCall('get-usage', { range: range, heatYear: heatYear }).then((value) => {
              if (!alive) return
              if (value && typeof value === 'object') {
                if (value.version !== lastVersion.current || value.heatYear !== lastHeatYear.current) {
                  lastVersion.current = value.version
                  lastHeatYear.current = value.heatYear
                  setSnapshot(value)
                }
              }
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
        }, [range, heatYear])
        return pair
      }

      function fmtTokens(value) {
        const n = Number(value) || 0
        if (n >= 1000000000) return (n / 1000000000).toFixed(2) + 'B'
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
        return String(Math.round(n))
      }

      function fmtMoney(value) {
        const n = Number(value) || 0
        if (!(n > 0)) return '$0'
        if (n < 0.01) return '$' + n.toFixed(4)
        if (n < 100) return '$' + n.toFixed(3)
        return '$' + n.toFixed(2)
      }

      function dayKey(date) {
        const pad = (n) => String(n).padStart(2, '0')
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      }

      function Icon({ paths, size }) {
        return React.createElement('svg', { viewBox: '0 0 24 24', width: size || 17, height: size || 17, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: paths } })
      }

      // ===== 折叠模块外壳 =====
      function Section({ title, extra, collapsed, onToggle, children }) {
        return React.createElement('section', { className: 'bmon-sec' + (collapsed ? ' bmon-sec-collapsed' : '') },
          React.createElement('div', { className: 'bmon-sec-head', onClick: onToggle },
            React.createElement('span', { className: 'bmon-sec-arrow' }, collapsed ? '▸' : '▾'),
            React.createElement('span', { className: 'bmon-sec-title' }, title),
            extra ? React.createElement('span', { className: 'bmon-sec-extra' }, extra) : null,
          ),
          collapsed ? null : React.createElement('div', { className: 'bmon-sec-body' }, children),
        )
      }

      // ===== 概览统计 =====
      function OverviewSection({ stats, range }) {
        const totals = stats.totals
        const prev = stats.prevTotals
        const pricePop = React.useState(null)
        const pricePopup = pricePop[0]
        const setPricePopup = pricePop[1]
        const delta = (current, previous) => {
          if (!prev || !previous) return null
          const value = ((current || 0) / previous - 1) * 100
          return React.createElement('span', { key: 'd', className: 'bmon-tip', 'data-tip': '对比上一周期' },
            value >= 0 ? '▲' : '▼', ' ', Math.abs(value).toFixed(0) + '%')
        }
        const hit = totals.prompt > 0 ? (totals.cache_read / totals.prompt) * 100 : null
        const days = Math.max(1, stats.daily.length)
        const dailyAvg = range === '1d' ? '' : (totals.requests / days).toFixed(1) + ' 次'
        const fresh = Math.max(0, totals.prompt - totals.cache_read)
        const hitStatus = hit === null ? '' : (hit >= 50 ? 'ok' : hit >= 20 ? 'warn' : 'err')
        const fullNum = (n) => Number(n || 0).toLocaleString()
        const priceRows = pricePopup && pricePopup.prices
          ? pricePopup.prices.map((p) => React.createElement('tr', { key: p.model },
              React.createElement('td', null, p.model),
              React.createElement('td', { className: 'bmon-u-num' }, '$' + Number(p.prompt).toFixed(3)),
              React.createElement('td', { className: 'bmon-u-num' }, '$' + Number(p.completion).toFixed(3)),
              React.createElement('td', { className: 'bmon-u-num' }, '$' + Number(p.cacheRead).toFixed(4)),
            ))
          : null
        const mk = (key, label, valueEl, footerEl, tip) => React.createElement('div', { key: key, className: 'bmon-u-tile bmon-tip', 'data-tip': tip || '' },
          React.createElement('div', { className: 'bmon-u-tile-label' }, label),
          valueEl,
          footerEl,
        )
        const tiles = [
          mk('t0', '预估费用',
            React.createElement('div', { className: 'bmon-u-tile-value' }, fmtMoney(totals.cost)),
            React.createElement('div', { className: 'bmon-u-tile-sub' },
              React.createElement('span', null, totals.cost > 0 ? '按模型单价换算' : '暂无价格，可同步'),
              React.createElement('span', {
                className: 'bmon-price-link',
                onMouseEnter: (e) => {
                  apiCall('get-prices', {}).then((v) => {
                    setPricePopup({ x: e.clientX + 12, y: e.clientY - 8, prices: v && v.prices ? v.prices : [] })
                  }).catch(() => setPricePopup({ x: e.clientX + 12, y: e.clientY - 8, prices: [] }))
                },
                onMouseMove: (e) => { if (pricePopup) setPricePopup({ x: e.clientX + 12, y: e.clientY - 8, prices: pricePopup.prices }) },
                onMouseLeave: () => setPricePopup(null),
              }, '查看单价'),
            ),
            '当前范围预估费用 ' + fmtMoney(totals.cost) + ' USD'),
          mk('t1', '总消耗', 
            React.createElement('div', { className: 'bmon-u-tile-value' }, fmtTokens(totals.total), React.createElement('small', null, 'tokens'), delta(totals.total, prev && prev.total)),
            React.createElement('div', { className: 'bmon-u-tile-sub' },
              React.createElement('div', null, '输入 ' + fmtTokens(totals.prompt)),
              React.createElement('div', null, '输出 ' + fmtTokens(totals.completion)),
            ),
            '总消耗 ' + fullNum(totals.total) + ' tokens（输入 ' + fullNum(totals.prompt) + ' / 输出 ' + fullNum(totals.completion) + '）'),
          mk('t2', '轮次 / 步数',
            React.createElement('div', { className: 'bmon-u-tile-value' }, String(totals.turns), React.createElement('small', null, '轮')),
            React.createElement('div', { className: 'bmon-u-tile-sub' },
              React.createElement('div', null, '步数 ' + String(totals.steps)),
              React.createElement('div', null, '工具调用 ' + totals.tools + ' 次'),
            ),
            '轮次 ' + fullNum(totals.turns) + ' · 步数 ' + fullNum(totals.steps) + ' · 工具调用 ' + fullNum(totals.tools) + ' 次'),
          mk('t3', '请求数',
            React.createElement('div', { className: 'bmon-u-tile-value' }, Number(totals.requests || 0).toLocaleString(), delta(totals.requests, prev && prev.requests)),
            React.createElement('div', { className: 'bmon-u-tile-sub' },
              React.createElement('div', null, '全部模型调用'),
              dailyAvg ? React.createElement('div', null, '日均 ' + dailyAvg) : null,
            ),
            '请求数 ' + fullNum(totals.requests) + (dailyAvg ? ' · 日均 ' + dailyAvg : '')),
          mk('t4', '缓存命中率' + (hitStatus ? '' : ''),
            React.createElement('div', { className: 'bmon-u-tile-value' + (hitStatus ? ' bmon-value-' + hitStatus : '') },
              hitStatus ? React.createElement('span', { className: 'bmon-dot-' + hitStatus, style: { display: 'inline-block', marginRight: 6, verticalAlign: 'middle' } }) : null,
              hit === null ? '—' : Math.round(hit) + '%'),
            React.createElement('div', { className: 'bmon-u-tile-sub' },
              React.createElement('div', null, '命中 ' + fmtTokens(totals.cache_read)),
              React.createElement('div', null, '未命中 ' + fmtTokens(fresh)),
            ),
            '缓存命中 ' + fullNum(totals.cache_read) + ' / 未命中 ' + fullNum(fresh) + ' tokens'),
        ]
        const pricePopover = pricePopup ? React.createElement('div', { className: 'bmon-price-pop' },
          React.createElement('div', { className: 'bmon-price-pop-title' }, '模型单价（USD / 1M tokens）'),
          priceRows && priceRows.length ? React.createElement('table', { className: 'bmon-table' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', null, '模型'),
              React.createElement('th', { className: 'bmon-u-num' }, '输入'),
              React.createElement('th', { className: 'bmon-u-num' }, '输出'),
              React.createElement('th', { className: 'bmon-u-num' }, '缓存命中'),
            )),
            React.createElement('tbody', null, ...priceRows),
          ) : React.createElement('div', { className: 'bmon-hint' }, '暂无缓存单价，请先同步价格'),
        ) : null
        return React.createElement('div', { className: 'bmon-ov-grid' },
          pricePopover ? React.createElement('div', { key: 'popwrap', className: 'bmon-price-pop-wrap', style: { left: pricePopup.x, top: pricePopup.y } }, pricePopover) : null,
          ...tiles,
        )
      }

      // ===== 用量日历（GitHub 贡献图，自然年）=====
      function UsageHeatmap({ heat }) {
        const data = heat || []
        const tipState = React.useState(null)
        const tip = tipState[0]
        const setTip = tipState[1]
        const selectedYear = data.length ? Number(data[data.length - 1].date.slice(0, 4)) : new Date().getFullYear()
        if (!data.length) return React.createElement('div', { className: 'bmon-gh-card' },
          React.createElement('div', { className: 'bmon-gh-head' },
            React.createElement('h3', { className: 'bmon-gh-title' }, '用量日历'),
            React.createElement('span', { className: 'bmon-gh-hint' }, selectedYear + ' 年暂无日用量数据'),
          ),
        )
        const byDate = new Map(data.map((d) => [d.date, d]))
        const first = new Date(selectedYear, 0, 1)
        const last = new Date(selectedYear, 11, 31)
        const start = new Date(first)
        const offset = (start.getDay() + 6) % 7
        start.setDate(start.getDate() - offset)
        const allDays = []
        for (const cursor = new Date(start); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
          const key = dayKey(cursor)
          allDays.push(byDate.get(key) || { date: key, requests: 0, total: 0 })
        }
        const weeks = []
        for (let i = 0; i < allDays.length; i += 7) {
          const chunk = allDays.slice(i, i + 7)
          while (chunk.length < 7) chunk.push(null)
          weeks.push(chunk)
        }
        const values = weeks.flat().filter(Boolean).map((d) => d.total).filter((v) => v > 0).sort((a, b) => a - b)
        const pct = (p) => values[Math.min(values.length - 1, Math.floor(values.length * p))] || 0
        const q1 = pct(0.25)
        const q2 = pct(0.5)
        const q3 = pct(0.75)
        const levelOf = (v) => {
          if (!v) return 0
          if (v <= q1) return 1
          if (v <= q2) return 2
          if (v <= q3) return 3
          return 4
        }
        const yearFirstKey = String(selectedYear) + '-01-01'
        const yearLastKey = String(selectedYear) + '-12-31'
        const inYear = (key) => key >= yearFirstKey && key <= yearLastKey
        const weekEls = weeks.map((col, w) => {
          const cells = col.map((day, r) => {
            if (!day || !inYear(day.date)) return React.createElement('i', { key: 'e' + r, className: 'bmon-gh-cell bmon-gh-cell-blank' })
            const lv = levelOf(day.total)
            const tipText = day.date + '：' + fmtTokens(day.total) + ' tokens · ' + day.requests + ' 次请求'
            return React.createElement('i', {
              key: day.date,
              className: 'bmon-gh-cell',
              'data-l': String(lv),
              onMouseEnter: (e) => setTip({ x: e.clientX + 12, y: e.clientY - 8, text: tipText }),
              onMouseMove: (e) => setTip({ x: e.clientX + 12, y: e.clientY - 8, text: tipText }),
              onMouseLeave: () => setTip(null),
            })
          })
          return React.createElement('div', { key: 'w' + w, className: 'bmon-gh-week' }, ...cells)
        })
        const weekCount = weeks.length
        const monthLabels = []
        let prevMonth = ''
        weeks.forEach((col, w) => {
          const firstDay = col.find((d) => d && inYear(d.date))
          if (!firstDay) return
          const month = firstDay.date.slice(0, 7)
          if (month !== prevMonth) {
            monthLabels.push(React.createElement('span', { key: month, className: 'bmon-gh-month', style: { left: ((w / weekCount) * 100) + '%' } }, month.slice(5) + '月'))
            prevMonth = month
          }
        })
        const totalRequests = data.reduce((s, d) => s + d.requests, 0)
        const totalTokens = data.reduce((s, d) => s + d.total, 0)
        const weekdays = ['一', '二', '三', '四', '五', '六', '日'].map((label, r) =>
          React.createElement('span', { key: r }, r % 2 === 0 ? label : ''))
        const legend = [0, 1, 2, 3, 4].map((lv) =>
          React.createElement('i', { key: lv, 'data-l': String(lv) }))
        return React.createElement('div', { className: 'bmon-gh-card' },
          tip ? React.createElement('div', { className: 'bmon-gh-tooltip', style: { left: tip.x, top: tip.y } }, tip.text) : null,
          React.createElement('div', { className: 'bmon-gh-head' },
            React.createElement('h3', { className: 'bmon-gh-title' }, '用量日历'),
            React.createElement('span', { className: 'bmon-gh-hint' },
              selectedYear + ' 年 · 共 ' + (totalTokens > 0 ? fmtTokens(totalTokens) : '0') + ' tokens · ' + totalRequests.toLocaleString() + ' 次调用'),
          ),
          React.createElement('div', { className: 'bmon-gh-scroll' },
            React.createElement('div', { className: 'bmon-gh-months' }, ...monthLabels),
            React.createElement('div', { className: 'bmon-gh-body' },
              React.createElement('div', { className: 'bmon-gh-days' }, ...weekdays),
              ...weekEls,
            ),
          ),
          React.createElement('div', { className: 'bmon-gh-footer' },
            React.createElement('span', null, '少'), ...legend,
            React.createElement('span', null, '多'),
          ),
        )
      }

      // ===== 消耗趋势（三段堆叠柱状图）=====
      function UsageBars({ daily, range }) {
        let slice = daily || []
        let weekly = false
        if (range === '1d') slice = slice.slice(-1)
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
        const HEIGHT = 180
        const max = Math.max(...slice.map((d) => d.total), 0)
        const children = []
        if (!max) {
          children.push(React.createElement('div', { key: 'empty', className: 'bmon-u-empty' }, '该范围内没有调用记录'))
          return React.createElement('div', { className: 'bmon-gh-card' }, ...children)
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
          React.createElement('h3', { style: { margin: 0, fontSize: 12, fontWeight: 600 } }, '消耗趋势'),
          React.createElement('span', { className: 'bmon-hint' }, weekly ? '按周聚合 · 悬停看明细' : '悬停看明细'),
          React.createElement('span', { className: 'bmon-hint', style: { marginLeft: 'auto' } },
            React.createElement('i', { style: { display: 'inline-block', width: 8, height: 8, background: 'var(--bmon-c1)', borderRadius: 2, marginRight: 4 } }), '新输入',
            React.createElement('i', { style: { display: 'inline-block', width: 8, height: 8, background: 'var(--bmon-c2)', borderRadius: 2, marginRight: 4, marginLeft: 10 } }), '输出',
            React.createElement('i', { style: { display: 'inline-block', width: 8, height: 8, background: 'var(--bmon-c3)', borderRadius: 2, marginRight: 4, marginLeft: 10 } }), '缓存命中'),
        ))
        children.push(React.createElement('div', { key: 'chart', className: 'bmon-u-bars-wrap' },
          React.createElement('div', { className: 'bmon-u-bars' }, ...grid, ...bars),
          React.createElement('div', { className: 'bmon-u-x' }, ...xlabels),
        ))
        return React.createElement('div', { className: 'bmon-gh-card' }, ...children)
      }

      // ===== 模型饼图（Top4 + 其他，可点击过滤）=====
      function PieDonut({ models, filter, onFilter, totalRequests }) {
        const colors = ['var(--bmon-c1)', 'var(--bmon-c2)', 'var(--bmon-c3)', 'var(--bmon-c4)']
        const gray = 'var(--dsw-alias-border-l2)'
        const sorted = [...(models || [])].sort((a, b) => b.total - a.total)
        const top = sorted.slice(0, 4)
        const rest = sorted.slice(4)
        const total = sorted.reduce((s, m) => s + m.total, 0)
        const items = top.map((m, i) => ({ key: m.model, label: m.model, value: m.total, color: colors[i] }))
        if (rest.length) items.push({ key: '__other__', label: '其他（' + rest.length + '）', value: rest.reduce((s, m) => s + m.total, 0), color: gray })
        let acc = 0
        const sectors = items.map((item) => {
          const pctVal = total > 0 ? (item.value / total) * 100 : 0
          const sector = React.createElement('circle', {
            key: item.key,
            cx: 21, cy: 21, r: 15.9155,
            fill: 'none',
            strokeWidth: filter === item.key ? 8 : 6,
            strokeDasharray: pctVal + ' ' + (100 - pctVal),
            strokeDashoffset: 25 - acc,
            className: 'bmon-pie-sector',
            style: { stroke: item.color },
            onClick: (e) => { e.stopPropagation(); onFilter(filter === item.key ? '' : item.key) },
          })
          acc += pctVal
          return sector
        })
        const legend = items.map((item) => React.createElement('div', {
          key: item.key,
          className: 'bmon-pie-legend-item' + (filter === item.key ? ' on' : ''),
          onClick: () => onFilter(filter === item.key ? '' : item.key),
        },
          React.createElement('span', { className: 'bmon-pie-legend-dot', style: { background: item.color } }),
          React.createElement('span', { className: 'bmon-pie-legend-name' }, item.label),
          React.createElement('span', { className: 'bmon-pie-legend-pct' }, (total > 0 ? (item.value / total * 100).toFixed(1) : '0.0') + '%'),
        ))
        return React.createElement('div', { className: 'bmon-pie-panel' },
          React.createElement('div', {
            className: 'bmon-pie-wrap',
            onClick: (e) => { if (e.target === e.currentTarget) onFilter('') },
          },
            React.createElement('svg', { viewBox: '0 0 42 42' }, ...sectors),
            React.createElement('div', { className: 'bmon-pie-center' },
              React.createElement('b', null, Number(totalRequests || 0).toLocaleString()),
              React.createElement('small', null, '次请求')),
          ),
          React.createElement('div', { className: 'bmon-pie-legend' }, ...legend),
        )
      }

      // ===== 模型明细表格（搜索/排序/可选列/分页/CSV）=====
      function ModelTable({ models, topNames, filter, search, onSearch, sortKey, sortDir, onSort, showCache, page, onPage }) {
        const PAGE_SIZE = 8
        const query = String(search || '').toLowerCase()
        let rows = (models || []).filter((m) => {
          if (filter === '__other__') { if (topNames.has(m.model)) return false }
          else if (filter && m.model !== filter) return false
          if (query && m.model.toLowerCase().indexOf(query) === -1) return false
          return true
        })
        const val = (m) => Number(m[sortKey] || 0)
        rows.sort((a, b) => sortDir === 'asc' ? val(a) - val(b) : val(b) - val(a))
        const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
        const safePage = Math.min(page, pageCount - 1)
        const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
        const colors = ['var(--bmon-c1)', 'var(--bmon-c2)', 'var(--bmon-c3)', 'var(--bmon-c4)']
        const colorOf = (m) => {
          const idx = [...topNames].indexOf(m.model)
          return idx >= 0 && idx < 4 ? colors[idx] : 'var(--dsw-alias-border-l2)'
        }
        const sortTh = (key, label, num) => React.createElement('th', {
          key: key,
          className: (num ? 'bmon-u-num ' : '') + 'bmon-th-sort' + (key === 'cache' ? ' bmon-col-cache' : ''),
          onClick: () => onSort(key),
        }, label, sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')
        const trs = pageRows.map((m) => React.createElement('tr', { key: m.model },
          React.createElement('td', null,
            React.createElement('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: colorOf(m), marginRight: 6, verticalAlign: 'middle' } }),
            m.model),
          React.createElement('td', { key: 'r', className: 'bmon-u-num' }, Number(m.requests || 0).toLocaleString()),
          React.createElement('td', { key: 'c', className: 'bmon-u-num bmon-money' }, fmtMoney(m.cost)),
          React.createElement('td', { key: 'i', className: 'bmon-u-num' }, fmtTokens(m.input)),
          React.createElement('td', { key: 'o', className: 'bmon-u-num' }, fmtTokens(m.output)),
          showCache ? React.createElement('td', { key: 'h', className: 'bmon-u-num bmon-col-cache' }, m.cacheRead ? fmtTokens(m.cacheRead) : '—') : null,
        ))
        const table = React.createElement('div', { className: 'bmon-table-scrollbox' },
          React.createElement('table', { className: 'bmon-table' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', { key: 'm' }, '模型'),
              sortTh('requests', '请求数', true),
              sortTh('cost', '费用', true),
              sortTh('input', '输入 tokens', true),
              sortTh('output', '输出 tokens', true),
              showCache ? sortTh('cacheRead', '缓存命中', true) : null,
            )),
            React.createElement('tbody', null, trs.length ? trs : React.createElement('tr', null, React.createElement('td', { colSpan: 6, className: 'bmon-u-empty' }, '无匹配模型'))),
          ),
        )
        const pager = React.createElement('div', { className: 'bmon-pager' },
          React.createElement('span', null, '共 ' + rows.length + ' 个模型 · 第 ' + (safePage + 1) + '/' + pageCount + ' 页'),
          React.createElement('button', { type: 'button', className: 'bmon-btn bmon-page', disabled: safePage <= 0, onClick: () => onPage(safePage - 1) }, '‹'),
          React.createElement('button', { type: 'button', className: 'bmon-btn bmon-page', disabled: safePage >= pageCount - 1, onClick: () => onPage(safePage + 1) }, '›'),
        )
        return { table, pager, rows }
      }

      // ===== 弹窗主体 =====
      function UsageModal({ onClose }) {
        const [range, setRange] = React.useState('7d')
        const [heatYear, setHeatYear] = React.useState(new Date().getFullYear())
        const [collapsed, setCollapsed] = React.useState({ overview: false, charts: false, models: false })
        const [pieFilter, setPieFilter] = React.useState('')
        const [search, setSearch] = React.useState('')
        const [sortKey, setSortKey] = React.useState('cost')
        const [sortDir, setSortDir] = React.useState('desc')
        const [showCache, setShowCache] = React.useState(false)
        const [page, setPage] = React.useState(0)
        const [syncing, setSyncing] = React.useState(false)
        const [syncMsg, setSyncMsg] = React.useState('')
        const pair = useUsageState(range, heatYear)
        const snapshot = pair[0]
        const stats = snapshot && snapshot.stats
        const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))
        const onSort = (key) => {
          if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
          else { setSortKey(key); setSortDir('desc') }
          setPage(0)
        }
        const syncPrices = () => {
          if (syncing) return
          setSyncing(true)
          setSyncMsg('')
          apiCall('sync-prices', {}).then((value) => {
            if (value && value.error) setSyncMsg('同步失败：' + value.error)
            else setSyncMsg(value && value.synced != null ? '已同步 ' + value.synced + ' 个模型' : '已同步')
            apiCall('get-usage', { range: range, heatYear: heatYear }).then((v) => { if (v && typeof v === 'object') pair[1](v) }).catch(() => {})
          }).catch((e) => setSyncMsg('同步失败：' + String(e && e.message || e)))
            .then(() => setSyncing(false))
        }
        const exportCsv = () => {
          if (!stats || !stats.models) return
          const colors = ['var(--bmon-c1)']
          const sortedByTotal = [...stats.models].sort((a, b) => b.total - a.total)
          const tops = new Set(sortedByTotal.slice(0, 4).map((m) => m.model))
          const query = search.toLowerCase()
          let rows = stats.models.filter((m) => {
            if (pieFilter === '__other__') { if (tops.has(m.model)) return false }
            else if (pieFilter && m.model !== pieFilter) return false
            if (query && m.model.toLowerCase().indexOf(query) === -1) return false
            return true
          })
          const val = (m) => Number(m[sortKey] || 0)
          rows.sort((a, b) => sortDir === 'asc' ? val(a) - val(b) : val(b) - val(a))
          const header = ['模型', '请求数', '费用(USD)', '输入tokens', '输出tokens' + (showCache ? ',缓存命中' : '')]
          const lines = [header.join(',')]
          for (const r of rows) {
            const cells = [r.model, r.requests, (r.cost || 0).toFixed(6), r.input, r.output]
            if (showCache) cells.push(r.cacheRead || 0)
            lines.push(cells.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))
          }
          const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'model-usage-' + range + '.csv'
          a.click()
          setTimeout(() => { try { URL.revokeObjectURL(a.href) } catch (e) { /* ignore */ } }, 1000)
        }
        const ranges = [['1d', '1天'], ['7d', '7天'], ['30d', '30天'], ['all', '至今']]
        const years = stats && Array.isArray(stats.heatYears) && stats.heatYears.length ? stats.heatYears : [new Date().getFullYear()]
        const selYear = stats && stats.heatYear ? stats.heatYear : heatYear
        const head = React.createElement('div', { key: 'head', className: 'bmon-overlay-head' },
          React.createElement('span', { className: 'bmon-overlay-title' }, '用量统计'),
          React.createElement('div', { className: 'bmon-head-filters' },
            React.createElement('div', { className: 'bmon-u-seg' },
              ...ranges.map((r) => React.createElement('button', { key: r[0], type: 'button', className: r[0] === range ? 'on' : '', onClick: () => { setRange(r[0]); setPage(0) } }, r[1]))),
            React.createElement('select', {
              className: 'bmon-head-select', value: String(selYear),
              onChange: (e) => setHeatYear(Number(e.target.value)),
              title: '日历年份',
            }, years.map((yy) => React.createElement('option', { key: yy, value: String(yy) }, yy + ' 年'))),
          ),
          React.createElement('div', { className: 'bmon-head-actions' },
            React.createElement('span', { className: 'bmon-head-updated' }, snapshot ? '更新于 ' + new Date(snapshot.updatedAt).toLocaleTimeString() : '载入中…'),
            React.createElement('button', { type: 'button', className: 'bmon-iconbtn', title: '刷新', onClick: () => { apiCall('get-usage', { range: range, heatYear: heatYear }).then((v) => { if (v && typeof v === 'object') pair[1](v) }).catch(() => {}) } }, '↻'),
            React.createElement('button', { type: 'button', className: 'bmon-iconbtn', title: '同步价格（models.dev）', disabled: syncing, onClick: syncPrices }, syncing ? '⏳' : '⚙'),
            React.createElement('button', { type: 'button', className: 'bmon-closebtn', onClick: onClose }, '✕ 关闭'),
          ),
        )
        const bodyChildren = []
        if (syncMsg) bodyChildren.push(React.createElement('div', { key: 'msg', className: 'bmon-head-msg' }, syncMsg))
        if (!snapshot) {
          bodyChildren.push(React.createElement('div', { key: 'loading', className: 'bmon-hint' }, '正在连接 Host…'))
        } else if (snapshot.error) {
          bodyChildren.push(React.createElement('div', { key: 'err', className: 'bmon-err' }, '用量统计不可用：' + snapshot.error))
        } else if (!snapshot.ready) {
          bodyChildren.push(React.createElement('div', { key: 'loading', className: 'bmon-hint' }, '正在扫描会话历史…'))
        } else {
          const s = snapshot.stats
          // 概览统计
          bodyChildren.push(React.createElement(Section, {
            key: 'ov', title: '概览统计', collapsed: collapsed.overview, onToggle: () => toggle('overview'),
            extra: '预估 ' + fmtMoney(s.totals.cost) + ' · ' + fmtTokens(s.totals.total) + ' tokens · ' + Number(s.totals.requests || 0).toLocaleString() + ' 次请求',
          }, React.createElement(OverviewSection, { stats: s, range: range })))
          // 图表区
          bodyChildren.push(React.createElement(Section, {
            key: 'charts', title: '图表区', collapsed: collapsed.charts, onToggle: () => toggle('charts'),
          }, React.createElement('div', { className: 'bmon-charts-grid' },
            React.createElement(UsageHeatmap, { key: 'heat', heat: s.heat }),
            React.createElement(UsageBars, { key: 'bars', daily: s.daily, range: range }),
          )))
          // 模型消耗明细
          const sortedByTotal = [...(s.models || [])].sort((a, b) => b.total - a.total)
          const topNames = new Set(sortedByTotal.slice(0, 4).map((m) => m.model))
          const mt = ModelTable({
            models: s.models, topNames, filter: pieFilter, search,
            onSearch: (v) => { setSearch(v); setPage(0) },
            sortKey, sortDir, onSort, showCache, page, onPage: setPage,
          })
          bodyChildren.push(React.createElement(Section, {
            key: 'models', title: '模型消耗明细', collapsed: collapsed.models, onToggle: () => toggle('models'),
            extra: (s.models || []).length + ' 个模型',
          }, React.createElement('div', { className: 'bmon-models-grid' },
            React.createElement(PieDonut, {
              key: 'pie', models: s.models, filter: pieFilter,
              onFilter: (f) => { setPieFilter(f); setPage(0) },
              totalRequests: s.totals.requests,
            }),
            React.createElement('div', { key: 'table', className: 'bmon-table-panel' },
              React.createElement('div', { className: 'bmon-table-toolbar' },
                React.createElement('input', {
                  className: 'bmon-search-input', placeholder: '搜索模型名称…', value: search,
                  onChange: (e) => { setSearch(e.target.value); setPage(0) },
                }),
                React.createElement('button', {
                  type: 'button',
                  className: 'bmon-btn bmon-col-toggle' + (showCache ? ' on' : ''),
                  onClick: () => setShowCache((v) => !v),
                  title: '显示/隐藏 缓存命中 列',
                }, '缓存命中列 ' + (showCache ? '开' : '关')),
                React.createElement('button', { type: 'button', className: 'bmon-btn', onClick: exportCsv }, '导出 CSV'),
                pieFilter ? React.createElement('button', { type: 'button', className: 'bmon-btn', onClick: () => { setPieFilter(''); setPage(0) } }, '清除过滤') : null,
              ),
              mt.table,
              mt.pager,
            ),
          )))
        }
        return React.createElement('div', { className: 'bmon-overlay', onClick: onClose },
          React.createElement('div', { className: 'bmon-overlay-card', onClick: (e) => e.stopPropagation() },
            head,
            React.createElement('div', { className: 'bmon-overlay-body' }, ...bodyChildren),
          ),
        )
      }

      function IconBarButton({ paths, label }) {
        const pair = React.useState(false)
        const open = pair[0]
        const setOpen = pair[1]
        const children = [
          React.createElement('button', { key: 'b', type: 'button', className: 'bmon-ibar' + (open ? ' bmon-ibar-on' : ''), onClick: () => setOpen(!open), 'aria-label': label, title: label },
            React.createElement(Icon, { paths: paths, size: 16 })),
        ]
        if (open) {
          children.push(React.createElement(UsageModal, { key: 'o', onClose: () => setOpen(false) }))
        }
        return React.createElement('div', { className: 'bmon-ibar-wrap' }, ...children)
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
