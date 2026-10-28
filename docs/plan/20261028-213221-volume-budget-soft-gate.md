# 计划：体积预算从硬门禁降为软门禁（warning，不阻塞）

## 背景与决策

`scripts/build.mjs` 原三道门禁全部 throw 阻塞。经 review 决策（2026-10-28）：**体积预算改为只报 warning、不打断打包流程**；import 白名单与 INLINED_THIRD_PARTY 两道门禁**维持阻塞不变**（它们防的是依赖泄漏，属于安全/契约性质；体积只是资源提示）。

同时 `tests/dist.test.mjs` §3 的体积硬断言放宽为"与构建时判定一致"的信息性检查——即 warning 为 `[]` 时通过；产物超预算时测试输出 warning 内容但**不再失败**。体积失控的约束从"机器阻塞"转为"日志可见 + 人工审阅"。

## 铁律 5 对照

本变更不动 `BUDGET` / `INLINED_THIRD_PARTY` / esbuild 版本的**取值**，改的是体积门禁的**语义**（throw → warn），属契约变更，以本文件记录。原计划 `20261017-231108-dist-bundle.md` 的"三道门禁皆阻塞"描述以本文为准作废。

## 改动

### 1. `scripts/build.mjs`

- `gateVolume(outBytes, budget = BUDGET)` 不再 throw，返回 `{ raw, gz, warnings }`；超 raw / 超 gzip 各产生一条中文 warning（仍带 `[gate:volume]` 前缀便于 grep）。
- `buildBundle`：调用后若有 warnings 打印到 stderr；返回的 `vol` 含 `warnings` 字段。
- `main`：成功行追加 `(warning: N)` 标记。
- 文件头"三道门禁"注释同步为"两道硬门禁 + 体积软门禁"。

### 2. `tests/build.test.mjs` §7

- "超 raw 预算 → throw" 改为 "超 raw 预算 → 不 throw，warnings 含 `[gate:volume] 原始`"
- "gzip 超限 → throw" 改为 "不 throw，warnings 含 `gzip`"
- 新增 "未超限 → warnings 为空数组"

### 3. `tests/dist.test.mjs` §3

- 三条硬断言（raw ≤ 30 KB、gzip ≤ 12 KB、5× 余量）替换为两条软检查：`vol.warnings` 为空（与构建判定一致）；`vol.raw` 正数 sanity。
- 头部注释覆盖清单 §3 描述同步。

### 4. `AGENTS.md`

- Structure 中 `build.mjs` 注释：三道门禁 → 两道硬门禁 + 体积软门禁
- Commands 中 `npm run build` 注释同上
- Known Issues "体积预算余量"条目补一句：超预算只 warning 不阻塞，需人工关注构建日志

## 清单

- [x] `build.mjs` gateVolume 去阻塞 + 打印链路
- [x] `build.test.mjs` §7 改 warning 断言
- [x] `dist.test.mjs` §3 放宽
- [x] `AGENTS.md` 同步
- [x] 验证：`npm run build` + `npm test` 全绿、`git diff dist/index.js` 为空；注入小预算脚本证明超预算时 exit 0 且有 warning
