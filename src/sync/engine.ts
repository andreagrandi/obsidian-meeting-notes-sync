/**
 * SyncEngine: orchestrate one sync run over every in-scope meeting, with
 * new/changed/skip classification, mirror updates, and strict file ownership.
 */

import type { MeetingSummary } from "../cli/types";
import { joinPath, bucketKey, dateParts, renderTemplate } from "./paths";
import { renderMeeting } from "./renderer";
import { assignNumber, effectiveSyncSince } from "./state";
import type {
	CliClient,
	MeetingRecord,
	Settings,
	SyncOptions,
	SyncStateData,
	SyncSummary,
	VaultIO,
} from "./types";

type Outcome = "created" | "updated" | "unchanged";

export interface SyncEngineDeps {
	cli: CliClient;
	vault: VaultIO;
	getSettings: () => Settings;
	getState: () => SyncStateData;
	persist: () => Promise<void>;
}

export class SyncEngine {
	private readonly cli: CliClient;
	private readonly vault: VaultIO;
	private readonly getSettings: () => Settings;
	private readonly getState: () => SyncStateData;
	private readonly persist: () => Promise<void>;

	constructor(deps: SyncEngineDeps) {
		this.cli = deps.cli;
		this.vault = deps.vault;
		this.getSettings = deps.getSettings;
		this.getState = deps.getState;
		this.persist = deps.persist;
	}

	/** Sync every completed meeting created on/after the sync-since date. */
	async sync(options: SyncOptions = {}): Promise<SyncSummary> {
		const force = options.force ?? false;
		const summary: SyncSummary = { created: 0, updated: 0, unchanged: 0 };

		const meetings = inScope(await this.cli.listMeetings(), this.syncSince());
		for (const meeting of meetings) {
			tally(summary, await this.processMeeting(meeting, force));
		}

		await this.persist();
		return summary;
	}

	private syncSince(): string {
		return effectiveSyncSince(this.getSettings(), this.getState());
	}

	/** Classify one meeting, fetch + render only when new, changed, or forced. */
	private async processMeeting(meeting: MeetingSummary, force: boolean): Promise<Outcome> {
		const state = this.getState();
		const settings = this.getSettings();
		const record = state.meetings[meeting.id];

		if (record && !force && isUnchanged(record, meeting)) {
			return "unchanged";
		}

		const isNew = !record;
		const detail = await this.cli.showMeeting(meeting.id);
		const results = settings.syncResults ? await this.cli.listResults(meeting.id) : [];

		const bucket = record?.bucket ?? bucketKey(meeting.createdAt);
		const n = assignNumber(state, meeting.id, bucket);
		const folderPath =
			record?.folderPath ?? joinPath(settings.baseFolder, renderTemplate(settings.pathTemplate, detail, n));

		const current: MeetingRecord = record ?? {
			folderPath,
			n,
			bucket,
			snapshot: { updatedAt: "", promptResultCount: -1 },
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

		current.snapshot = { updatedAt: meeting.updatedAt, promptResultCount: meeting.promptResultCount };
		state.meetings[meeting.id] = current;

		if (isNew) {
			return "created";
		}
		return wrote > 0 ? "updated" : "unchanged";
	}
}

/** A known meeting is unchanged when both snapshot fields still match. */
export function isUnchanged(record: MeetingRecord, meeting: MeetingSummary): boolean {
	return (
		record.snapshot.updatedAt === meeting.updatedAt &&
		record.snapshot.promptResultCount === meeting.promptResultCount
	);
}

/**
 * Completed meetings created on/after `since`, oldest first for stable
 * numbering. `since` is a calendar date (YYYY-MM-DD), so compare it against the
 * meeting's UTC date rather than its full timestamp to keep the boundary crisp.
 */
export function inScope(meetings: MeetingSummary[], since: string): MeetingSummary[] {
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
