import { type App, Modal, Setting } from "obsidian";
import type MeetingNotesSyncPlugin from "./main";
import { joinPath, renderTemplate, sanitizeTitle } from "./sync";
import type { MeetingRecord, SourceName } from "./sync";

/** Human label per source, for the picker's source badge. */
const SOURCE_LABELS: Record<SourceName, string> = {
	macparakeet: "MacParakeet",
	fellow: "Fellow",
};

const SOURCE_NAMES: readonly SourceName[] = ["macparakeet", "fellow"];

/** One selectable meeting in the picker. */
interface Entry {
	key: string;
	record: MeetingRecord;
	/** Full folder leaf (number + title + date), shown in the dropdowns. */
	label: string;
	/** Clean title used for the "keep title" choice and the result preview. */
	title: string;
}

/**
 * Pick two cross-source duplicate meetings and merge them into one. The lower
 * number survives; the chosen title drives the merged folder name.
 */
export class MergeMeetingsModal extends Modal {
	private readonly plugin: MeetingNotesSyncPlugin;
	private readonly entries: Entry[];
	private keyA: string;
	private keyB: string;
	private titleChoice: "a" | "b" = "a";

	constructor(app: App, plugin: MeetingNotesSyncPlugin) {
		super(app);
		this.plugin = plugin;
		this.entries = buildEntries(plugin.getState().meetings);
		this.keyA = this.entries[0]?.key ?? "";
		this.keyB = this.entries[1]?.key ?? "";
	}

	onOpen(): void {
		this.titleEl.setText("Merge two meetings");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.entries.length < 2) {
			contentEl.createEl("p", { text: "Need at least two synced meetings to merge." });
			return;
		}

		const options = Object.fromEntries(this.entries.map((entry) => [entry.key, entry.label]));

		new Setting(contentEl).setName("First meeting").addDropdown((dropdown) =>
			dropdown
				.addOptions(options)
				.setValue(this.keyA)
				.onChange((value) => {
					this.keyA = value;
					this.render();
				}),
		);

		new Setting(contentEl).setName("Second meeting").addDropdown((dropdown) =>
			dropdown
				.addOptions(options)
				.setValue(this.keyB)
				.onChange((value) => {
					this.keyB = value;
					this.render();
				}),
		);

		const entryA = this.entryFor(this.keyA);
		const entryB = this.entryFor(this.keyB);

		if (entryA && entryB) {
			new Setting(contentEl).setName("Keep title").addDropdown((dropdown) =>
				dropdown
					.addOptions({ a: entryA.title, b: entryB.title })
					.setValue(this.titleChoice)
					.onChange((value) => {
						this.titleChoice = value === "b" ? "b" : "a";
						this.render();
					}),
			);
		}

		const error = this.validate(entryA, entryB);
		const preview = contentEl.createEl("div", { cls: "setting-item-description" });
		if (error) {
			preview.addClass("mod-warning");
			preview.setText(error);
		} else if (entryA && entryB) {
			preview.setText(`Result → ${this.previewFolder(entryA, entryB)}`);
		}

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => {
				button.setButtonText("Merge").setCta();
				if (error) {
					button.setDisabled(true);
				} else {
					button.onClick(() => void this.runMerge(entryA, entryB));
				}
				return button;
			});
	}

	/** The validation error blocking a merge, or null when it can proceed. */
	private validate(entryA: Entry | undefined, entryB: Entry | undefined): string | null {
		if (!entryA || !entryB) {
			return "Select two meetings.";
		}
		if (entryA.key === entryB.key) {
			return "Select two different meetings.";
		}
		if (sourcesOverlap(entryA.record, entryB.record)) {
			return "Those meetings share a source; only cross-source duplicates can be merged.";
		}
		return null;
	}

	private async runMerge(entryA: Entry | undefined, entryB: Entry | undefined): Promise<void> {
		if (!entryA || !entryB) {
			return;
		}
		const title = this.titleChoice === "a" ? entryA.title : entryB.title;
		this.close();
		await this.plugin.mergeMeetings(entryA.key, entryB.key, { title });
	}

	private entryFor(key: string): Entry | undefined {
		return this.entries.find((entry) => entry.key === key);
	}

	/** The merged folder leaf the user will get, for the live preview. */
	private previewFolder(entryA: Entry, entryB: Entry): string {
		const survivor = entryA.record.n <= entryB.record.n ? entryA : entryB;
		const absorbed = survivor === entryA ? entryB : entryA;
		const title = this.titleChoice === "a" ? entryA.title : entryB.title;
		const createdAt = survivor.record.interval?.start ?? absorbed.record.interval?.start ?? "";
		const path = joinPath(
			this.plugin.getSettings().baseFolder,
			renderTemplate(this.plugin.getSettings().pathTemplate, { createdAt, title }, survivor.record.n),
		);
		return path.slice(path.lastIndexOf("/") + 1);
	}
}

function buildEntries(meetings: Record<string, MeetingRecord>): Entry[] {
	return Object.entries(meetings)
		.map(([key, record]) => ({
			key,
			record,
			label: labelFor(record),
			title: titleFor(record),
		}))
		.sort((a, b) =>
			a.record.bucket === b.record.bucket
				? a.record.n - b.record.n
				: a.record.bucket < b.record.bucket
					? -1
					: 1,
		);
}

function labelFor(record: MeetingRecord): string {
	const leaf = record.folderPath.slice(record.folderPath.lastIndexOf("/") + 1);
	const badges = SOURCE_NAMES.filter((name) => record.sources[name]).map((name) => SOURCE_LABELS[name]);
	return badges.length > 0 ? `${leaf} — ${badges.join(", ")}` : leaf;
}

function titleFor(record: MeetingRecord): string {
	const title = record.title?.trim();
	if (title) {
		return title;
	}
	const leaf = record.folderPath.slice(record.folderPath.lastIndexOf("/") + 1);
	return sanitizeTitle(leaf);
}

function sourcesOverlap(a: MeetingRecord, b: MeetingRecord): boolean {
	return SOURCE_NAMES.some((name) => a.sources[name] !== undefined && b.sources[name] !== undefined);
}
