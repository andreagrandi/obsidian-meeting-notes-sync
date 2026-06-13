/**
 * Plugin data (settings + sync state) normalization and number assignment.
 * Numbering is frozen: a meeting's n is assigned once and never reassigned.
 */

import {
	DEFAULT_SETTINGS,
	type FileRecord,
	type Interval,
	type MeetingRecord,
	type PluginData,
	type Settings,
	type SourceBinding,
	type SourceName,
	type SourceSnapshot,
	type SyncStateData,
	emptyState,
} from "./types";

/** Source names migration and indexing iterate over, in a stable order. */
const SOURCE_NAMES: readonly SourceName[] = ["macparakeet", "fellow"];

/** Merge persisted (possibly partial) data with defaults into a full PluginData. */
export function normalizeData(raw: unknown, installDate: string): PluginData {
	const obj = isRecord(raw) ? raw : {};
	const settings = normalizeSettings(obj.settings);
	const state = normalizeState(obj.state, installDate);
	return { settings, state };
}

function normalizeSettings(raw: unknown): Settings {
	const obj = isRecord(raw) ? raw : {};
	return {
		cliPath: asString(obj.cliPath, DEFAULT_SETTINGS.cliPath),
		baseFolder: asString(obj.baseFolder, DEFAULT_SETTINGS.baseFolder),
		pathTemplate: asString(obj.pathTemplate, DEFAULT_SETTINGS.pathTemplate),
		syncSince: asString(obj.syncSince, DEFAULT_SETTINGS.syncSince),
		syncResults: asBool(obj.syncResults, DEFAULT_SETTINGS.syncResults),
		syncNotes: asBool(obj.syncNotes, DEFAULT_SETTINGS.syncNotes),
		syncTranscript: asBool(obj.syncTranscript, DEFAULT_SETTINGS.syncTranscript),
		syncIntervalMinutes: asNumber(obj.syncIntervalMinutes, DEFAULT_SETTINGS.syncIntervalMinutes),
		syncOnLaunch: asBool(obj.syncOnLaunch, DEFAULT_SETTINGS.syncOnLaunch),
		sourceMacparakeetEnabled: asBool(obj.sourceMacparakeetEnabled, DEFAULT_SETTINGS.sourceMacparakeetEnabled),
		sourceFellowEnabled: asBool(obj.sourceFellowEnabled, DEFAULT_SETTINGS.sourceFellowEnabled),
		fellowSubdomain: asString(obj.fellowSubdomain, DEFAULT_SETTINGS.fellowSubdomain),
		fellowApiKey: asString(obj.fellowApiKey, DEFAULT_SETTINGS.fellowApiKey),
		overlapThreshold: clampOverlap(asNumber(obj.overlapThreshold, DEFAULT_SETTINGS.overlapThreshold)),
		minimumOverlapMinutes: clampMinutes(asNumber(obj.minimumOverlapMinutes, DEFAULT_SETTINGS.minimumOverlapMinutes)),
	};
}

function normalizeState(raw: unknown, installDate: string): SyncStateData {
	if (!isRecord(raw)) {
		return emptyState(installDate);
	}
	const rawMeetings = isRecord(raw.meetings) ? raw.meetings : {};
	const meetings: Record<string, MeetingRecord> = {};
	for (const [key, value] of Object.entries(rawMeetings)) {
		const record = normalizeRecord(key, value);
		if (record) {
			meetings[key] = record;
		}
	}
	return {
		installDate: asString(raw.installDate, installDate),
		counters: isRecord(raw.counters) ? (raw.counters as Record<string, number>) : {},
		meetings,
	};
}

/**
 * Coerce one persisted meeting record to the v2 shape. A v1 record (top-level
 * `snapshot`, no `sources`) is migrated into a `macparakeet` source binding
 * keyed on the meetings-map key — the v1 MacParakeet meeting id — while `n`,
 * `bucket`, `folderPath`, and `files` carry over untouched. Re-normalizing a v2
 * record is a no-op.
 */
function normalizeRecord(key: string, raw: unknown): MeetingRecord | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const record: MeetingRecord = {
		folderPath: asString(raw.folderPath, ""),
		n: asNumber(raw.n, 0),
		bucket: asString(raw.bucket, ""),
		sources: isRecord(raw.sources)
			? normalizeSources(raw.sources)
			: { macparakeet: { id: key, snapshot: normalizeSnapshot(raw.snapshot) } },
		files: isRecord(raw.files) ? (raw.files as Record<string, FileRecord>) : {},
	};
	const title = asString(raw.title, "");
	if (title) {
		record.title = title;
	}
	const interval = normalizeInterval(raw.interval);
	if (interval) {
		record.interval = interval;
	}
	const mergeConfidence = asString(raw.mergeConfidence, "");
	if (mergeConfidence === "high" || mergeConfidence === "low") {
		record.mergeConfidence = mergeConfidence;
	}
	return record;
}

function normalizeSources(raw: Record<string, unknown>): Partial<Record<SourceName, SourceBinding>> {
	const sources: Partial<Record<SourceName, SourceBinding>> = {};
	for (const name of SOURCE_NAMES) {
		const binding = raw[name];
		if (isRecord(binding) && typeof binding.id === "string") {
			sources[name] = { id: binding.id, snapshot: normalizeSnapshot(binding.snapshot) };
		}
	}
	return sources;
}

function normalizeSnapshot(raw: unknown): SourceSnapshot {
	const obj = isRecord(raw) ? raw : {};
	return {
		updatedAt: asString(obj.updatedAt, ""),
		promptResultCount: asNumber(obj.promptResultCount, 0),
	};
}

function normalizeInterval(raw: unknown): Interval | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const start = asString(raw.start, "");
	const end = asString(raw.end, "");
	return start && end ? { start, end } : undefined;
}

/**
 * Return the frozen number for a meeting, assigning the next free one in its
 * bucket on first sight. Mutates `state.counters` only when assigning.
 */
export function assignNumber(state: SyncStateData, meetingId: string, bucket: string): number {
	const existing = state.meetings[meetingId];
	if (existing) {
		return existing.n;
	}
	const next = state.counters[bucket] ?? 1;
	state.counters[bucket] = next + 1;
	return next;
}

/** The date (YYYY-MM-DD) below which meetings are out of scope. */
export function effectiveSyncSince(settings: Settings, state: SyncStateData): string {
	return settings.syncSince.trim() || state.installDate;
}

/** Stable index key for a (source, source-id) pair. */
export function sourceIndexKey(source: SourceName, id: string): string {
	return `${source}:${id}`;
}

/**
 * Build a (source, source-id) -> meetings-map-key index so the engine's diff
 * loop resolves an incoming source meeting to its record in O(1).
 */
export function buildSourceIndex(state: SyncStateData): Map<string, string> {
	const index = new Map<string, string>();
	for (const [key, record] of Object.entries(state.meetings)) {
		for (const name of SOURCE_NAMES) {
			const binding = record.sources[name];
			if (binding) {
				index.set(sourceIndexKey(name, binding.id), key);
			}
		}
	}
	return index;
}

/** The meetings-map key a source id is bound to, or undefined. */
export function findBySource(index: Map<string, string>, source: SourceName, id: string): string | undefined {
	return index.get(sourceIndexKey(source, id));
}

/** Canonical interval from a source's start instant and duration in ms. */
export function intervalFromDuration(startIso: string, durationMs: number): Interval {
	const start = new Date(startIso);
	const end = new Date(start.getTime() + Math.max(0, durationMs));
	return { start: start.toISOString(), end: end.toISOString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampOverlap(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function clampMinutes(value: number): number {
	return Math.max(0, Math.floor(value));
}
