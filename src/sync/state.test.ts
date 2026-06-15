import { describe, expect, it } from "vitest";
import {
	assignNumber,
	buildSourceIndex,
	effectiveSyncSince,
	findBySource,
	intervalFromDuration,
	normalizeData,
} from "./state";
import { DEFAULT_SETTINGS, emptyState } from "./types";

describe("normalizeData", () => {
	it("fills defaults when data.json is empty", () => {
		const data = normalizeData(undefined, "2026-06-12");
		expect(data.settings).toEqual(DEFAULT_SETTINGS);
		expect(data.state).toEqual(emptyState("2026-06-12"));
	});

	it("ships every source disabled by default (sources are opt-in)", () => {
		expect(DEFAULT_SETTINGS.sourceMacparakeetEnabled).toBe(false);
		expect(DEFAULT_SETTINGS.sourceFellowEnabled).toBe(false);
	});

	it("round-trips v2 state byte-for-byte (load -> normalize -> save -> load)", () => {
		const original = {
			settings: { ...DEFAULT_SETTINGS, baseFolder: "Notes", syncTranscript: true },
			state: {
				installDate: "2026-01-01",
				counters: { "2026/06": 3 },
				meetings: {
					"m-1": {
						folderPath: "Notes/Meetings/2026/06/2-Standup",
						n: 2,
						bucket: "2026/06",
						interval: { start: "2026-06-12T10:00:00.000Z", end: "2026-06-12T10:47:00.000Z" },
						sources: {
							macparakeet: { id: "m-1", snapshot: { updatedAt: "2026-06-12T10:30:00Z", promptResultCount: 3 } },
						},
						files: { index: { path: "x.md", sourceUpdatedAt: "2026-06-12T10:30:00Z" } },
					},
				},
			},
		};
		const once = normalizeData(original, "2026-06-12");
		expect(once).toEqual(original);
		// Idempotent: a second pass over the normalized shape changes nothing.
		expect(normalizeData(JSON.parse(JSON.stringify(once)), "2026-06-12")).toEqual(once);
	});

	it("migrates a v1 record into a macparakeet source binding, preserving n/bucket/folder/files", () => {
		const v1 = {
			state: {
				installDate: "2026-01-01",
				counters: { "2026/06": 3 },
				meetings: {
					"uuid-1": {
						folderPath: "Meetings/2026/06 - June/2 - Standup",
						n: 2,
						bucket: "2026/06",
						snapshot: { updatedAt: "2026-06-12T10:30:00Z", promptResultCount: 3 },
						files: {
							index: { path: "Meetings/2026/06 - June/2 - Standup/2 - Standup.md", sourceUpdatedAt: "2026-06-12T10:30:00Z" },
							"result:r-1": { path: "Meetings/2026/06 - June/2 - Standup/Summary.md", sourceUpdatedAt: "2026-06-12T10:05:00Z" },
						},
					},
				},
			},
		};
		const record = normalizeData(v1, "2026-06-12").state.meetings["uuid-1"];
		expect(record?.n).toBe(2);
		expect(record?.bucket).toBe("2026/06");
		expect(record?.folderPath).toBe("Meetings/2026/06 - June/2 - Standup");
		expect(record?.files).toEqual(v1.state.meetings["uuid-1"].files);
		expect(record?.sources).toEqual({
			macparakeet: { id: "uuid-1", snapshot: { updatedAt: "2026-06-12T10:30:00Z", promptResultCount: 3 } },
		});
		// Interval is backfilled lazily on the next sync, not during migration.
		expect(record?.interval).toBeUndefined();
	});

	it("re-normalizing a migrated record is idempotent", () => {
		const v1 = {
			state: {
				meetings: {
					"uuid-1": {
						folderPath: "Meetings/2026/06 - June/1 - Sync",
						n: 1,
						bucket: "2026/06",
						snapshot: { updatedAt: "2026-06-12T10:30:00Z", promptResultCount: 0 },
						files: {},
					},
				},
			},
		};
		const first = normalizeData(v1, "2026-06-12");
		const second = normalizeData(JSON.parse(JSON.stringify(first)), "2026-06-12");
		expect(second).toEqual(first);
	});

	it("handles mixed-shape state (v1 and v2 records side by side)", () => {
		const mixed = {
			state: {
				meetings: {
					legacy: {
						folderPath: "f1",
						n: 1,
						bucket: "2026/06",
						snapshot: { updatedAt: "t1", promptResultCount: 1 },
						files: {},
					},
					modern: {
						folderPath: "f2",
						n: 2,
						bucket: "2026/06",
						sources: { macparakeet: { id: "modern", snapshot: { updatedAt: "t2", promptResultCount: 2 } } },
						files: {},
					},
				},
			},
		};
		const meetings = normalizeData(mixed, "2026-06-12").state.meetings;
		expect(meetings.legacy?.sources.macparakeet).toEqual({ id: "legacy", snapshot: { updatedAt: "t1", promptResultCount: 1 } });
		expect(meetings.modern?.sources.macparakeet).toEqual({ id: "modern", snapshot: { updatedAt: "t2", promptResultCount: 2 } });
	});

	it("ignores an unrelated installDate argument when state already has one", () => {
		const data = normalizeData({ state: { installDate: "2025-12-25" } }, "2026-06-12");
		expect(data.state.installDate).toBe("2025-12-25");
	});
});

describe("assignNumber", () => {
	it("assigns 1 then 2 within a fresh bucket and advances the counter", () => {
		const state = emptyState("2026-06-01");
		expect(assignNumber(state, "a", "2026/06")).toBe(1);
		expect(assignNumber(state, "b", "2026/06")).toBe(2);
		expect(state.counters["2026/06"]).toBe(3);
	});

	it("returns a meeting's frozen number without touching the counter", () => {
		const state = emptyState("2026-06-01");
		state.meetings["a"] = {
			folderPath: "x",
			n: 7,
			bucket: "2026/06",
			sources: {},
			files: {},
		};
		state.counters["2026/06"] = 9;
		expect(assignNumber(state, "a", "2026/06")).toBe(7);
		expect(state.counters["2026/06"]).toBe(9);
	});

	it("counts buckets independently", () => {
		const state = emptyState("2026-06-01");
		expect(assignNumber(state, "a", "2026/06")).toBe(1);
		expect(assignNumber(state, "b", "2026/07")).toBe(1);
	});

	it("gives a backfilled older meeting the next free number without renumbering the first", () => {
		const state = emptyState("2026-06-01");
		// A newer meeting is synced first and frozen at n=1.
		const newer = assignNumber(state, "newer", "2026/06");
		state.meetings["newer"] = {
			folderPath: `M/1-newer`,
			n: newer,
			bucket: "2026/06",
			sources: {},
			files: {},
		};
		// Later, an older meeting in the same month is backfilled -> next free number.
		expect(assignNumber(state, "older", "2026/06")).toBe(2);
		// Re-syncing the first meeting keeps its frozen number.
		expect(assignNumber(state, "newer", "2026/06")).toBe(1);
	});
});

describe("effectiveSyncSince", () => {
	it("uses the setting when present", () => {
		const state = emptyState("2026-06-01");
		expect(effectiveSyncSince({ ...DEFAULT_SETTINGS, syncSince: "2026-03-01" }, state)).toBe("2026-03-01");
	});

	it("falls back to the install date when the setting is blank", () => {
		const state = emptyState("2026-06-01");
		expect(effectiveSyncSince({ ...DEFAULT_SETTINGS, syncSince: "" }, state)).toBe("2026-06-01");
	});
});

describe("buildSourceIndex / findBySource", () => {
	it("resolves a source meeting to its record key in O(1), across multiple sources", () => {
		const state = emptyState("2026-06-01");
		state.meetings["rec-1"] = {
			folderPath: "f",
			n: 1,
			bucket: "2026/06",
			sources: {
				macparakeet: { id: "mp-1", snapshot: { updatedAt: "t", promptResultCount: 0 } },
				fellow: { id: "fl-9", snapshot: { updatedAt: "t", promptResultCount: 0 } },
			},
			files: {},
		};
		const index = buildSourceIndex(state);
		expect(findBySource(index, "macparakeet", "mp-1")).toBe("rec-1");
		expect(findBySource(index, "fellow", "fl-9")).toBe("rec-1");
		expect(findBySource(index, "macparakeet", "missing")).toBeUndefined();
	});
});

describe("intervalFromDuration", () => {
	it("derives an ISO interval from a start instant and duration", () => {
		expect(intervalFromDuration("2026-06-12T10:00:00Z", 2820000)).toEqual({
			start: "2026-06-12T10:00:00.000Z",
			end: "2026-06-12T10:47:00.000Z",
		});
	});

	it("clamps negative durations to a zero-length interval", () => {
		expect(intervalFromDuration("2026-06-12T10:00:00Z", -5000)).toEqual({
			start: "2026-06-12T10:00:00.000Z",
			end: "2026-06-12T10:00:00.000Z",
		});
	});
});
