import { describe, expect, it } from "vitest";
import type { AiResult, MeetingDetail } from "../cli/types";
import { formatDuration, renderArtifacts, renderFrontmatter, renderIndex } from "./renderer";
import type { FileRecord, Interval, SourceBinding, SourceName } from "./types";

const MEETING: MeetingDetail = {
	id: "550e8400-e29b-41d4-a716-446655440000",
	shortID: "550E8400",
	title: "Weekly Standup",
	status: "completed",
	createdAt: "2026-06-12T10:00:00Z",
	updatedAt: "2026-06-12T10:30:00Z",
	durationMs: 2820000,
	transcript: "Hello there.",
	userNotes: "",
};

const INTERVAL: Interval = { start: "2026-06-12T10:00:00.000Z", end: "2026-06-12T10:47:00.000Z" };

function result(overrides: Partial<AiResult>): AiResult {
	return {
		id: "r-1",
		shortID: "R1",
		name: "Summary",
		content: "A summary.",
		promptContent: "Summarize.",
		createdAt: "2026-06-12T10:05:00Z",
		updatedAt: "2026-06-12T10:05:00Z",
		...overrides,
	};
}

function binding(id: string, updatedAt = MEETING.updatedAt): SourceBinding {
	return { id, snapshot: { updatedAt, promptResultCount: 0 } };
}

/** Build a files map from rendered artifacts, the way the engine persists it. */
function filesOf(...rendered: { key: string; path: string; source?: SourceName }[]): Record<string, FileRecord> {
	const files: Record<string, FileRecord> = {};
	for (const file of rendered) {
		files[file.key] = { path: file.path, sourceUpdatedAt: "x", source: file.source };
	}
	return files;
}

describe("renderArtifacts — MacParakeet", () => {
	it("suffixes new artifacts with the source and scopes their keys", () => {
		const files = renderArtifacts({
			source: "macparakeet",
			meeting: { ...MEETING, userNotes: "remember the demo", transcript: "full transcript" },
			results: [result({ id: "a", name: "Summary" })],
			folderPath: "Meetings/1 - Weekly Standup",
			includeNotes: true,
			includeTranscript: true,
		});

		const byKey = Object.fromEntries(files.map((f) => [f.key, f.path]));
		expect(byKey["result:a"]).toBe("Meetings/1 - Weekly Standup/Summary (MacParakeet).md");
		expect(byKey["transcript"]).toBe("Meetings/1 - Weekly Standup/Transcript (MacParakeet).md");
		// Notes stays unsuffixed for MacParakeet (PLAN §12.4).
		expect(byKey["notes"]).toBe("Meetings/1 - Weekly Standup/Notes.md");
		expect(files.find((f) => f.key === "result:a")?.content).toContain("macparakeet-id: 550e8400-e29b-41d4-a716-446655440000");
	});

	it("reuses a legacy tracked path instead of renaming it", () => {
		const existingFiles = filesOf({ key: "result:a", path: "Meetings/1 - Weekly Standup/Summary.md", source: "macparakeet" });
		const files = renderArtifacts({
			source: "macparakeet",
			meeting: MEETING,
			results: [result({ id: "a", name: "Summary" })],
			folderPath: "Meetings/1 - Weekly Standup",
			existingFiles,
		});
		expect(files.find((f) => f.key === "result:a")?.path).toBe("Meetings/1 - Weekly Standup/Summary.md");
	});
});

describe("renderArtifacts — Fellow", () => {
	it("scopes keys under the source and suffixes every artifact, including notes", () => {
		const files = renderArtifacts({
			source: "fellow",
			meeting: { ...MEETING, userNotes: "fellow notes", transcript: "fellow transcript" },
			results: [result({ id: "f1", name: "Action Items" })],
			folderPath: "Meetings/1 - Weekly Standup",
			includeNotes: true,
			includeTranscript: true,
		});

		const byKey = Object.fromEntries(files.map((f) => [f.key, f.path]));
		expect(byKey["result:fellow:f1"]).toBe("Meetings/1 - Weekly Standup/Action Items (Fellow).md");
		expect(byKey["transcript:fellow"]).toBe("Meetings/1 - Weekly Standup/Transcript (Fellow).md");
		expect(byKey["notes:fellow"]).toBe("Meetings/1 - Weekly Standup/Notes (Fellow).md");
		expect(files.find((f) => f.key === "result:fellow:f1")?.content).toContain("fellow-id: 550e8400-e29b-41d4-a716-446655440000");
	});
});

describe("renderIndex — single source", () => {
	it("renders flat links (no source header) and source-specific frontmatter", () => {
		const summary = renderArtifacts({
			source: "macparakeet",
			meeting: MEETING,
			results: [result({ id: "a", name: "Summary" })],
			folderPath: "Meetings/1 - Weekly Standup",
		});
		const index = renderIndex({
			folderPath: "Meetings/1 - Weekly Standup",
			title: "Weekly Standup",
			interval: INTERVAL,
			sources: { macparakeet: binding("550e8400-e29b-41d4-a716-446655440000") },
			files: filesOf(...summary),
		});

		expect(index.path).toBe("Meetings/1 - Weekly Standup/1 - Weekly Standup.md");
		expect(index.content).toContain("type: meeting");
		expect(index.content).toContain("macparakeet-id: 550e8400-e29b-41d4-a716-446655440000");
		expect(index.content).toContain("duration: 47m");
		expect(index.content).toContain("# Weekly Standup");
		expect(index.content).toContain("[[Summary (MacParakeet)]]");
		expect(index.content).not.toContain("## MacParakeet");
		expect(index.content).not.toContain("fellow-id");
	});

	it("emits an index with no links and no headers when there are no artifacts", () => {
		const index = renderIndex({
			folderPath: "M",
			title: "Empty",
			interval: INTERVAL,
			sources: { macparakeet: binding("m-1") },
			files: {},
		});
		expect(index.content).not.toContain("[[");
		expect(index.content).not.toContain("##");
	});
});

describe("renderIndex — merged meeting", () => {
	it("groups artifacts per source, carries both ids and the interval, flags low confidence", () => {
		const mp = renderArtifacts({
			source: "macparakeet",
			meeting: { ...MEETING, transcript: "mp transcript" },
			results: [result({ id: "a", name: "Summary" })],
			folderPath: "Meetings/4 - Weekly Standup",
			includeTranscript: true,
		});
		const fellow = renderArtifacts({
			source: "fellow",
			meeting: { ...MEETING, id: "rec-1", transcript: "fl transcript" },
			results: [
				result({ id: "rec-1#0.0", name: "Summary", createdAt: "2026-06-12T14:00:00Z" }),
				result({ id: "rec-1#0.1", name: "Action Items", createdAt: "2026-06-12T14:00:00Z" }),
			],
			folderPath: "Meetings/4 - Weekly Standup",
			includeTranscript: true,
		});

		const index = renderIndex({
			folderPath: "Meetings/4 - Weekly Standup",
			title: "Weekly Standup",
			interval: INTERVAL,
			sources: { macparakeet: binding("mp-1"), fellow: binding("rec-1", "2026-06-12T14:00:00Z") },
			files: filesOf(...mp, ...fellow),
			mergeConfidence: "low",
		});

		expect(index.content).toContain("macparakeet-id: mp-1");
		expect(index.content).toContain("fellow-id: rec-1");
		expect(index.content).toContain('interval-start: "2026-06-12T10:00:00.000Z"');
		expect(index.content).toContain("merge-confidence: low");
		// Grouped per source, MacParakeet first.
		expect(index.content).toContain("## MacParakeet");
		expect(index.content).toContain("## Fellow");
		expect(index.content.indexOf("## MacParakeet")).toBeLessThan(index.content.indexOf("## Fellow"));
		expect(index.content).toContain("[[Summary (MacParakeet)]]");
		expect(index.content).toContain("[[Transcript (MacParakeet)]]");
		// Fellow results keep section order: Summary before Action Items.
		expect(index.content).toContain("[[Summary (Fellow)]] · [[Action Items (Fellow)]]");
		// Index mirrors the newest source snapshot.
		expect(index.sourceUpdatedAt).toBe("2026-06-12T14:00:00Z");
	});
});

describe("renderFrontmatter", () => {
	it("quotes values containing YAML-significant characters", () => {
		const block = renderFrontmatter({ prompt: "Notes: the plan #1", id: "x" });
		expect(block).toContain('prompt: "Notes: the plan #1"');
		expect(block).toContain("id: x");
	});
});

describe("formatDuration", () => {
	it("formats sub-hour durations in minutes", () => {
		expect(formatDuration(2820000)).toBe("47m");
	});

	it("formats multi-hour durations as hours and minutes", () => {
		expect(formatDuration(3 * 3600000 + 5 * 60000)).toBe("3h 5m");
	});

	it("drops the minutes when a duration is a whole number of hours", () => {
		expect(formatDuration(2 * 3600000)).toBe("2h");
	});
});
