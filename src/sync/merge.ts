/**
 * Manual cross-source merge: fold two duplicate meeting records (one per source)
 * into one folder, trash the redundant one, and renumber the rest of the month
 * so numbers stay contiguous. Obsidian-free so it unit-tests with a fake vault.
 *
 * Numbering is otherwise frozen (see state.ts); this is the one place a record's
 * `n` changes after assignment, and only through an explicit user action.
 */

import { joinPath, renderTemplate } from "./paths";
import { renderIndex } from "./renderer";
import type { Interval, MeetingRecord, Settings, SyncStateData, VaultIO } from "./types";

/** The sources a record can bind, in stable order. */
const SOURCE_NAMES = ["macparakeet", "fellow"] as const;

/** A merge that cannot proceed; the caller surfaces the message as a Notice. */
export class MergeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MergeError";
	}
}

export interface MergeMeetingsDeps {
	state: SyncStateData;
	settings: Settings;
	vault: VaultIO;
	/** meetings-map keys of the two records to merge. */
	keyA: string;
	keyB: string;
	/** Title the merged meeting keeps (drives the folder name + index heading). */
	title: string;
}

export interface MergeResult {
	/** Surviving meetings-map key (the lower-numbered record). */
	recordKey: string;
	/** Final folder path of the merged meeting. */
	folderPath: string;
	/** How many later meetings in the bucket were shifted down to close the gap. */
	renumbered: number;
}

/**
 * Merge `keyB` into `keyA` (or vice-versa): the lower-numbered record survives,
 * the other is absorbed and trashed. Mutates `state`; the caller persists.
 */
export async function mergeMeetings(deps: MergeMeetingsDeps): Promise<MergeResult> {
	const { state, settings, vault, keyA, keyB, title } = deps;

	if (keyA === keyB) {
		throw new MergeError("Select two different meetings to merge.");
	}
	const a = state.meetings[keyA];
	const b = state.meetings[keyB];
	if (!a || !b) {
		throw new MergeError("One of the selected meetings no longer exists.");
	}
	if (sourcesOverlap(a, b)) {
		throw new MergeError(
			"Those meetings share a source; only cross-source duplicates (one MacParakeet + one Fellow) can be merged.",
		);
	}

	// The lower number survives; the other is absorbed and its number is freed.
	const survivorIsA = a.n <= b.n;
	const survivorKey = survivorIsA ? keyA : keyB;
	const absorbedKey = survivorIsA ? keyB : keyA;
	const survivor = survivorIsA ? a : b;
	const absorbed = survivorIsA ? b : a;
	const freed = absorbed.n;

	const createdAt = survivor.interval?.start ?? absorbed.interval?.start;
	if (!createdAt) {
		throw new MergeError("The surviving meeting has no date on record; cannot rebuild its folder.");
	}

	// 1. Rename the survivor's folder if the chosen title changes its leaf name.
	const newFolder = joinPath(
		settings.baseFolder,
		renderTemplate(settings.pathTemplate, { createdAt, title }, survivor.n),
	);
	await relocateRecordFolder(vault, survivor, newFolder);

	// 2. Move the absorbed record's artifacts into the survivor folder. Names are
	// source-suffixed and the sources are disjoint, so nothing collides.
	for (const [key, file] of Object.entries(absorbed.files)) {
		if (key === "index") {
			continue; // trashed with the absorbed folder below
		}
		const dest = `${newFolder}/${basename(file.path)}`;
		await vault.rename(file.path, dest);
		survivor.files[key] = { ...file, path: dest };
	}

	// 3. Merge bindings + metadata into the survivor.
	survivor.sources = { ...survivor.sources, ...absorbed.sources };
	survivor.title = title;
	survivor.interval = unionInterval(survivor.interval, absorbed.interval);
	survivor.mergeConfidence = "high"; // a manual merge is authoritative

	// 4. Trash the absorbed folder (leftover index + now-empty folder) and drop it.
	await vault.trash(absorbed.folderPath);
	delete state.meetings[absorbedKey];

	// 5. Re-render the combined index so it links both sources' artifacts.
	const index = renderIndex({
		folderPath: newFolder,
		title: survivor.title,
		interval: survivor.interval,
		sources: survivor.sources,
		files: survivor.files,
		mergeConfidence: survivor.mergeConfidence,
	});
	await vault.write(index.path, index.content);
	survivor.files.index = { path: index.path, sourceUpdatedAt: index.sourceUpdatedAt };

	// 6. Renumber the tail so the freed number is reclaimed.
	const renumbered = await renumberAfterMerge(state, settings, vault, survivor.bucket, freed);

	return { recordKey: survivorKey, folderPath: newFolder, renumbered };
}

/**
 * Shift every later meeting in `bucket` (n > freed) down by one so numbering
 * stays contiguous, then reset the bucket counter to the next free number.
 * Processed in ascending order so each target slot is already vacated.
 */
async function renumberAfterMerge(
	state: SyncStateData,
	settings: Settings,
	vault: VaultIO,
	bucket: string,
	freed: number,
): Promise<number> {
	const affected = Object.values(state.meetings)
		.filter((record) => record.bucket === bucket && record.n > freed)
		.sort((a, b) => a.n - b.n);

	for (const record of affected) {
		record.n -= 1;
		await relocateRecordFolder(vault, record, renumberedFolder(settings, record));
	}

	// Reset the counter to the next free number for the (now contiguous) bucket.
	const maxN = Object.values(state.meetings)
		.filter((record) => record.bucket === bucket)
		.reduce((max, record) => Math.max(max, record.n), 0);
	state.counters[bucket] = maxN + 1;

	return affected.length;
}

/** The folder a record should live in after its `n` changed. */
function renumberedFolder(settings: Settings, record: MeetingRecord): string {
	const createdAt = record.interval?.start;
	if (!createdAt) {
		// No date to re-render the template; rewrite just the leading "<n> -" of the leaf.
		return record.folderPath.replace(/(^|\/)(\d+)( - )/, (_match, sep: string, _n, sep2: string) => `${sep}${record.n}${sep2}`);
	}
	return joinPath(
		settings.baseFolder,
		renderTemplate(settings.pathTemplate, { createdAt, title: record.title ?? "" }, record.n),
	);
}

/**
 * Move a record's folder to `newFolder`, reparenting all tracked file paths and
 * renaming the folder-note so its filename keeps mirroring the folder name.
 */
async function relocateRecordFolder(vault: VaultIO, record: MeetingRecord, newFolder: string): Promise<void> {
	const oldFolder = record.folderPath;
	if (oldFolder === newFolder) {
		return;
	}
	await vault.rename(oldFolder, newFolder);
	for (const file of Object.values(record.files)) {
		file.path = reparent(file.path, oldFolder, newFolder);
	}
	// The folder note must be named exactly like its folder (folder-note plugins).
	const index = record.files.index;
	if (index) {
		const desired = `${newFolder}/${basename(newFolder)}.md`;
		if (index.path !== desired) {
			await vault.rename(index.path, desired);
			index.path = desired;
		}
	}
	record.folderPath = newFolder;
}

/** True when both records bind the same source (cannot be merged). */
function sourcesOverlap(a: MeetingRecord, b: MeetingRecord): boolean {
	return SOURCE_NAMES.some((name) => a.sources[name] !== undefined && b.sources[name] !== undefined);
}

/** Smallest interval covering both; either side may be missing. */
function unionInterval(a?: Interval, b?: Interval): Interval | undefined {
	if (!a) {
		return b;
	}
	if (!b) {
		return a;
	}
	return {
		start: a.start < b.start ? a.start : b.start,
		end: a.end > b.end ? a.end : b.end,
	};
}

/** Swap the `oldFolder` prefix of a path for `newFolder`; unrelated paths pass through. */
function reparent(path: string, oldFolder: string, newFolder: string): string {
	if (path === oldFolder) {
		return newFolder;
	}
	if (path.startsWith(`${oldFolder}/`)) {
		return `${newFolder}${path.slice(oldFolder.length)}`;
	}
	return path;
}

/** The last path segment (file name with extension, or folder leaf). */
function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
