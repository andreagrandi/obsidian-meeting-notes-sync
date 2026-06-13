/** MacParakeet CLI adapter: exposes the existing CLI bridge through the source facade. */

import type { AiResult } from "../cli/types";
import type { CliClient, Settings } from "../sync/types";
import type { SourceAdapter, SourceMeeting, SourceMeetingDetail } from "./types";

export class MacParakeetAdapter implements SourceAdapter {
	readonly source = "macparakeet";

	constructor(private readonly cli: CliClient) {}

	isEnabled(settings: Settings): boolean {
		return settings.sourceMacparakeetEnabled;
	}

	async listMeetings(): Promise<SourceMeeting[]> {
		return this.cli.listMeetings();
	}

	async showMeeting(id: string): Promise<SourceMeetingDetail> {
		return this.cli.showMeeting(id);
	}

	async listResults(id: string): Promise<AiResult[]> {
		return this.cli.listResults(id);
	}
}
