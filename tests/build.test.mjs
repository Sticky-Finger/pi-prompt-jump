/**
 * tests/build.test.mjs — scripts/build.mjs 主要函数单元测试
 *
 * 跑法:node tests/build.test.mjs(已在 package.json scripts.test 中串入)
 * 风格:与 tests/dist.test.mjs 一致,纯 Node + node:assert,无新依赖。
 *
 * 覆盖(对齐 docs/plan/20261028-153322-build-unit-tests.md §2):
 *   1. parseArgs              :默认值 / 各 flag / 未知参数
 *   2. peerExternals          :pkg 注入 / 空 / 与真实 package.json 一致
 *   3. thirdPartyFromMetafile :scoped 提取 / 去重 / 非 node_modules
 *   4. collectImportSpecifiers:各类 import/export 语法 / 相对路径过滤 / 伪关键字不误报
 *   5. gateImportWhitelist    :通过 + 三种违规 throw
 *   6. gateInlinedThirdParty  :一致 + 三种不一致 throw 消息
 *   7. gateVolume             :软门禁 —— 返回值 / 超 raw·gzip 预算只产 warnings 不 throw
 *   8. 一致性回归              :真实 dist 产物过 collectImportSpecifiers 全在白名单内
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	parseArgs,
	peerExternals,
	thirdPartyFromMetafile,
	collectImportSpecifiers,
	gateImportWhitelist,
	gateInlinedThirdParty,
	gateVolume,
	BUDGET,
	ALLOWED_IMPORT_PREFIXES,
	INLINED_THIRD_PARTY,
} from "../scripts/build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));

let failures = 0;
function check(name, fn) {
	try {
		fn();
		console.log(`  ok - ${name}`);
	} catch (e) {
		failures += 1;
		console.error(`  FAIL - ${name}\n    ${e.message}`);
	}
}

// ---- 用例 ------------------------------------------------------------------

console.log("1. parseArgs:");
check("无参 → 默认值", () => {
	assert.deepEqual(parseArgs([]), { minify: true, report: false, outfile: "./dist/index.js" });
});
check("--no-minify → minify=false", () => {
	assert.equal(parseArgs(["--no-minify"]).minify, false);
});
check("--report → report=true", () => {
	assert.equal(parseArgs(["--report"]).report, true);
});
check("--outfile <path> → 取下一个参数", () => {
	assert.equal(parseArgs(["--outfile", "tmp/x.js"]).outfile, "tmp/x.js");
});
check("flag 可组合", () => {
	assert.deepEqual(parseArgs(["--no-minify", "--report", "--outfile", "a/b.js"]), {
		minify: false,
		report: true,
		outfile: "a/b.js",
	});
});
check("未知参数 → throw", () => {
	assert.throws(() => parseArgs(["--bogus"]), /未知参数: --bogus/);
});

console.log("2. peerExternals:");
check("注入 pkg → 返回 peerDependencies 的 keys", () => {
	const fake = { peerDependencies: { "@earendil-works/pi-tui": "*", "@scope/other": "^1" } };
	assert.deepEqual(peerExternals(fake).sort(), ["@earendil-works/pi-tui", "@scope/other"].sort());
});
check("无 peerDependencies → []", () => {
	assert.deepEqual(peerExternals({}), []);
});
check("真实 PKG 结果与 package.json 一致(防漂移)", () => {
	assert.deepEqual([...peerExternals(pkg)].sort(), [...Object.keys(pkg.peerDependencies)].sort());
});

console.log("3. thirdPartyFromMetafile:");
const meta = (...inputs) => ({ inputs: Object.fromEntries(inputs.map((p) => [p, {}])) });
check("非 scoped 包名提取", () => {
	assert.deepEqual([...thirdPartyFromMetafile(meta("node_modules/foo/index.js"))], ["foo"]);
});
check("scoped 包名提取", () => {
	assert.deepEqual([...thirdPartyFromMetafile(meta("repo/node_modules/@org/pkg/dist/i.js"))], ["@org/pkg"]);
});
check("同包多输入去重", () => {
	assert.deepEqual([...thirdPartyFromMetafile(meta("a/node_modules/foo/1.js", "b/node_modules/foo/2.js"))], ["foo"]);
});
check("不含 node_modules 的输入被忽略;空 inputs → 空集合", () => {
	assert.equal(thirdPartyFromMetafile(meta("src/index.ts")).size, 0);
	assert.equal(thirdPartyFromMetafile(meta()).size, 0);
});

console.log("4. collectImportSpecifiers:");
check("静态 import x from", () => {
	assert.deepEqual([...collectImportSpecifiers('import x from "a";')], ["a"]);
});
check("裸 import", () => {
	assert.deepEqual([...collectImportSpecifiers('import "b";')], ["b"]);
});
check("动态 import()", () => {
	assert.deepEqual([...collectImportSpecifiers('const m = await import("c");')], ["c"]);
});
check("export * from", () => {
	assert.deepEqual([...collectImportSpecifiers('export * from "d";')], ["d"]);
});
check("export { y } from", () => {
	assert.deepEqual([...collectImportSpecifiers('export { y } from "e";')], ["e"]);
});
check("相对/绝对路径不返回", () => {
	assert.deepEqual([...collectImportSpecifiers('import a from "./x";\nimport b from "/abs/y";')], []);
});
check("伪关键字不误报(important / exported)", () => {
	assert.deepEqual(
		[...collectImportSpecifiers('const important = 1; const exported2 = { from: "not-an-import" };')],
		[],
	);
});

console.log("5. gateImportWhitelist:");
check("白名单前缀 + 相对路径 → 通过", () => {
	const src = 'import fs from "node:fs";\nimport tui from "@earendil-works/pi-tui";\nimport x from "./rel.js";';
	gateImportWhitelist(Buffer.from(src));
});
check("裸包 import → throw", () => {
	assert.throws(() => gateImportWhitelist(Buffer.from('import { z } from "foo";')), /gate:import-whitelist.*未授权的 import: foo/);
});
check("非白名单 scoped 包 → throw", () => {
	assert.throws(() => gateImportWhitelist(Buffer.from('import p from "@other/pkg";')), /未授权的 import: @other\/pkg/);
});
check("动态违规 import → throw", () => {
	assert.throws(() => gateImportWhitelist(Buffer.from('await import("evil");')), /未授权的 import: evil/);
});

console.log("6. gateInlinedThirdParty:");
check("实际 == 登记 → 通过", () => {
	gateInlinedThirdParty(meta("x/node_modules/a/i.js", "x/node_modules/b/i.js"), ["a", "b"]);
});
check("双方均空 → 通过", () => {
	gateInlinedThirdParty(meta(), []);
});
check("实际多打未登记包 → throw 含「实际打进但未登记」", () => {
	assert.throws(
		() => gateInlinedThirdParty(meta("x/node_modules/a/i.js"), []),
		(e) =>
			e.message.includes("[gate:inlined-third-party]") &&
			e.message.includes("实际打进但未登记: a"),
	);
});
check("登记未实际打进 → throw 含「已登记但未打进」", () => {
	assert.throws(
		() => gateInlinedThirdParty(meta(), ["a"]),
		(e) => e.message.includes("已登记但未打进: a"),
	);
});
check("双向不一致 → throw 同时含两行", () => {
	assert.throws(
		() => gateInlinedThirdParty(meta("x/node_modules/a/i.js"), ["b"]),
		(e) =>
			e.message.includes("实际打进但未登记: a") &&
			e.message.includes("已登记但未打进: b"),
	);
});

console.log("7. gateVolume(软门禁:不 throw,只产 warnings):");
check("远小于预算 → 返回 {raw, gz, warnings:[]} 且与实测一致", () => {
	const buf = Buffer.from("hello");
	const vol = gateVolume(buf);
	assert.equal(vol.raw, buf.length);
	assert.equal(vol.gz, gzipSync(buf, { level: 9 }).length);
	assert.deepEqual(vol.warnings, []);
});
check("超 raw 预算 → 不 throw,warnings 含原始超限条目", () => {
	const buf = Buffer.alloc(BUDGET.raw + 1024, 0);
	let vol;
	assert.doesNotThrow(() => { vol = gateVolume(buf); });
	assert.equal(vol.warnings.length, 1);
	assert.match(vol.warnings[0], /\[gate:volume\] 原始 \d+ B 超预算/);
});
check("raw 达标但超 gzip 预算 → 不 throw,warnings 含 gzip 条目(注入小预算)", () => {
	const buf = Buffer.alloc(1024, 7); // raw 1024 ≤ 2048;不可压缩到 4 B 以下
	const vol = gateVolume(buf, { raw: 2048, gzip: 4 });
	assert.equal(vol.warnings.length, 1);
	assert.match(vol.warnings[0], /\[gate:volume\] gzip \d+ B 超预算 4 B/);
});
check("raw 与 gzip 双超限 → warnings 两条", () => {
	const buf = randomBytes(BUDGET.raw + 1024); // 随机字节不可压,raw/gzip 同时超限
	const vol = gateVolume(buf);
	assert.equal(vol.warnings.length, 2);
	assert.match(vol.warnings[0], /原始/);
	assert.match(vol.warnings[1], /gzip/);
});

console.log("8. 一致性回归(真实产物):");
const distSrc = (await readFile(join(ROOT, "dist/index.js"))).toString("utf8");
check("dist 的非相对 import 全部落在白名单前缀内", () => {
	for (const spec of collectImportSpecifiers(distSrc)) {
		assert.ok(
			ALLOWED_IMPORT_PREFIXES.some((p) => spec.startsWith(p)),
			`unauthorized: ${spec}`,
		);
	}
});
check("INLINED_THIRD_PARTY 当前为空(与项目现状一致)", () => {
	assert.deepEqual([...INLINED_THIRD_PARTY], []);
});

// ---- 退出 ----
console.log(failures === 0 ? "\n全部通过 ✔" : `\n${failures} 个失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
