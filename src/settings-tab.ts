import { type App, PluginSettingTab, Setting, debounce, normalizePath } from "obsidian";
import type MeetingNotesSyncPlugin from "./main";
import {
	cleanBaseFolder,
	cleanInterval,
	cleanMinimumOverlapMinutes,
	cleanOverlapThreshold,
	cleanSubdomain,
	isValidSyncSince,
	isValidTemplate,
} from "./settings";

/** The full configuration UI; reads and writes the plugin's live settings. */
export class MeetingNotesSettingTab extends PluginSettingTab {
	private readonly plugin: MeetingNotesSyncPlugin;
	private cliStatusEl: HTMLElement | null = null;
	private fellowStatusEl: HTMLElement | null = null;

	constructor(app: App, plugin: MeetingNotesSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.getSettings();

		containerEl.createEl("h3", { text: "MacParakeet" });

		new Setting(containerEl)
			.setName("Enable MacParakeet source")
			.setDesc("Import meetings from macparakeet-cli.")
			.addToggle((toggle) =>
				toggle.setValue(settings.sourceMacparakeetEnabled).onChange((value) => {
					void this.plugin.updateSettings({ sourceMacparakeetEnabled: value });
				}),
			);

		new Setting(containerEl)
			.setName("macparakeet-cli path")
			.setDesc(
				"Leave empty to auto-discover (Homebrew paths, then the MacParakeet app bundle). " +
					"Set a full path to override discovery.",
			)
			.addText((text) =>
				text
					.setPlaceholder("/opt/homebrew/bin/macparakeet-cli")
					.setValue(settings.cliPath)
					.onChange(
						debounce(
							async (value: string) => {
								await this.plugin.updateSettings({ cliPath: value.trim() });
								await this.refreshCliStatus();
							},
							600,
							true,
						),
					),
			);
		this.cliStatusEl = containerEl.createEl("div", { cls: "setting-item-description" });
		void this.refreshCliStatus();

		containerEl.createEl("h3", { text: "Fellow" });

		new Setting(containerEl)
			.setName("Enable Fellow source")
			.setDesc("Import AI recaps from Fellow. Requires a paid plan with the API enabled.")
			.addToggle((toggle) =>
				toggle.setValue(settings.sourceFellowEnabled).onChange((value) => {
					void this.plugin.updateSettings({ sourceFellowEnabled: value });
				}),
			);

		new Setting(containerEl)
			.setName("Fellow workspace subdomain")
			.setDesc("Your workspace slug (the 'acme' in acme.fellow.app).")
			.addText((text) =>
				text
					.setPlaceholder("acme")
					.setValue(settings.fellowSubdomain)
					.onChange(
						debounce(
							async (value: string) => {
								await this.plugin.updateSettings({ fellowSubdomain: cleanSubdomain(value) });
								await this.refreshFellowStatus();
							},
							600,
							true,
						),
					),
			);

		new Setting(containerEl)
			.setName("Fellow API key")
			.setDesc(
				"Personal API key from User Settings → Developer Tools. Stored in plaintext in data.json — mind vault sync and git.",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(settings.fellowApiKey).onChange(
					debounce(
						async (value: string) => {
							await this.plugin.updateSettings({ fellowApiKey: value.trim() });
							await this.refreshFellowStatus();
						},
						600,
						true,
					),
				);
			});

		this.fellowStatusEl = containerEl.createEl("div", { cls: "setting-item-description" });
		void this.refreshFellowStatus();

		containerEl.createEl("h3", { text: "Merge" });

		new Setting(containerEl)
			.setName("Overlap threshold")
			.setDesc("Minimum overlap as a fraction of the shorter meeting (0–1).")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.step = "0.05";
				text.setValue(String(settings.overlapThreshold)).onChange((value) => {
					void this.plugin.updateSettings({ overlapThreshold: cleanOverlapThreshold(value) });
				});
			});

		new Setting(containerEl)
			.setName("Minimum overlap (minutes)")
			.setDesc("Absolute minimum overlap required before a merge is considered.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(String(settings.minimumOverlapMinutes)).onChange((value) => {
					void this.plugin.updateSettings({ minimumOverlapMinutes: cleanMinimumOverlapMinutes(value) });
				});
			});

		containerEl.createEl("h3", { text: "Vault layout" });

		new Setting(containerEl)
			.setName("Base folder")
			.setDesc("Vault folder all meeting folders are created under.")
			.addText((text) =>
				text.setValue(settings.baseFolder).onChange((value) => {
					void this.plugin.updateSettings({ baseFolder: normalizePath(cleanBaseFolder(value)) });
				}),
			);

		const templateError = containerEl.createEl("div", { cls: "setting-item-description mod-warning" });
		new Setting(containerEl)
			.setName("Path template")
			.setDesc(
				"Folder path per meeting. Tokens: {year} {month} {monthName} {monthShort} {day} {dayOrdinal} {date} {n} {title}",
			)
			.addText((text) =>
				text.setValue(settings.pathTemplate).onChange((value) => {
					if (!isValidTemplate(value)) {
						templateError.setText("Path template cannot be empty.");
						return;
					}
					templateError.setText("");
					void this.plugin.updateSettings({ pathTemplate: value.trim() });
				}),
			);

		const sinceError = containerEl.createEl("div", { cls: "setting-item-description mod-warning" });
		new Setting(containerEl)
			.setName("Sync meetings since")
			.setDesc("Only meetings created on/after this date are imported. Empty = the install date.")
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(settings.syncSince).onChange((value) => {
					if (!isValidSyncSince(value)) {
						sinceError.setText("Enter a YYYY-MM-DD date or leave empty.");
						return;
					}
					sinceError.setText("");
					void this.plugin.updateSettings({ syncSince: value.trim() });
				});
			});

		containerEl.createEl("h3", { text: "Content" });

		new Setting(containerEl)
			.setName("Sync AI results")
			.setDesc("Import each meeting's AI prompt results as separate notes.")
			.addToggle((toggle) =>
				toggle.setValue(settings.syncResults).onChange((value) => {
					void this.plugin.updateSettings({ syncResults: value });
				}),
			);

		new Setting(containerEl)
			.setName("Sync meeting notes")
			.setDesc("Import the notes you typed in MacParakeet as Notes.md.")
			.addToggle((toggle) =>
				toggle.setValue(settings.syncNotes).onChange((value) => {
					void this.plugin.updateSettings({ syncNotes: value });
				}),
			);

		new Setting(containerEl)
			.setName("Sync transcript")
			.setDesc("Import the full transcript as Transcript.md. Transcripts can be long; off by default.")
			.addToggle((toggle) =>
				toggle.setValue(settings.syncTranscript).onChange((value) => {
					void this.plugin.updateSettings({ syncTranscript: value });
				}),
			);

		containerEl.createEl("h3", { text: "Triggers" });

		new Setting(containerEl)
			.setName("Sync interval (minutes)")
			.setDesc("How often to sync in the background. 0 disables the timer.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setValue(String(settings.syncIntervalMinutes)).onChange((value) => {
					void this.plugin.updateSettings({ syncIntervalMinutes: cleanInterval(value) });
				});
			});

		new Setting(containerEl)
			.setName("Sync on launch")
			.setDesc("Run a sync shortly after Obsidian starts.")
			.addToggle((toggle) =>
				toggle.setValue(settings.syncOnLaunch).onChange((value) => {
					void this.plugin.updateSettings({ syncOnLaunch: value });
				}),
			);
	}

	/** Validate the CLI from the current override and reflect the result inline. */
	private async refreshCliStatus(): Promise<void> {
		const el = this.cliStatusEl;
		if (!el) {
			return;
		}
		el.removeClass("mod-warning");
		el.setText("Checking macparakeet-cli…");
		const status = await this.plugin.validateCli();
		if (status.ok) {
			el.setText(`Connected · ${status.path} · ${status.meetingCount} meetings`);
		} else {
			el.addClass("mod-warning");
			el.setText(`Not connected: ${status.error}`);
		}
	}

	private async refreshFellowStatus(): Promise<void> {
		const el = this.fellowStatusEl;
		if (!el) {
			return;
		}
		const settings = this.plugin.getSettings();
		if (!settings.sourceFellowEnabled) {
			el.removeClass("mod-warning");
			el.setText("Fellow source is disabled.");
			return;
		}
		if (!settings.fellowSubdomain || !settings.fellowApiKey) {
			el.addClass("mod-warning");
			el.setText("Enter subdomain and API key to connect.");
			return;
		}
		el.removeClass("mod-warning");
		el.setText("Checking Fellow…");
		const status = await this.plugin.validateFellow();
		if (status.ok) {
			el.removeClass("mod-warning");
			el.setText(`Connected · ${status.workspace}`);
		} else {
			el.addClass("mod-warning");
			el.setText(`Not connected: ${status.error}`);
		}
	}
}
