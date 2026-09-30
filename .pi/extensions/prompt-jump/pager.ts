/**
 * pager.ts — 消息查看器:覆盖整个终端窗格的 overlay 组件。
 *
 * 以选中的用户消息首行对齐窗口顶部,之后可用
 *   ↑/↓ 或 k/j   逐行滚动
 *   f / 空格 / PgDn  下翻一页     b / PgUp  上翻一页
 *   d / u       半页滚动          g / G      跳到开头/结尾
 *   滚轮(fullscreen 模式)逐行滚动
 *   q / Esc     退出
 * 翻阅的是打开时刻的会话文档渲染行(冻结视图),不影响宿主任何状态。
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { renderConversationLines } from "./anchors.ts";

export class MessagePager implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly initialOffset: number;
	private readonly onDone: () => void;

	private scrollTop = 0;
	private disposed = false;
	/** 文档行缓存(按宽度),随 renderConversationLines 内部缓存对齐 */
	private cachedWidth = -1;
	private cachedLines: string[] = [];

	constructor(tui: TUI, theme: Theme, initialOffset: number, onDone: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.initialOffset = initialOffset;
		this.onDone = onDone;
	}

	invalidate(): void {
		this.cachedWidth = -1;
		this.cachedLines = [];
	}

	dispose(): void {
		this.disposed = true;
	}

	private get height(): number {
		return Math.max(1, this.tui.terminal?.rows ?? 24);
	}

	private get lines(): string[] {
		const { lines, contentWidth } = renderConversationLines(this.tui);
		if (contentWidth !== this.cachedWidth) {
			this.cachedWidth = contentWidth;
			this.cachedLines = lines;
			// 打开时刻定位到目标消息;之后宽度变化仅重新切片,不再重置位置
			if (this.cachedWidth !== -1 && this.scrollTop === 0 && this.initialOffset > 0) {
				this.scrollTop = this.initialOffset;
			}
		}
		return this.cachedLines;
	}

	private maxScrollTop(): number {
		// 最后一行留给状态栏
		return Math.max(0, this.lines.length - (this.height - 1));
	}

	private clamp(): void {
		this.scrollTop = Math.max(0, Math.min(this.maxScrollTop(), this.scrollTop));
	}

	private scrollBy(delta: number): void {
		this.scrollTop += delta;
		this.clamp();
	}

	render(width: number): string[] {
		if (this.disposed) return [];
		const lines = this.lines;
		this.clamp();
		const viewHeight = this.height - 1; // 状态栏占一行
		const out: string[] = [];
		const total = this.lines.length;
		const from = this.scrollTop;
		const to = Math.min(total, from + viewHeight);
		for (let i = from; i < to; i++) {
			const line = lines[i] ?? "";
			// 行是按 contentWidth 渲染的,补齐到 overlay 宽度避免残留字符
			const pad = Math.max(0, width - visibleWidth(line));
			out.push(pad > 0 ? line + " ".repeat(pad) : line);
		}
		while (out.length < viewHeight) {
			out.push("");
		}
		const position = total > 0 ? `第 ${from + 1}-${to} 行 / 共 ${total} 行` : "(空)";
		const help = "↑↓ 滚动 · f/b 翻页 · d/u 半页 · g/G 首尾 · q 退出";
		const status = truncateToWidth(` /jump 查看  ${position}  ${help} `, width);
		out.push(this.theme.fg("dim", status));
		return out;
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		if (data === "q" || data === "Q" || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onDone();
			return;
		}
		if (data === "j" || matchesKey(data, "down")) {
			this.scrollBy(1);
		} else if (data === "k" || matchesKey(data, "up")) {
			this.scrollBy(-1);
		} else if (data === "f" || data === " " || matchesKey(data, "pagedown")) {
			this.scrollBy(this.height - 1);
		} else if (data === "b" || matchesKey(data, "pageup")) {
			this.scrollBy(-(this.height - 1));
		} else if (data === "d") {
			this.scrollBy(Math.floor((this.height - 1) / 2));
		} else if (data === "u") {
			this.scrollBy(-Math.floor((this.height - 1) / 2));
		} else if (data === "g" || matchesKey(data, "home")) {
			this.scrollTop = 0;
		} else if (data === "G" || matchesKey(data, "end")) {
			this.scrollTop = this.maxScrollTop();
		} else {
			return; // 未识别的键不改状态,也不强制重绘
		}
		this.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.disposed) return undefined;
		if (event.type === "wheel" && typeof event.wheelDelta === "number") {
			this.scrollBy(event.wheelDelta); // wheelDelta 负值向上
			this.tui.requestRender();
			return { handled: true, render: false };
		}
		return undefined;
	}
}
