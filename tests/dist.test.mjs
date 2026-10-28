/**
 * tests/dist.test.mjs — dist bundle 测试
 *
 * 跑法:node tests/dist.test.mjs(已在 package.json scripts.test 中串入)
 * 风格:与 tests/anchors.test.mjs 一致,纯 Node + node:assert,无新依赖。
 *
 * 覆盖(对齐 docs/plan/20261017-231108-dist-bundle.md §3.4):
 *   1. 新鲜度   :重打到 <tmp>,与提交的 dist/index.js 字节一致
 *   2. 单文件   :dist/ 下有且只有 index.js
 *   3. 体积提示 :软门禁 —— 重打产物无 gateVolume warnings(超预算不再失败)
 *   4. 无泄漏   :产物不含本机绝对路径 / sourcemap 注释 / builder banner
 *   5. 内容完整 :产物含 "registerCommand" / "jump" 字符串
 *   6. 可加载   :复制到 <tmp>,await import 拿到 default 是 function
 *   7. 可注册   :子进程加载 bundle,传入 mock ExtensionAPI,断言注册了 "jump" 命令
 *   8. 零依赖   :package.json dependencies 空;产物无裸 import("xxx");import 在白名单;INLINED_THIRD_PARTY 空
 *   9. 可复现   :跑两次 build,字节相同
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, symlink, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundle } from "../scripts/build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist/index.js");
const PKG_PATH = resolve(ROOT, "package.json");
const PI_INSTALL = "/Users/a1/.pi/agent/install/releases/0.87.1/node_modules";

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

function sha256(buf) {
	return createHash("sha256").update(buf).digest("hex");
}

/** CRLF → LF 归一化(防止不同平台下换行差异导致误判) */
function normalizeNewlines(buf) {
	return buf.toString("utf8").replace(/\r\n/g, "\n");
}

// ---- 准备 ----
const pkg = JSON.parse(await readFile(PKG_PATH, "utf8"));
const committedBytes = await readFile(DIST);
const committedSha = sha256(committedBytes);
const tmp = await mkdtemp(join(tmpdir(), "pi-prompt-jump-dist-"));
const tmpBundle = join(tmp, "index.js");

// 跑一次 build 到 <tmp>(同样经过三道门禁,失败即 throw)
const { vol, externals, inlinedThirdParty } = await buildBundle({ outfile: tmpBundle });
const rebuiltBytes = await readFile(tmpBundle);
const rebuiltSha = sha256(rebuiltBytes);

// ---- 用例 ------------------------------------------------------------------

console.log("1. 新鲜度:");
check("重打产物与提交 dist 字节一致(CRLF 归一化后)", () => {
	assert.equal(
		normalizeNewlines(committedBytes),
		normalizeNewlines(rebuiltBytes),
		`committed=${committedSha} rebuilt=${rebuiltSha}`,
	);
});

console.log("2. 单文件:");
check("dist/ 下有且只有 index.js", async () => {
	const distDir = dirname(DIST);
	const files = (await readdir(distDir)).sort();
	assert.deepEqual(files, ["index.js"], `got ${JSON.stringify(files)}`);
});

console.log("3. 体积提示(软门禁,超预算不失败):");
check("重打产物无体积 warning(与构建时判定一致)", () => {
	assert.deepEqual(vol.warnings, [], vol.warnings.join("; "));
});
check("体积实测为正数", () => {
	assert.ok(vol.raw > 0 && vol.gz > 0, `raw=${vol.raw} gz=${vol.gz}`);
});

console.log("4. 无环境泄漏:");
check("产物不含本机绝对路径", () => {
	const src = committedBytes.toString("utf8");
	for (const needle of ["/Users/", "/home/", "C:\\\\", ".git/"]) {
		assert.ok(!src.includes(needle), `意外包含: ${needle}`);
	}
});
check("产物不含 sourcemap 注释", () => {
	const src = committedBytes.toString("utf8");
	assert.ok(!src.includes("sourceMappingURL"), "意外包含 sourceMappingURL");
});
check("产物无 builder banner(避免无谓字节开销)", () => {
	const src = committedBytes.toString("utf8");
	// 默认不写 banner;如未来启用 banner,这里要相应更新断言
	const firstLine = src.split("\n", 1)[0] ?? "";
	assert.ok(!firstLine.startsWith("/*") && !firstLine.startsWith("//"), `首行像 banner: ${firstLine.slice(0, 60)}`);
});

console.log("5. 内容完整:");
check("产物含 'registerCommand' 字符串", () => {
	assert.ok(committedBytes.toString("utf8").includes("registerCommand"));
});
check("产物含 'jump' 命令名", () => {
	assert.ok(committedBytes.toString("utf8").includes("jump"));
});

console.log("6. 可加载:");
// 与 test 7 同理,需在 <tmp> 下放一份 bundle + symlink node_modules,让 import 能解析 @earendil-works/*
const loadTmp = await mkdtemp(join(tmpdir(), "pi-prompt-jump-load-"));
const loadBundle = join(loadTmp, "index.js");
await copyFile(DIST, loadBundle);
await symlink(PI_INSTALL, join(loadTmp, "node_modules"), "dir");
const loadable = await import(/* @vite-ignore */ loadBundle).catch((e) => ({ error: e }));
await rm(loadTmp, { recursive: true, force: true });
check("await import 拿到 default = function", () => {
	assert.equal(loadable.error, undefined, loadable.error?.message);
	assert.equal(typeof loadable.default, "function", `got ${typeof loadable.default}`);
});

console.log("7. 可注册(子进程加载 + mock ExtensionAPI):");
// 在 <tmp> 下复制 bundle + 软链 node_modules,让 import 能解析 @earendil-works/*
const subTmp = await mkdtemp(join(tmpdir(), "pi-prompt-jump-sub-"));
const subBundle = join(subTmp, "index.js");
await copyFile(DIST, subBundle);
const subNm = join(subTmp, "node_modules");
await symlink(PI_INSTALL, subNm, "dir");

const probe = `
const captured = [];
const mock = {
  registerCommand(name, def) { captured.push({ name, desc: def.description }); }
};
const m = await import("./index.js");
m.default(mock);
process.stdout.write(JSON.stringify(captured));
`;
const child = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
	cwd: subTmp,
	encoding: "utf8",
	timeout: 10_000,
});
await rm(subTmp, { recursive: true, force: true });

check("子进程退出码 0", () => {
	assert.equal(child.status, 0, `status=${child.status} stderr=${child.stderr?.slice(0, 500)}`);
});
check("注册了 'jump' 命令(描述含 '跳转')", () => {
	const captured = JSON.parse(child.stdout);
	assert.ok(Array.isArray(captured) && captured.length === 1, `got ${child.stdout}`);
	assert.equal(captured[0].name, "jump");
	assert.ok(captured[0].desc?.includes("跳转"), `desc=${captured[0].desc}`);
});

console.log("8. 零依赖:");
check("package.json.dependencies 为空对象", () => {
	const deps = pkg.dependencies;
	const ok = deps == null || (typeof deps === "object" && Object.keys(deps).length === 0);
	assert.ok(ok, `dependencies=${JSON.stringify(deps)}`);
});
check("package.json.peerDependencies 仅含 @earendil-works/*", () => {
	const peers = Object.keys(pkg.peerDependencies ?? {});
	assert.ok(peers.length > 0, "peerDependencies 为空");
	for (const p of peers) assert.ok(p.startsWith("@earendil-works/"), `non-peer: ${p}`);
});
check("产物 import 全部在白名单(node: / @earendil-works/ / 相对)", () => {
	const src = committedBytes.toString("utf8");
	const re = /(?:^|[^\w$])(?:import\s*(?:[^"';]+from\s*)?|export\s*(?:[^"';]+from\s*)?|import\s*\(\s*|from\s*)["']([^"']+)["']/g;
	const seen = new Set();
	let m;
	while ((m = re.exec(src))) seen.add(m[1]);
	for (const spec of seen) {
		const ok = spec.startsWith(".") || spec.startsWith("/")
			|| spec.startsWith("node:")
			|| spec.startsWith("@earendil-works/");
		assert.ok(ok, `unauthorized: ${spec}`);
	}
});
check("产物无裸包动态 import()", () => {
	const src = committedBytes.toString("utf8");
	const re = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
	let m;
	while ((m = re.exec(src))) {
		const spec = m[1];
		const ok = spec.startsWith(".") || spec.startsWith("/")
			|| spec.startsWith("node:")
			|| spec.startsWith("@earendil-works/");
		assert.ok(ok, `bare dynamic import: ${spec}`);
	}
});
check("INLINED_THIRD_PARTY = 空(当前无任何内联第三方包)", () => {
	assert.deepEqual(inlinedThirdParty, [], `inlined=${inlinedThirdParty.join(", ")}`);
});
check("buildBundle.externals = peer 包(与 package.json 一致)", () => {
	assert.deepEqual([...externals].sort(), [...Object.keys(pkg.peerDependencies)].sort());
});

console.log("9. 可复现:");
const tmp2 = await mkdtemp(join(tmpdir(), "pi-prompt-jump-dup-"));
const tmp2Bundle = join(tmp2, "index.js");
await buildBundle({ outfile: tmp2Bundle });
const dupBytes = await readFile(tmp2Bundle);
const dupSha = sha256(dupBytes);
await rm(tmp2, { recursive: true, force: true });
check("两次 build 字节相同", () => {
	assert.equal(dupSha, rebuiltSha, `${dupSha} vs ${rebuiltSha}`);
});

// ---- 清理 + 退出 ----
await rm(tmp, { recursive: true, force: true });

console.log(failures === 0 ? "\n全部通过 ✔" : `\n${failures} 个失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
