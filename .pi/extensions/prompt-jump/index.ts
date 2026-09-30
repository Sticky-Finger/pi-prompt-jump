/**
 * prompt-jump — Pi 对话记录用户消息快速跳转导航
 *
 * /jump:弹出与 /tree 同款的消息树选择器(仅用户消息),
 * 选中后让 transcript 滚动到该消息位置(消息首行对齐视口顶部),
 * 不切换会话分支,不影响滚轮/滚动条的自由浏览。
 *
 * 仅支持 fullscreen TUI 模式(regular 模式无 ScrollView 可滚动)。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { showJumpList } from "./jump-list.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("jump", {
		description: "跳转到指定用户消息(滚动 transcript,不切换分支)",
		handler: async (_args, ctx) => {
			await showJumpList(ctx);
		},
	});
}
