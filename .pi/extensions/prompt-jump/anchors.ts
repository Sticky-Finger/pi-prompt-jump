/**
 * anchors.ts — 定位层:找到 fullscreen transcript 的 ScrollView 与消息容器,
 * 测量各用户消息组件在文档中的行偏移,建立 entryId → 行偏移 映射。
 *
 * 全部访问都做了形状校验与 try/catch 防御:结构不符时返回 undefined / 空数组,
 * 让上层降级为提示"跳转失败",绝不让扩展崩溃影响宿主。
 */
import { SkillInvocationMessageComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

/** fullscreen transcript 定位结果 */
export interface TranscriptRef {
	/** 主 ScrollView(transcript 视口) */
	sv: {
		scrollTo(scrollTop: number): void;
		getContentWidth(width: number): number;
		readonly viewportHeight: number;
	};
	/** transcript 文档根容器(documentContainer) */
	doc: Component & { children: Component[] };
}

/** 一条用户消息的定位锚点 */
export interface Anchor {
	entryId: string;
	/** 该消息组件首行在文档内容中的行偏移 */
	offset: number;
}

/** 任意组件是否带 children(容器) */
function isContainer(c: Component): c is Component & { children: Component[] } {
	return Boolean(c) && Array.isArray((c as { children?: unknown }).children);
}

/**
 * 形状探测 fullscreen transcript。
 * 返回 undefined 表示:非 fullscreen 模式 / 结构与预期不符 / 探测异常。
 */
export function findTranscript(tui: TUI): TranscriptRef | undefined {
	try {
		if (tui.mode !== "fullscreen") return undefined;
		const getter = (tui as TUI & { getPrimaryScrollView?: () => unknown }).getPrimaryScrollView;
		if (typeof getter !== "function") return undefined;
		const sv = getter.call(tui) as TranscriptRef["sv"] | undefined;
		if (!sv || typeof sv.scrollTo !== "function" || typeof sv.getContentWidth !== "function") {
			return undefined;
		}
		const doc = (sv as unknown as { child?: Component }).child;
		if (!doc || !isContainer(doc)) return undefined;
		return { sv, doc };
	} catch {
		return undefined;
	}
}

/** 从 doc.children 中探测 chat 容器:第一个包含用户消息组件的容器 */
export function findChatContainer(doc: TranscriptRef["doc"]): (Component & { children: Component[] }) | undefined {
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

function isUserAnchorComponent(c: Component): boolean {
	return c instanceof UserMessageComponent || c instanceof SkillInvocationMessageComponent;
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
		const ref = findTranscript(tui);
		if (!ref) return [];
		const chat = findChatContainer(ref.doc);
		if (!chat) return [];

		const entries = collectUserEntries(ctx);
		if (entries.length === 0) return [];

		const contentWidth = ref.sv.getContentWidth((tui.terminal.columns ?? 80) | 0);
		if (!Number.isFinite(contentWidth) || contentWidth <= 0) return [];

		// 收集锚点组件:skill 块会产生 SkillInvocation + 紧随的 UserMessage(同一条消息),
		// 用 skipNextUser 合并为一个锚点,保证与用户消息 1:1 对应。
		const anchorComponents: Component[] = [];
		let skipNextUser = false;
		for (const child of chat.children) {
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
		for (const child of ref.doc.children) {
			if (child === chat) break;
			offset += measureComponent(child, contentWidth);
		}
		// 阶段二:遍历 chat 内部,遇到锚点组件记当前行偏移
		let anchorIndex = 0;
		for (const child of chat.children) {
			if (anchorIndex < count && child === anchorComponents[anchorIndex]) {
				anchors.push({ entryId: entries[anchorIndex].entryId, offset });
				anchorIndex += 1;
			}
			offset += measureComponent(child, contentWidth);
		}
		return anchors;
	} catch {
		return [];
	}
}

/** 单组件高度;异常按 0 行处理(不中断整体测量) */
function measureComponent(component: Component, width: number): number {
	try {
		const lines = component.render(width);
		return Array.isArray(lines) ? lines.length : 0;
	} catch {
		return 0;
	}
}
