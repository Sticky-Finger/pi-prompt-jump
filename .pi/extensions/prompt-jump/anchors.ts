/**
 * anchors.ts — 定位层:找到会话文档容器(regular/fullscreen 两种模式),
 * 测量各用户消息组件在文档中的行偏移,建立 entryId → 行偏移 映射,
 * 并为消息查看器(pager)提供整份文档的渲染行。
 *
 * 全部访问都做了形状校验与 try/catch 防御:结构不符时返回 undefined / 空数组,
 * 让上层降级为提示"跳转失败",绝不让扩展崩溃影响宿主。
 */
import { SkillInvocationMessageComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

/** 会话文档视图(regular 与 fullscreen 统一) */
export interface ConversationView {
	/** transcript 文档根容器(documentContainer) */
	doc: Component & { children: Component[] };
	/** 含消息组件的 chat 容器(doc 的直接子容器) */
	chat: Component & { children: Component[] };
	/** 文档渲染宽度(与宿主渲染一致,保证行偏移可对齐) */
	contentWidth: number;
}

/** 一条用户消息的定位锚点 */
export interface Anchor {
	entryId: string;
	/** 该消息组件首行在文档渲染行中的下标(行偏移) */
	offset: number;
}

/** 任意组件是否带 children(容器) */
function isContainer(c: Component): c is Component & { children: Component[] } {
	return Boolean(c) && Array.isArray((c as { children?: unknown }).children);
}

function isUserAnchorComponent(c: Component): boolean {
	return c instanceof UserMessageComponent || c instanceof SkillInvocationMessageComponent;
}

/**
 * 解析会话文档视图,regular / fullscreen 两种模式统一:
 *  - fullscreen:transcript 是主 ScrollView,文档为 sv.child,宽度按滚动条配置折减
 *  - regular:文档容器是 tui 的第一个子容器,宽度为整个终端宽
 * 返回 undefined 表示结构不符或探测异常。
 */
export function resolveConversationView(tui: TUI): ConversationView | undefined {
	try {
		const columns = tui.terminal?.columns ?? 0;
		if (!Number.isFinite(columns) || columns <= 0) return undefined;

		// fullscreen:经 getPrimaryScrollView 拿到 transcript 文档
		const getter = (tui as TUI & { getPrimaryScrollView?: () => unknown }).getPrimaryScrollView;
		if (typeof getter === "function") {
			const sv = getter.call(tui) as
				| { child?: unknown; getContentWidth?: (w: number) => number }
				| undefined;
			const doc = (sv as { child?: Component } | undefined)?.child;
			if (isContainer(doc)) {
				const chat = findChatContainer(doc);
				if (chat) {
					const width = typeof sv.getContentWidth === "function" ? (sv.getContentWidth(columns) ?? columns) : columns;
					return { doc, chat, contentWidth: width };
				}
			}
		}

		// regular:文档容器为 tui.children 中的第一个(形状探测校验)
		const children = (tui as TUI & { children?: Component[] }).children;
		if (Array.isArray(children)) {
			for (const child of children) {
				if (!isContainer(child)) continue;
				const chat = findChatContainer(child);
				if (chat) return { doc: child, chat, contentWidth: columns };
			}
		}
	} catch {
		/* fallthrough */
	}
	return undefined;
}

/** 从 doc.children 中探测 chat 容器:第一个包含用户消息组件的容器 */
export function findChatContainer(doc: Component & { children: Component[] }): (Component & { children: Component[] }) | undefined {
	try {
		for (const child of doc.children) {
			if (!isContainer(child)) continue;
			if (child.children.some((c) => isUserAnchorComponent(c))) return child;
		}
	} catch {
		/* fallthrough */
	}
	return undefined;
}

/**
 * 收集当前活动分支上的用户文本消息(buildContextEntries 与界面渲染一致,
 * 天然是压缩感知的),按出现顺序返回。
 */
export function collectUserEntries(ctx: ExtensionContext): { entryId: string; previewText: string }[] {
	try {
		const result: { entryId: string; previewText: string }[] = [];
		for (const entry of ctx.sessionManager.buildContextEntries()) {
			if (entry.type !== "message") continue;
			const message = entry.message as { role?: string; content?: unknown };
			if (message?.role !== "user") continue;
			const text = extractText(message.content);
			if (!text) continue;
			result.push({ entryId: entry.id, previewText: firstLine(text) });
		}
		return result;
	} catch {
		return [];
	}
}

/** 对齐宿主 getUserMessageText:字符串或 content 数组中 text 部分的拼接 */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => {
			const part = c as { type?: string; text?: unknown };
			return part?.type === "text" && typeof part.text === "string";
		})
		.map((c) => c.text)
		.join("");
}

function firstLine(text: string): string {
	const line = text.split("\n", 1)[0] ?? "";
	return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

/**
 * 测量各用户消息的行偏移。
 * 原理:Container.render(width) 即子组件渲染按序拼接,
 * 逐组件 render(contentWidth).length 累加即为该组件首行的行偏移。
 * 返回数组与 collectUserEntries 顺序一一对应(数量不匹配时截断,保守降级)。
 */
export function measureAnchors(tui: TUI, ctx: ExtensionContext): Anchor[] {
	try {
		const view = resolveConversationView(tui);
		if (!view) return [];

		const entries = collectUserEntries(ctx);
		if (entries.length === 0 || view.contentWidth <= 0) return [];

		// 收集锚点组件:skill 块会产生 SkillInvocation + 紧随的 UserMessage(同一条消息),
		// 用 skipNextUser 合并为一个锚点,保证与用户消息 1:1 对应。
		const anchorComponents: Component[] = [];
		let skipNextUser = false;
		for (const child of view.chat.children) {
			if (child instanceof SkillInvocationMessageComponent) {
				anchorComponents.push(child);
				skipNextUser = true;
				continue;
			}
			if (child instanceof UserMessageComponent) {
				if (skipNextUser) {
					skipNextUser = false; // 属于上一个 skill 块的附属用户消息
					continue;
				}
				anchorComponents.push(child);
			}
		}

		const count = Math.min(anchorComponents.length, entries.length);
		if (count === 0) return [];

		const anchors: Anchor[] = [];
		let offset = 0;
		// 阶段一:累计 chat 容器之前 doc 层已渲染的行数(header / loadedResources 等)
		for (const child of view.doc.children) {
			if (child === view.chat) break;
			offset += measureComponent(child, view.contentWidth);
		}
		// 阶段二:遍历 chat 内部,遇到锚点组件记当前行偏移
		let anchorIndex = 0;
		for (const child of view.chat.children) {
			if (anchorIndex < count && child === anchorComponents[anchorIndex]) {
				anchors.push({ entryId: entries[anchorIndex].entryId, offset });
				anchorIndex += 1;
			}
			offset += measureComponent(child, view.contentWidth);
		}
		return anchors;
	} catch {
		return [];
	}
}

/**
 * 渲染整份会话文档为行数组(供 pager 使用)。
 * 与 measureAnchors 使用同一 view 与宽度,保证行偏移可直接用于切片。
 * 内部按宽度缓存,重复调用无额外渲染开销(组件自身也有宽度缓存)。
 */
export function renderConversationLines(tui: TUI): { lines: string[]; contentWidth: number } {
	const empty = { lines: [] as string[], contentWidth: 0 };
	try {
		const view = resolveConversationView(tui);
		if (!view) return empty;
		let cache = renderConversationLines.cache?.get(view.doc);
		if (!cache || cache.width !== view.contentWidth) {
			const lines = view.doc.render(view.contentWidth);
			cache = { width: view.contentWidth, lines: Array.isArray(lines) ? lines : [] };
			(renderConversationLines.cache ??= new WeakMap()).set(view.doc, cache);
		}
		return { lines: cache.lines, contentWidth: view.contentWidth };
	} catch {
		return empty;
	}
}
renderConversationLines.cache = undefined as WeakMap<Component, { width: number; lines: string[] }> | undefined;

/** 单组件高度;异常按 0 行处理(不中断整体测量) */
function measureComponent(component: Component, width: number): number {
	try {
		const lines = component.render(width);
		return Array.isArray(lines) ? lines.length : 0;
	} catch {
		return 0;
	}
}
