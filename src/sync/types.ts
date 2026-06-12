/**
 * Settings, persisted sync state, and the thin interfaces the engine talks to.
 * Everything here is Obsidian-free so the engine is unit-testable with fakes.
 */

import type { AiResult, MeetingDetail, MeetingSummary } from "../cli/types";

/** User-configurable settings; persisted in data.json alongside sync state (PLAN §4). */
export interface Settings {
	/** Manual CLI path override; empty means auto-discover. */
	cliPath: string;
	baseFolder: string;
	pathTemplate: string;
	/** Only meetings created on/after this date (YYYY-MM-DD) are in scope. */
	syncSince: string;
	syncResults: boolean;
	syncNotes: boolean;
	syncTranscript: boolean;
	/** Background interval in minutes; 0 disables. */
	syncIntervalMinutes: number;
	syncOnLaunch: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	cliPath: "",
	baseFolder: "MacParakeet",
	pathTemplate: "Meetings/{year}/{month}/{n}-{title}",
	syncSince: "",
	syncResults: true,
	syncNotes: true,
	syncTranscript: false,
	syncIntervalMinutes: 30,
	syncOnLaunch: true,
};

/** A plugin-owned file: the only paths the plugin is ever allowed to write. */
export interface FileRecord {
	path: string;
	/** Source timestamp the file was last rendered from; drives mirror updates. */
	sourceUpdatedAt: string;
}

/** Per-meeting state: frozen numbering, change snapshot, and owned files. */
export interface MeetingRecord {
	folderPath: string;
	n: number;
	bucket: string;
	snapshot: { updatedAt: string; promptResultCount: number };
	/** key -> file; keys: "index", "transcript", "notes", "result:<result-id>". */
	files: Record<string, FileRecord>;
}

/** Persisted sync state (PLAN §5). */
export interface SyncStateData {
	/** First-run date; default for syncSince when the setting is empty. */
	installDate: string;
	/** Next n per "{year}/{month}" bucket. */
	counters: Record<string, number>;
	meetings: Record<string, MeetingRecord>;
}

export function emptyState(installDate: string): SyncStateData {
	return { installDate, counters: {}, meetings: {} };
}

/** Everything persisted to data.json. */
export interface PluginData {
	settings: Settings;
	state: SyncStateData;
}

/** The slice of the CLI bridge the engine depends on (fakeable in tests). */
export interface CliClient {
	listMeetings(): Promise<MeetingSummary[]>;
	showMeeting(id: string): Promise<MeetingDetail>;
	listResults(id: string): Promise<AiResult[]>;
}

/** Minimal vault file I/O the engine needs; backed by Obsidian's Vault at runtime. */
export interface VaultIO {
	folderExists(path: string): Promise<boolean>;
	createFolder(path: string): Promise<void>;
	fileExists(path: string): Promise<boolean>;
	/** Create or overwrite a file, creating parent folders as needed. */
	write(path: string, content: string): Promise<void>;
}

/** What one sync run reports back to the caller. */
export interface SyncSummary {
	created: number;
	updated: number;
	unchanged: number;
}

export interface SyncOptions {
	/** Re-render and overwrite every in-scope meeting, ignoring the cheap diff. */
	force?: boolean;
}
