/**
 * NoteRenderer: turn a meeting + its AI results into markdown files. Artifacts
 * are attributed by source — keys are source-scoped and new files carry a
 * " (Source)" suffix (PLAN §12.4) — while the combined index links every
 * source's artifacts and carries both ids. Tracked paths are never renamed.
 */

import type { AiResult, MeetingDetail } from "../cli/types";
import { sanitizeTitle, uniqueName } from "./paths";
import type { FileRecord, Interval, SourceBinding, SourceName } from "./types";

/** Human label per source, used for the artifact filename suffix and index headers. */
const SOURCE_LABELS: Record<SourceName, string> = {
	macparakeet: "MacParakeet",
	fellow: "Fellow",
};

/** Stable source order for the index, matching the persisted state's order. */
const SOURCE_ORDER: readonly SourceName[] = ["macparakeet", "fellow"];

/** One file the renderer wants written, with the source timestamp it mirrors. */
export interface RenderedFile {
	/** State key: "index", or a source-scoped artifact key (e.g. "result:fellow:<id>"). */
	key: string;
	path: string;
	content: string;
	sourceUpdatedAt: string;
	/** Owning source; omitted for the shared index note. */
	source?: SourceName;
}

export interface RenderArtifactsInput {
	source: SourceName;
	meeting: MeetingDetail;
	results: AiResult[];
	folderPath: string;
	includeNotes?: boolean;
	includeTranscript?: boolean;
	/** The record's tracked files; a tracked path is reused verbatim (never renamed). */
	existingFiles?: Record<string, FileRecord>;
}

export interface RenderIndexInput {
	folderPath: string;
	title: string;
	interval?: Interval;
	sources: Partial<Record<SourceName, SourceBinding>>;
	/** The record's full files map (all sources); drives the grouped links. */
	files: Record<string, FileRecord>;
	mergeConfidence?: "high" | "low";
}

/** Render one source's artifact files (no index): results, notes, transcript. */
export function renderArtifacts(input: RenderArtifactsInput): RenderedFile[] {
	const { source, meeting, folderPath } = input;
	const existing = input.existingFiles ?? {};
	const files: RenderedFile[] = [];

	const used = new Set<string>();
	for (const result of sortResults(input.results)) {
		const key = resultKey(source, result.id);
		const name = uniqueName(suffixed(sanitizeTitle(result.name), source), result.shortID || result.id, used);
		files.push({
			key,
			source,
			path: pathFor(existing, key, folderPath, name),
			content: renderResult(source, meeting, result),
			sourceUpdatedAt: result.updatedAt,
		});
	}

	if (input.includeNotes && meeting.userNotes.trim().length > 0) {
		const key = notesKey(source);
		files.push({
			key,
			source,
			path: pathFor(existing, key, folderPath, notesName(source)),
			content: renderNotes(source, meeting),
			sourceUpdatedAt: meeting.updatedAt,
		});
	}

	if (input.includeTranscript && meeting.transcript.trim().length > 0) {
		const key = transcriptKey(source);
		files.push({
			key,
			source,
			path: pathFor(existing, key, folderPath, suffixed("Transcript", source)),
			content: renderTranscript(source, meeting),
			sourceUpdatedAt: meeting.updatedAt,
		});
	}

	return files;
}

/** Render the combined index note from the whole record's bindings and files. */
export function renderIndex(input: RenderIndexInput): RenderedFile {
	// The folder note must be named exactly like its folder for folder-note plugin
	// compatibility (PLAN §7) — derive it from the folder, never re-sanitize.
	const indexName = input.folderPath.slice(input.folderPath.lastIndexOf("/") + 1);
	const groups = groupLinks(input.files);
	const present = SOURCE_ORDER.filter((source) => hasLinks(groups[source]));

	const body = [`# ${input.title}`];
	if (present.length > 1) {
		for (const source of present) {
			body.push("", `## ${SOURCE_LABELS[source]}`, ...sourceBullets(groups[source]));
		}
	} else if (present.length === 1 && present[0]) {
		body.push("", ...sourceBullets(groups[present[0]]));
	}

	return {
		key: "index",
		path: `${input.folderPath}/${indexName}.md`,
		content: `${renderFrontmatter(indexFrontmatter(input))}\n${body.join("\n")}\n`,
		sourceUpdatedAt: latestSnapshot(input.sources),
	};
}

// --- Artifact keys (source-scoped; MacParakeet keeps its v1 keys) ----------

function resultKey(source: SourceName, id: string): string {
	return source === "macparakeet" ? `result:${id}` : `result:${source}:${id}`;
}

function transcriptKey(source: SourceName): string {
	return source === "macparakeet" ? "transcript" : `transcript:${source}`;
}

function notesKey(source: SourceName): string {
	return source === "macparakeet" ? "notes" : `notes:${source}`;
}

/** Append the source suffix to an artifact base name. */
function suffixed(base: string, source: SourceName): string {
	return `${base} (${SOURCE_LABELS[source]})`;
}

/** Notes stay unsuffixed for MacParakeet (v1 layout); other sources are suffixed. */
function notesName(source: SourceName): string {
	return source === "macparakeet" ? "Notes" : suffixed("Notes", source);
}

/** Reuse a tracked file's path so plugin-owned files are never renamed. */
function pathFor(
	existing: Record<string, FileRecord>,
	key: string,
	folderPath: string,
	name: string,
): string {
	const tracked = existing[key];
	return tracked ? tracked.path : `${folderPath}/${name}.md`;
}

// --- Index assembly --------------------------------------------------------

interface SourceGroup {
	results: string[];
	notes?: string;
	transcript?: string;
}

/** Bucket the record's files by source and kind, preserving render (insertion) order. */
function groupLinks(files: Record<string, FileRecord>): Partial<Record<SourceName, SourceGroup>> {
	const groups: Partial<Record<SourceName, SourceGroup>> = {};
	for (const [key, record] of Object.entries(files)) {
		if (key === "index") {
			continue;
		}
		const source = record.source ?? "macparakeet";
		const group = (groups[source] ??= { results: [] });
		const name = basename(record.path);
		if (key.startsWith("result")) {
			group.results.push(name);
		} else if (key.startsWith("transcript")) {
			group.transcript = name;
		} else if (key.startsWith("notes")) {
			group.notes = name;
		}
	}
	return groups;
}

function hasLinks(group: SourceGroup | undefined): boolean {
	return group !== undefined && (group.results.length > 0 || group.notes !== undefined || group.transcript !== undefined);
}

/** Bullet lines for one source: results joined, then notes, then transcript. */
function sourceBullets(group: SourceGroup | undefined): string[] {
	if (!group) {
		return [];
	}
	const bullets: string[] = [];
	if (group.results.length > 0) {
		bullets.push(`- ${group.results.map((name) => `[[${name}]]`).join(" · ")}`);
	}
	if (group.notes) {
		bullets.push(`- [[${group.notes}]]`);
	}
	if (group.transcript) {
		bullets.push(`- [[${group.transcript}]]`);
	}
	return bullets;
}

function indexFrontmatter(input: RenderIndexInput): Record<string, string> {
	const fields: Record<string, string> = { type: "meeting" };
	if (input.sources.macparakeet) {
		fields["macparakeet-id"] = input.sources.macparakeet.id;
	}
	if (input.sources.fellow) {
		fields["fellow-id"] = input.sources.fellow.id;
	}
	if (input.interval) {
		fields.date = input.interval.start;
		fields.duration = formatDuration(intervalDurationMs(input.interval));
		fields["interval-start"] = input.interval.start;
		fields["interval-end"] = input.interval.end;
	}
	if (input.mergeConfidence === "low") {
		fields["merge-confidence"] = "low";
	}
	return fields;
}

/** The newest source snapshot timestamp; drives the index mirror update. */
function latestSnapshot(sources: Partial<Record<SourceName, SourceBinding>>): string {
	return Object.values(sources)
		.map((binding) => binding?.snapshot.updatedAt ?? "")
		.sort()
		.pop() ?? "";
}

function intervalDurationMs(interval: Interval): number {
	return Math.max(0, new Date(interval.end).getTime() - new Date(interval.start).getTime());
}

// --- Artifact bodies -------------------------------------------------------

function renderNotes(source: SourceName, meeting: MeetingDetail): string {
	const frontmatter = { [`${source}-id`]: meeting.id, type: "notes" };
	return `${renderFrontmatter(frontmatter)}\n# Notes\n\n${meeting.userNotes.trim()}\n`;
}

function renderTranscript(source: SourceName, meeting: MeetingDetail): string {
	const frontmatter = { [`${source}-id`]: meeting.id, type: "transcript" };
	return `${renderFrontmatter(frontmatter)}\n# Transcript\n\n${meeting.transcript.trim()}\n`;
}

function renderResult(source: SourceName, meeting: MeetingDetail, result: AiResult): string {
	const frontmatter = {
		[`${source}-id`]: meeting.id,
		"result-id": result.id,
		prompt: result.name,
		generated: result.createdAt,
	};
	return `${renderFrontmatter(frontmatter)}\n# ${result.name}\n\n${result.content.trim()}\n`;
}

/** Stable order (oldest first, then id) so file naming never churns across syncs. */
function sortResults(results: AiResult[]): AiResult[] {
	return [...results].sort((a, b) => {
		if (a.createdAt !== b.createdAt) {
			return a.createdAt < b.createdAt ? -1 : 1;
		}
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

/** Render a YAML frontmatter block, quoting values that need it. */
export function renderFrontmatter(fields: Record<string, string>): string {
	const lines = Object.entries(fields).map(([key, value]) => `${key}: ${yamlValue(value)}`);
	return `---\n${lines.join("\n")}\n---\n`;
}

/** A YAML-safe scalar: raw when plainly safe, otherwise a quoted/escaped string. */
function yamlValue(value: string): string {
	if (value.length > 0 && /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/.test(value)) {
		return value;
	}
	return JSON.stringify(value);
}

/** Human duration like "51m" or "1h 23m". */
export function formatDuration(durationMs: number): string {
	const totalMinutes = Math.max(0, Math.round(durationMs / 60000));
	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	}
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function basename(path: string): string {
	const file = path.slice(path.lastIndexOf("/") + 1);
	return file.endsWith(".md") ? file.slice(0, -3) : file;
}
