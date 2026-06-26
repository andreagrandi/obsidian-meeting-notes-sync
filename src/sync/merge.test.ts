import { describe, expect, it } from "vitest";
import { MergeError, mergeMeetings } from "./merge";
import {
	DEFAULT_SETTINGS,
	type MeetingRecord,
	type Settings,
	type SyncStateData,
	type VaultIO,
} from "./types";

class FakeVault implements VaultIO {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();

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
	}
	async rename(fromPath: string, toPath: string): Promise<void> {
		const prefix = `${fromPath}/`;
		for (const key of [...this.files.keys()]) {
			if (key === fromPath || key.startsWith(prefix)) {
				this.files.set(
					`${toPath}${key.slice(fromPath.length)}`,
					this.files.get(key) as string,
				);
				this.files.delete(key);
			}
		}
		for (const folder of [...this.folders]) {
			if (folder === fromPath || folder.startsWith(prefix)) {
				this.folders.delete(folder);
				this.folders.add(`${toPath}${folder.slice(fromPath.length)}`);
			}
		}
	}
	async trash(path: string): Promise<void> {
		const prefix = `${path}/`;
		for (const key of [...this.files.keys()]) {
			if (key === path || key.startsWith(prefix)) {
				this.files.delete(key);
			}
		}
		for (const folder of [...this.folders]) {
			if (folder === path || folder.startsWith(prefix)) {
				this.folders.delete(folder);
			}
		}
	}
}

const MP_FOLDER =
	"Meetings/2026/06 - June/9 - Meeting 22 Jun 2026 at 13-41 - Jun 22nd";
const FELLOW_FOLDER =
	"Meetings/2026/06 - June/10 - Workshop Buy Side Tech - Jun 22nd";
const LATER_FOLDER = "Meetings/2026/06 - June/11 - Daily Sync - Jun 23rd";
const MERGED_FOLDER =
	"Meetings/2026/06 - June/9 - Workshop Buy Side Tech - Jun 22nd";
const RENUMBERED_LATER = "Meetings/2026/06 - June/10 - Daily Sync - Jun 23rd";

function settings(overrides: Partial<Settings> = {}): Settings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

function macparakeetMeeting(): MeetingRecord {
	return {
		folderPath: MP_FOLDER,
		n: 9,
		bucket: "2026/06",
		interval: {
			start: "2026-06-22T13:41:00.000Z",
			end: "2026-06-22T14:30:00.000Z",
		},
		title: "Meeting 22 Jun 2026 at 13-41",
		sources: {
			macparakeet: {
				id: "mp-1",
				snapshot: {
					updatedAt: "2026-06-22T14:30:00.000Z",
					promptResultCount: 2,
				},
			},
		},
		files: {
			index: {
				path: `${MP_FOLDER}/9 - Meeting 22 Jun 2026 at 13-41 - Jun 22nd.md`,
				sourceUpdatedAt: "2026-06-22T14:30:00.000Z",
			},
			"result:r1": {
				path: `${MP_FOLDER}/Summary (MacParakeet).md`,
				sourceUpdatedAt: "2026-06-22T14:00:00.000Z",
				source: "macparakeet",
			},
			"result:r2": {
				path: `${MP_FOLDER}/Action Items & Decisions (MacParakeet).md`,
				sourceUpdatedAt: "2026-06-22T14:00:00.000Z",
				source: "macparakeet",
			},
		},
	};
}

function fellowMeeting(): MeetingRecord {
	return {
		folderPath: FELLOW_FOLDER,
		n: 10,
		bucket: "2026/06",
		interval: {
			start: "2026-06-22T13:40:00.000Z",
			end: "2026-06-22T14:25:00.000Z",
		},
		title: "Workshop Buy Side Tech",
		sources: {
			fellow: {
				id: "fellow-1",
				snapshot: {
					updatedAt: "2026-06-22T14:40:00.000Z",
					promptResultCount: 0,
				},
			},
		},
		files: {
			index: {
				path: `${FELLOW_FOLDER}/10 - Workshop Buy Side Tech - Jun 22nd.md`,
				sourceUpdatedAt: "2026-06-22T14:40:00.000Z",
			},
			"result:fellow:f1": {
				path: `${FELLOW_FOLDER}/Summary (Fellow).md`,
				sourceUpdatedAt: "2026-06-22T14:40:00.000Z",
				source: "fellow",
			},
			"result:fellow:f2": {
				path: `${FELLOW_FOLDER}/Action items (Fellow).md`,
				sourceUpdatedAt: "2026-06-22T14:40:00.000Z",
				source: "fellow",
			},
		},
	};
}

function laterMeeting(): MeetingRecord {
	return {
		folderPath: LATER_FOLDER,
		n: 11,
		bucket: "2026/06",
		interval: {
			start: "2026-06-23T09:00:00.000Z",
			end: "2026-06-23T09:30:00.000Z",
		},
		title: "Daily Sync",
		sources: {
			macparakeet: {
				id: "mp-2",
				snapshot: {
					updatedAt: "2026-06-23T09:30:00.000Z",
					promptResultCount: 1,
				},
			},
		},
		files: {
			index: {
				path: `${LATER_FOLDER}/11 - Daily Sync - Jun 23rd.md`,
				sourceUpdatedAt: "2026-06-23T09:30:00.000Z",
			},
			"result:r3": {
				path: `${LATER_FOLDER}/Summary (MacParakeet).md`,
				sourceUpdatedAt: "2026-06-23T09:30:00.000Z",
				source: "macparakeet",
			},
		},
	};
}

function makeState(
	records: Record<string, MeetingRecord>,
	counter: number,
): SyncStateData {
	return {
		installDate: "2026-06-01",
		counters: { "2026/06": counter },
		meetings: records,
	};
}

function seed(vault: FakeVault, state: SyncStateData): void {
	for (const record of Object.values(state.meetings)) {
		vault.folders.add(record.folderPath);
		for (const file of Object.values(record.files)) {
			vault.files.set(file.path, "seed");
		}
	}
}

function recordOf(state: SyncStateData, key: string): MeetingRecord {
	const record = state.meetings[key];
	if (!record) {
		throw new Error(`missing record ${key}`);
	}
	return record;
}

describe("mergeMeetings", () => {
	it("folds both sources into the survivor folder, keeping the chosen title", async () => {
		const state = makeState(
			{
				"mp-1": macparakeetMeeting(),
				"fellow-1": fellowMeeting(),
				"mp-2": laterMeeting(),
			},
			12,
		);
		const vault = new FakeVault();
		seed(vault, state);

		const result = await mergeMeetings({
			state,
			settings: settings(),
			vault,
			keyA: "mp-1",
			keyB: "fellow-1",
			title: "Workshop Buy Side Tech",
		});

		expect(result.recordKey).toBe("mp-1");
		expect(result.folderPath).toBe(MERGED_FOLDER);

		const merged = recordOf(state, "mp-1");
		expect(state.meetings["fellow-1"]).toBeUndefined();
		expect(merged.n).toBe(9);
		expect(merged.folderPath).toBe(MERGED_FOLDER);
		expect(merged.title).toBe("Workshop Buy Side Tech");
		expect(merged.mergeConfidence).toBe("high");
		expect(merged.sources.macparakeet?.id).toBe("mp-1");
		expect(merged.sources.fellow?.id).toBe("fellow-1");
		expect(merged.interval).toEqual({
			start: "2026-06-22T13:40:00.000Z",
			end: "2026-06-22T14:30:00.000Z",
		});
	});

	it("relocates every artifact into the merged folder and trashes the redundant one", async () => {
		const state = makeState(
			{ "mp-1": macparakeetMeeting(), "fellow-1": fellowMeeting() },
			11,
		);
		const vault = new FakeVault();
		seed(vault, state);

		await mergeMeetings({
			state,
			settings: settings(),
			vault,
			keyA: "mp-1",
			keyB: "fellow-1",
			title: "Workshop Buy Side Tech",
		});

		expect(vault.folders.has(MERGED_FOLDER)).toBe(true);
		expect(vault.folders.has(MP_FOLDER)).toBe(false);
		expect(vault.folders.has(FELLOW_FOLDER)).toBe(false);
		expect(vault.files.has(`${MERGED_FOLDER}/Summary (MacParakeet).md`)).toBe(
			true,
		);
		expect(
			vault.files.has(
				`${MERGED_FOLDER}/Action Items & Decisions (MacParakeet).md`,
			),
		).toBe(true);
		expect(vault.files.has(`${MERGED_FOLDER}/Summary (Fellow).md`)).toBe(true);
		expect(vault.files.has(`${MERGED_FOLDER}/Action items (Fellow).md`)).toBe(
			true,
		);
		expect(vault.files.has(`${FELLOW_FOLDER}/Summary (Fellow).md`)).toBe(false);

		const merged = recordOf(state, "mp-1");
		expect(merged.files["result:fellow:f1"]?.path).toBe(
			`${MERGED_FOLDER}/Summary (Fellow).md`,
		);
		expect(merged.files["result:r1"]?.path).toBe(
			`${MERGED_FOLDER}/Summary (MacParakeet).md`,
		);
		expect(merged.files.index?.path).toBe(
			`${MERGED_FOLDER}/9 - Workshop Buy Side Tech - Jun 22nd.md`,
		);
	});

	it("applies the transcript source preference during manual merge", async () => {
		const macparakeet = macparakeetMeeting();
		macparakeet.files.transcript = {
			path: `${MP_FOLDER}/Transcript (MacParakeet).md`,
			sourceUpdatedAt: "2026-06-22T14:30:00.000Z",
			source: "macparakeet",
		};
		const fellow = fellowMeeting();
		fellow.files["transcript:fellow"] = {
			path: `${FELLOW_FOLDER}/Transcript (Fellow).md`,
			sourceUpdatedAt: "2026-06-22T14:40:00.000Z",
			source: "fellow",
		};
		const state = makeState({ "mp-1": macparakeet, "fellow-1": fellow }, 11);
		const vault = new FakeVault();
		seed(vault, state);

		await mergeMeetings({
			state,
			settings: settings({
				syncTranscript: true,
				transcriptSourcePreference: "fellow",
			}),
			vault,
			keyA: "mp-1",
			keyB: "fellow-1",
			title: "Workshop Buy Side Tech",
		});

		expect(
			vault.files.has(`${MERGED_FOLDER}/Transcript (MacParakeet).md`),
		).toBe(false);
		expect(vault.files.has(`${MERGED_FOLDER}/Transcript (Fellow).md`)).toBe(
			true,
		);
		const merged = recordOf(state, "mp-1");
		expect(merged.files.transcript).toBeUndefined();
		expect(merged.files["transcript:fellow"]?.path).toBe(
			`${MERGED_FOLDER}/Transcript (Fellow).md`,
		);
		const index = vault.files.get(
			`${MERGED_FOLDER}/9 - Workshop Buy Side Tech - Jun 22nd.md`,
		) as string;
		expect(index).not.toContain("[[Transcript (MacParakeet)]]");
		expect(index).toContain("[[Transcript (Fellow)]]");
	});

	it("re-renders the combined index with both sources", async () => {
		const state = makeState(
			{ "mp-1": macparakeetMeeting(), "fellow-1": fellowMeeting() },
			11,
		);
		const vault = new FakeVault();
		seed(vault, state);

		await mergeMeetings({
			state,
			settings: settings(),
			vault,
			keyA: "mp-1",
			keyB: "fellow-1",
			title: "Workshop Buy Side Tech",
		});

		const index = vault.files.get(
			`${MERGED_FOLDER}/9 - Workshop Buy Side Tech - Jun 22nd.md`,
		) as string;
		expect(index).toContain("# Workshop Buy Side Tech");
		expect(index).toContain("## MacParakeet");
		expect(index).toContain("## Fellow");
		expect(index).toContain("macparakeet-id: mp-1");
		expect(index).toContain("fellow-id: fellow-1");
		expect(index).not.toContain("merge-confidence");
	});

	it("renumbers later meetings in the bucket to close the gap", async () => {
		const state = makeState(
			{
				"mp-1": macparakeetMeeting(),
				"fellow-1": fellowMeeting(),
				"mp-2": laterMeeting(),
			},
			12,
		);
		const vault = new FakeVault();
		seed(vault, state);

		const result = await mergeMeetings({
			state,
			settings: settings(),
			vault,
			keyA: "mp-1",
			keyB: "fellow-1",
			title: "Workshop Buy Side Tech",
		});

		expect(result.renumbered).toBe(1);
		const later = recordOf(state, "mp-2");
		expect(later.n).toBe(10);
		expect(later.folderPath).toBe(RENUMBERED_LATER);
		expect(later.files.index?.path).toBe(
			`${RENUMBERED_LATER}/10 - Daily Sync - Jun 23rd.md`,
		);
		expect(state.counters["2026/06"]).toBe(11);
		expect(vault.folders.has(RENUMBERED_LATER)).toBe(true);
		expect(vault.folders.has(LATER_FOLDER)).toBe(false);
		expect(
			vault.files.has(`${RENUMBERED_LATER}/10 - Daily Sync - Jun 23rd.md`),
		).toBe(true);
		expect(
			vault.files.has(`${RENUMBERED_LATER}/Summary (MacParakeet).md`),
		).toBe(true);
	});

	it("leaves no gap when merging the two highest numbers", async () => {
		const state = makeState(
			{ "mp-1": macparakeetMeeting(), "fellow-1": fellowMeeting() },
			11,
		);
		const vault = new FakeVault();
		seed(vault, state);

		const result = await mergeMeetings({
			state,
			settings: settings(),
			vault,
			keyA: "mp-1",
			keyB: "fellow-1",
			title: "Workshop Buy Side Tech",
		});

		expect(result.renumbered).toBe(0);
		expect(state.counters["2026/06"]).toBe(10);
	});

	it("picks the lower-numbered record as survivor regardless of argument order", async () => {
		const state = makeState(
			{ "mp-1": macparakeetMeeting(), "fellow-1": fellowMeeting() },
			11,
		);
		const vault = new FakeVault();
		seed(vault, state);

		const result = await mergeMeetings({
			state,
			settings: settings(),
			vault,
			keyA: "fellow-1",
			keyB: "mp-1",
			title: "Workshop Buy Side Tech",
		});

		expect(result.recordKey).toBe("mp-1");
		expect(state.meetings["fellow-1"]).toBeUndefined();
		expect(state.meetings["mp-1"]?.n).toBe(9);
	});

	it("does not rename the survivor folder when its own title is kept", async () => {
		const state = makeState(
			{ "mp-1": macparakeetMeeting(), "fellow-1": fellowMeeting() },
			11,
		);
		const vault = new FakeVault();
		seed(vault, state);

		await mergeMeetings({
			state,
			settings: settings(),
			vault,
			keyA: "mp-1",
			keyB: "fellow-1",
			title: "Meeting 22 Jun 2026 at 13-41",
		});

		const merged = recordOf(state, "mp-1");
		expect(merged.folderPath).toBe(MP_FOLDER);
		expect(vault.folders.has(MP_FOLDER)).toBe(true);
		expect(vault.files.has(`${MP_FOLDER}/Summary (Fellow).md`)).toBe(true);
		expect(merged.files.index?.path).toBe(
			`${MP_FOLDER}/9 - Meeting 22 Jun 2026 at 13-41 - Jun 22nd.md`,
		);
	});

	it("rejects merging two meetings from the same source", async () => {
		const state = makeState(
			{ "mp-1": macparakeetMeeting(), "mp-2": laterMeeting() },
			12,
		);
		const vault = new FakeVault();
		seed(vault, state);

		await expect(
			mergeMeetings({
				state,
				settings: settings(),
				vault,
				keyA: "mp-1",
				keyB: "mp-2",
				title: "x",
			}),
		).rejects.toBeInstanceOf(MergeError);
	});

	it("rejects merging a meeting with itself", async () => {
		const state = makeState({ "mp-1": macparakeetMeeting() }, 10);
		const vault = new FakeVault();
		seed(vault, state);

		await expect(
			mergeMeetings({
				state,
				settings: settings(),
				vault,
				keyA: "mp-1",
				keyB: "mp-1",
				title: "x",
			}),
		).rejects.toBeInstanceOf(MergeError);
	});
});
