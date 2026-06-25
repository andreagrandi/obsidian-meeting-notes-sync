import { describe, expect, it } from "vitest";
import { MacParakeetAdapter } from "./macparakeet";
import type { AiResult, MeetingDetail, MeetingSummary } from "../cli/types";
import type { CliClient } from "../sync/types";

function summary(overrides: Partial<MeetingSummary> = {}): MeetingSummary {
	return {
		id: "mp-1",
		shortID: "",
		title: "Andrea / James - 1-1",
		status: "completed",
		// MacParakeet stamps createdAt at the END of the recording (save time).
		createdAt: "2026-06-25T08:37:31Z",
		updatedAt: "2026-06-25T08:37:49Z",
		durationMs: 1_946_879,
		hasNotes: false,
		promptResultCount: 3,
		...overrides,
	};
}

function detail(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
	return {
		id: "mp-1",
		shortID: "",
		title: "Andrea / James - 1-1",
		status: "completed",
		createdAt: "2026-06-25T08:37:31Z",
		updatedAt: "2026-06-25T08:37:49Z",
		durationMs: 1_946_879,
		transcript: "",
		userNotes: "",
		...overrides,
	};
}

function fakeCli(over: Partial<CliClient> = {}): CliClient {
	return {
		listMeetings: async () => [summary()],
		showMeeting: async () => detail(),
		listResults: async (): Promise<AiResult[]> => [],
		...over,
	};
}

describe("MacParakeetAdapter createdAt normalization", () => {
	it("shifts a listed meeting's createdAt back by its duration (save time is the end)", async () => {
		const adapter = new MacParakeetAdapter(fakeCli());

		const [meeting] = await adapter.listMeetings();

		// 08:37:31 (save/end) minus 1_946_879 ms (~32m27s) = the real start.
		expect(meeting?.createdAt).toBe("2026-06-25T08:05:04.121Z");
		// The recovered interval ends exactly at the original save time.
		const end = new Date(new Date(meeting!.createdAt).getTime() + meeting!.durationMs);
		expect(end.toISOString()).toBe("2026-06-25T08:37:31.000Z");
	});

	it("applies the same shift to the detail fetch", async () => {
		const adapter = new MacParakeetAdapter(fakeCli());

		const result = await adapter.showMeeting("mp-1");

		expect(result.createdAt).toBe("2026-06-25T08:05:04.121Z");
	});

	it("leaves createdAt untouched when the duration is unknown", async () => {
		const adapter = new MacParakeetAdapter(fakeCli({ listMeetings: async () => [summary({ durationMs: 0 })] }));

		const [meeting] = await adapter.listMeetings();

		expect(meeting?.createdAt).toBe("2026-06-25T08:37:31Z");
	});

	it("leaves an unparseable createdAt untouched", async () => {
		const adapter = new MacParakeetAdapter(fakeCli({ listMeetings: async () => [summary({ createdAt: "" })] }));

		const [meeting] = await adapter.listMeetings();

		expect(meeting?.createdAt).toBe("");
	});
});
