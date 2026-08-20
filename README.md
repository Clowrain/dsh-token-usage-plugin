<div align="center">

# 📊 DSH Token 用量统计

**DeepSeek Harness（DSH）插件** —— Miyu 风格 Token 用量统计与金额估算，深浅色主题自适应

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ 功能

基于 [dsh-balance-plugin](https://github.com/Francis-Xavier-code/dsh-balance-plugin) 精简而来，**只保留用量统计与金额估算**：

| 模块 | 能力 |
| --- | --- |
| **概览统计** | 预估费用 / 总消耗 / 轮次步数 / 请求数 / 缓存命中率（彩色徽章 + 环比上一周期） |
| **用量日历** | GitHub 贡献图风格热力图（自然年、周一起始、中文星期），悬停看每日明细 |
| **消耗趋势** | 三段堆叠柱状图（新输入 / 输出 / 缓存命中），图例可点击开关系列，「至今」范围按周聚合 |
| **模型消耗明细** | 环形图（Top4 + 其他，可点击过滤）+ 明细表（搜索 / 排序 / 可选列 / 分页 / CSV 导出） |
| **金额估算** | USD/1M tokens，按模型单价实时换算；支持从 models.dev 手动同步最新价格（含内置兜底价） |
| **数据来源** | session/event 实时监听 + 启动后延后扫描历史会话（按 seq 去重），SQLite 持久化 |

已移除：余额监控、低余额告警、充值入口、三方插件管理、`query_api_quota` 模型工具、live 性能条、调用明细。

**深色模式**：配色跟随 DSH 应用主题（`body[data-ds-dark-theme]`），而非 `prefers-color-scheme`，与应用内主题始终一致。

---

## 🖼 界面预览

| 截图 | 说明 |
| --- | --- |
| ![用量统计界面-顶部](assess/用量统计界面-顶部.png) | 范围切换、概览瓦片、用量日历 |
| ![用量统计界面底部](assess/用量统计界面底部.png) | 消耗趋势、模型消耗明细 |

---

## 📥 安装

```bash
dsh plugin --profile web add <github 源或本地 link: 路径>
# 重启 DeepSeek Harness
```

输入框工具行右侧出现 📊 柱状图图标即生效。

## 🗑 卸载

```bash
dsh plugin --profile web rm dsh-token-usage-plugin
# 重启 DeepSeek Harness
```

---

## 🏗 架构

```
Host（Node.js 进程，src/index.ts → lib/index.js）
├─ 用量聚合：session/event 实时监听 + 延后历史扫描（按 seq 去重）
├─ SQLite 存储：~/.dsh/plugins/dsh-token-usage-plugin/usage.db
└─ RPC 路由：POST /tusage/api/get-usage | sync-prices | get-prices

Client（浏览器，src/client.ts → lib/client.js，ModuleLoader bundle）
├─ 入口：输入框工具行右侧 1 个柱状图图标按钮
├─ 浮层：组件内自渲染 fixed 面板（容器查询响应式）
└─ 配色：跟随 body[data-ds-dark-theme] 应用主题，深浅自适应
```

### TypeScript 工程化（v3.8.0+）

- 源码为 **TypeScript**（`src/index.ts` Host + `src/client.ts` Client），复用 `@deepseek-ai/*` 类型（`import type`，编译后擦除，零运行时依赖）
- `lib/` 为构建产物：Host 由 `tsc` 编 ESM + 类型声明；Client 由 `tsc` 编 CommonJS + 薄包装生成 ModuleLoader bundle
- 开发命令：
  ```bash
  npm install          # 安装 devDependencies（typescript、@deepseek-ai/* 类型）
  npm run typecheck    # 两端类型检查
  npm run build        # 构建 lib/ 产物 + verify
  npm run verify       # 产物完整性校验
  ```
- 安装时 `prepare` 钩子自动构建；`files` 同时发布 `lib` 与 `src`

---

## ❓ 常见问题

**Q：用量统计没有历史数据？**
A：插件启动后延后扫描历史会话（避开 DSH 启动高峰），离线期间用量会后台补齐。

**Q：金额显示不准？**
A：金额为估算值（按 models.dev 单价换算）。点击弹窗中的同步单价图标可手动拉取最新价格，历史金额自动按新价格重算。

---

## 📄 许可

[MIT](LICENSE) © 2026 原作 [Black Cat (Francis-Xavier-code)](https://github.com/Francis-Xavier-code)，精简修改版
