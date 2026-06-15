/**
 * Fellow REST Developer API types and the thin HTTP transport the client talks
 * to. Typed from the real payloads documented in docs/fellow-api-notes.md (#24).
 */

/** One HTTP request the Fellow client issues; method/headers are always set. */
export interface FellowHttpRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

/** Raw HTTP response; the client parses `text` and maps `status` to errors. */
export interface FellowHttpResponse {
	status: number;
	text: string;
}

/**
 * Injectable transport: resolves with the response even on 4xx/5xx (the client
 * maps status codes), and only rejects on a genuine network failure. Backed by
 * Obsidian's `requestUrl` at runtime, faked in tests.
 */
export type FellowHttp = (request: FellowHttpRequest) => Promise<FellowHttpResponse>;

export type FellowErrorKind =
	| "config"
	| "auth"
	| "forbidden"
	| "not-found"
	| "rate-limited"
	| "http"
	| "network"
	| "parse";

/** Typed failure from the Fellow client; `kind` drives user-facing messaging. */
export class FellowError extends Error {
	readonly kind: FellowErrorKind;
	readonly status?: number;

	constructor(kind: FellowErrorKind, message: string, extra?: { status?: number }) {
		super(message);
		this.name = "FellowError";
		this.kind = kind;
		this.status = extra?.status;
	}
}

/** Subdomain + key the client needs for every call; read live from settings. */
export interface FellowConfig {
	subdomain: string;
	apiKey: string;
}

// --- Shared ---------------------------------------------------------------

export interface FellowPaginatedRequestParams {
	cursor?: string | null;
	page_size?: number;
}

export interface FellowPageInfo {
	cursor: string | null;
	page_size: number;
}

export interface FellowPaginatedResponse<T> {
	page_info: FellowPageInfo;
	data: T[];
}

export interface FellowUser {
	id: string;
	email: string;
	full_name: string;
}

export interface FellowWorkspace {
	id: string;
	name: string;
	subdomain: string;
}

export interface FellowMeResponse {
	user: FellowUser;
	workspace: FellowWorkspace;
}

export interface FellowAttendee {
	email: string | null;
}

// --- Notes ----------------------------------------------------------------

export interface NoteFilters {
	event_guid?: string | null;
	created_at_start?: string | null;
	created_at_end?: string | null;
	updated_at_start?: string | null;
	updated_at_end?: string | null;
	channel_id?: string | null;
	title?: string | null;
	event_attendees?: string[] | null;
}

export interface NoteIncludableExpensiveField {
	content_markdown?: boolean;
	event_attendees?: boolean;
}

export interface GetNotesRequest {
	pagination?: FellowPaginatedRequestParams;
	filters?: NoteFilters;
	include?: NoteIncludableExpensiveField;
}

export interface FellowNote {
	id: string;
	created_at: string | null;
	updated_at: string | null;
	title: string | null;
	event_guid: string | null;
	event_start: string | null;
	event_end: string | null;
	event_is_all_day: boolean;
	recording_ids: string[];
	event_attendees: FellowAttendee[] | null;
	content_markdown: string | null;
}

export interface FellowNotesListResponse {
	notes: FellowPaginatedResponse<FellowNote>;
}

export interface FellowNoteResponse {
	note: FellowNote;
}

// --- Recordings -----------------------------------------------------------

export interface RecordingFilters {
	event_guid?: string | null;
	created_at_start?: string | null;
	created_at_end?: string | null;
	updated_at_start?: string | null;
	updated_at_end?: string | null;
	channel_id?: string | null;
	title?: string | null;
}

export interface RecordingIncludableExpensiveField {
	transcript?: boolean;
	ai_notes?: boolean;
}

export interface GetRecordingsRequest {
	pagination?: FellowPaginatedRequestParams;
	filters?: RecordingFilters;
	include?: RecordingIncludableExpensiveField;
	media_url?: { expire_in?: number };
}

export interface FellowTranscriptSegment {
	start: number;
	end: number;
	speaker: string | null;
	text: string;
}

export interface FellowTranscript {
	speech_segments: FellowTranscriptSegment[];
	language_code: string | null;
}

export interface FellowRecapActionItem {
	timestamp: number;
	text: string;
	id: string | null;
	assignees: FellowUser[];
	completion_type: "all" | "any" | null;
	due_date: string | null;
	accepted: boolean;
	status: "Done" | "Archived" | "Incomplete";
}

export interface FellowRecapBulletPoint {
	timestamp: number;
	text: string;
}

export interface FellowRecapTopic {
	title: string;
	bullet_points: FellowRecapBulletPoint[];
}

export interface FellowRecapDecision {
	timestamp: number;
	text: string;
}

export interface FellowRecapKeyMoment {
	timestamp: number;
	text: string;
}

export interface FellowRecapSection {
	title: string;
	type: "STANDARD" | "CUSTOM";
	content:
		| FellowRecapActionItem[]
		| FellowRecapDecision[]
		| FellowRecapTopic[]
		| FellowRecapKeyMoment[]
		| string;
}

export interface FellowRecap {
	id: string;
	is_active: boolean;
	title: string;
	template_creator: string;
	sections: FellowRecapSection[];
}

export interface FellowRecording {
	id: string;
	title: string | null;
	created_at: string | null;
	updated_at: string | null;
	started_at: string;
	ended_at: string | null;
	event_call_url: string | null;
	event_guid: string | null;
	note_id: string | null;
	user_has_calendar_event: boolean | null;
	transcript: FellowTranscript | null;
	ai_notes: FellowRecap[] | null;
	media_url: string | null;
}

export interface FellowRecordingsListResponse {
	recordings: FellowPaginatedResponse<FellowRecording>;
}

export interface FellowRecordingResponse {
	recording: FellowRecording;
}
