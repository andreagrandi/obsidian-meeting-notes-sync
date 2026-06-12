import { execFile } from "node:child_process";
import type { CliRunResult, CommandRunner } from "./types";

/** Generous cap so a full `meetings list` never overflows the stdout buffer. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Real runner backed by child_process.execFile (no shell).
 * Resolves with captured output even on non-zero exit; sets spawnError on spawn failure.
 */
export const nodeCommandRunner: CommandRunner = (binPath, args, { timeoutMs }) =>
	new Promise<CliRunResult>((resolve) => {
		execFile(
			binPath,
			args,
			{ timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ stdout, stderr, code: 0, timedOut: false });
					return;
				}

				const err = error as NodeJS.ErrnoException & {
					killed?: boolean;
					code?: number | string;
				};

				// We only ever kill the child via the timeout option.
				if (err.killed === true) {
					resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code: null, timedOut: true });
					return;
				}

				// Spawn-level failures (ENOENT, EACCES, ...) carry a string code.
				if (typeof err.code === "string") {
					resolve({
						stdout: stdout ?? "",
						stderr: stderr ?? "",
						code: null,
						timedOut: false,
						spawnError: err.code,
					});
					return;
				}

				resolve({
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					code: typeof err.code === "number" ? err.code : null,
					timedOut: false,
				});
			},
		);
	});
