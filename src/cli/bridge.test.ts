import { describe, expect, it } from "vitest";
import {
	CliBridge,
	DEFAULT_CLI_PATHS,
	parseMeetingSummaries,
	type CliBridgeDeps,
	type CliRunResult,
	CliError,
	type CommandRunner,
} from "./index";

const APP_BUNDLE_PATH = "/Applications/MacParakeet.app/Contents/MacOS/macparakeet-cli";
const HOMEBREW_PATH = "/opt/homebrew/bin/macparakeet-cli";

const HEALTH_JSON = JSON.stringify({ database: { status: "ok" } });
const STDERR_NOISE =
	"2026-06-12 15:29:24.910 macparakeet-cli[52815:5720437] Using your own bundle " +
	"identifier as an NSUserDefaults suite name does not make sense and will not work.";

const MEETINGS_FIXTURE = [
	{
		createdAt: "2026-06-12T08:56:15Z",
		durationMs: 3075147,
		hasNotes: false,
		id: "FF6AE2C4-FE1B-4AD9-88B7-55E7513B4CA9",
		promptResultCount: 3,
		shortID: "FF6AE2C4",
		status: "completed",
		title: "Andrea / James - 1-1",
		updatedAt: "2026-06-12T08:57:12Z",
	},
	{
		createdAt: "2026-06-11T10:00:00Z",
		durationMs: 600000,
		hasNotes: true,
		id: "AAAA1111-0000-0000-0000-000000000000",
		promptResultCount: 0,
		shortID: "AAAA1111",
		status: "completed",
		title: "Weekly Standup",
		updatedAt: "2026-06-11T10:10:00Z",
	},
];

function ok(json: unknown): CliRunResult {
	return { stdout: JSON.stringify(json), stderr: "", code: 0, timedOut: false };
}

/** Runner that dispatches on the first CLI argument and records every call. */
function routingRunner(handlers: {
	health?: () => CliRunResult;
	list?: () => CliRunResult;
}): { runner: CommandRunner; calls: { binPath: string; args: string[] }[] } {
	const calls: { binPath: string; args: string[] }[] = [];
	const runner: CommandRunner = async (binPath, args) => {
		calls.push({ binPath, args });
		if (args[0] === "health" && handlers.health) {
			return handlers.health();
		}
		if (args[0] === "meetings" && args[1] === "list" && handlers.list) {
			return handlers.list();
		}
		throw new Error(`unexpected CLI call: ${args.join(" ")}`);
	};
	return { runner, calls };
}

function makeBridge(overrides: Partial<CliBridgeDeps>): CliBridge {
	return new CliBridge({
		runner: async () => ok({}),
		pathExists: () => true,
		...overrides,
	});
}

describe("CliBridge discovery", () => {
	it("returns the first existing candidate in priority order", () => {
		const bridge = makeBridge({ pathExists: (p) => p === APP_BUNDLE_PATH });
		expect(bridge.discoverPath()).toBe(APP_BUNDLE_PATH);
	});

	it("prefers homebrew over the app bundle when both exist", () => {
		const existing = new Set([HOMEBREW_PATH, APP_BUNDLE_PATH]);
		const bridge = makeBridge({ pathExists: (p) => existing.has(p) });
		expect(bridge.discoverPath()).toBe(HOMEBREW_PATH);
	});

	it("uses the settings override verbatim, ahead of discovery", () => {
		const bridge = makeBridge({
			pathExists: () => true,
			overridePath: () => "  /custom/macparakeet-cli  ",
		});
		expect(bridge.discoverPath()).toBe("/custom/macparakeet-cli");
	});

	it("returns null when no candidate exists", () => {
		const bridge = makeBridge({ pathExists: () => false });
		expect(bridge.discoverPath()).toBeNull();
	});

	it("checks the default paths in the documented order", () => {
		expect(DEFAULT_CLI_PATHS).toEqual([
			"/opt/homebrew/bin/macparakeet-cli",
			"/usr/local/bin/macparakeet-cli",
			APP_BUNDLE_PATH,
		]);
	});
});

describe("CliBridge.resolveCli", () => {
	it("throws not-found when nothing is discovered", async () => {
		const bridge = makeBridge({ pathExists: () => false });
		await expect(bridge.resolveCli()).rejects.toMatchObject({ kind: "not-found" });
	});

	it("validates with health and caches the resolved path for the session", async () => {
		const { runner, calls } = routingRunner({ health: () => ok({ database: { status: "ok" } }) });
		const bridge = makeBridge({ pathExists: (p) => p === APP_BUNDLE_PATH, runner });

		await expect(bridge.resolveCli()).resolves.toBe(APP_BUNDLE_PATH);
		await expect(bridge.resolveCli()).resolves.toBe(APP_BUNDLE_PATH);

		// health runs once; the second resolve hits the cache.
		expect(calls.filter((c) => c.args[0] === "health")).toHaveLength(1);
		expect(calls[0]?.binPath).toBe(APP_BUNDLE_PATH);
	});

	it("re-discovers after clearCache", async () => {
		const { runner, calls } = routingRunner({ health: () => ok({}) });
		const bridge = makeBridge({ runner });

		await bridge.resolveCli();
		bridge.clearCache();
		await bridge.resolveCli();

		expect(calls.filter((c) => c.args[0] === "health")).toHaveLength(2);
	});
});

describe("CliBridge.listMeetings", () => {
	it("parses the meetings array into typed summaries", async () => {
		const { runner } = routingRunner({
			health: () => ok({}),
			list: () => ok(MEETINGS_FIXTURE),
		});
		const bridge = makeBridge({ runner });

		const meetings = await bridge.listMeetings();
		expect(meetings).toHaveLength(2);
		expect(meetings[0]).toEqual({
			id: "FF6AE2C4-FE1B-4AD9-88B7-55E7513B4CA9",
			shortID: "FF6AE2C4",
			title: "Andrea / James - 1-1",
			status: "completed",
			createdAt: "2026-06-12T08:56:15Z",
			updatedAt: "2026-06-12T08:57:12Z",
			durationMs: 3075147,
			hasNotes: false,
			promptResultCount: 3,
		});
	});
});

describe("CliBridge.checkConnection", () => {
	it("returns the resolved path and meeting count", async () => {
		const { runner } = routingRunner({
			health: () => ok({}),
			list: () => ok(MEETINGS_FIXTURE),
		});
		const bridge = makeBridge({ pathExists: (p) => p === APP_BUNDLE_PATH, runner });

		await expect(bridge.checkConnection()).resolves.toEqual({
			cliPath: APP_BUNDLE_PATH,
			meetingCount: 2,
		});
	});
});

describe("CliBridge error mapping", () => {
	it("maps the {ok:false} envelope to an envelope error, preserving errorType", async () => {
		const runner: CommandRunner = async () => ({
			stdout: JSON.stringify({
				ok: false,
				error: "No meeting matching 'x'",
				errorType: "lookup",
			}),
			stderr: STDERR_NOISE,
			code: 1,
			timedOut: false,
		});
		const bridge = makeBridge({ runner });

		await expect(bridge.health()).rejects.toMatchObject({
			kind: "envelope",
			errorType: "lookup",
			message: "No meeting matching 'x'",
		});
	});

	it("maps a non-zero exit with plain-text stderr to an exit error", async () => {
		const runner: CommandRunner = async () => ({
			stdout: "",
			stderr: "Error: Unknown option '--json'\nUsage: macparakeet-cli <subcommand>",
			code: 2,
			timedOut: false,
		});
		const bridge = makeBridge({ runner });

		const error = await bridge.health().catch((e) => e as CliError);
		expect(error).toBeInstanceOf(CliError);
		expect(error.kind).toBe("exit");
		expect(error.message).toContain("Unknown option");
		expect(error.message).toContain("code 2");
	});

	it("maps a timeout to a timeout error", async () => {
		const runner: CommandRunner = async () => ({
			stdout: "",
			stderr: "",
			code: null,
			timedOut: true,
		});
		const bridge = makeBridge({ runner, timeoutMs: 1234 });

		await expect(bridge.health()).rejects.toMatchObject({ kind: "timeout" });
	});

	it("maps an ENOENT spawn failure to not-found", async () => {
		const runner: CommandRunner = async () => ({
			stdout: "",
			stderr: "",
			code: null,
			timedOut: false,
			spawnError: "ENOENT",
		});
		const bridge = makeBridge({ runner });

		await expect(bridge.health()).rejects.toMatchObject({ kind: "not-found" });
	});

	it("maps a non-ENOENT spawn failure to a spawn error", async () => {
		const runner: CommandRunner = async () => ({
			stdout: "",
			stderr: "",
			code: null,
			timedOut: false,
			spawnError: "EACCES",
		});
		const bridge = makeBridge({ runner });

		await expect(bridge.health()).rejects.toMatchObject({ kind: "spawn" });
	});

	it("maps invalid JSON on a clean exit to a parse error", async () => {
		const runner: CommandRunner = async () => ({
			stdout: "not json at all",
			stderr: "",
			code: 0,
			timedOut: false,
		});
		const bridge = makeBridge({ runner });

		await expect(bridge.health()).rejects.toMatchObject({ kind: "parse" });
	});

	it("ignores stderr log noise when stdout carries valid JSON", async () => {
		const runner: CommandRunner = async () => ({
			stdout: HEALTH_JSON,
			stderr: STDERR_NOISE,
			code: 0,
			timedOut: false,
		});
		const bridge = makeBridge({ runner });

		await expect(bridge.health()).resolves.toMatchObject({ database: { status: "ok" } });
	});

	it("wraps an unexpected runner rejection as a spawn error", async () => {
		const runner: CommandRunner = async () => {
			throw new Error("boom");
		};
		const bridge = makeBridge({ runner });

		await expect(bridge.health()).rejects.toMatchObject({ kind: "spawn" });
	});
});

describe("parseMeetingSummaries", () => {
	it("rejects a non-array payload", () => {
		expect(() => parseMeetingSummaries({})).toThrow(CliError);
	});

	it("rejects a meeting missing a string id", () => {
		expect(() => parseMeetingSummaries([{ title: "no id" }])).toThrow(/missing a string "id"/);
	});

	it("coerces missing optional fields to safe defaults", () => {
		const [meeting] = parseMeetingSummaries([{ id: "only-id" }]);
		expect(meeting).toEqual({
			id: "only-id",
			shortID: "",
			title: "Untitled Meeting",
			status: "",
			createdAt: "",
			updatedAt: "",
			durationMs: 0,
			hasNotes: false,
			promptResultCount: 0,
		});
	});
});
