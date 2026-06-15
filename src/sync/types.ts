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
	/** Per-source enablement. Disabled sources are inert. */
	sourceMacparakeetEnabled: boolean;
	sourceFellowEnabled: boolean;
	/** Fellow workspace subdomain (no protocol, no .fellow.app). */
	fellowSubdomain: string;
	/** Fellow personal API key; stored plaintext in data.json. */
	fellowApiKey: string;
	/** Minimum overlap fraction (0-1) for cross-source merge. */
	overlapThreshold: number;
	/** Minimum overlap in minutes for cross-source merge. */
	minimumOverlapMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
	cliPath: "",
	baseFolder: "",
	pathTemplate: "Meetings/{year}/{month} - {monthName}/{n} - {title} - {monthShort} {dayOrdinal}",
	syncSince: "",
	syncResults: true,
	syncNotes: true,
	syncTranscript: false,
	syncIntervalMinutes: 30,
	syncOnLaunch: true,
	sourceMacparakeetEnabled: false,
	sourceFellowEnabled: false,
	fellowSubdomain: "",
	fellowApiKey: "",
	overlapThreshold: 0.5,
	minimumOverlapMinutes: 5,
};

/** A plugin-owned file: the only paths the plugin is ever allowed to write. */
export interface FileRecord {
	path: string;
	/** Source timestamp the file was last rendered from; drives mirror updates. */
	sourceUpdatedAt: string;
	/** Owning source; absent on legacy (v1) records, treated as macparakeet. */
	source?: SourceName;
}

/** The meeting sources the plugin can ingest from. */
export type SourceName = "macparakeet" | "fellow";

/** A canonical real-world time interval (ISO 8601) for cross-source matching. */
export interface Interval {
	start: string;
	end: string;
}

/** Change-detection snapshot for one source binding. */
export interface SourceSnapshot {
	updatedAt: string;
	/** MacParakeet's AI-result count; sources without the notion leave it at 0. */
	promptResultCount: number;
}

/** One source's contribution to a (possibly multi-source) meeting record. */
export interface SourceBinding {
	id: string;
	snapshot: SourceSnapshot;
}

/**
 * Per-meeting state: frozen numbering, per-source bindings, and owned files.
 * One record can bind several sources after a cross-source merge.
 */
export interface MeetingRecord {
	folderPath: string;
	n: number;
	bucket: string;
	/** Canonical real-world interval; backfilled lazily for legacy records. */
	interval?: Interval;
	/** Best-known title for this meeting; used for cross-source tiebreaking. */
	title?: string;
	/** Confidence of the last cross-source merge; rendered to frontmatter in #29. */
	mergeConfidence?: "high" | "low";
	/** Per-source id + change snapshot; keyed by source name. */
	sources: Partial<Record<SourceName, SourceBinding>>;
	/**
	 * key -> file. Legacy keys ("index", "transcript", "notes", "result:<id>")
	 * are preserved; new artifacts source-scope their keys ("transcript:macparakeet").
	 */
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

/** A source that failed during a run without aborting the other sources. */
export interface SyncSourceError {
	source: SourceName;
	message: string;
}

/** What one sync run reports back to the caller. */
export interface SyncSummary {
	created: number;
	updated: number;
	unchanged: number;
	/** Per-source failures that did not abort the run; omitted when the run was clean. */
	errors?: SyncSourceError[];
}

export interface SyncOptions {
	/** Re-render and overwrite every in-scope meeting, ignoring the cheap diff. */
	force?: boolean;
}
