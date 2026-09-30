/**
 * anchors.ts 纯逻辑自测(不依赖真实 TUI)
 *
 * 运行:node tests/anchors.test.mjs
 * 用与宿主一致的 jiti 别名加载扩展模块,校验:
 *  - findTranscript 的形状探测与防御性降级
 *  - collectUserEntries 的过滤/提取/顺序
 *  - measureAnchors 的锚点识别(skill 合并)、行偏移累加、异常降级
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "/Users/a1/.pi/agent/install/releases/0.87.1/node_modules/jiti/lib/jiti.mjs";

// 与宿主 dist/core/extensions/loader.js 的别名保持一致(指向本机 pi 安装)
const piInstall = "/Users/a1/.pi/agent/install/releases/0.87.1/node_modules";
const alias = {
	"@earendil-works/pi-coding-agent": path.join(piInstall, "@earendil-works/pi-coding-agent/dist/index.js"),
	"@earendil-works/pi-agent-core": path.join(piInstall, "@earendil-works/pi-agent-core/dist/index.js"),
	"@earendil-works/pi-tui": path.join(piInstall, "@earendil-works/pi-tui/dist/index.js"),
	"@earendil-works/pi-ai": path.join(piInstall, "@earendil-works/pi-ai/dist/compat.js"),
};

const jiti = createJiti(import.meta.url, { alias, moduleCache: false });
const pkg = await jiti.import(path.join(piInstall, "@earendil-works/pi-coding-agent/dist/index.js"));
const anchorsPath = fileURLToPath(new URL("../.pi/extensions/prompt-jump/anchors.ts", import.meta.url));
const { findTranscript, findChatContainer, collectUserEntries, measureAnchors } = await jiti.import(anchorsPath);

const { SkillInvocationMessageComponent, UserMessageComponent, initTheme } = pkg;
initTheme(); // 组件构造依赖全局主题(仅测试环境需要)

let failures = 0;
function check(name, cond) {
	if (cond) {
		console.log(`  ok - ${name}`);
	} else {
		failures += 1;
		console.error(`  FAIL - ${name}`);
	}
}

const text = (lines) => ({ render: () => lines, invalidate() {} });

/** 造一个最小但结构正确的 fake TUI:
 *  doc = [header(1行), chat]
 *  chat = [user1(2行), assistant(1行), spacer(1行), skill块(2行,锚点), spacer(1行), skill附属user(1行,不锚)]
 *  期望:e1 offset=1,e2 offset=1+2+1+1=5
 */
function makeFakeTUI({ mode = "fullscreen" } = {}) {
	const header = text(["=== header ==="]);
	const user1 = new UserMessageComponent("user message 1");
	const assistant = text(["[assistant reply]"]);
	const skill = new SkillInvocationMessageComponent({
		skillName: "demo-skill",
		userMessage: "skill 附带消息",
	});
	const skillUser = new UserMessageComponent("skill 附带消息");
	user1.render = () => ["[user 1 line a]", "[user 1 line b]"];
	skill.render = () => ["[user 2 only line]"];
	skillUser.render = () => ["[skill 附带用户消息]"];
	const chatChildren = [user1, assistant, text([""]), skill, text([""]), skillUser];
	const chat = {
		children: chatChildren,
		render: (w) => chatChildren.flatMap((c) => c.render(w)),
		invalidate() {},
	};
	const docChildren = [header, chat];
	const doc = {
		children: docChildren,
		render: (w) => docChildren.flatMap((c) => c.render(w)),
		invalidate() {},
	};
	const sv = {
		scrollTo() {},
		getContentWidth: () => 80,
		viewportHeight: 10,
		child: doc,
	};
	return {
		tui: {
			mode,
			terminal: { columns: 80, rows: 24 },
			getPrimaryScrollView: () => sv,
		},
		sv,
		doc,
		chat,
	};
}

function makeFakeCtx(entries) {
	return { sessionManager: { buildContextEntries: () => entries } };
}

// ---- 用例 ------------------------------------------------------------------
console.log("findTranscript:");
{
	const { tui } = makeFakeTUI();
	check("fullscreen + 合法结构 → 返回 ref", findTranscript(tui) != null);
	check("regular 模式 → undefined", findTranscript({ ...tui, mode: "regular" }) === undefined);
	check("无 getPrimaryScrollView → undefined", findTranscript({ mode: "fullscreen", terminal: { columns: 80 } }) === undefined);
	check(
		"sv 缺 scrollTo → undefined",
		findTranscript({ mode: "fullscreen", terminal: { columns: 80 }, getPrimaryScrollView: () => ({ getContentWidth: () => 80 }) }) === undefined,
	);
}

console.log("findChatContainer:");
{
	const { doc, chat } = makeFakeTUI();
	check("能定位到含用户消息组件的容器", findChatContainer(doc) === chat);
	check("无匹配 → undefined", findChatContainer({ children: [text(["x"])] }) === undefined);
}

console.log("collectUserEntries:");
{
	const ctx = makeFakeCtx([
		{ type: "message", id: "e1", message: { role: "user", content: "第一条\n第二行" } },
		{ type: "message", id: "a1", message: { role: "assistant", content: "回复" } },
		{ type: "message", id: "e2", message: { role: "user", content: [{ type: "text", text: "数组内容" }, { type: "image", data: "x" }] } },
		{ type: "message", id: "e3", message: { role: "user", content: [{ type: "image", data: "y" }] } }, // 纯图片,跳过
		{ type: "compaction", id: "c1" },
	]);
	const list = collectUserEntries(ctx);
	check("数量 = 2(跳过 assistant/纯图片/非 message)", list.length === 2);
	check("顺序正确", list[0].entryId === "e1" && list[1].entryId === "e2");
	check("preview 取首行", list[0].previewText === "第一条");
	check("数组 content 提取 text 部分", list[1].previewText === "数组内容");
}

console.log("measureAnchors:");
{
	const { tui } = makeFakeTUI();
	const ctx = makeFakeCtx([
		{ type: "message", id: "e1", message: { role: "user", content: "m1" } },
		{ type: "message", id: "e2", message: { role: "user", content: "m2" } },
	]);
	const result = measureAnchors(tui, ctx);
	check("两条锚点(skill 与其附属 user 合并为一条)", result.length === 2);
	check("entryId 对应", result[0].entryId === "e1" && result[1].entryId === "e2");
	check("e1 偏移 = 1(header 之后)", result[0].offset === 1);
	check("e2 偏移 = 5(跳过 user1+assistant+spacer)", result[1].offset === 5);
}
{
	const { tui } = makeFakeTUI();
	check("无用户消息 → 空数组", measureAnchors(tui, makeFakeCtx([])).length === 0);
	check(
		"entry 多于锚点时截断到锚点数",
		measureAnchors(
			tui,
			makeFakeCtx([
				{ type: "message", id: "e1", message: { role: "user", content: "m1" } },
				{ type: "message", id: "e2", message: { role: "user", content: "m2" } },
				{ type: "message", id: "e3", message: { role: "user", content: "m3" } },
			]),
		).length === 2,
	);
	check(
		"测量中 render 抛错不崩溃且返回数组",
		(() => {
			const fake = makeFakeTUI();
			fake.doc.children[0].render = () => {
				throw new Error("boom");
			};
			return Array.isArray(
				measureAnchors(fake.tui, makeFakeCtx([{ type: "message", id: "e1", message: { role: "user", content: "x" } }])),
			);
		})(),
	);
}

console.log(failures === 0 ? "\n全部通过 ✔" : `\n${failures} 个失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
