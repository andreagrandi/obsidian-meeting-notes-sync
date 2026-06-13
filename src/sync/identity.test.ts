import { describe, expect, it } from "vitest";
import { resolveIdentity, normalizedTitle, normalizedTitleSimilarity } from "./identity";
import type { ResolvableMeeting } from "./identity";
import { emptyState } from "./types";
import type { MeetingRecord, Settings, SyncStateData } from "./types";
import { DEFAULT_SETTINGS } from "./types";

function settings(overrides: Partial<Settings> = {}): Settings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

function meeting(overrides: Partial<ResolvableMeeting> & { id: string }): ResolvableMeeting {
	return {
		source: "fellow",
		title: "Weekly Standup",
		createdAt: "2026-06-12T10:00:00Z",
		updatedAt: "2026-06-12T10:30:00Z",
		durationMs: 2_820_000,
		promptResultCount: 0,
		...overrides,
	};
}

function macparakeetRecord(
	id: string,
	start: string,
	durationMs: number,
	title = "Weekly Standup",
): MeetingRecord {
	const end = new Date(new Date(start).getTime() + durationMs).toISOString();
	return {
		folderPath: `Meetings/2026/06 - June/1 - ${title}`,
		n: 1,
		bucket: "2026/06",
		interval: { start, end },
		title,
		sources: {
			macparakeet: { id, snapshot: { updatedAt: "2026-06-12T10:30:00Z", promptResultCount: 0 } },
		},
		files: {},
	};
}

describe("resolveIdentity", () => {
	it("returns a new record key when no records exist", () => {
		const state = emptyState("2026-06-01");
		const m = meeting({ id: "fl-1" });

		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("fl-1");
		expect(result.existingRecord).toBeUndefined();
		expect(result.mergeConfidence).toBeUndefined();
	});

	it("returns the existing record when the source id is already bound", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 2_820_000);
		// The fellow id is already bound to the same record.
		state.meetings["mp-1"].sources.fellow = { id: "fl-1", snapshot: { updatedAt: "t", promptResultCount: 0 } };

		const m = meeting({ id: "fl-1" });
		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("mp-1");
		expect(result.existingRecord).toBe(state.meetings["mp-1"]);
		expect(result.mergeConfidence).toBeUndefined();
	});

	it("merges by interval overlap when the source id is unbound", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 2_820_000);

		const m = meeting({ id: "fl-1", createdAt: "2026-06-12T10:02:00Z", durationMs: 2_700_000 });
		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("mp-1");
		expect(result.existingRecord).toBe(state.meetings["mp-1"]);
		expect(result.mergeConfidence).toBe("high");
	});

	it("does not merge when overlap is below the fraction threshold", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 2_820_000);

		// Overlaps only the first 3 minutes of a 47-minute meeting.
		const m = meeting({ id: "fl-1", createdAt: "2026-06-12T09:50:00Z", durationMs: 780_000 });
		const result = resolveIdentity(m, state, settings({ overlapThreshold: 0.5 }));

		expect(result.recordKey).toBe("fl-1");
		expect(result.existingRecord).toBeUndefined();
	});

	it("does not merge when overlap is below the minutes floor", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 2_820_000);

		// 100% overlap of a 2-minute meeting with a 47-minute meeting.
		const m = meeting({ id: "fl-1", createdAt: "2026-06-12T10:00:00Z", durationMs: 120_000 });
		const result = resolveIdentity(m, state, settings({ minimumOverlapMinutes: 5 }));

		expect(result.recordKey).toBe("fl-1");
		expect(result.existingRecord).toBeUndefined();
	});

	it("does not merge into a record that already has the same source binding", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 2_820_000);
		// A second MacParakeet meeting overlapping the first; must not merge into mp-1.
		const m: ResolvableMeeting = {
			source: "macparakeet",
			id: "mp-2",
			title: "Weekly Standup",
			createdAt: "2026-06-12T10:05:00Z",
			updatedAt: "2026-06-12T10:30:00Z",
			durationMs: 2_700_000,
			promptResultCount: 0,
		};

		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("mp-2");
		expect(result.existingRecord).toBeUndefined();
	});

	it("keeps back-to-back meetings separate", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 900_000);

		const m = meeting({ id: "fl-1", createdAt: "2026-06-12T10:15:00Z", durationMs: 900_000 });
		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("fl-1");
		expect(result.existingRecord).toBeUndefined();
	});

	it("merges late-start recordings that mostly overlap", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 3_600_000);

		// Starts 20 minutes late but overlaps the remaining 40 minutes.
		const m = meeting({ id: "fl-1", createdAt: "2026-06-12T10:20:00Z", durationMs: 2_400_000 });
		const result = resolveIdentity(m, state, settings({ overlapThreshold: 0.5 }));

		expect(result.recordKey).toBe("mp-1");
		expect(result.mergeConfidence).toBe("high");
	});

	it("uses title similarity to resolve a double-booked slot", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-a"] = macparakeetRecord("mp-a", "2026-06-12T10:00:00Z", 3_600_000, "Sprint Planning");
		state.meetings["mp-b"] = macparakeetRecord("mp-b", "2026-06-12T10:00:00Z", 3_600_000, "Architecture Review");

		const m = meeting({ id: "fl-1", title: "Sprint Planning", createdAt: "2026-06-12T10:00:00Z", durationMs: 3_600_000 });
		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("mp-a");
		expect(result.mergeConfidence).toBe("high");
	});

	it("flags low confidence when two candidates overlap similarly and titles tiebreak", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-a"] = macparakeetRecord("mp-a", "2026-06-12T10:00:00Z", 3_600_000, "Sprint Planning");
		state.meetings["mp-b"] = macparakeetRecord("mp-b", "2026-06-12T10:00:00Z", 3_600_000, "Architecture Review");

		const m = meeting({ id: "fl-1", title: "Different Topic", createdAt: "2026-06-12T10:00:00Z", durationMs: 3_600_000 });
		const result = resolveIdentity(m, state, settings());

		// Both candidates overlap 100%; the tiebreaker picks one but marks it low-confidence.
		expect(["mp-a", "mp-b"]).toContain(result.recordKey);
		expect(result.mergeConfidence).toBe("low");
	});

	it("flags low confidence when the matched title differs strongly", () => {
		const state = emptyState("2026-06-01");
		state.meetings["mp-1"] = macparakeetRecord("mp-1", "2026-06-12T10:00:00Z", 2_820_000, "Weekly Standup");

		const m = meeting({ id: "fl-1", title: "Q3 Roadmap Review", createdAt: "2026-06-12T10:02:00Z", durationMs: 2_700_000 });
		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("mp-1");
		expect(result.mergeConfidence).toBe("low");
	});

	it("works when Fellow arrives first and MacParakeet second", () => {
		const state = emptyState("2026-06-01");
		state.meetings["fl-1"] = {
			folderPath: "Meetings/2026/06 - June/1 - Weekly Standup",
			n: 1,
			bucket: "2026/06",
			interval: { start: "2026-06-12T10:00:00.000Z", end: "2026-06-12T10:47:00.000Z" },
			title: "Weekly Standup",
			sources: {
				fellow: { id: "fl-1", snapshot: { updatedAt: "t", promptResultCount: 0 } },
			},
			files: {},
		};

		const m: ResolvableMeeting = {
			source: "macparakeet",
			id: "mp-1",
			title: "Weekly Standup",
			createdAt: "2026-06-12T10:00:00Z",
			updatedAt: "2026-06-12T10:30:00Z",
			durationMs: 2_820_000,
			promptResultCount: 0,
		};
		const result = resolveIdentity(m, state, settings());

		expect(result.recordKey).toBe("fl-1");
		expect(result.existingRecord).toBe(state.meetings["fl-1"]);
		expect(result.mergeConfidence).toBe("high");
	});
});

describe("normalizedTitle", () => {
	it("lowercases, drops punctuation, and collapses whitespace", () => {
		expect(normalizedTitle("Weekly Standup - June 12!!")).toBe("weekly standup june 12");
	});
});

describe("normalizedTitleSimilarity", () => {
	it("returns 1 for identical normalized titles", () => {
		expect(normalizedTitleSimilarity("Weekly Standup", "weekly standup")).toBe(1);
	});

	it("returns 0 when either title is empty", () => {
		expect(normalizedTitleSimilarity("", "Weekly Standup")).toBe(0);
	});

	it("is high for minor wording differences", () => {
		const similarity = normalizedTitleSimilarity("Weekly Team Standup", "Weekly Standup");
		expect(similarity).toBeGreaterThan(0.5);
	});

	it("is low for unrelated titles", () => {
		const similarity = normalizedTitleSimilarity("Weekly Standup", "Q3 Roadmap Review");
		expect(similarity).toBeLessThan(0.5);
	});
});
