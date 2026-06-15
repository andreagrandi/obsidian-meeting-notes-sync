/**
 * FellowClient: pure-HTTP adapter for the Fellow REST Developer API, behind the
 * same kind of injectable transport the CLI bridge uses. Maps HTTP status codes
 * to a typed error taxonomy and walks cursor pagination sequentially.
 */

import {
	FellowError,
	type FellowConfig,
	type FellowHttp,
	type FellowMeResponse,
	type FellowNote,
	type FellowNoteResponse,
	type FellowRecording,
	type FellowRecordingResponse,
	type FellowRecordingsListResponse,
	type GetRecordingsRequest,
	type RecordingFilters,
} from "./types";

/** Page size for list calls; the API caps this at 50. */
export const FELLOW_PAGE_SIZE = 50;

/** Hard stop so a malformed cursor loop can never spin forever (10k req/day cap). */
const MAX_PAGES = 200;

export interface FellowClientDeps {
	http: FellowHttp;
	/** Live subdomain + key; read per call so settings changes take effect at once. */
	getConfig: () => FellowConfig;
}

export interface ListRecordingsOptions {
	/** ISO 8601 lower bound for `updated_at`; the incremental-sync watermark. */
	updatedAtStart?: string;
}

/** Talks to one Fellow workspace, mapping failures to FellowError. */
export class FellowClient {
	private readonly http: FellowHttp;
	private readonly getConfig: () => FellowConfig;

	constructor(deps: FellowClientDeps) {
		this.http = deps.http;
		this.getConfig = deps.getConfig;
	}

	/** Validate auth and read the workspace identity — backs the health check. */
	async me(): Promise<FellowMeResponse> {
		const data = await this.request("me", "GET");
		const me = data as FellowMeResponse;
		if (!me || typeof me !== "object" || typeof me.workspace?.subdomain !== "string") {
			throw new FellowError("parse", "Fellow /me returned an unexpected shape.");
		}
		return me;
	}

	/**
	 * List recordings (the primary enumeration object, per the spike), walking
	 * cursor pagination. No expensive includes: change detection only needs the
	 * base fields, and transcripts/recaps are fetched per meeting on change.
	 */
	async listRecordings(options: ListRecordingsOptions = {}): Promise<FellowRecording[]> {
		const filters: RecordingFilters = {};
		if (options.updatedAtStart) {
			filters.updated_at_start = options.updatedAtStart;
		}

		const recordings: FellowRecording[] = [];
		let cursor: string | null = null;
		for (let page = 0; page < MAX_PAGES; page += 1) {
			const requestBody: GetRecordingsRequest = {
				pagination: { cursor, page_size: FELLOW_PAGE_SIZE },
				filters,
			};
			const data = await this.request("recordings", "POST", requestBody);
			const body = data as FellowRecordingsListResponse;
			const page_info = body?.recordings?.page_info;
			const rows = body?.recordings?.data;
			if (!Array.isArray(rows) || !page_info) {
				throw new FellowError("parse", "Fellow /recordings returned an unexpected shape.");
			}
			recordings.push(...rows);
			cursor = page_info.cursor;
			if (!cursor) {
				return recordings;
			}
		}
		throw new FellowError("parse", "Fellow /recordings pagination did not terminate.");
	}

	/** Fetch one recording's detail; transcript + ai_notes are returned by default. */
	async getRecording(id: string): Promise<FellowRecording> {
		const data = await this.request(`recording/${encodeURIComponent(id)}`, "GET");
		const recording = (data as FellowRecordingResponse)?.recording;
		if (!recording || typeof recording.id !== "string") {
			throw new FellowError("parse", "Fellow recording detail returned an unexpected shape.");
		}
		return recording;
	}

	/** Fetch one note's detail (its `content_markdown` is the user's manual notes). */
	async getNote(id: string): Promise<FellowNote> {
		const data = await this.request(`note/${encodeURIComponent(id)}`, "GET");
		const note = (data as FellowNoteResponse)?.note;
		if (!note || typeof note.id !== "string") {
			throw new FellowError("parse", "Fellow note detail returned an unexpected shape.");
		}
		return note;
	}

	/** Issue one request, then map config/network/status/parse failures to FellowError. */
	private async request(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
		const { subdomain, apiKey } = this.getConfig();
		const cleanSubdomain = subdomain.trim();
		const cleanKey = apiKey.trim();
		if (!cleanSubdomain || !cleanKey) {
			throw new FellowError("config", "Fellow subdomain and API key are not configured.");
		}

		const headers: Record<string, string> = {
			"X-API-KEY": cleanKey,
			Accept: "application/json",
		};
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}

		let response;
		try {
			response = await this.http({
				url: `https://${cleanSubdomain}.fellow.app/api/v1/${path}`,
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		} catch (error) {
			throw new FellowError("network", `Could not reach Fellow: ${messageOf(error)}`);
		}

		if (response.status < 200 || response.status >= 300) {
			throw statusError(response.status);
		}

		const text = response.text.trim();
		if (text.length === 0) {
			throw new FellowError("parse", "Fellow returned an empty response body.");
		}
		try {
			return JSON.parse(text);
		} catch {
			throw new FellowError("parse", "Fellow returned a response that was not valid JSON.");
		}
	}
}

/** Map a non-2xx status to a typed, user-meaningful error. */
function statusError(status: number): FellowError {
	switch (status) {
		case 401:
			return new FellowError("auth", "Fellow rejected the API key (401). Check the key in settings.", {
				status,
			});
		case 403:
			return new FellowError(
				"forbidden",
				"Fellow denied access (403). The workspace API may be disabled, or the key lacks permission.",
				{ status },
			);
		case 404:
			return new FellowError("not-found", "Fellow returned 404. Check the workspace subdomain.", { status });
		case 429:
			return new FellowError("rate-limited", "Fellow rate limit reached (429). Try again shortly.", {
				status,
			});
		default:
			return new FellowError("http", `Fellow request failed with HTTP ${status}.`, { status });
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
