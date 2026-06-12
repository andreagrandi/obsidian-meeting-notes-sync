import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { existsSync } from "node:fs";
import { CliBridge, nodeCommandRunner } from "./cli";
import { SyncEngine, SyncRunner, describeError, normalizeData } from "./sync";
import type { PluginData, Settings, SyncOptions, VaultIO } from "./sync";
import { MacParakeetSettingTab } from "./settings-tab";

/** Delay after layout-ready before the on-launch sync, so startup is never slowed. */
const LAUNCH_DELAY_MS = 15_000;

/** Result of validating the CLI path, surfaced in the settings tab. */
export interface CliStatus {
	ok: boolean;
	path?: string;
	meetingCount?: number;
	error?: string;
}

export default class MacParakeetSyncPlugin extends Plugin {
	private cli!: CliBridge;
	private engine!: SyncEngine;
	private runner!: SyncRunner;
	private data!: PluginData;
	private intervalId: number | null = null;
	private launchTimeoutId: number | null = null;

	async onload(): Promise<void> {
		this.data = normalizeData(await this.loadData(), todayDate());
		await this.saveData(this.data);

		this.cli = new CliBridge({
			runner: nodeCommandRunner,
			pathExists: (path) => existsSync(path),
			overridePath: () => this.data.settings.cliPath.trim() || undefined,
		});

		this.engine = new SyncEngine({
			cli: this.cli,
			vault: new ObsidianVaultIO(this),
			getSettings: () => this.data.settings,
			getState: () => this.data.state,
			persist: () => this.saveData(this.data),
		});

		this.runner = new SyncRunner({
			sync: (options) => this.engine.sync(options),
			notify: (message) => {
				new Notice(message);
			},
			log: (message) => console.log(message),
			logError: (message, error) => console.error(message, error),
		});

		this.addRibbonIcon("refresh-cw", "Sync MacParakeet meetings", () => {
			void this.runner.run("manual");
		});

		this.addCommand({
			id: "check-connection",
			name: "Check connection",
			callback: () => {
				void this.checkConnection();
			},
		});

		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: () => {
				void this.runner.run("manual");
			},
		});

		this.addCommand({
			id: "force-resync",
			name: "Force re-sync",
			callback: () => {
				void this.runner.run("manual", { force: true });
			},
		});

		this.addSettingTab(new MacParakeetSettingTab(this.app, this));

		this.applySchedule();
		this.scheduleLaunchSync();
	}

	onunload(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
		}
		if (this.launchTimeoutId !== null) {
			window.clearTimeout(this.launchTimeoutId);
		}
	}

	/** Current settings; the engine and settings tab read these live. */
	getSettings(): Settings {
		return this.data.settings;
	}

	/** Merge a settings patch and persist it; takes effect on the next sync. */
	async updateSettings(patch: Partial<Settings>): Promise<void> {
		const previousInterval = this.data.settings.syncIntervalMinutes;
		this.data.settings = { ...this.data.settings, ...patch };
		await this.saveData(this.data);
		if (this.data.settings.syncIntervalMinutes !== previousInterval) {
			this.applySchedule();
		}
	}

	/** Re-discover and validate the CLI from the current override; for the settings tab. */
	async validateCli(): Promise<CliStatus> {
		this.cli.clearCache();
		try {
			const { cliPath, meetingCount } = await this.cli.checkConnection();
			return { ok: true, path: cliPath, meetingCount };
		} catch (error) {
			return { ok: false, error: describeError(error) };
		}
	}

	/** (Re)start the background interval timer from the current setting; 0 disables. */
	private applySchedule(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
		const minutes = this.data.settings.syncIntervalMinutes;
		if (minutes > 0) {
			this.intervalId = window.setInterval(() => {
				void this.runner.run("background");
			}, minutes * 60_000);
			this.registerInterval(this.intervalId);
		}
	}

	/** Run a background sync ~15 s after layout is ready, if the toggle is on. */
	private scheduleLaunchSync(): void {
		this.app.workspace.onLayoutReady(() => {
			this.launchTimeoutId = window.setTimeout(() => {
				this.launchTimeoutId = null;
				if (this.data.settings.syncOnLaunch) {
					void this.runner.run("background");
				}
			}, LAUNCH_DELAY_MS);
		});
	}

	private async checkConnection(): Promise<void> {
		try {
			const { cliPath, meetingCount } = await this.cli.checkConnection();
			new Notice(`MacParakeet Sync: connected.\nCLI: ${cliPath}\nMeetings: ${meetingCount}`);
		} catch (error) {
			new Notice(`MacParakeet Sync: ${describeError(error)}`);
			console.error("MacParakeet Sync: check connection failed", error);
		}
	}
}

/** Obsidian Vault-backed file I/O; the only place that touches the vault. */
class ObsidianVaultIO implements VaultIO {
	constructor(private readonly plugin: Plugin) {}

	private get vault() {
		return this.plugin.app.vault;
	}

	async folderExists(path: string): Promise<boolean> {
		return this.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFolder;
	}

	async createFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		const segments = normalized.split("/").filter((segment) => segment.length > 0);
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!(this.vault.getAbstractFileByPath(current) instanceof TFolder)) {
				try {
					await this.vault.createFolder(current);
				} catch (error) {
					// Tolerate a concurrent/pre-existing folder; rethrow anything else.
					if (!/exists/i.test(messageOf(error))) {
						throw error;
					}
				}
			}
		}
	}

	async fileExists(path: string): Promise<boolean> {
		return this.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
	}

	async write(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.vault.modify(existing, content);
			return;
		}
		const parent = normalized.slice(0, normalized.lastIndexOf("/"));
		if (parent.length > 0) {
			await this.createFolder(parent);
		}
		await this.vault.create(normalized, content);
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Today's date as YYYY-MM-DD, used as the default sync-since on first run. */
function todayDate(): string {
	return new Date().toISOString().slice(0, 10);
}
