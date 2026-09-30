# pi-prompt-jump

一个 [Pi](https://github.com/earendil-works/pi)(AI coding agent)扩展:为对话记录提供**用户消息快速跳转导航**。

聊天轮次多了以后想回看某条自己发过的消息,只能靠终端往上翻。本扩展提供 `/jump` 命令:弹出与 Pi 原生 `/tree` 同款的会话树选择器(默认只列用户消息),选中某条后打开**消息查看器(pager)**——目标消息首行对齐窗口顶部,然后可以像 `git log | less` 一样用键盘/滚轮翻阅整个会话。**不切换会话分支,不影响宿主任何状态。**

- 选择器:/tree 同款交互(方向键选择、搜索、折叠、跨分支浏览)
- 查看器:目标消息显示在窗口顶部;`↑↓`/`j`/`k` 逐行、`f`/`空格`/`b` 翻页、`d`/`u` 半页、`g`/`G` 首尾、`q`/`Esc` 退出;底部状态栏显示行位置与按键提示
- **regular 与 fullscreen 两种 TUI 模式均可使用**(fullscreen 下额外支持滚轮翻阅)

> 本项目不发布到 Pi 包市场,也不发布到 npm。分发方式是 GitHub 仓库 + 分支/标签引用。

## 安装

通过 `pi install` 从 GitHub 安装(写入个人配置 `~/.pi/agent/settings.json`,所有项目可用):

```bash
# 跟踪 master 分支(默认)
pi install git:github.com/Sticky-Finger/pi-prompt-jump@master

# 等价写法(https 形式,再手动指定 ref 时用上面那种)
pi install https://github.com/Sticky-Finger/pi-prompt-jump
```

- `@ref` 可以是**分支、标签或 commit**,如 `@master`、`@v0.1.0`、`@<commit>`
- 只想装到**某个项目**(写入该项目 `.pi/settings.json`):加 `-l`,项目信任后生效

```bash
pi install -l git:github.com/Sticky-Finger/pi-prompt-jump@master
```

### 更新 / 切换版本 / 卸载

```bash
pi update --extensions   # 重新拉取:分支 ref 会 checkout 到该分支最新;标签/commit 固定不动
pi install git:github.com/Sticky-Finger/pi-prompt-jump@<其他分支或标签>   # 切换版本
pi remove git:github.com/Sticky-Finger/pi-prompt-jump                    # 卸载
pi list                    # 查看已安装的包
```

### 免安装试用

不改任何配置,当场试一次:

```bash
pi -e git:github.com/Sticky-Finger/pi-prompt-jump@master
```

## 使用

任意 Pi 会话中输入:

```
/jump
```

1. 在弹出的消息树里(默认仅用户消息)选中目标消息,回车
2. 进入查看器:目标消息首行在窗口顶部,按 `f`/`空格` 下翻、`b` 上翻、`g`/`G` 跳首尾,滚轮(fullscreen)逐行滚动
3. `q` / `Esc` 退出查看器,回到输入框

选中不在当前活动分支上的消息会提示"该消息不在当前分支";`Esc` 取消无任何副作用。

## 开发

```bash
git clone https://github.com/Sticky-Finger/pi-prompt-jump.git
cd pi-prompt-jump

# 跑纯逻辑自测(无需 TUI)
node tests/anchors.test.mjs

# 本仓库内直接作为项目扩展调试(.pi/extensions/ 约定,项目信任后自动加载)
pi
# 或显式加载
pi --extension ./.pi/extensions/prompt-jump/index.ts
```

结构:

```
.pi/extensions/prompt-jump/
  index.ts      # 入口:注册 /jump 命令
  anchors.ts    # 定位层:双模式文档视图解析、用户消息收集、行偏移测量、整文档渲染
  jump-list.ts  # 交互编排:TreeSelector 选择器 → pager overlay 两段式
  pager.ts      # 消息查看器:覆盖整窗 overlay,键盘/滚轮翻阅
tests/anchors.test.mjs          # 纯逻辑自测
docs/plan/                      # 设计与实施计划(含进度记录)
package.json                    # pi 包清单(pi.extensions 指向上面的扩展)
```

核心原理:会话文档由各消息组件按序渲染拼接,逐组件 `render(width).length` 累加即得每个用户消息的精确行偏移;pager 将整份文档行切片显示并自管滚动位置。regular 模式经 `tui.children` 探测文档容器,fullscreen 模式经 `getPrimaryScrollView`,两者测量结果一致。

## 已知限制

- pager 尺寸在打开时定格,查看中改窗口大小会出现显示偏差(退出重开即恢复)
- regular 模式下滚轮归终端管,查看器内仅键盘翻阅;fullscreen 模式滚轮可用
- 依赖宿主少量内部结构(`getPrimaryScrollView`、文档容器层级);已全部做形状校验与 try/catch 降级——结构不符时提示失败而非崩溃
- skill 调用消息按一条锚点处理(skill 块与其附属用户消息合并)
- 在本仓库内开发时项目扩展已自动加载,无需再 `pi install` 本包(否则命令会注册两份)
