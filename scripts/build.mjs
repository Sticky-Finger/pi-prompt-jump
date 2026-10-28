#!/usr/bin/env node
/**
 * scripts/build.mjs — esbuild 打包 src/ 为单文件 dist/index.js
 *
 * 设计要点(详见 docs/plan/20261017-231108-dist-bundle.md §2 / §3.1):
 *   - external 只留 @earendil-works/* 宿主包(从 package.json peerDependencies 读出,不硬编码)
 *   - 构建后三道门禁:import 白名单 / INLINED_THIRD_PARTY 比对 / 体积预算
 *   - 既被直接执行,也被 tests/dist.test.mjs import 调用(共享 buildBundle 避免参数漂移)
 *
 * CLI 用法:
 *   node scripts/build.mjs                       # 默认:minify, 写 dist/index.js
 *   node scripts/build.mjs --no-minify           # 排障可读版(不提交)
 *   node scripts/build.mjs --report              # 打印内联清单与体积
 *   node scripts/build.mjs --outfile <path>      # 自定义输出(测试用)
 */
import { build } from "esbuild";
import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));

const ENTRY = "./src/index.ts";
const DEFAULT_OUTFILE = "./dist/index.js";

/** 体积预算:原始 / gzip,任一超阈值即构建失败(防止大库被悄悄打进 bundle) */
const BUDGET = { raw: 30 * 1024, gzip: 12 * 1024 };

/** 允许保留在产物 import 语句里的说明符前缀(其余一律内联或构建失败) */
const ALLOWED_IMPORT_PREFIXES = ["node:", "@earendil-works/"];

/** 当前内联的第三方包清单(空:本项目目前无任何内联第三方包)。
 *  引入新第三方包时必须在此登记:包名 / 精确版本 / 体积 / 许可 + 上游审计链接。
 *  metafile 比对门禁会强制此清单与实际打进产物的第三方包集合完全一致。 */
const INLINED_THIRD_PARTY = Object.freeze([]);

function parseArgs(argv) {
	const args = { minify: true, report: false, outfile: DEFAULT_OUTFILE };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--no-minify") args.minify = false;
		else if (a === "--report") args.report = true;
		else if (a === "--outfile") args.outfile = argv[++i];
		else throw new Error(`未知参数: ${a}`);
	}
	return args;
}

function peerExternals() {
	const peers = PKG.peerDependencies ?? {};
	return Object.keys(peers);
}

/** 从 metafile inputs 中抽取第三-party 包名(路径含 /node_modules/<name>/ 的那段) */
function thirdPartyFromMetafile(metafile) {
	const names = new Set();
	for (const inputPath of Object.keys(metafile.inputs)) {
		const m = inputPath.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
		if (m) names.add(m[1]);
	}
	return names;
}

/** 门禁 1:扫产物 import 语句,只允许白名单前缀 + 相对路径 */
function gateImportWhitelist(outBytes) {
	const src = outBytes.toString("utf8");
	// 匹配 import ... from "x" / import("x") / export ... from "x"
	const re = /(?:^|[^\w$])(?:import\s*(?:[^"';]+from\s*)?|export\s*(?:[^"';]+from\s*)?|import\s*\(\s*|from\s*)["']([^"']+)["']/g;
	const offenders = new Set();
	let m;
	while ((m = re.exec(src))) {
		const spec = m[1];
		if (spec.startsWith(".") || spec.startsWith("/")) continue; // 相对路径,已内联
		if (ALLOWED_IMPORT_PREFIXES.some((p) => spec.startsWith(p))) continue;
		offenders.add(spec);
	}
	if (offenders.size > 0) {
		throw new Error(`[gate:import-whitelist] 产物中出现未授权的 import: ${[...offenders].join(", ")}`);
	}
}

/** 门禁 2:metafile 第三方包集合必须与 INLINED_THIRD_PARTY 完全一致 */
function gateInlinedThirdParty(metafile) {
	const actual = thirdPartyFromMetafile(metafile);
	const declared = new Set(INLINED_THIRD_PARTY);
	const onlyActual = [...actual].filter((x) => !declared.has(x));
	const onlyDeclared = [...declared].filter((x) => !actual.has(x));
	if (onlyActual.length > 0 || onlyDeclared.length > 0) {
		const lines = [];
		if (onlyActual.length) lines.push(`  实际打进但未登记: ${onlyActual.join(", ")}`);
		if (onlyDeclared.length) lines.push(`  已登记但未打进: ${onlyDeclared.join(", ")}`);
		throw new Error(`[gate:inlined-third-party] 第三方包清单不一致:\n${lines.join("\n")}\n请修改 scripts/build.mjs 顶部 INLINED_THIRD_PARTY 数组(包名/精确版本/体积/许可)后重试`);
	}
}

/** 门禁 3:体积预算 */
function gateVolume(outBytes) {
	const raw = outBytes.length;
	const gz = gzipSync(outBytes, { level: 9 }).length;
	if (raw > BUDGET.raw) {
		throw new Error(`[gate:volume] 原始 ${raw} B 超预算 ${BUDGET.raw} B(${((raw / BUDGET.raw) * 100).toFixed(1)}%)`);
	}
	if (gz > BUDGET.gzip) {
		throw new Error(`[gate:volume] gzip ${gz} B 超预算 ${BUDGET.gzip} B(${((gz / BUDGET.gzip) * 100).toFixed(1)}%)`);
	}
	return { raw, gz };
}

export async function buildBundle({ outfile = DEFAULT_OUTFILE, minify = true } = {}) {
	const externals = peerExternals();
	if (externals.length === 0) {
		throw new Error("[build] package.json.peerDependencies 为空;无法解析 external 列表");
	}
	const result = await build({
		entryPoints: [resolve(ROOT, ENTRY)],
		outfile: resolve(ROOT, outfile),
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node20",
		minify,
		legalComments: "none",
		metafile: true,
		external: externals,
		logLevel: "silent",
	});

	const outBytes = await readFile(resolve(ROOT, outfile));
	const meta = result.metafile;

	gateImportWhitelist(outBytes);
	gateInlinedThirdParty(meta);
	const vol = gateVolume(outBytes);

	return { outBytes, vol, externals, inlinedThirdParty: [...thirdPartyFromMetafile(meta)] };
}

function fmtKB(b) {
	return `${(b / 1024).toFixed(2)} KB`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const start = Date.now();
	const { vol, externals, inlinedThirdParty } = await buildBundle(args);
	const ms = Date.now() - start;

	// 断言 dist/ 目录里只有 outfile(单文件约束)
	const distDir = dirname(resolve(ROOT, args.outfile));
	const files = await readdir(distDir);
	const expected = args.outfile.split("/").pop();
	if (files.length !== 1 || files[0] !== expected) {
		throw new Error(`[gate:single-file] ${distDir}/ 下有 ${files.length} 个文件: ${files.join(", ")};要求仅 ${expected} 一个文件`);
	}
	const s = await stat(resolve(ROOT, args.outfile));

	console.log(
		`✔ ${args.outfile}  ${fmtKB(s.size)}  (gzip ${fmtKB(vol.gz)})  build=${ms}ms  externals=[${externals.join(", ")}]  inlined=[]`,
	);
	if (args.report) {
		console.log(`  externals: ${externals.join(", ")}`);
		console.log(`  inlined third-party: ${inlinedThirdParty.length === 0 ? "(无)" : inlinedThirdParty.join(", ")}`);
		console.log(`  budget: raw ${fmtKB(BUDGET.raw)} / gzip ${fmtKB(BUDGET.gzip)}`);
	}
}

// 仅在直接执行本脚本时跑 CLI;被 import 时只导出 buildBundle
const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
	main().catch((e) => {
		console.error(`✘ ${e.message}`);
		process.exit(1);
	});
}
