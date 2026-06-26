import type {
	FileRecord,
	MeetingRecord,
	Settings,
	SourceBinding,
	SourceName,
	VaultIO,
} from "./types";

/** Source order used when a preferred transcript is unavailable. */
const SOURCE_NAMES: readonly SourceName[] = ["macparakeet", "fellow"];

export interface ShouldRenderTranscriptInput {
	settings: Settings;
	source: SourceName;
	/** Bindings after the current source is applied. */
	sources: Partial<Record<SourceName, SourceBinding>>;
	files: Record<string, FileRecord>;
}

/** True when this source should render a transcript under the duplicate policy. */
export function shouldRenderTranscript(
	input: ShouldRenderTranscriptInput,
): boolean {
	const preference = input.settings.transcriptSourcePreference;
	if (!input.settings.syncTranscript) {
		return false;
	}
	if (preference === "all" || boundSourceCount(input.sources) < 2) {
		return true;
	}
	if (input.source === preference) {
		return true;
	}
	return !hasTranscriptForSource(input.files, preference);
}

export interface ApplyTranscriptPreferenceInput {
	settings: Settings;
	record: MeetingRecord;
	vault: VaultIO;
}

/** Trash tracked duplicate transcript artifacts, leaving the selected source linked. */
export async function applyTranscriptPreference(
	input: ApplyTranscriptPreferenceInput,
): Promise<number> {
	const keep = transcriptSourceToKeep(
		input.settings,
		input.record.sources,
		input.record.files,
	);
	if (!keep) {
		return 0;
	}

	let removed = 0;
	for (const entry of transcriptEntries(input.record.files)) {
		if (entry.source === keep) {
			continue;
		}
		await input.vault.trash(entry.file.path);
		delete input.record.files[entry.key];
		removed += 1;
	}
	return removed;
}

function transcriptSourceToKeep(
	settings: Settings,
	sources: Partial<Record<SourceName, SourceBinding>>,
	files: Record<string, FileRecord>,
): SourceName | undefined {
	const preference = settings.transcriptSourcePreference;
	if (
		!settings.syncTranscript ||
		preference === "all" ||
		boundSourceCount(sources) < 2
	) {
		return undefined;
	}

	const entries = transcriptEntries(files);
	if (entries.length <= 1) {
		return undefined;
	}
	if (entries.some((entry) => entry.source === preference)) {
		return preference;
	}
	return firstAvailableTranscriptSource(entries);
}

function firstAvailableTranscriptSource(
	entries: TranscriptEntry[],
): SourceName | undefined {
	const presentSources = new Set(entries.map((entry) => entry.source));
	for (const source of SOURCE_NAMES) {
		if (presentSources.has(source)) {
			return source;
		}
	}
	return undefined;
}

function boundSourceCount(
	sources: Partial<Record<SourceName, SourceBinding>>,
): number {
	return SOURCE_NAMES.filter((source) => sources[source] !== undefined).length;
}

function hasTranscriptForSource(
	files: Record<string, FileRecord>,
	source: SourceName,
): boolean {
	return transcriptEntries(files).some((entry) => entry.source === source);
}

interface TranscriptEntry {
	key: string;
	file: FileRecord;
	source: SourceName;
}

function transcriptEntries(
	files: Record<string, FileRecord>,
): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
	for (const [key, file] of Object.entries(files)) {
		if (isTranscriptKey(key)) {
			entries.push({ key, file, source: transcriptSource(key, file) });
		}
	}
	return entries;
}

function isTranscriptKey(key: string): boolean {
	return key === "transcript" || key.startsWith("transcript:");
}

function transcriptSource(key: string, file: FileRecord): SourceName {
	if (file.source) {
		return file.source;
	}
	return key === "transcript:fellow" ? "fellow" : "macparakeet";
}
