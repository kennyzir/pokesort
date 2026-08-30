# PokeSort SEO R2-Lite：导航层级与无效入口清理

发布日期：2026-08-30  
状态：已合并并完成生产验收

## 发布标识

- 分支：`codex/seo-r2-lite-navigation-cleanup`
- 发布前 Tag：`pre-seo-r2-lite-20260830`，指向 `75b17f5c7b2cc825aa7cd377a0b5ef043cdb99fb`
- PR：[kennyzir/pokesort#2](https://github.com/kennyzir/pokesort/pull/2)
- 功能 Commit：`3a94723efadfcd1f3f57b899b7f2eaf25ab16cfc`
- Merge SHA：`af063f14fe2e2a50b676af3faaa6499743f9636d`
- Cloudflare Pages Production Deployment ID：`2dfd64ec-62e6-477d-9412-4dfaffc83523`
- Cloudflare Pages 结果：`success`，2026-08-30T09:05:53Z 完成

## 修改文件

- `scripts/build.mjs`
- `scripts/seo/test-r2-lite.mjs`
- `index.html`
- `how-to-play/index.html`
- `package.json`
- `docs/seo/releases/2026-08-30-r2-lite-navigation-cleanup.md`（本报告，合并后的文档提交）

没有修改 Daily 数据或 Manifest、R1 Production Smoke、robots.txt、sitemap 生成范围、Workflow、依赖、游戏逻辑、Today 采集与验证流程。

## 导航修改

修改前：

| 标签 | 目标 |
| --- | --- |
| 4×4 Daily | `/` |
| 4×4 Infinite | `/infinite/#game`；部分源页面为 `/?mode=infinite#game` |
| 4×4 Archive | `/archive/` |
| 4×4 rules | `/how-to-play/` |

修改后：

| key | 标签 | 目标 |
| --- | --- | --- |
| `daily` | Daily | `/` |
| `infinite` | Infinite | `/infinite/` |
| `archive` | Archive | `/archive/` |
| `how-to-play` | How to Play | `/how-to-play/` |

`renderMainNavigation(activeKey)` 和 `replaceMainNavigation(html, activeKey)` 成为所有生成页面的唯一主导航来源。active 状态按最终输出路由映射，不再按完整可见文案替换。每页最多一个 `aria-current="page"`；非四个主导航页面不设置 active。

首页 Pokelike Notice 不再链接 `/pokelike-pokesort/today/`。Today 页面继续存在、未发布答案、保持 `noindex,follow`，且不进入 sitemap。首页 topic-links 收拢为指定五项；`/pokesort-down/` 从 How to Play 的 Troubleshooting 区域可达；`/pokesort-alternative/` 仍存在并由 troubleshooting 页面链接。

## 测试结果

| 检查 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm ci` | PASS | 安装 2 个 package；0 vulnerabilities |
| `npm run build:cloudflare` | PASS | UTC 2026-08-30；临时补齐 API 日期 2026-08-26 至 2026-08-30；37 个 Daily 页面、49 个 indexable route |
| `npm run build` + 临时生产历史输入 | PASS | 原命令未改；生产数据 Gate PASS；临时输入位于忽略目录且未提交 |
| `npm run test:seo-r2-lite` | PASS | 52 个共享导航页面、37 个 Daily 路由；受保护身份和 held Today 完整 |
| R1 SEO static | PASS | 52 个 HTML、49 个 sitemap URL、5 个 redirect case、3 个 malicious-host case、1 个 open-redirect case |
| R5 runtime state | PASS | idle/loading/ready/unavailable、竞态取消及边缘请求验证通过 |
| R6 archive SEO | PASS | 49 个 indexable route、37 个 Daily route、最大点击深度 3 |
| R7 release | PASS | Daily edge API、release security、workflow、Cloudflare automation、release rehearsal、production build gate 全部通过 |
| Product regression | PASS | 受保护路由/任务、运行安全、Daily 唯一页面和未来发布边界通过 |
| Browser runtime | PASS | Chrome 390×844 及桌面；Archive 年/月、Pokelike worksheet、404 通过 |
| 本地生产构建浏览器验收 | PASS | 首页 ready、Infinite ready、Archive 200、2026-08-30 Daily ready、Today unavailable/noindex；四个导航点击目标正确 |
| PR Cloudflare Pages check | PASS | PR #2 check conclusion `SUCCESS` |
| `npm run smoke:production` | PASS | 见下节 |
| 生产五页人工验收 | PASS | `/`、`/infinite/`、`/archive/`、`/how-to-play/`、`/pokelike-pokesort/today/` 均 200，导航与 active 正确 |

### `npm test` 日期夹具说明

`npm test` 已实际执行，但当前仓库的多个既有门禁在 R1 Edge Daily 切换后使用互斥的日期输入，因此没有一个单体运行获得最终零退出码：

- 默认 UTC 2026-08-30 运行时，仓库静态公开历史固定截至 2026-08-25，`test:production-build-gate` 拒绝缺失当天静态 Manifest。
- 固定 `POKESORT_BUILD_UTC_DATE=2026-08-25` 后，构建门禁通过，但 R5 浏览器按真实 UTC 2026-08-30 正确拒绝过期的嵌入 board。
- 在隔离 worktree 补齐当前生产 API 历史后，R1 SEO、R2-Lite、R5 和 R6 通过；R7 的次日发布演练会按其较早的故意 future-leak 边界拒绝 2026-08-26 至 2026-08-30 输入。

没有为取得绿色结果而修改 R1、Daily、Today 或这些既有测试。上表中的每个组成门禁均在其设计输入下实际执行并通过。该时间耦合是现有测试编排风险，不是 R2-Lite 产品回归。

## Production Smoke

`npm run smoke:production` 返回 `gate: PASS`：

- HTTPS apex 首页：200
- canonical：`https://pokesort.org/`
- `og:site_name`：`PokeSort 4×4`
- WebSite `@id`：`https://pokesort.org/#website`
- WebSite `url`：`https://pokesort.org/`
- sitemap URL：49，robots sitemap 为 `https://pokesort.org/sitemap.xml`
- 首页运行态：`ready`，`dateKey=2026-08-30`
- Infinite：`ready`，16 cards
- Archive：200，31 cards
- Today：`unavailable`、`noindex,follow`、0 answers
- redirect chain、恶意 next 参数和最终 origin 检查均通过，无 smoke failure

Cloudflare 外层域名规范化当前仍报告 301 hop；R1 Production Smoke 将完整链路判为 PASS。本次没有修改 R1 redirect Worker 或 Cloudflare 域名规则。

## 受保护字段对比

聚合范围：首页 title、meta description、canonical、og:title、完整 play-area、WebApplication JSON-LD、WebSite JSON-LD。比较时仅规范化 HTML 空白。

- 发布前 Tag SHA-256：`932629b3ccca22faf04e90974e9aa8deed62a0b90764aa7252bc910e15b56d8f`
- R2-Lite 源码 SHA-256：`932629b3ccca22faf04e90974e9aa8deed62a0b90764aa7252bc910e15b56d8f`
- 结果：完全一致

额外的 dist 回归断言确认：首页 title、description、H1、canonical、og:title、WebApplication、WebSite、`og:site_name` 以及 Infinite title、description、H1 均保持预期值；整个 dist 不含 `pokesort.example`。

## Today 验证

- 生产 URL：`https://pokesort.org/pokelike-pokesort/today/`
- HTTP：200
- `data-today-state`：`unavailable`
- robots：`noindex,follow`
- 发布答案数量：0
- sitemap：无 Today URL
- 首页：无 `/pokelike-pokesort/today/` 链接
- 主导航：无错误 `aria-current`

## 风险

- 既有单体 `npm test` 编排未统一 Edge Daily 后的静态历史、真实浏览器日期与 R7 演练边界；需要在独立于 R2-Lite 的 Daily 测试维护任务中处理。
- Cloudflare 外层 HTTP/www 规范化目前产生 301 hop，虽然既有 R1 smoke 明确 PASS；R2-Lite 未触碰该规则。
- active 状态依赖 `mainNavigationActiveKey()` 的路由映射；新增主导航页面时必须同步映射并扩展 `test-r2-lite.mjs`。

## 回滚

从 `main` 回滚 R2-Lite 合并：

```bash
git checkout main
git pull --ff-only origin main
git revert -m 1 af063f14fe2e2a50b676af3faaa6499743f9636d
git push origin main
npm run smoke:production
```

发布前代码可由 Tag `pre-seo-r2-lite-20260830` 定位。不要强制移动或覆盖该 Tag。
