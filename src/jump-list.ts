/**
 * jump-list.ts — /jump 选择器:复用宿主的 TreeSelectorComponent(/tree 同款外观),
 * 初始过滤为"仅用户消息";选中后打开消息查看器(pager)——
 * 覆盖整个终端窗格的 overlay,目标消息首行对齐窗口顶部,
 * 之后可用键盘/滚轮翻阅。regular 与 fullscreen 模式行为一致。
 */
import { TreeSelectorComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { measureAnchors, resolveConversationView } from "./anchors.ts";
import { MessagePager } from "./pager.ts";

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

	// 第一步:消息树选择器(替换编辑区,与 /tree 同款交互)
	let pickedEntryId: string | undefined;
	await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
		const selector = new TreeSelectorComponent(
			tree,
			ctx.sessionManager.getLeafId(),
			tui.terminal.rows ?? 24,
			(entryId) => {
				pickedEntryId = entryId;
				done();
			},
			() => done(), // Esc 取消
			undefined,
			undefined,
			"user-only", // 初始过滤:仅用户消息
		);
		return selector;
	});
	if (!pickedEntryId) return; // 用户取消

	// 第二步:打开消息查看器,定位到选中消息
	let pagerTui: import("@earendil-works/pi-tui").TUI | undefined;
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		pagerTui = tui;
		const view = resolveConversationView(tui);
		if (!view) {
			ctx.ui.notify("跳转失败:无法定位会话文档", "warning");
			queueMicrotask(() => done());
			return new Container();
		}
		const anchor = measureAnchors(tui, ctx).find((a) => a.entryId === pickedEntryId);
		if (!anchor) {
			ctx.ui.notify("该消息不在当前分支,无法跳转", "warning");
			queueMicrotask(() => done());
			return new Container();
		}
		return new MessagePager(tui, theme, anchor.offset, done);
	}, {
		overlay: true,
		// 工厂先执行、overlayOptions 后求值,此时 pagerTui 已可用(尺寸在打开时定格)
		overlayOptions: () => ({
			anchor: "top-left" as const,
			row: 0,
			col: 0,
			width: pagerTui?.terminal.columns ?? 80,
			maxHeight: pagerTui?.terminal.rows ?? 24,
		}),
	});
}
