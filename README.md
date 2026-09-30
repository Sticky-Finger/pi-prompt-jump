# prompt-jump — Pi 用户消息快速跳转导航

Pi 扩展:为对话记录提供 DeepSeek 式的"历史消息快速跳转"能力,以 `/jump` 命令呈现——外观与 Pi 原生 `/tree` 一致,但选中后**不切换会话分支**,而是把 transcript 滚动到该消息位置。

## 功能

- `/jump`:弹出会话树选择器(初始过滤为**仅用户消息**,支持搜索/折叠/分支浏览,与 `/tree` 同款交互)
- 选中某条用户消息 → transcript 滚动到该处,**消息首行对齐 CLI 窗口顶部**(含首条消息,行为统一)
- **不影响任何原生滚动行为**:跳转只是一次性的 `ScrollView.scrollTo`,跳转后滚轮、滚动条仍可自由浏览整个会话,新消息到来时自动跟随到底部
- 选中不在当前活动分支上的消息 → 提示"该消息不在当前分支",不做任何操作
- `Esc` 取消,无副作用

## 使用要求

- **fullscreen TUI 模式**(`/settings` → `tuiMode` 设为 `fullscreen`,或启动参数对应设置)。regular 模式下对话记录由终端原生 scrollback 管理,无法程序化滚动,`/jump` 会提示切换。

## 启用方式

```bash
# 方式一:项目信任后自动加载(本仓库 .pi/extensions/prompt-jump/)
pi

# 方式二:显式加载
pi --extension ./.pi/extensions/prompt-jump/index.ts
```

## 实现结构

```
.pi/extensions/prompt-jump/
  index.ts      # 入口:注册 /jump 命令
  anchors.ts    # 定位层:fullscreen transcript 形状探测、用户消息收集、行偏移测量
  jump-list.ts  # 选择器:复用宿主 TreeSelectorComponent(user-only 过滤),选中即滚动
tests/
  anchors.test.mjs  # anchors 纯逻辑自测(node tests/anchors.test.mjs)
docs/plan/
  20260930-205341-user-message-jump-nav.md  # 设计与实施计划(含进度记录)
```

核心原理:fullscreen 下 transcript 是 `ScrollView`,其文档由各消息组件按序渲染拼接;逐组件 `render(width).length` 累加即可得到每个用户消息的精确行偏移,`scrollTo(offset)` 即完成跳转。测量在选中时单次执行,无常驻状态。

## 已知限制

- 仅 fullscreen 模式;regular 模式提示不可用
- 依赖宿主少量内部结构(`getPrimaryScrollView`、文档容器层级);已全部做形状校验与 try/catch 降级——结构不符时提示失败而非崩溃,Pi 升级若变动仅表现为功能失效
- skill 调用消息按一条锚点处理(skill 块与其附属用户消息合并)
