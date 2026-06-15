import { describe, expect, it, vi } from "vitest";
import { CliError } from "../cli/types";
import { SyncRunner } from "./runner";
import type { SyncOptions, SyncSummary } from "./types";

const EMPTY: SyncSummary = { created: 0, updated: 0, unchanged: 0 };

/** A sync stub whose pending promise the test resolves by hand. */
function deferredSync() {
	let resolve!: (value: SyncSummary) => void;
	const calls: SyncOptions[] = [];
	const sync = (options: SyncOptions) => {
		calls.push(options);
		return new Promise<SyncSummary>((r) => {
			resolve = r;
		});
	};
	return { sync, calls, resolve: (value: SyncSummary) => resolve(value) };
}

function makeRunner(sync: (options: SyncOptions) => Promise<SyncSummary>) {
	const notify = vi.fn();
	const log = vi.fn();
	const logError = vi.fn();
	return { runner: new SyncRunner({ sync, notify, log, logError }), notify, log, logError };
}

describe("SyncRunner — single-flight", () => {
	it("collapses overlapping triggers into one run", async () => {
		const deferred = deferredSync();
		const { runner } = makeRunner(deferred.sync);

		const first = runner.run("background");
		expect(runner.isRunning).toBe(true);

		// A second trigger while the first is in flight does not start a run.
		await runner.run("background");
		expect(deferred.calls).toHaveLength(1);

		deferred.resolve(EMPTY);
		await first;
		expect(runner.isRunning).toBe(false);
	});

	it("notifies a manual trigger that a run is already in progress", async () => {
		const deferred = deferredSync();
		const { runner, notify } = makeRunner(deferred.sync);

		const first = runner.run("background");
		await runner.run("manual");

		expect(notify).toHaveBeenCalledWith("Meeting Notes Sync: a sync is already running.");
		deferred.resolve(EMPTY);
		await first;
	});

	it("allows a new run after the previous one finishes", async () => {
		const { runner } = makeRunner(async () => EMPTY);
		await runner.run("manual");
		await runner.run("manual");
		expect(runner.isRunning).toBe(false);
	});
});

describe("SyncRunner — notice policy", () => {
	it("always reports a manual sync result", async () => {
		const { runner, notify, log } = makeRunner(async () => ({ created: 2, updated: 1, unchanged: 14 }));
		await runner.run("manual");
		expect(notify).toHaveBeenCalledWith("Meeting Notes Sync: 2 new, 1 updated, 14 unchanged");
		expect(log).not.toHaveBeenCalled();
	});

	it("is silent on a background success, logging to the console only", async () => {
		const { runner, notify, log } = makeRunner(async () => ({ created: 1, updated: 0, unchanged: 3 }));
		await runner.run("background");
		expect(notify).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith("Meeting Notes Sync: 1 new, 0 updated, 3 unchanged");
	});

	it("notifies a manual sync failure with the actionable message", async () => {
		const error = new CliError("not-found", "Could not find macparakeet-cli.");
		const { runner, notify, logError } = makeRunner(async () => {
			throw error;
		});
		await runner.run("manual");
		expect(notify).toHaveBeenCalledWith("Meeting Notes Sync: Could not find macparakeet-cli.");
		expect(logError).toHaveBeenCalled();
	});

	it("notices a background failure only once per streak", async () => {
		let mode: "fail" | "ok" = "fail";
		const error = new CliError("timeout", "macparakeet-cli timed out.");
		const { runner, notify, logError } = makeRunner(async () => {
			if (mode === "fail") {
				throw error;
			}
			return EMPTY;
		});

		await runner.run("background");
		await runner.run("background");
		await runner.run("background");

		// One notice for the whole streak; every failure still hits the console.
		expect(notify).toHaveBeenCalledTimes(1);
		expect(logError).toHaveBeenCalledTimes(3);

		// A success ends the streak so the next failure notices again.
		mode = "ok";
		await runner.run("background");
		mode = "fail";
		await runner.run("background");
		expect(notify).toHaveBeenCalledTimes(2);
	});
});

describe("SyncRunner — per-source errors", () => {
	const FELLOW_FAILED: SyncSummary = {
		created: 2,
		updated: 0,
		unchanged: 1,
		errors: [{ source: "fellow", message: "Fellow rejected the API key (401)." }],
	};

	it("reports a source failure on a manual sync, with the counts and the message", async () => {
		const { runner, notify, logError } = makeRunner(async () => FELLOW_FAILED);
		await runner.run("manual");
		expect(notify).toHaveBeenCalledWith(
			"Meeting Notes Sync: 2 new, 0 updated, 1 unchanged — fellow failed: Fellow rejected the API key (401).",
		);
		expect(logError).toHaveBeenCalled();
	});

	it("notices a background source failure only once per streak", async () => {
		let mode: "fail" | "ok" = "fail";
		const { runner, notify, logError } = makeRunner(async () => (mode === "fail" ? FELLOW_FAILED : EMPTY));

		await runner.run("background");
		await runner.run("background");
		expect(notify).toHaveBeenCalledTimes(1);
		expect(logError).toHaveBeenCalledTimes(2);

		// A clean run ends the streak so the next failure notices again.
		mode = "ok";
		await runner.run("background");
		mode = "fail";
		await runner.run("background");
		expect(notify).toHaveBeenCalledTimes(2);
	});
});
