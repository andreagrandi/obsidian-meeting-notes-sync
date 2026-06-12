import {
	CliError,
	type CliRunResult,
	type CommandRunner,
	type HealthResult,
	type MeetingSummary,
} from "./types";

/** Default per-command timeout (PLAN §3: ~30 s). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Discovery locations checked in order; Electron does not inherit the shell $PATH. */
export const DEFAULT_CLI_PATHS = [
	"/opt/homebrew/bin/macparakeet-cli",
	"/usr/local/bin/macparakeet-cli",
	"/Applications/MacParakeet.app/Contents/MacOS/macparakeet-cli",
];

const HEALTH_ARGS = ["health", "--json"];
const LIST_ARGS = ["meetings", "list", "--limit", "500", "--json"];

export interface CliBridgeDeps {
	runner: CommandRunner;
	pathExists: (path: string) => boolean;
	/** Manual override from settings; used verbatim when it returns a non-empty path. */
	overridePath?: () => string | undefined;
	candidatePaths?: string[];
	timeoutMs?: number;
}

export interface ConnectionInfo {
	cliPath: string;
	meetingCount: number;
}

/** Discovers, validates, and talks to macparakeet-cli, mapping failures to CliError. */
export class CliBridge {
	private readonly runner: CommandRunner;
	private readonly pathExists: (path: string) => boolean;
	private readonly overridePath: () => string | undefined;
	private readonly candidatePaths: string[];
	private readonly timeoutMs: number;
	private resolvedPath: string | null = null;

	constructor(deps: CliBridgeDeps) {
		this.runner = deps.runner;
		this.pathExists = deps.pathExists;
		this.overridePath = deps.overridePath ?? (() => undefined);
		this.candidatePaths = deps.candidatePaths ?? DEFAULT_CLI_PATHS;
		this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	/** First candidate that exists (override wins, used verbatim); null if none. */
	discoverPath(): string | null {
		const override = this.overridePath()?.trim();
		if (override) {
			return override;
		}
		for (const path of this.candidatePaths) {
			if (this.pathExists(path)) {
				return path;
			}
		}
		return null;
	}

	/** Resolve + validate via `health --json`, caching the path for the session. */
	async resolveCli(): Promise<string> {
		if (this.resolvedPath) {
			return this.resolvedPath;
		}
		const candidate = this.discoverPath();
		if (!candidate) {
			throw new CliError(
				"not-found",
				"Could not find macparakeet-cli. Install MacParakeet, or set the CLI path in plugin settings.",
			);
		}
		await this.runJson(candidate, HEALTH_ARGS);
		this.resolvedPath = candidate;
		return candidate;
	}

	/** Drop the cached path so the next call re-discovers (e.g. override changed). */
	clearCache(): void {
		this.resolvedPath = null;
	}

	async health(): Promise<HealthResult> {
		const cliPath = await this.resolveCli();
		return (await this.runJson(cliPath, HEALTH_ARGS)) as HealthResult;
	}

	async listMeetings(): Promise<MeetingSummary[]> {
		const cliPath = await this.resolveCli();
		const data = await this.runJson(cliPath, LIST_ARGS);
		return parseMeetingSummaries(data);
	}

	/** Validate the binary and count meetings — backs the "Check connection" command. */
	async checkConnection(): Promise<ConnectionInfo> {
		const cliPath = await this.resolveCli();
		const meetings = await this.listMeetings();
		return { cliPath, meetingCount: meetings.length };
	}

	/** Spawn once, then map spawn/timeout/exit/envelope/parse failures to CliError. */
	private async runJson(binPath: string, args: string[]): Promise<unknown> {
		let result: CliRunResult;
		try {
			result = await this.runner(binPath, args, { timeoutMs: this.timeoutMs });
		} catch (error) {
			throw new CliError("spawn", `Failed to run macparakeet-cli: ${messageOf(error)}`);
		}

		if (result.spawnError === "ENOENT") {
			throw new CliError("not-found", `macparakeet-cli was not found at ${binPath}.`);
		}
		if (result.spawnError) {
			throw new CliError("spawn", `Could not start macparakeet-cli (${result.spawnError}).`);
		}
		if (result.timedOut) {
			throw new CliError("timeout", `macparakeet-cli timed out after ${this.timeoutMs} ms.`);
		}

		const stdout = result.stdout.trim();
		if (stdout.length === 0) {
			const failed = result.code !== null && result.code !== 0;
			throw new CliError(failed ? "exit" : "parse", exitMessage(result), { code: result.code });
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(stdout);
		} catch {
			if (result.code !== null && result.code !== 0) {
				throw new CliError("exit", exitMessage(result), { code: result.code });
			}
			throw new CliError("parse", "macparakeet-cli returned output that was not valid JSON.");
		}

		if (isErrorEnvelope(parsed)) {
			throw new CliError("envelope", parsed.error ?? "macparakeet-cli reported an error.", {
				errorType: parsed.errorType,
			});
		}

		return parsed;
	}
}

interface ErrorEnvelope {
	ok: false;
	error?: string;
	errorType?: string;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { ok?: unknown }).ok === false
	);
}

/** Validate and coerce the `meetings list` array into typed summaries. */
export function parseMeetingSummaries(data: unknown): MeetingSummary[] {
	if (!Array.isArray(data)) {
		throw new CliError("parse", "Expected a JSON array of meetings from macparakeet-cli.");
	}
	return data.map((raw, index) => coerceMeetingSummary(raw, index));
}

function coerceMeetingSummary(raw: unknown, index: number): MeetingSummary {
	if (typeof raw !== "object" || raw === null) {
		throw new CliError("parse", `Meeting at index ${index} was not a JSON object.`);
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.id !== "string") {
		throw new CliError("parse", `Meeting at index ${index} is missing a string "id".`);
	}
	return {
		id: obj.id,
		shortID: typeof obj.shortID === "string" ? obj.shortID : "",
		title: typeof obj.title === "string" ? obj.title : "Untitled Meeting",
		status: typeof obj.status === "string" ? obj.status : "",
		createdAt: typeof obj.createdAt === "string" ? obj.createdAt : "",
		updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : "",
		durationMs: typeof obj.durationMs === "number" ? obj.durationMs : 0,
		hasNotes: obj.hasNotes === true,
		promptResultCount: typeof obj.promptResultCount === "number" ? obj.promptResultCount : 0,
	};
}

/** Strip macOS unified-logging noise (e.g. the NSUserDefaults warning) from stderr. */
function cleanStderr(stderr: string): string {
	return stderr
		.split("\n")
		.filter((line) => line.trim().length > 0 && !/macparakeet-cli\[\d+:\d+\]/.test(line))
		.join("\n")
		.trim();
}

function exitMessage(result: CliRunResult): string {
	const detail = cleanStderr(result.stderr);
	const code = result.code === null ? "unknown" : String(result.code);
	if (detail) {
		return `macparakeet-cli exited with code ${code}: ${detail}`;
	}
	return `macparakeet-cli exited with code ${code} and produced no output.`;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
