# Changelog

本项目所有重要变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/),版本遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Changed

- **仓库布局重构**:扩展源码由 `.pi/extensions/prompt-jump/*.ts` 迁至 `src/`;构建产物由 `.pi/extensions/prompt-jump/dist/index.js` 迁至仓库根 `dist/index.js`(由改过 outfile 的 `scripts/build.mjs` 重新 `npm run build` 产出,产物字节与旧产物一致);`package.json` 的 `pi.extensions` 改为 `./dist/index.js`。
- **`.pi/` 出库**:`.gitignore` 忽略 `/.pi/` 及 `.agents/` `.claude/` `.cursor/` `.aider/` `.codex/` `.gemini/` `.copilot/` `.windsurf/` `.continue/` `.roo/` `.opencode/` 等 agent 目录;`dist/` 仍必须入库(pi 的 git 安装链路不跑构建)。
- **版本**:0.2.0 → 0.3.0(安装布局变化)。

## [0.2.0] - 2026-10-17

### Changed

- **构建管线**:扩展入口由 TS 源(`.pi/extensions/prompt-jump/index.ts`)改为 esbuild 打包产物(`.pi/extensions/prompt-jump/dist/index.js`)。pi 启动时不再用 jiti 现场转译 4 个 TS 模块(16 KB),改为原生加载单文件产物(5.5 KB / gzip 2.4 KB)。
- **依赖管理**:首次引入 `package-lock.json` 入库;`esbuild@0.28.2` 锁为 devDependency;`@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-tui` 声明为 `peerDependencies`;运行时第三方依赖(`dependencies`)保持为 0。
- **测试**:`tests/dist.test.mjs` 新增(18 项断言,覆盖新鲜度 / 单文件 / 体积预算 / 无泄漏 / 内容完整 / 可加载 / 可注册 / 零依赖 / 可复现九大类);`npm test` 现串行运行既有 `anchors.test.mjs` + 新 `dist.test.mjs`。
- **文档**:新增 `AGENTS.md`(硬规则清单);`docs/plan/20261017-231108-dist-bundle.md` 为本次改动的设计与端到端验证记录。

### Security

- **产物自包含**:第三方包一律内联(当前 `INLINED_THIRD_PARTY` 清单为空),无法在产物层面悄悄引入外部代码;`scripts/build.mjs` 三道门禁(import 白名单 / metafile 比对 / 体积预算)在构建期强制。

## [0.1.0] - 2026-09-30

### Added

- 初始版本。`/jump` 命令:复用宿主 `TreeSelectorComponent`(默认仅用户消息),选中后打开消息查看器(pager)覆盖整窗,目标消息首行对齐窗口顶部,键盘/滚轮翻阅整个会话;regular 与 fullscreen 两种 TUI 模式行为一致。
- 4 个 TS 模块(`index.ts` / `anchors.ts` / `jump-list.ts` / `pager.ts`,合计 16 KB)。
- `tests/anchors.test.mjs` 纯逻辑自测(21 项断言)。
