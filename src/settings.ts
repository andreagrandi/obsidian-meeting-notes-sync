/**
 * Pure settings validation and normalization helpers, kept Obsidian-free so
 * they can be unit-tested. The settings UI lives in settings-tab.ts.
 */

import { DEFAULT_SETTINGS } from "./sync";
import type { TranscriptSourcePreference } from "./sync/types";

/** Normalize a base-folder string: trim, strip stray slashes, fall back to default. */
export function cleanBaseFolder(input: string): string {
	const cleaned = input
		.trim()
		.replace(/^\/+|\/+$/g, "")
		.replace(/\/{2,}/g, "/");
	return cleaned.length > 0 ? cleaned : DEFAULT_SETTINGS.baseFolder;
}

/** A path template is valid when it is non-empty after trimming. */
export function isValidTemplate(input: string): boolean {
	return input.trim().length > 0;
}

/** Coerce an interval field to a non-negative whole number of minutes (0 = off). */
export function cleanInterval(input: string | number): number {
	const value = typeof input === "number" ? input : Number.parseInt(input, 10);
	if (!Number.isFinite(value) || value < 0) {
		return 0;
	}
	return Math.floor(value);
}

/** Normalize a Fellow subdomain: trim, drop protocol/host, fall back to empty. */
export function cleanSubdomain(input: string): string {
	let value = input.trim().toLowerCase();
	value = value.replace(/^https?:\/\//, "");
	value = value.replace(/\.fellow\.app(\/.*)?$/, "");
	return value.replace(/[^a-z0-9-]/g, "");
}

/** Coerce an overlap threshold to a number between 0 and 1. */
export function cleanOverlapThreshold(input: string | number): number {
	const value = typeof input === "number" ? input : Number.parseFloat(input);
	if (!Number.isFinite(value)) {
		return DEFAULT_SETTINGS.overlapThreshold;
	}
	return Math.max(0, Math.min(1, value));
}

/** Coerce a minimum-overlap-minutes field to a non-negative whole number. */
export function cleanMinimumOverlapMinutes(input: string | number): number {
	return cleanInterval(input);
}

/** Normalize which source transcript to keep for merged meetings. */
export function cleanTranscriptSourcePreference(
	input: string,
): TranscriptSourcePreference {
	if (input === "all" || input === "macparakeet" || input === "fellow") {
		return input;
	}
	return DEFAULT_SETTINGS.transcriptSourcePreference;
}

/** A sync-since value is valid when blank (= install date) or a YYYY-MM-DD date. */
export function isValidSyncSince(input: string): boolean {
	const value = input.trim();
	if (value.length === 0) {
		return true;
	}
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
