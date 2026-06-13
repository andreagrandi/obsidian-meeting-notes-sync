/**
 * Fellow REST API adapter (stub).
 *
 * Issue #25 will implement the real HTTP client. Until then this adapter is
 * disabled by default and throws a clear error if a user somehow enables it
 * without the completed client.
 */

import type { AiResult, MeetingDetail } from "../cli/types";
import type { Settings } from "../sync/types";
import type { SourceAdapter, SourceMeeting } from "./types";

export class FellowAdapter implements SourceAdapter {
	readonly source = "fellow";

	isEnabled(settings: Settings): boolean {
		return (
			settings.sourceFellowEnabled &&
			settings.fellowSubdomain.trim().length > 0 &&
			settings.fellowApiKey.trim().length > 0
		);
	}

	async listMeetings(): Promise<SourceMeeting[]> {
		throw new Error("Fellow API integration is not implemented yet (tracked in issue #25).");
	}

	async showMeeting(): Promise<MeetingDetail> {
		throw new Error("Fellow API integration is not implemented yet (tracked in issue #25).");
	}

	async listResults(): Promise<AiResult[]> {
		throw new Error("Fellow API integration is not implemented yet (tracked in issue #25).");
	}
}
