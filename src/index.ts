/**
 * prompt-jump — Pi 对话记录用户消息快速跳转导航
 *
 * /jump:弹出与 /tree 同款的消息树选择器(仅用户消息),
 * 选中后打开消息查看器(pager):目标消息首行对齐窗口顶部,
 * 键盘/滚轮翻阅整个会话;不切换分支,不影响宿主任何状态。
 * regular 与 fullscreen 模式行为一致。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { showJumpList } from "./jump-list.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("jump", {
		description: "跳转到指定用户消息,打开翻阅视图(不切换分支)",
		handler: async (_args, ctx) => {
			await showJumpList(ctx);
		},
	});
}
