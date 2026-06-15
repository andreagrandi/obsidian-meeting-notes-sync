import { describe, expect, it } from "vitest";
import { FellowClient, type FellowHttp, type FellowRecording } from "../fellow";
import { SyncEngine } from "../sync/engine";
import { DEFAULT_SETTINGS, emptyState, type Settings, type SyncStateData, type VaultIO } from "../sync/types";
import { FellowAdapter } from "./fellow";

const LIST_ROW: FellowRecording = {
	id: "recording_001",
	title: "Weekly Standup",
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

const RECORDING_DETAIL: FellowRecording = {
	...LIST_ROW,
	transcript: {
		speech_segments: [{ start: 0, end: 2, speaker: "Alex", text: "Let's begin." }],
		language_code: "en",
	},
	ai_notes: [
		{
			id: "GENERAL",
			is_active: true,
			title: "GENERAL",
			template_creator: "Fellow",
			sections: [{ title: "Summary", type: "STANDARD", content: "We shipped the release." }],
		},
	],
};

const NOTE = {
	id: "note_001",
	created_at: null,
	updated_at: null,
	title: null,
	event_guid: null,
	event_start: null,
	event_end: null,
	event_is_all_day: false,
	recording_ids: ["recording_001"],
	event_attendees: null,
	content_markdown: "# Talking Points\nShip it.",
};

function json(body: unknown) {
	return { status: 200, text: JSON.stringify(body) };
}

/** Routing transport that counts calls per endpoint. */
function fellowTransport() {
	const counts = { list: 0, recording: 0, note: 0 };
	const http: FellowHttp = async (req) => {
		if (req.url.endsWith("/recordings") && req.method === "POST") {
			counts.list += 1;
			return json({ recordings: { page_info: { cursor: null, page_size: 50 }, data: [LIST_ROW] } });
		}
		if (req.url.includes("/recording/")) {
			counts.recording += 1;
			return json({ recording: RECORDING_DETAIL });
		}
		if (req.url.includes("/note/")) {
			counts.note += 1;
			return json({ note: NOTE });
		}
		throw new Error(`unexpected request: ${req.method} ${req.url}`);
	};
	return { http, counts };
}

class FakeVault implements VaultIO {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	readonly writeLog: string[] = [];
	async folderExists(path: string): Promise<boolean> {
		return this.folders.has(path);
	}
	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}
	async fileExists(path: string): Promise<boolean> {
		return this.files.has(path);
	}
	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
		this.writeLog.push(path);
	}
}

function settings(overrides: Partial<Settings> = {}): Settings {
	return {
		...DEFAULT_SETTINGS,
		syncSince: "2000-01-01",
		sourceMacparakeetEnabled: false,
		sourceFellowEnabled: true,
		fellowSubdomain: "example",
		fellowApiKey: "key-123",
		...overrides,
	};
}

function makeEngine(http: FellowHttp, state: SyncStateData, live: Settings, vault: VaultIO) {
	const client = new FellowClient({ http, getConfig: () => ({ subdomain: live.fellowSubdomain, apiKey: live.fellowApiKey }) });
	const adapter = new FellowAdapter(client, () => live);
	return new SyncEngine({
		sources: [adapter],
		vault,
		getSettings: () => live,
		getState: () => state,
		persist: async () => {},
	});
}

const FOLDER = "Meetings/2026/06 - June/1 - Weekly Standup - Jun 11th";

describe("FellowAdapter — end to end through the engine", () => {
	it("imports a Fellow meeting into the vault layout", async () => {
		const { http, counts } = fellowTransport();
		const vault = new FakeVault();
		const result = await makeEngine(http, emptyState("2026-06-01"), settings({ syncTranscript: true }), vault).sync();

		expect(result).toEqual({ created: 1, updated: 0, unchanged: 0 });
		expect(vault.folders.has(FOLDER)).toBe(true);
		expect(vault.files.has(`${FOLDER}/1 - Weekly Standup - Jun 11th.md`)).toBe(true);
		expect(vault.files.get(`${FOLDER}/Summary (Fellow).md`)).toContain("We shipped the release.");
		expect(vault.files.get(`${FOLDER}/Notes (Fellow).md`)).toContain("Ship it.");
		expect(vault.files.get(`${FOLDER}/Transcript (Fellow).md`)).toContain("**Alex:** Let's begin.");
		// show + results share a single recording fetch.
		expect(counts.recording).toBe(1);
		expect(counts.note).toBe(1);
	});

	it("makes the immediate second sync a no-op with zero writes and zero detail fetches", async () => {
		const { http, counts } = fellowTransport();
		const vault = new FakeVault();
		const state = emptyState("2026-06-01");
		const live = settings();
		const engine = makeEngine(http, state, live, vault);

		await engine.sync();
		vault.writeLog.length = 0;
		const detailFetchesAfterFirst = counts.recording;

		const second = await engine.sync();

		expect(second).toEqual({ created: 0, updated: 0, unchanged: 1 });
		expect(vault.writeLog).toHaveLength(0);
		expect(counts.recording).toBe(detailFetchesAfterFirst);
	});

	it("makes zero Fellow requests when the source is disabled (the default)", async () => {
		const { http, counts } = fellowTransport();
		const vault = new FakeVault();
		// Configured, but the enable flag is off — the engine must never touch it.
		const live = settings({ sourceFellowEnabled: false });

		const result = await makeEngine(http, emptyState("2026-06-01"), live, vault).sync();

		expect(result).toEqual({ created: 0, updated: 0, unchanged: 0 });
		expect(counts).toEqual({ list: 0, recording: 0, note: 0 });
		expect(vault.writeLog).toHaveLength(0);
	});

	it("stays inert when enabled but not yet configured", async () => {
		const { http, counts } = fellowTransport();
		const vault = new FakeVault();
		const live = settings({ fellowApiKey: "" });

		await makeEngine(http, emptyState("2026-06-01"), live, vault).sync();

		expect(counts).toEqual({ list: 0, recording: 0, note: 0 });
	});

	it("does not fetch the linked note when note sync is off", async () => {
		const { http, counts } = fellowTransport();
		const vault = new FakeVault();

		await makeEngine(http, emptyState("2026-06-01"), settings({ syncNotes: false }), vault).sync();

		expect(counts.note).toBe(0);
		expect(vault.files.has(`${FOLDER}/Notes (Fellow).md`)).toBe(false);
	});

	it("reports a revoked/invalid key as a source error with no partial write", async () => {
		const http: FellowHttp = async () => ({ status: 401, text: "" });
		const vault = new FakeVault();

		const result = await makeEngine(http, emptyState("2026-06-01"), settings(), vault).sync();

		expect(result.created).toBe(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors?.[0]?.source).toBe("fellow");
		expect(result.errors?.[0]?.message).toContain("401");
		expect(vault.writeLog).toHaveLength(0);
	});
});

describe("FellowAdapter.isEnabled", () => {
	function adapter() {
		const client = new FellowClient({ http: async () => json({}), getConfig: () => ({ subdomain: "", apiKey: "" }) });
		return new FellowAdapter(client, () => settings());
	}

	it("is enabled only when the flag is on and both fields are set", () => {
		expect(adapter().isEnabled(settings())).toBe(true);
	});

	it("is disabled when the API key is empty, even with the flag on", () => {
		expect(adapter().isEnabled(settings({ fellowApiKey: "" }))).toBe(false);
		expect(adapter().isEnabled(settings({ fellowApiKey: "   " }))).toBe(false);
	});

	it("is disabled when the subdomain is empty", () => {
		expect(adapter().isEnabled(settings({ fellowSubdomain: "" }))).toBe(false);
	});

	it("is disabled when the flag is off", () => {
		expect(adapter().isEnabled(settings({ sourceFellowEnabled: false }))).toBe(false);
	});
});
