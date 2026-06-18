/**
 * Source-agnostic facade the sync engine consumes. Each adapter represents one
 * meeting source (MacParakeet CLI, Fellow REST API, …) behind a common shape.
 */

import type { AiResult, MeetingDetail } from "../cli/types";
import type { Settings, SourceName } from "../sync/types";

/** A meeting as seen by the engine, independent of its originating source. */
export interface SourceMeeting {
	id: string;
	title: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	durationMs: number;
	promptResultCount: number;
}

/** Detail fetch result, normalized across sources. */
export type SourceMeetingDetail = MeetingDetail;

/** One enabled source adapter. Disabled adapters are never invoked by the engine. */
export interface SourceAdapter {
	readonly source: SourceName;
	isEnabled(settings: Settings): boolean;
	listMeetings(): Promise<SourceMeeting[]>;
	showMeeting(id: string): Promise<SourceMeetingDetail>;
	listResults(id: string): Promise<AiResult[]>;
}
