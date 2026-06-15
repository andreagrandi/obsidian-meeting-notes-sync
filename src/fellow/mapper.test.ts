import { describe, expect, it } from "vitest";
import {
	formatTranscript,
	recordingToDetail,
	recordingToResults,
	recordingToSourceMeeting,
	renderRecapSection,
} from "./mapper";
import type { FellowRecording } from "./types";

function recording(overrides: Partial<FellowRecording> = {}): FellowRecording {
	return {
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
		...overrides,
	};
}

describe("recordingToSourceMeeting", () => {
	it("uses started_at as the interval anchor and updated_at for change detection", () => {
		const meeting = recordingToSourceMeeting(recording());
		expect(meeting).toMatchObject({
			id: "recording_001",
			title: "Example Team Meeting",
			status: "completed",
			createdAt: "2026-06-11T13:03:09.585Z",
			updatedAt: "2026-06-11T13:46:05.809Z",
			promptResultCount: 0,
		});
		// 13:03:09.585 → 13:44:36.481 is ~41m26s.
		expect(meeting.durationMs).toBe(2486896);
	});

	it("marks an in-flight recording (no ended_at) as not completed", () => {
		const meeting = recordingToSourceMeeting(recording({ ended_at: null }));
		expect(meeting.status).toBe("recording");
		expect(meeting.durationMs).toBe(0);
	});
});

describe("recordingToDetail", () => {
	it("maps the transcript and pulls user notes from the linked note", () => {
		const detail = recordingToDetail(
			recording({
				transcript: {
					speech_segments: [
						{ start: 0, end: 2, speaker: "Alex", text: "Hello there." },
						{ start: 2, end: 4, speaker: "Sam", text: "Hi Alex." },
					],
					language_code: "en",
				},
			}),
			{
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
			},
		);

		expect(detail.transcript).toBe("**Alex:** Hello there.\n\n**Sam:** Hi Alex.");
		expect(detail.userNotes).toBe("# Talking Points\nShip it.");
	});

	it("leaves user notes empty when no note is supplied", () => {
		const detail = recordingToDetail(recording(), null);
		expect(detail.userNotes).toBe("");
	});
});

describe("recordingToResults", () => {
	it("emits one result per non-empty recap section, in order", () => {
		const results = recordingToResults(
			recording({
				ai_notes: [
					{
						id: "GENERAL",
						is_active: true,
						title: "GENERAL",
						template_creator: "Fellow",
						sections: [
							{ title: "Summary", type: "STANDARD", content: "The team shipped the release." },
							{
								title: "Action items",
								type: "STANDARD",
								content: [
									{
										timestamp: 1,
										text: "Write the changelog",
										id: "a1",
										assignees: [{ id: "u1", email: "u@x.com", full_name: "Example User" }],
										completion_type: "all",
										due_date: null,
										accepted: false,
										status: "Incomplete",
									},
								],
							},
							// Empty section is dropped.
							{ title: "Decisions", type: "STANDARD", content: [] },
						],
					},
				],
			}),
		);

		expect(results.map((r) => r.name)).toEqual(["Summary", "Action items"]);
		expect(results[0]?.id).toBe("recording_001#0.0");
		expect(results[0]?.content).toBe("The team shipped the release.");
		expect(results[1]?.content).toBe("- [ ] Write the changelog (Example User)");
		expect(results[0]?.updatedAt).toBe("2026-06-11T13:46:05.809Z");
	});

	it("skips inactive recaps", () => {
		const results = recordingToResults(
			recording({
				ai_notes: [
					{
						id: "OLD",
						is_active: false,
						title: "OLD",
						template_creator: "Fellow",
						sections: [{ title: "Summary", type: "STANDARD", content: "stale" }],
					},
				],
			}),
		);
		expect(results).toHaveLength(0);
	});
});

describe("renderRecapSection", () => {
	it("renders topics as headings with bullet points", () => {
		const md = renderRecapSection({
			title: "Topics",
			type: "STANDARD",
			content: [
				{ title: "Release", bullet_points: [{ timestamp: 1, text: "Ship Friday" }] },
			],
		});
		expect(md).toBe("### Release\n- Ship Friday");
	});

	it("checks off completed action items", () => {
		const md = renderRecapSection({
			title: "Action items",
			type: "STANDARD",
			content: [
				{
					timestamp: 1,
					text: "Done thing",
					id: "a1",
					assignees: [],
					completion_type: "all",
					due_date: null,
					accepted: true,
					status: "Done",
				},
			],
		});
		expect(md).toBe("- [x] Done thing");
	});

	it("renders decisions as a plain bullet list", () => {
		const md = renderRecapSection({
			title: "Decisions",
			type: "STANDARD",
			content: [{ timestamp: 1, text: "Adopt the new plan" }],
		});
		expect(md).toBe("- Adopt the new plan");
	});
});

describe("formatTranscript", () => {
	it("returns an empty string when there is no transcript", () => {
		expect(formatTranscript(null)).toBe("");
	});

	it("omits the speaker prefix for unattributed segments", () => {
		expect(
			formatTranscript({ speech_segments: [{ start: 0, end: 1, speaker: null, text: "Anon line." }], language_code: "en" }),
		).toBe("Anon line.");
	});
});
