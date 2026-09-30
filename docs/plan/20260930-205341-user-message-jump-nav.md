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

1. 创建 `.pi/extensions/prompt-jump/anchors.ts` — 定位与测量:`findTranscript(tui)` 形状探测(tui.mode 为 fullscreen 且存在 getPrimaryScrollView)取 `{sv, doc, chat}`(chat 为含消息组件的容器,结构不符返回 undefined);`collectUserEntries(sm)` 从 `buildContextEntries()` 过滤 `type==="message" && role==="user" && 有文本` 生成 `{entryId, previewText}`;`measureAnchors(tui, sm)` 单次遍历 doc/chat children,`instanceof UserMessageComponent | SkillInvocationMessageComponent` 认锚点并按序对应 collectUserEntries 第 i 条,`child.render(contentWidth).length` 累加得行偏移,返回 `{entryId, offset}[]`;全程 try/catch,异常返回空数组。
2. 创建 `.pi/extensions/prompt-jump/jump-list.ts` — 选择器封装:`showJumpList(ctx)` 用 `ctx.ui.custom((tui, theme, kb, done) => new TreeSelectorComponent(tree, leafId, termRows, onSelect, onCancel))`,`initialFilterMode` 传 `"user-only"`;onSelect(entryId) 调 measureAnchors 查 entryId → 命中则 `sv.scrollTo(offset)`(消息首行对齐视口顶部,scrollTo 内部自动夹紧边界)并 done() 关闭,未命中(非活动分支或结构异常)notify 提示后仍关闭;regular 模式在进入前直接 notify "请先切换 fullscreen 模式"。
3. 创建 `.pi/extensions/prompt-jump/index.ts` — 入口:`registerCommand("jump")`(描述:跳转到指定用户消息)调用 showJumpList;可选 `registerShortcut`(如 ctrl+j)打开同列表;`ctx.mode !== "tui"` 时直接提示不支持。
4. 创建 `README.md` — 中文说明:功能与演示说明、启用方式(项目信任后自动加载,或 `pi --extension ./.pi/extensions/prompt-jump/index.ts`)、需 fullscreen 模式、已知限制(regular 模式不可用、依赖内部结构的降级策略)。
5. 手动测试 — 本仓库内 `pi --extension ./.pi/extensions/prompt-jump/index.ts` + `/settings` 切 fullscreen;验证多轮对话后 `/jump` 外观同 /tree 且默认只列用户消息、回车后目标消息首行显示在窗口顶部(选首条用户消息跳转同样正确)、Esc 取消无副作用;关键验证滚动自由度:跳转后滚轮上下滚动、拖动滚动条均可浏览整个会话(能滚到开头也能滚到末尾),新消息到来时跟随滚动正常;边界:空会话/单消息/选中非当前分支消息提示正确/`/tree` 真切换分支后再跳/压缩后再跳/窗口 resize 后再跳/regular 模式提示不报错。

## 风险与说明

- 依赖少量半公开内部结构(`getPrimaryScrollView`、document/chat 容器层级、`ScrollView.child`)——全部做形状校验 + try/catch 降级,异常时提示"跳转失败"而非崩溃;Pi 升级若变动仅表现为功能失效。
- 测量在选择确认时单次执行(组件自身有宽度缓存),性能无压力,无需常驻状态或事件订阅。
