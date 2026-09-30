/**
 * jump-list.ts — /jump 选择器:复用宿主的 TreeSelectorComponent(/tree 同款外观),
 * 初始过滤为"仅用户消息";选中后测量锚点并滚动 transcript 到该消息,
 * 消息首行对齐视口顶部。不做分支切换,不影响任何原生滚动行为。
 */
import { TreeSelectorComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { findTranscript, measureAnchors } from "./anchors.ts";

export async function showJumpList(ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("/jump 仅在交互式 TUI 模式下可用", "warning");
		return;
	}

	const tree = ctx.sessionManager.getTree();
	if (tree.length === 0) {
		ctx.ui.notify("当前会话没有任何消息", "warning");
		return;
	}

	await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
		// fullscreen 检测必须在拿到 tui 后进行;regular 模式无 ScrollView 可滚动
		if (!findTranscript(tui)) {
			ctx.ui.notify("/jump 需要 fullscreen TUI 模式:/settings 中将 tuiMode 设为 fullscreen", "warning");
			queueMicrotask(() => done());
			return new Container(); // 空组件占位,选择器不展示
		}

		const terminalHeight = tui.terminal.rows ?? 24;
		const selector = new TreeSelectorComponent(
			tree,
			ctx.sessionManager.getLeafId(),
			terminalHeight,
			(entryId) => {
				// 选中:测量锚点(此时选择器仍覆盖编辑区,transcript 在上方,测量的是真实文档)
				const anchor = measureAnchors(tui, ctx).find((a) => a.entryId === entryId);
				done(); // 先关选择器,再滚动,让用户立刻看到结果
				const ref = anchor ? findTranscript(tui) : undefined;
				if (anchor && ref) {
					ref.sv.scrollTo(anchor.offset); // 消息首行对齐视口顶部
				} else if (anchor) {
					ctx.ui.notify("跳转失败:无法定位 transcript 视口", "warning");
				} else {
					ctx.ui.notify("该消息不在当前分支,无法跳转", "warning");
				}
			},
			() => done(), // Esc 取消
			undefined,
			undefined,
			"user-only", // 初始过滤:仅用户消息
		);
		return selector;
	});
}
