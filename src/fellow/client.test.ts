import { describe, expect, it } from "vitest";
import { FellowClient, type FellowClientDeps } from "./client";
import {
	FellowError,
	type FellowConfig,
	type FellowHttp,
	type FellowHttpRequest,
	type FellowHttpResponse,
} from "./types";

const CONFIG: FellowConfig = { subdomain: "example", apiKey: "key-123" };

function jsonResponse(status: number, body: unknown): FellowHttpResponse {
	return { status, text: JSON.stringify(body) };
}

/** Transport that records every request and replies from a handler map. */
function recordingTransport(handler: (req: FellowHttpRequest) => FellowHttpResponse): {
	http: FellowHttp;
	calls: FellowHttpRequest[];
} {
	const calls: FellowHttpRequest[] = [];
	const http: FellowHttp = async (req) => {
		calls.push(req);
		return handler(req);
	};
	return { http, calls };
}

function makeClient(http: FellowHttp, config: FellowConfig = CONFIG): FellowClient {
	const deps: FellowClientDeps = { http, getConfig: () => config };
	return new FellowClient(deps);
}

const RECORDING = {
	id: "recording_001",
	title: "Example Team Meeting",
	created_at: "2026-06-11T12:41:12.874Z",
	updated_at: "2026-06-11T13:46:05.809Z",
	started_at: "2026-06-11T13:03:09.585Z",
	ended_at: "2026-06-11T13:44:36.481Z",
	event_call_url: null,
	event_guid: "guid_001",
	note_id: "note_001",
	user_has_calendar_event: true,
	transcript: null,
	ai_notes: null,
	media_url: null,
};

describe("FellowClient.me", () => {
	it("returns the workspace identity and sends the API key header", async () => {
		const { http, calls } = recordingTransport(() =>
			jsonResponse(200, {
				user: { id: "u1", email: "u@example.com", full_name: "Example User" },
				workspace: { id: "w1", name: "Example", subdomain: "example" },
			}),
		);
		const me = await makeClient(http).me();

		expect(me.workspace.subdomain).toBe("example");
		expect(calls[0]?.url).toBe("https://example.fellow.app/api/v1/me");
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.headers["X-API-KEY"]).toBe("key-123");
	});
});

describe("FellowClient.listRecordings", () => {
	it("walks cursor pagination until the cursor is null", async () => {
		const { http, calls } = recordingTransport((req) => {
			const body = JSON.parse(req.body ?? "{}") as { pagination?: { cursor?: string | null } };
			if (!body.pagination?.cursor) {
				return jsonResponse(200, {
					recordings: { page_info: { cursor: "next", page_size: 50 }, data: [RECORDING] },
				});
			}
			return jsonResponse(200, {
				recordings: { page_info: { cursor: null, page_size: 50 }, data: [{ ...RECORDING, id: "recording_002" }] },
			});
		});

		const recordings = await makeClient(http).listRecordings();

		expect(recordings.map((r) => r.id)).toEqual(["recording_001", "recording_002"]);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toBe("https://example.fellow.app/api/v1/recordings");
	});

	it("passes the updated_at watermark as a filter", async () => {
		const { http, calls } = recordingTransport(() =>
			jsonResponse(200, { recordings: { page_info: { cursor: null, page_size: 50 }, data: [] } }),
		);

		await makeClient(http).listRecordings({ updatedAtStart: "2026-06-01T00:00:00Z" });

		const body = JSON.parse(calls[0]?.body ?? "{}") as { filters?: { updated_at_start?: string } };
		expect(body.filters?.updated_at_start).toBe("2026-06-01T00:00:00Z");
	});

	it("throws a parse error when the payload shape is wrong", async () => {
		const { http } = recordingTransport(() => jsonResponse(200, { recordings: {} }));
		await expect(makeClient(http).listRecordings()).rejects.toMatchObject({ kind: "parse" });
	});
});

describe("FellowClient.getRecording / getNote", () => {
	it("unwraps the recording detail envelope", async () => {
		const { http, calls } = recordingTransport(() => jsonResponse(200, { recording: RECORDING }));
		const recording = await makeClient(http).getRecording("recording_001");

		expect(recording.id).toBe("recording_001");
		expect(calls[0]?.url).toBe("https://example.fellow.app/api/v1/recording/recording_001");
	});

	it("unwraps the note detail envelope", async () => {
		const { http, calls } = recordingTransport(() =>
			jsonResponse(200, { note: { id: "note_001", content_markdown: "# Notes" } }),
		);
		const note = await makeClient(http).getNote("note_001");

		expect(note.content_markdown).toBe("# Notes");
		expect(calls[0]?.url).toBe("https://example.fellow.app/api/v1/note/note_001");
	});
});

describe("FellowClient error mapping", () => {
	it("does not call the transport when subdomain or key is missing", async () => {
		const { http, calls } = recordingTransport(() => jsonResponse(200, {}));
		const client = makeClient(http, { subdomain: "example", apiKey: "  " });

		await expect(client.me()).rejects.toMatchObject({ kind: "config" });
		expect(calls).toHaveLength(0);
	});

	it.each([
		[401, "auth"],
		[403, "forbidden"],
		[404, "not-found"],
		[429, "rate-limited"],
		[500, "http"],
	])("maps HTTP %i to a %s error", async (status, kind) => {
		const { http } = recordingTransport(() => ({ status, text: "" }));
		let error: FellowError | undefined;
		try {
			await makeClient(http).me();
		} catch (caught) {
			error = caught as FellowError;
		}
		expect(error).toBeInstanceOf(FellowError);
		expect(error?.kind).toBe(kind);
		expect(error?.status).toBe(status);
	});

	it("maps a transport rejection to a network error", async () => {
		const http: FellowHttp = async () => {
			throw new Error("getaddrinfo ENOTFOUND");
		};
		await expect(makeClient(http).me()).rejects.toMatchObject({ kind: "network" });
	});

	it("maps invalid JSON to a parse error", async () => {
		const { http } = recordingTransport(() => ({ status: 200, text: "not json" }));
		await expect(makeClient(http).me()).rejects.toMatchObject({ kind: "parse" });
	});

	it("maps an empty body to a parse error", async () => {
		const { http } = recordingTransport(() => ({ status: 200, text: "" }));
		await expect(makeClient(http).me()).rejects.toMatchObject({ kind: "parse" });
	});
});
