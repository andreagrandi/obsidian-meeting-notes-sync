/**
 * Cross-source identity resolution: decide whether an incoming source meeting
 * belongs to an existing MeetingRecord (by prior binding or by interval overlap)
 * or needs a brand-new record.
 */

import type { Interval, MeetingRecord, Settings, SourceName, SyncStateData } from "./types";
import { buildSourceIndex, findBySource, intervalFromDuration } from "./state";
import { dateParts } from "./paths";

/** A meeting from any source, in the minimal shape the resolver needs. */
export interface ResolvableMeeting {
	source: SourceName;
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	durationMs: number;
	promptResultCount: number;
}

/** Outcome of resolving one source meeting to a record key. */
export interface IdentityResolution {
	/** Key to use in state.meetings. */
	recordKey: string;
	/** Existing record when one was found; undefined when a new record is needed. */
	existingRecord?: MeetingRecord;
	/** Set only when an unbound source meeting merges into an existing record. */
	mergeConfidence?: "high" | "low";
}

/** How an incoming meeting matched an existing record. */
type MatchSignal = "overlap" | "title-day";

interface ScoredCandidate {
	recordKey: string;
	record: MeetingRecord;
	overlapMs: number;
	overlapFraction: number;
	titleSimilarity: number;
	matchedBy: MatchSignal;
	score: number;
}

const MIN_TITLE_SIMILARITY_FOR_HIGH_CONFIDENCE = 0.5;
/** Title bar for the same-day fallback, which merges without any time overlap. */
const MIN_TITLE_SIMILARITY_FOR_DAY_MERGE = 0.5;
/** Keeps overlap candidates ranked above same-day-only ones (whose score is <= 1). */
const OVERLAP_PRIORITY = 1000;
const CANDIDATE_SCORE_EPSILON = 0.001;

/**
 * Resolve an incoming source meeting to a record key.
 *
 * 1. If the source id is already bound to a record, return that record.
 * 2. Otherwise, search existing records with a canonical interval for an
 *    overlap match above the configured threshold.
 * 3. If no match, return a new record key (the source meeting id).
 */
export function resolveIdentity(
	meeting: ResolvableMeeting,
	state: SyncStateData,
	settings: Settings,
): IdentityResolution {
	const sourceIndex = buildSourceIndex(state);
	const boundKey = findBySource(sourceIndex, meeting.source, meeting.id);
	if (boundKey) {
		const record = state.meetings[boundKey];
		if (record) {
			return { recordKey: boundKey, existingRecord: record };
		}
	}

	const meetingInterval = intervalFromDuration(meeting.createdAt, meeting.durationMs);
	const candidates = findCandidates(meeting, meetingInterval, state, settings);
	if (candidates.length === 0) {
		return { recordKey: meeting.id };
	}

	const best = candidates[0];
	if (!best) {
		return { recordKey: meeting.id };
	}
	// A same-day title match with no time overlap is heuristic — the recordings
	// cover different windows — so it is never high confidence.
	if (best.matchedBy === "title-day") {
		return { recordKey: best.recordKey, existingRecord: best.record, mergeConfidence: "low" };
	}
	if (candidates.length > 1 && closeScore(candidates[1]?.score ?? 0, best.score)) {
		return { recordKey: best.recordKey, existingRecord: best.record, mergeConfidence: "low" };
	}
	if (best.titleSimilarity < MIN_TITLE_SIMILARITY_FOR_HIGH_CONFIDENCE) {
		return { recordKey: best.recordKey, existingRecord: best.record, mergeConfidence: "low" };
	}
	return { recordKey: best.recordKey, existingRecord: best.record, mergeConfidence: "high" };
}

function findCandidates(
	meeting: ResolvableMeeting,
	meetingInterval: Interval,
	state: SyncStateData,
	settings: Settings,
): ScoredCandidate[] {
	const threshold = clamp(settings.overlapThreshold, 0, 1);
	const minOverlapMs = Math.max(0, settings.minimumOverlapMinutes) * 60_000;
	const meetingDurationMs = durationMs(meetingInterval);

	const meetingDate = dateParts(meeting.createdAt).date;

	const scored: ScoredCandidate[] = [];
	for (const [recordKey, record] of Object.entries(state.meetings)) {
		if (!record.interval || record.sources[meeting.source]) {
			continue;
		}
		const titleSimilarity = normalizedTitleSimilarity(meeting.title, recordTitle(record));

		// Primary signal: the recordings overlap in time above the thresholds.
		const overlapMs = intervalOverlap(meetingInterval, record.interval);
		const shorterDurationMs = Math.min(meetingDurationMs, durationMs(record.interval));
		const overlapFraction = shorterDurationMs > 0 ? overlapMs / shorterDurationMs : 0;
		const overlapMatch =
			overlapMs > 0 && overlapFraction >= threshold && overlapMs >= minOverlapMs;

		// Fallback signal: same calendar day and a near-identical title, even with
		// no time overlap — one tool started late or the other stopped early, so
		// the windows don't meet. The time gap is ignored by design.
		const titleDayMatch =
			dateParts(record.interval.start).date === meetingDate &&
			titleSimilarity >= MIN_TITLE_SIMILARITY_FOR_DAY_MERGE;

		if (!overlapMatch && !titleDayMatch) {
			continue;
		}

		const matchedBy: MatchSignal = overlapMatch ? "overlap" : "title-day";
		const score = scoreCandidate(matchedBy, overlapFraction, titleSimilarity);
		scored.push({ recordKey, record, overlapMs, overlapFraction, titleSimilarity, matchedBy, score });
	}

	return scored.sort((a, b) => b.score - a.score);
}

/** Score a candidate: overlap matches outrank same-day ones; title breaks ties. */
function scoreCandidate(matchedBy: MatchSignal, overlapFraction: number, titleSimilarity: number): number {
	const base = matchedBy === "overlap" ? OVERLAP_PRIORITY : 0;
	return base + overlapFraction * 100 + titleSimilarity;
}

function closeScore(a: number, b: number): boolean {
	return Math.abs(a - b) < CANDIDATE_SCORE_EPSILON;
}

/** Duration of an interval in milliseconds. */
function durationMs(interval: Interval): number {
	return Math.max(0, new Date(interval.end).getTime() - new Date(interval.start).getTime());
}

/** Overlap of two intervals in milliseconds; zero or positive. */
function intervalOverlap(a: Interval, b: Interval): number {
	const startA = new Date(a.start).getTime();
	const endA = new Date(a.end).getTime();
	const startB = new Date(b.start).getTime();
	const endB = new Date(b.end).getTime();
	const overlap = Math.min(endA, endB) - Math.max(startA, startB);
	return Math.max(0, overlap);
}

/** Best-effort title for a record: prefer the stored title, else empty. */
function recordTitle(record: MeetingRecord): string {
	return record.title ?? "";
}

/** Normalize a title for comparison: lowercase, drop punctuation, collapse spaces. */
export function normalizedTitle(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Simple Jaccard-ish similarity over word sets, 0-1. */
export function normalizedTitleSimilarity(a: string, b: string): number {
	const na = normalizedTitle(a);
	const nb = normalizedTitle(b);
	if (na.length === 0 || nb.length === 0) {
		return 0;
	}
	if (na === nb) {
		return 1;
	}
	const setA = new Set(na.split(" "));
	const setB = new Set(nb.split(" "));
	const intersection = new Set([...setA].filter((word) => setB.has(word)));
	const union = new Set([...setA, ...setB]);
	if (union.size === 0) {
		return 0;
	}
	return intersection.size / union.size;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
