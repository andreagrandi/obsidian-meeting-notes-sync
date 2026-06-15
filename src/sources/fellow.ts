/**
 * Fellow REST API adapter: exposes the Fellow client through the source facade.
 *
 * Opt-in from the first commit (PLAN §12.5): disabled unless the source is
 * enabled *and* configured. The engine never invokes a disabled adapter, so a
 * sync with Fellow off makes zero requests, zero writes, zero notices.
 */

import type { AiResult, MeetingDetail } from "../cli/types";
import type { Settings } from "../sync/types";
import {
	type FellowClient,
	type FellowRecording,
	recordingToDetail,
	recordingToResults,
	recordingToSourceMeeting,
} from "../fellow";
import type { SourceAdapter, SourceMeeting } from "./types";

export class FellowAdapter implements SourceAdapter {
	readonly source = "fellow";

	/** Last recording detail fetched, reused across the show/results pair for one meeting. */
	private cached: { id: string; recording: FellowRecording } | null = null;

	constructor(
		private readonly client: FellowClient,
		private readonly getSettings: () => Settings,
	) {}

	isEnabled(settings: Settings): boolean {
		return (
			settings.sourceFellowEnabled &&
			settings.fellowSubdomain.trim().length > 0 &&
			settings.fellowApiKey.trim().length > 0
		);
	}

	async listMeetings(): Promise<SourceMeeting[]> {
		const recordings = await this.client.listRecordings({ updatedAtStart: this.updatedAtStart() });
		return recordings.map(recordingToSourceMeeting);
	}

	async showMeeting(id: string): Promise<MeetingDetail> {
		const recording = await this.recording(id);
		const noteId = recording.note_id;
		const note = this.getSettings().syncNotes && noteId ? await this.client.getNote(noteId) : null;
		return recordingToDetail(recording, note);
	}

	async listResults(id: string): Promise<AiResult[]> {
		const recording = await this.recording(id);
		return recordingToResults(recording);
	}

	/** Fetch a recording's detail, serving the show/results pair from one call. */
	private async recording(id: string): Promise<FellowRecording> {
		if (this.cached?.id === id) {
			return this.cached.recording;
		}
		const recording = await this.client.getRecording(id);
		this.cached = { id, recording };
		return recording;
	}

	/** ISO lower bound for `updated_at`, from the configured sync-since date. */
	private updatedAtStart(): string | undefined {
		const since = this.getSettings().syncSince.trim();
		return since ? `${since}T00:00:00Z` : undefined;
	}
}
