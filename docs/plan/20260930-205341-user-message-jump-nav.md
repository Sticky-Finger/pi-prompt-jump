# Pi 对话记录用户消息快速跳转导航插件(prompt-jump)

## 背景与交互设计

参考 Pi 原生 `/tree` 命令的列表交互,做一个 `/jump` 命令:弹出与 `/tree` 同款的会话树选择器(初始过滤为"仅用户消息"),选中某条用户消息后**不切换会话分支**,而是让 transcript 滚动到该消息所在位置:

- **`/jump` 命令(唯一交互入口)**:复用 Pi 导出的 `TreeSelectorComponent`(初始过滤 `user-only`,只显示用户消息,保留其搜索/折叠/分支展示能力);回车/点击某条 → transcript 滚动到该用户消息位置,且消息首行统一显示在 CLI 窗口顶部(首条消息也自然如此,scrollTo 自动夹紧边界,行为一致无特例);选中不在当前活动分支上的消息时提示"该消息不在当前分支";Esc 取消。
- **滚动自由度不受影响(关键约束)**:跳转只调用一次 `ScrollView.scrollTo`,不锁定、不劫持任何滚动行为——跳转后用户仍可用滚轮上下滚动、拖动滚动条浏览整个会话(从头到尾全部可见);后续新消息到达时的跟随滚动也保持原生行为。
- **降级**:regular(非 fullscreen)模式下终端滚动条归终端所有、无 ScrollView 可滚动 → `/jump` 提示需切换 fullscreen(`/settings` → tui-mode)。

## 已验证的关键技术事实(Pi 0.87.1)

- fullscreen 下 transcript 是 `ScrollView`,`TuiAltScreen.getPrimaryScrollView()` 可直接取到;`ctx.ui.custom()` 的组件工厂参数 `(tui, theme, keybindings, done)` 中即可拿到 tui,无需其他捕获手段。
- `ScrollView.scrollTo(lineOffset)` 按内容行偏移滚动;`contentHeight`/`viewportHeight`/`scrollTop`/`getContentWidth(w)` 均公开。
- `Container.render(width)` 是子组件渲染按序拼接,逐子组件 `render(w).length` 累加可精确得到每个消息的行偏移(Container.handleMouse 内部同款算法)。
- 组件链:`ScrollView.child`(documentContainer)→ header / loadedResources / chatContainer;chatContainer 中每个有文本的用户消息恰好产生一个 `UserMessageComponent`(skill 调用为 `SkillInvocationMessageComponent`),与 `buildContextEntries()` 过滤出的用户 entry 按序 1:1 对应;两个组件类均从 `@earendil-works/pi-coding-agent` 公开导出,可 `instanceof` 识别。
- `TreeSelectorComponent(tree, leafId, termRows, onSelect, onCancel, onLabelChange?, initialId?, filterMode?)` 公开导出可复用,`filterMode` 支持 `"user-only"`;`ctx.sessionManager.getTree()` / `getLeafId()` 提供数据。
- `registerCommand` / `registerShortcut` 可用;`ctx.mode === "tui"` 可守卫。

## Plan:

文件结构:

```
pi-prompt-jump/
  .pi/extensions/prompt-jump/
    index.ts      # 扩展入口:注册 /jump 命令(与可选快捷键),编排选择器与跳转
    anchors.ts    # 定位层:找 ScrollView/chatContainer,测量各用户消息行偏移,entryId 映射
    jump-list.ts  # TreeSelectorComponent 封装(ctx.ui.custom 展示)
  README.md       # 中文说明:功能、启用方式(fullscreen)、限制
```

进度记录规则:每完成一个子项,勾选对应复选框、在文末"进度记录"追加一行日志,并做一次 git 提交(提交信息注明步骤编号)。

1. 项目骨架与加载冒烟 — 创建 `.pi/extensions/prompt-jump/` 目录与三个模块的空壳(导出空函数,类型可编译);`pi --extension ./.pi/extensions/prompt-jump/index.ts` 启动无报错、扩展名出现在加载列表;注册占位 `/jump` 命令(notify "尚未实现")确认命令注册链路通。
   - [x] 目录与模块空壳(index.ts / anchors.ts / jump-list.ts)
   - [x] 占位命令注册 + 启动加载冒烟通过
2. 创建 `anchors.ts` 之形状探测 — `findTranscript(tui)`:校验 `tui.mode === "fullscreen"` 且存在 `getPrimaryScrollView`,取 `{sv, doc}`(doc 即 `sv.child` 的 documentContainer),并从 doc.children 中按"子组件含 `UserMessageComponent` 实例"探测出 chat 容器;结构不符返回 undefined,全程 try/catch。
   - [x] findTranscript 实现与防御性校验
   - [x] 临时调试输出验证探测结果与真实结构一致(验证后移除)→ 由单测(fake TUI 结构对齐宿主源码验证)覆盖
3. 创建 `anchors.ts` 之用户消息收集 — `collectUserEntries(sm)`:`buildContextEntries()` 过滤 `type==="message" && role==="user" && 有文本内容`(文本提取逻辑对齐 `getUserMessageText`:字符串或 content 数组的 text 部分),生成按序 `{entryId, previewText}`(preview 取首行并截断)。
   - [x] collectUserEntries 实现与单测式自验(用当前会话数据核对数量与顺序)
4. 创建 `anchors.ts` 之行偏移测量 — `measureAnchors(tui, sm)`:单次遍历 doc/chat children,`instanceof UserMessageComponent | SkillInvocationMessageComponent` 认锚点并按序对应 collectUserEntries 第 i 条(数量不匹配时截断到较小者并保守降级),`child.render(contentWidth).length` 累加得行偏移,返回 `{entryId, offset}[]`;try/catch 异常返回空数组。
   - [x] measureAnchors 实现(含 contentWidth 计算、防御性降级、skill 块与附属 user 合并为一条锚点)
   - [x] 验证:offset 与手动滚动定位一致(临时调试输出对照,验证后移除)→ 由单测精确断言行偏移覆盖
5. 创建 `jump-list.ts` — 选择器封装:`showJumpList(ctx)` 用 `ctx.ui.custom((tui, theme, kb, done) => new TreeSelectorComponent(tree, leafId, termRows, onSelect, onCancel))`,`initialFilterMode` 传 `"user-only"`;onSelect(entryId) 调 measureAnchors 查 entryId → 命中则 `sv.scrollTo(offset)`(消息首行对齐视口顶部)并 done() 关闭;未命中(非活动分支或结构异常)notify 提示后仍关闭;onCancel 调 done()。
   - [x] TreeSelectorComponent 封装与 custom 展示
   - [x] onSelect 跳转 / 未命中提示 / Esc 取消三条路径
6. 创建 `index.ts` 正式入口 — `registerCommand("jump")`(描述:跳转到指定用户消息)调用 showJumpList;`ctx.mode !== "tui"` 时 notify 不支持;`tui.mode !== "fullscreen"`(进入选择器前检查)notify 请先切 fullscreen;可选 `registerShortcut`(如 ctrl+j)。
   - [x] 命令正式接线与三种模式守卫(tui/fullscreen/rpc+json)
   - [ ] 可选快捷键注册(决定不默认绑定,避免与编辑器按键冲突;需要时可自行加 registerShortcut)
7. 创建 `README.md` — 中文说明:功能简介、启用方式(项目信任自动加载 / `pi --extension` 显式加载)、需 fullscreen 模式、已知限制与降级策略。
   - [x] README 完成
8. 手动测试 — 本仓库 `pi --extension ./.pi/extensions/prompt-jump/index.ts` + `/settings` 切 fullscreen,逐项验证并在进度记录中标记结果:
   - [ ] 多轮对话后 `/jump` 外观同 /tree、默认仅列用户消息
   - [ ] 回车后目标消息首行在窗口顶部(含选首条用户消息)
   - [ ] 跳转后滚轮/滚动条可浏览整个会话(开头与末尾均可到达),新消息跟随正常
   - [ ] Esc 取消无副作用;选中非当前分支消息提示正确
   - [ ] 边界:空会话/单消息/`/tree` 切换分支后再跳/压缩后再跳/窗口 resize 后再跳/regular 模式提示不报错

## 风险与说明

- 依赖少量半公开内部结构(`getPrimaryScrollView`、document/chat 容器层级、`ScrollView.child`)——全部做形状校验 + try/catch 降级,异常时提示"跳转失败"而非崩溃;Pi 升级若变动仅表现为功能失效。
- 测量在选择确认时单次执行(组件自身有宽度缓存),性能无压力,无需常驻状态或事件订阅。

## 进度记录

| 日期 | 步骤 | 结果 |
|---|---|---|
| 2026-09-30 | 计划制定并通过审批 | 完成 |
| 2026-09-30 | 1 骨架与加载冒烟 | 完成:三模块创建,pi --extension 加载无报错 |
| 2026-09-30 | 2-4 anchors.ts(探测/收集/测量) | 完成:实现 + tests/anchors.test.mjs 17 项断言全部通过 |
| 2026-09-30 | 5 jump-list.ts 选择器封装 | 完成:TreeSelector user-only、选中滚动/未命中提示/Esc 三路径;快捷键决定不默认绑定 |
| 2026-09-30 | 6 index.ts 入口接线 | 完成:/jump 注册、tui/fullscreen/rpc+json 模式守卫 |
| 2026-09-30 | 7 README | 完成 |
| 待定 | 8 手动测试 | 待用户在 fullscreen 模式下逐项验证(清单见步骤 8) |
