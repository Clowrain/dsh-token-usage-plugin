<div align="center">

# 📊 DSH Token 用量统计

**DeepSeek Harness（DSH）插件** —— Miyu 风格 Token 用量统计，深浅色主题自适应

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ 功能

基于 [dsh-balance-plugin](https://github.com/Francis-Xavier-code/dsh-balance-plugin) 精简而来，**只保留用量统计**：

| 模块 | 能力 |
| --- | --- |
| **统计瓦片** | 总消耗 / 输入输出拆分 / 轮次步数 / 请求数 / 缓存命中率（环比上一周期） |
| **用量日历** | GitHub 贡献图风格热力图，悬停看每日明细 |
| **消耗趋势** | 三段堆叠柱状图（新输入 / 输出 / 缓存命中），「至今」范围按周聚合 |
| **模型消耗** | 环形图 + 明细表（占比 / 请求 / 输入 / 输出 / 缓存命中） |
| **调用明细** | 最近 50 条调用记录，支持按模型过滤 |
| **性能指标** | 轮次 · 步数 · LLM 时长 · 工具调用时长 · 首 token 平均延迟 · tok/s |
| **数据来源** | session/event 实时监听 + 启动时扫描近 90 天会话历史（按 seq 去重） |

已移除：余额监控、低余额告警、充值入口、三方插件管理、`query_api_quota` 模型工具。

**深色模式修复**：原版通过 `prefers-color-scheme` 媒体查询跟随系统配色，与 DSH 应用内主题（`body[data-ds-dark-theme]`）不一致时会出现浅色板叠深色底的问题；现改为跟随应用主题属性，同时环形图底轨、遮罩阴影、柱状悬停亮度也随主题自适应。

---

## 🖼 界面预览

| 截图 | 说明 |
| --- | --- |
| ![用量统计界面-顶部](assess/用量统计界面-顶部.png) | 范围切换、统计瓦片、live 性能指标条、用量日历 |
| ![用量统计界面底部](assess/用量统计界面底部.png) | 趋势柱状图、模型消耗明细、调用明细 |

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
Host（Node.js 进程）
├─ 用量聚合：session/event 实时监听 + 90 天历史扫描（按 seq 去重）
└─ RPC 路由：POST /tusage/api/get-usage

Client（浏览器）
├─ 入口：输入框工具行右侧 1 个柱状图图标按钮
├─ 浮层：组件内自渲染 fixed 面板
└─ 配色：跟随 body[data-ds-dark-theme] 应用主题，深浅自适应
```

---

## ❓ 常见问题

**Q：用量统计没有历史数据？**
A：插件启动时扫描近 90 天会话事件；「首 token 平均」仅统计插件运行后实时捕获的流式数据。

---

## 📄 许可

[MIT](LICENSE) © 2026 原作 [Black Cat (Francis-Xavier-code)](https://github.com/Francis-Xavier-code)，精简修改版
