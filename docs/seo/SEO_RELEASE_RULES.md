1. 不修改首页 URL、canonical 和根目录结构。
2. 2026-09-03 之前，不修改首页 title、meta description、H1 和首屏主文案。
3. 每个 SEO Release 必须单独分支、单独 PR、单独 Git Tag。
4. 同一个页面的搜索可见内容，至少间隔 4 天才能再次修改。
5. 每次部署前必须执行：
   npm ci
   npm run build
   npm test
6. 每次部署后必须执行 production smoke test。
7. 不批量生成 Pokémon 独立页、answer archive、地区页、翻译页或 alternatives 文章。
8. Pokelike Today 在 verification Gate 通过前永远保持 noindex。
9. 不同时修改首页标题、导航、结构、正文和外链。
10. 不因为单个小时或单个 fresh 24-hour 数据下跌而回滚。
11. 不添加广告、弹窗、通知授权和强制安装提示。
12. 不批量建设外链，不添加全站站群页脚链接。
13. 首页的核心词 pokesort 必须始终由 [https://pokesort.org/](https://pokesort.org/) 承接。
14. 所有新功能先 noindex 验证，功能和数据 Gate 通过后再进入 sitemap。
