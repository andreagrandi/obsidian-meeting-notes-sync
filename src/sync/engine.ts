/**
 * SyncEngine: orchestrate one sync run over every enabled source, with
 * new/changed/skip classification, cross-source identity resolution, mirror
 * updates, and strict file ownership.
 */

import type { SourceAdapter, SourceMeeting } from "../sources/types";
import { joinPath, bucketKey, renderTemplate, dateParts } from "./paths";
import { renderMeeting } from "./renderer";
import { assignNumber, effectiveSyncSince, intervalFromDuration } from "./state";
import { resolveIdentity, type ResolvableMeeting } from "./identity";
import type {
	MeetingRecord,
	Settings,
	SyncOptions,
	SyncStateData,
	SyncSummary,
	VaultIO,
} from "./types";

type Outcome = "created" | "updated" | "unchanged";

export interface SyncEngineDeps {
	sources: SourceAdapter[];
	vault: VaultIO;
	getSettings: () => Settings;
	getState: () => SyncStateData;
	persist: () => Promise<void>;
}

export class SyncEngine {
	private readonly sources: SourceAdapter[];
	private readonly vault: VaultIO;
	private readonly getSettings: () => Settings;
	private readonly getState: () => SyncStateData;
	private readonly persist: () => Promise<void>;

	constructor(deps: SyncEngineDeps) {
		this.sources = deps.sources;
		this.vault = deps.vault;
		this.getSettings = deps.getSettings;
		this.getState = deps.getState;
		this.persist = deps.persist;
	}

	/** Sync every enabled source. */
	async sync(options: SyncOptions = {}): Promise<SyncSummary> {
		const force = options.force ?? false;
		const summary: SyncSummary = { created: 0, updated: 0, unchanged: 0 };
		const settings = this.getSettings();

		for (const source of this.sources) {
			if (!source.isEnabled(settings)) {
				continue;
			}
			try {
				const meetings = inScope(await source.listMeetings(), this.syncSince());
				for (const meeting of meetings) {
					tally(summary, await this.processMeeting(source, meeting, force));
				}
			} catch (error) {
				console.error(`Meeting Notes Sync: source ${source.source} failed`, error);
			}
		}

		await this.persist();
		return summary;
	}

	private syncSince(): string {
		return effectiveSyncSince(this.getSettings(), this.getState());
	}

	/** Classify one source meeting, fetch + render only when new/changed/forced. */
	private async processMeeting(
		source: SourceAdapter,
		meeting: SourceMeeting,
		force: boolean,
	): Promise<Outcome> {
		const state = this.getState();
		const settings = this.getSettings();

		const resolution = resolveIdentity(toResolvable(source.source, meeting), state, settings);
		const recordKey = resolution.recordKey;
		const record = resolution.existingRecord;

		if (record && !force && isSourceUnchanged(record, source.source, meeting)) {
			// Lazily backfill interval/title for legacy records; state-only change.
			if (!record.interval) {
				record.interval = intervalFromDuration(meeting.createdAt, meeting.durationMs);
			}
			if (!record.title) {
				record.title = meeting.title;
			}
			return "unchanged";
		}

		const isNew = !record;
		const detail = await source.showMeeting(meeting.id);
		const results = settings.syncResults ? await source.listResults(meeting.id) : [];

		const bucket = record?.bucket ?? bucketKey(meeting.createdAt);
		const n = assignNumber(state, recordKey, bucket);
		const folderPath =
			record?.folderPath ?? joinPath(settings.baseFolder, renderTemplate(settings.pathTemplate, detail, n));

		const current: MeetingRecord = record ?? {
			folderPath,
			n,
			bucket,
			sources: {},
			files: {},
		};

		if (isNew) {
			await this.vault.createFolder(folderPath);
		}

		const rendered = renderMeeting({
			meeting: detail,
			results,
			n,
			folderPath,
			includeNotes: settings.syncNotes,
			includeTranscript: settings.syncTranscript,
		});
		const index = rendered.find((file) => file.key === "index");
		const artifacts = rendered.filter((file) => file.key !== "index");

		let wrote = 0;
		for (const file of artifacts) {
			const existing = current.files[file.key];
			const stale =
				force ||
				!existing ||
				existing.sourceUpdatedAt !== file.sourceUpdatedAt ||
				existing.path !== file.path;
			if (stale) {
				await this.vault.write(file.path, file.content);
				current.files[file.key] = { path: file.path, sourceUpdatedAt: file.sourceUpdatedAt };
				wrote += 1;
			}
		}

		if (index) {
			const existing = current.files.index;
			const indexStale =
				force ||
				!existing ||
				existing.sourceUpdatedAt !== index.sourceUpdatedAt ||
				existing.path !== index.path;
			if (isNew || wrote > 0 || indexStale) {
				await this.vault.write(index.path, index.content);
				current.files.index = { path: index.path, sourceUpdatedAt: index.sourceUpdatedAt };
				wrote += 1;
			}
		}

		current.sources[source.source] = {
			id: meeting.id,
			snapshot: { updatedAt: meeting.updatedAt, promptResultCount: meeting.promptResultCount },
		};
		if (!current.interval) {
			current.interval = intervalFromDuration(meeting.createdAt, meeting.durationMs);
		}
		current.title = meeting.title;
		if (resolution.mergeConfidence) {
			current.mergeConfidence = resolution.mergeConfidence;
		}
		state.meetings[recordKey] = current;

		if (isNew) {
			return "created";
		}
		return wrote > 0 ? "updated" : "unchanged";
	}
}

/** A known source binding is unchanged when its snapshot fields still match. */
export function isSourceUnchanged(
	record: MeetingRecord,
	source: SourceAdapter["source"],
	meeting: SourceMeeting,
): boolean {
	const snapshot = record.sources[source]?.snapshot;
	return (
		snapshot !== undefined &&
		snapshot.updatedAt === meeting.updatedAt &&
		snapshot.promptResultCount === meeting.promptResultCount
	);
}

function toResolvable(source: SourceAdapter["source"], meeting: SourceMeeting): ResolvableMeeting {
	return { ...meeting, source };
}

/**
 * Completed meetings created on/after `since`, oldest first for stable
 * numbering. `since` is a calendar date (YYYY-MM-DD), so compare it against the
 * meeting's UTC date rather than its full timestamp to keep the boundary crisp.
 */
export function inScope(meetings: SourceMeeting[], since: string): SourceMeeting[] {
	return meetings
		.filter((meeting) => meeting.status === "completed" && dateParts(meeting.createdAt).date >= since)
		.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

function tally(summary: SyncSummary, outcome: Outcome): void {
	if (outcome === "created") {
		summary.created += 1;
	} else if (outcome === "updated") {
		summary.updated += 1;
	} else {
		summary.unchanged += 1;
	}
}
