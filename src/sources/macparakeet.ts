/** MacParakeet CLI adapter: exposes the existing CLI bridge through the source facade. */

import type { AiResult } from "../cli/types";
import type { CliClient, Settings } from "../sync/types";
import type { SourceAdapter, SourceMeeting, SourceMeetingDetail } from "./types";

export class MacParakeetAdapter implements SourceAdapter {
	readonly source = "macparakeet";

	constructor(private readonly cli: CliClient) {}

	isEnabled(settings: Settings): boolean {
		return settings.sourceMacparakeetEnabled;
	}

	async listMeetings(): Promise<SourceMeeting[]> {
		return (await this.cli.listMeetings()).map(toMeetingStart);
	}

	async showMeeting(id: string): Promise<SourceMeetingDetail> {
		return toMeetingStart(await this.cli.showMeeting(id));
	}

	async listResults(id: string): Promise<AiResult[]> {
		return this.cli.listResults(id);
	}
}

/**
 * MacParakeet stamps `createdAt` when the recording is finalized — i.e. at the
 * END of the meeting — not when it started. The engine treats `createdAt` as the
 * meeting start: it dates the note from it and builds the canonical matching
 * interval as [createdAt, createdAt + durationMs]. Left as-is, every MacParakeet
 * meeting's window lands one full duration too late, which mis-dates notes and
 * can overlap the *next* meeting during cross-source matching. Shift `createdAt`
 * back by the duration so it is the real start (its end stays at the save time).
 */
function toMeetingStart<T extends { createdAt: string; durationMs: number }>(meeting: T): T {
	const end = new Date(meeting.createdAt).getTime();
	if (Number.isNaN(end) || meeting.durationMs <= 0) {
		return meeting;
	}
	return { ...meeting, createdAt: new Date(end - meeting.durationMs).toISOString() };
}
