/**
 * SyncRunner: the single-flight guard and notice policy around a sync run.
 * Timing (interval, on-launch delay, ribbon) is wired in main.ts; this piece is
 * Obsidian-free so the guard and messaging are unit-testable.
 */

import { CliError } from "../cli/types";
import type { SyncOptions, SyncSummary } from "./types";

export type SyncTrigger = "manual" | "background";

export interface SyncRunnerDeps {
	sync: (options: SyncOptions) => Promise<SyncSummary>;
	/** Show a user-facing Notice. */
	notify: (message: string) => void;
	log: (message: string) => void;
	logError: (message: string, error: unknown) => void;
}

export class SyncRunner {
	private running = false;
	private backgroundFailureStreak = 0;

	constructor(private readonly deps: SyncRunnerDeps) {}

	/** True while a run is in flight; lets the UI reflect single-flight state. */
	get isRunning(): boolean {
		return this.running;
	}

	/**
	 * Run a sync unless one is already in flight (overlapping triggers collapse
	 * into the single active run). Manual runs always report; background runs are
	 * silent on success and notice an error only once per failure streak.
	 */
	async run(trigger: SyncTrigger, options: SyncOptions = {}): Promise<void> {
		if (this.running) {
			if (trigger === "manual") {
				this.deps.notify("Meeting Notes Sync: a sync is already running.");
			}
			return;
		}
		this.running = true;
		try {
			const summary = await this.deps.sync(options);
			this.report(trigger, summary);
		} catch (error) {
			this.handleError(trigger, error);
		} finally {
			this.running = false;
		}
	}

	/** Route a completed run to the clean-success or partial-failure handler. */
	private report(trigger: SyncTrigger, summary: SyncSummary): void {
		const errors = summary.errors ?? [];
		if (errors.length === 0) {
			this.handleSuccess(trigger, summary);
		} else {
			this.handleSourceErrors(trigger, summary, errors);
		}
	}

	private handleSuccess(trigger: SyncTrigger, summary: SyncSummary): void {
		const message = `Meeting Notes Sync: ${formatSummary(summary)}`;
		if (trigger === "manual") {
			this.deps.notify(message);
		} else {
			this.deps.log(message);
		}
		// A clean run clears the streak so the next failure notices again.
		this.backgroundFailureStreak = 0;
	}

	/**
	 * A source failed but the run finished (other sources may have synced). Report
	 * it like an error: manual always, background once per failure streak.
	 */
	private handleSourceErrors(
		trigger: SyncTrigger,
		summary: SyncSummary,
		errors: NonNullable<SyncSummary["errors"]>,
	): void {
		const detail = errors.map((entry) => `${entry.source} failed: ${entry.message}`).join("; ");
		const message = `Meeting Notes Sync: ${formatSummary(summary)} — ${detail}`;
		if (trigger === "manual") {
			this.deps.notify(message);
			this.deps.logError("Meeting Notes Sync: a source failed during manual sync", errors);
			return;
		}
		this.deps.logError("Meeting Notes Sync: a source failed during background sync", errors);
		this.backgroundFailureStreak += 1;
		if (this.backgroundFailureStreak === 1) {
			this.deps.notify(message);
		}
	}

	private handleError(trigger: SyncTrigger, error: unknown): void {
		const message = `Meeting Notes Sync: ${describeError(error)}`;
		if (trigger === "manual") {
			this.deps.notify(message);
			this.deps.logError("Meeting Notes Sync: manual sync failed", error);
			return;
		}
		this.deps.logError("Meeting Notes Sync: background sync failed", error);
		this.backgroundFailureStreak += 1;
		if (this.backgroundFailureStreak === 1) {
			this.deps.notify(message);
		}
	}
}

/** One-line sync result for a Notice or the console. */
export function formatSummary(summary: SyncSummary): string {
	return `${summary.created} new, ${summary.updated} updated, ${summary.unchanged} unchanged`;
}

/** Turn a thrown error into a single actionable line. */
export function describeError(error: unknown): string {
	if (error instanceof CliError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}
