# AGENTS.md

> 给后续接手本仓库的 AI / 协作者的"硬规则"清单。结构、命令、边界、已知问题。

## Structure

```
pi-prompt-jump/
├── src/
│   ├── index.ts          # 入口:注册 /jump 命令
│   ├── anchors.ts        # 定位层:文档视图解析 + 行偏移测量
│   ├── jump-list.ts      # 交互编排:TreeSelector → pager overlay
│   └── pager.ts          # 消息查看器 overlay
├── dist/index.js         # ⚙️ GENERATED(由 npm run build 产出,提交进 git)
├── scripts/
│   └── build.mjs         # esbuild 打包脚本(两道硬门禁 + 体积软门禁)
├── tests/
│   ├── anchors.test.mjs  # 纯逻辑自测(加载 .ts via jiti)
│   ├── build.test.mjs    # build.mjs 主要函数单测(导出面:parseArgs/gate* 等)
│   └── dist.test.mjs     # dist 产物门禁测试
├── docs/plan/            # 历史与当前计划(只读存档)
├── package.json          # pi.extensions 指向 dist/index.js
├── package-lock.json     # devDep 锁版入库
└── README.md             # 用户文档
```

## Commands

```bash
# 首次 clone 后
npm ci                                  # 装 devDep(esbuild 0.28.2,精确锁版)

# 改源码后必做
npm run build                           # 打 dist/index.js(过两道硬门禁;体积超预算仅 warning)
node tests/dist.test.mjs                # 验证 dist(17 项断言)
node tests/anchors.test.mjs             # 验证锚点逻辑
node tests/build.test.mjs               # 验证 build.mjs 门禁/参数解析(35 项断言)
npm test                                # 上面三个串行

# 本仓库内调试
pi --extension ./src/index.ts                # 显式加载 TS 源(走 jiti)
pi --extension ./dist/index.js               # 显式加载打包产物(原生 ESM)
pi -ne -e .                                  # 一次性试用本仓库,加载 dist/index.js
```

## Boundaries(铁律)

> 详见 `docs/plan/20261017-231108-dist-bundle.md §0`(铁律 1-5)与 `docs/plan/20261028-131219-relocate-dist-and-ignore-agent-dirs.md`(铁律 6)。以下是最容易踩雷的几条:

1. **`dist/index.js` 必须提交进 git**(位于仓库根 `dist/`)。本扩展是 git 源安装(`pi install git:...`),pi 的安装链路(`git clone` + `npm install --omit=dev`)不跑构建。**未提交的 dist 在用户机器上不存在,扩展会静默不加载。**
2. **改 .ts 源码必须 `npm run build` 并提交 dist**。dist 是 GENERATED(`.gitattributes` 标了 `linguist-generated`);但因为 pi 不在安装时构建,**仍然要入库**。
3. **禁止手改 `dist/index.js`**。手改会跑过测试但下次 `npm run build` 就被覆盖。改源码。
4. **`dependencies` 永远为空**。所有运行时第三方依赖必须走"内联 + 登记到 `scripts/build.mjs` 顶部 `INLINED_THIRD_PARTY`"流程,或改用 `node:` 内置。`tests/dist.test.mjs §8` 会卡住非空情况。
5. **包版本/budget 阈值改了要同步 plan 文档**。任何对 `BUDGET` / `esbuild` 版本 / `INLINED_THIRD_PARTY` 清单的修改都属于"破坏铁律的契约",先改 plan 通过审阅再改代码。
6. **源码只放 `src/`;`.pi/` 及其他 agent 目录一律不入库**。`.pi/` 是 pi 的本机状态目录(`.gitignore` 已忽略 `/.pi/` 及 `.agents/` `.claude/` 等);产物路径由 `scripts/build.mjs` 的 outfile 决定,只能靠 `npm run build` 生成,**禁止手工搬运/拷贝产物**。

## Known Issues

- **pager 尺寸在打开时定格**:查看中改窗口大小会有显示偏差,退出重开即恢复。
- **regular 模式滚轮归终端管**:pager 内仅键盘翻阅;fullscreen 模式滚轮可用。
- **依赖宿主半公开结构**:`getPrimaryScrollView`、document/chat 容器层级等已做形状校验 + try/catch 降级;结构不符时提示"跳转失败"而非崩溃。
- **esbuild 锁版**:`package.json` 中 `esbuild` 必须精确锁版(无 `^`/`~`)。升级版本 = 重新 build + 提交新 dist + 验证字节差异在 commit message 里说明。
- **体积预算为软门禁(参考值,不阻塞)**:`raw ≤ 30 KB` / `gzip ≤ 12 KB`。超预算 `npm run build` 只打 warning、产物照常写出,是否提交由人工判断(决策与背景见 `docs/plan/20261028-213221-volume-budget-soft-gate.md`)。当前 5.5 KB / 2.4 KB,留 ~5× 余量。引入新第三方包前对照 `docs/plan/.../§附录 A.5` 价目表。注意:import 白名单与 INLINED_THIRD_PARTY 仍是**硬门禁**,违例直接构建失败。
- **测试需要本机 pi 安装**:`tests/dist.test.mjs §6/§7` 通过 symlink `/Users/a1/.pi/agent/install/releases/0.87.1/node_modules` 解析 `@earendil-works/*`。换机器 / 升 pi 后**必须更新此路径**或在测试里加探测逻辑。

## File generation rules

| 路径 | 状态 | 由谁生成 |
|---|---|---|
| `dist/index.js` | GENERATED,提交入库 | `npm run build` |
| `package-lock.json` | 已生成,提交入库 | `npm install` 时生成 |
| `package.json` 的 `devDependencies.esbuild` | 手编,精确锁版 | 维护者 |
| 任何其他 `.ts` / `.mjs` / `.md` | 手编,提交入库 | 维护者 |
