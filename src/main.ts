import { Notice, Plugin } from "obsidian";
import { existsSync } from "node:fs";
import { CliBridge, CliError, nodeCommandRunner } from "./cli";

export default class MacParakeetSyncPlugin extends Plugin {
	private cli!: CliBridge;

	async onload(): Promise<void> {
		this.cli = new CliBridge({
			runner: nodeCommandRunner,
			pathExists: (path) => existsSync(path),
		});

		this.addCommand({
			id: "check-connection",
			name: "Check connection",
			callback: () => {
				void this.checkConnection();
			},
		});

		this.addCommand({
			id: "sync-meetings",
			name: "Sync MacParakeet meetings",
			callback: () => {
				new Notice("MacParakeet Sync: sync is not implemented yet.");
			},
		});
	}

	onunload(): void {
		// Commands registered via addCommand are unregistered automatically on unload.
	}

	private async checkConnection(): Promise<void> {
		try {
			const { cliPath, meetingCount } = await this.cli.checkConnection();
			new Notice(
				`MacParakeet Sync: connected.\nCLI: ${cliPath}\nMeetings: ${meetingCount}`,
			);
		} catch (error) {
			new Notice(`MacParakeet Sync: ${describeCliError(error)}`);
			console.error("MacParakeet Sync: check connection failed", error);
		}
	}
}

/** Turn a thrown error into a single actionable line for the Check connection Notice. */
function describeCliError(error: unknown): string {
	if (error instanceof CliError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}
