/**
 * Map Fellow recordings/notes onto the source-agnostic meeting model the engine
 * already consumes. Pure functions, no I/O — the recap lives on the Recording's
 * `ai_notes`, manual notes on the linked Note's `content_markdown` (spike #24).
 */

import type { AiResult, MeetingDetail } from "../cli/types";
import type { SourceMeeting } from "../sources/types";
import type {
	FellowNote,
	FellowRecapActionItem,
	FellowRecapSection,
	FellowRecapTopic,
	FellowRecording,
	FellowTranscript,
} from "./types";

/** A finished recording maps to a "completed" meeting; in-flight ones stay out of scope. */
export function recordingToSourceMeeting(recording: FellowRecording): SourceMeeting {
	return {
		id: recording.id,
		title: recording.title ?? "Untitled Meeting",
		status: recording.ended_at ? "completed" : "recording",
		createdAt: recording.started_at,
		updatedAt: recording.updated_at ?? recording.started_at,
		durationMs: durationMs(recording),
		// Fellow has no AI-result count; change detection keys on updated_at instead.
		promptResultCount: 0,
	};
}

/** Recording detail → engine detail; `note` supplies the manual notes when present. */
export function recordingToDetail(recording: FellowRecording, note: FellowNote | null): MeetingDetail {
	return {
		id: recording.id,
		shortID: "",
		title: recording.title ?? "Untitled Meeting",
		status: recording.ended_at ? "completed" : "recording",
		createdAt: recording.started_at,
		updatedAt: recording.updated_at ?? recording.started_at,
		durationMs: durationMs(recording),
		transcript: formatTranscript(recording.transcript),
		userNotes: note?.content_markdown?.trim() ?? "",
	};
}

/**
 * Each AI-recap section becomes its own result, so the renderer emits one
 * artifact per section (Summary, Action items, …). Empty sections are dropped.
 */
export function recordingToResults(recording: FellowRecording): AiResult[] {
	const results: AiResult[] = [];
	const recaps = recording.ai_notes ?? [];
	recaps.forEach((recap, recapIndex) => {
		if (recap.is_active === false) {
			return;
		}
		recap.sections.forEach((section, sectionIndex) => {
			const content = renderRecapSection(section).trim();
			if (content.length === 0) {
				return;
			}
			results.push({
				// Stable, order-preserving id so file naming never churns across syncs.
				id: `${recording.id}#${recapIndex}.${sectionIndex}`,
				shortID: "",
				name: section.title || "Recap",
				content,
				promptContent: "",
				createdAt: recording.created_at ?? recording.started_at,
				updatedAt: recording.updated_at ?? recording.started_at,
			});
		});
	});
	return results;
}

/** Diarized segments → readable markdown, one line per speaker turn. */
export function formatTranscript(transcript: FellowTranscript | null): string {
	const segments = transcript?.speech_segments ?? [];
	return segments
		.map((segment) => {
			const text = segment.text.trim();
			const speaker = segment.speaker?.trim();
			return speaker ? `**${speaker}:** ${text}` : text;
		})
		.filter((line) => line.length > 0)
		.join("\n\n");
}

/** Render one recap section to markdown, branching on its content union. */
export function renderRecapSection(section: FellowRecapSection): string {
	const content = section.content;
	if (typeof content === "string") {
		return content.trim();
	}
	if (!Array.isArray(content) || content.length === 0) {
		return "";
	}
	if (isTopicArray(content)) {
		return content
			.map((topic) => {
				const bullets = topic.bullet_points.map((bullet) => `- ${bullet.text.trim()}`).join("\n");
				return `### ${topic.title.trim()}\n${bullets}`.trim();
			})
			.join("\n\n");
	}
	if (isActionItemArray(content)) {
		return content.map((item) => renderActionItem(item)).join("\n");
	}
	// Decisions and key moments are both `{timestamp, text}` lists.
	return content.map((item) => `- ${String((item as { text: string }).text).trim()}`).join("\n");
}

function renderActionItem(item: FellowRecapActionItem): string {
	const checkbox = item.status === "Done" ? "[x]" : "[ ]";
	const assignees = item.assignees
		.map((assignee) => assignee.full_name)
		.filter((name) => Boolean(name))
		.join(", ");
	const suffix = assignees ? ` (${assignees})` : "";
	return `- ${checkbox} ${item.text.trim()}${suffix}`;
}

function isTopicArray(content: unknown[]): content is FellowRecapTopic[] {
	const first = content[0];
	return typeof first === "object" && first !== null && Array.isArray((first as FellowRecapTopic).bullet_points);
}

function isActionItemArray(content: unknown[]): content is FellowRecapActionItem[] {
	const first = content[0];
	return typeof first === "object" && first !== null && Array.isArray((first as FellowRecapActionItem).assignees);
}

function durationMs(recording: FellowRecording): number {
	if (!recording.started_at || !recording.ended_at) {
		return 0;
	}
	const start = new Date(recording.started_at).getTime();
	const end = new Date(recording.ended_at).getTime();
	if (Number.isNaN(start) || Number.isNaN(end)) {
		return 0;
	}
	return Math.max(0, end - start);
}
