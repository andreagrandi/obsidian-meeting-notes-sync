/**
 * Live end-to-end harness for the Fellow integration (#31 real-data run).
 * Runs the real SyncEngine — real macparakeet-cli + the live Fellow API — into a
 * throwaway temp vault, then prints the result. Reads FELLOW_SUBDOMAIN and
 * FELLOW_API_KEY from .env (see .env.example). Run: `npx -y tsx scripts/fellow-live-test.mts`.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CliBridge, nodeCommandRunner } from "../src/cli";
import { FellowClient, type FellowHttp } from "../src/fellow";
import { FellowAdapter, MacParakeetAdapter } from "../src/sources";
import { SyncEngine, DEFAULT_SETTINGS, emptyState, type Settings, type VaultIO } from "../src/sync";

function loadEnv(): void {
	const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
	for (const raw of text.split("\n")) {
		const match = /^([A-Z_]+)=(.*)$/.exec(raw.trim());
		if (match && match[1] && process.env[match[1]] === undefined) {
			process.env[match[1]] = match[2];
		}
	}
}

loadEnv();
const subdomain = (process.env.FELLOW_SUBDOMAIN ?? "").trim();
const apiKey = (process.env.FELLOW_API_KEY ?? "").trim();
if (!subdomain || !apiKey) {
	console.error("Missing FELLOW_SUBDOMAIN / FELLOW_API_KEY in .env");
	process.exit(1);
}

const fellowHttp: FellowHttp = async (request) => {
	const response = await fetch(request.url, {
		method: request.method,
		headers: request.headers,
		body: request.body,
	});
	return { status: response.status, text: await response.text() };
};

class FsVault implements VaultIO {
	readonly writeLog: string[] = [];
	constructor(private readonly root: string) {}
	private abs(path: string): string {
		return join(this.root, path);
	}
	async folderExists(path: string): Promise<boolean> {
		return existsSync(this.abs(path)) && statSync(this.abs(path)).isDirectory();
	}
	async createFolder(path: string): Promise<void> {
		mkdirSync(this.abs(path), { recursive: true });
	}
	async fileExists(path: string): Promise<boolean> {
		return existsSync(this.abs(path));
	}
	async write(path: string, content: string): Promise<void> {
		mkdirSync(dirname(this.abs(path)), { recursive: true });
		writeFileSync(this.abs(path), content);
		this.writeLog.push(path);
	}
}

function printTree(dir: string, prefix = ""): void {
	if (!existsSync(dir)) {
		return;
	}
	for (const entry of readdirSync(dir).sort()) {
		const full = join(dir, entry);
		const isDir = statSync(full).isDirectory();
		console.log(`${prefix}${entry}${isDir ? "/" : ""}`);
		if (isDir) {
			printTree(full, `${prefix}  `);
		}
	}
}

async function main(): Promise<void> {
	const settings: Settings = {
		...DEFAULT_SETTINGS,
		baseFolder: "",
		syncSince: "2026-06-01",
		syncTranscript: true,
		sourceMacparakeetEnabled: true,
		sourceFellowEnabled: true,
		fellowSubdomain: subdomain,
		fellowApiKey: apiKey,
	};
	const state = emptyState("2026-06-01");
	const root = mkdtempSync(join(tmpdir(), "mns-live-"));
	const vault = new FsVault(root);

	const fellow = new FellowClient({
		http: fellowHttp,
		getConfig: () => ({ subdomain: settings.fellowSubdomain, apiKey: settings.fellowApiKey }),
	});
	const cli = new CliBridge({
		runner: nodeCommandRunner,
		pathExists: (path) => existsSync(path),
		overridePath: () => settings.cliPath.trim() || undefined,
	});
	const engine = new SyncEngine({
		sources: [new MacParakeetAdapter(cli), new FellowAdapter(fellow, () => settings)],
		vault,
		getSettings: () => settings,
		getState: () => state,
		persist: async () => {},
	});

	console.log(`Temp vault: ${root}\n`);

	console.log("== Fellow /me ==");
	const me = await fellow.me();
	console.log(`  workspace: ${me.workspace.name} (${me.workspace.subdomain})\n`);

	console.log("== Fellow recordings (since 2026-06-01) ==");
	const recordings = await fellow.listRecordings({ updatedAtStart: "2026-06-01T00:00:00Z" });
	for (const recording of recordings) {
		console.log(`  ${recording.id} | "${recording.title}" | ${recording.started_at} -> ${recording.ended_at}`);
	}
	console.log("");

	console.log("== Sync 1 ==");
	console.log("  summary:", await engine.sync());
	console.log("== Sync 2 (expect 0 new / 0 updated) ==");
	console.log("  summary:", await engine.sync());

	console.log("\n== Vault tree ==");
	printTree(root);

	console.log("\n== State: per-meeting sources + merge confidence ==");
	for (const [key, record] of Object.entries(state.meetings)) {
		const sources = Object.keys(record.sources).join("+");
		console.log(`  ${record.folderPath} | sources: ${sources} | confidence: ${record.mergeConfidence ?? "-"} | key: ${key}`);
	}

	const merged = Object.values(state.meetings).find((record) => Object.keys(record.sources).length > 1);
	if (merged) {
		const indexPath = merged.files.index?.path;
		if (indexPath) {
			console.log(`\n== Merged index (${indexPath}) ==`);
			console.log(readFileSync(join(root, indexPath), "utf8"));
		}
	} else {
		console.log("\n(No cross-source merge occurred — no meeting overlapped between sources.)");
	}
}

main().catch((error) => {
	console.error("LIVE TEST FAILED:", error);
	process.exit(1);
});
