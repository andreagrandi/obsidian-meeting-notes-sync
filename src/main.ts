import { Notice, Plugin } from "obsidian";

export default class MacParakeetSyncPlugin extends Plugin {
	async onload(): Promise<void> {
		this.addCommand({
			id: "sync-meetings",
			name: "Sync MacParakeet meetings",
			callback: () => {
				new Notice("MacParakeet Sync: sync is not implemented yet.");
			},
		});
	}

	onunload(): void {
		// Nothing to clean up yet; commands registered via addCommand are
		// unregistered automatically when the plugin unloads.
	}
}
