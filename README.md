# prompt-jump — Pi 用户消息快速跳转导航

Pi 扩展:为对话记录提供"历史消息快速跳转"能力。`/jump` 外观与 Pi 原生 `/tree` 一致,但选中后**不切换会话分支**,而是打开消息查看器(pager)快速定位翻阅。**regular 与 fullscreen 模式均可使用**。

## 功能

- `/jump`:弹出会话树选择器(初始过滤为**仅用户消息**,支持搜索/折叠/分支浏览,与 `/tree` 同款交互)
- 选中某条用户消息 → 打开**消息查看器(pager)**:
  - 目标消息**首行对齐窗口顶部**,打开即见
  - 翻阅按键(类似 `git log | less`):

    | 按键 | 作用 |
    |---|---|
    | `↑` / `↓` 或 `k` / `j` | 逐行滚动 |
    | `f` / 空格 / PgDn | 下翻一页 |
    | `b` / PgUp | 上翻一页 |
    | `d` / `u` | 半页滚动 |
    | `g` / `G` | 跳到开头 / 结尾 |
    | 滚轮 | 逐行滚动(fullscreen 模式) |
    | `q` / `Esc` / `Ctrl+C` | 退出查看器 |

  - 底部状态栏显示当前行位置与按键提示
- 翻阅的是打开时刻的会话渲染(冻结视图),不影响宿主状态;选中不在当前活动分支的消息会提示;`Esc` 取消无副作用

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
  anchors.ts    # 定位层:双模式文档视图解析、用户消息收集、行偏移测量、整文档渲染
  jump-list.ts  # 交互编排:TreeSelector 选择器 → pager overlay 两段式
  pager.ts      # 消息查看器:覆盖整窗 overlay,键盘/滚轮翻阅
tests/
  anchors.test.mjs  # 纯逻辑自测(node tests/anchors.test.mjs)
docs/plan/
  20260930-205341-user-message-jump-nav.md  # 设计与实施计划(含进度记录)
```

核心原理:会话文档由各消息组件按序渲染拼接,逐组件 `render(width).length` 累加即得每个用户消息的精确行偏移;pager 将整份文档行切片显示并自管滚动位置。regular 模式经 `tui.children` 探测文档容器,fullscreen 模式经 `getPrimaryScrollView`,两者测量结果一致。

## 已知限制

- pager 尺寸在打开时定格,查看中改窗口大小会出现显示偏差(退出重开即恢复)
- regular 模式下滚轮归终端管,pager 内仅键盘翻阅;fullscreen 模式滚轮可用
- 依赖宿主少量内部结构(`getPrimaryScrollView`、文档容器层级);已全部做形状校验与 try/catch 降级——结构不符时提示失败而非崩溃
- skill 调用消息按一条锚点处理(skill 块与其附属用户消息合并)
