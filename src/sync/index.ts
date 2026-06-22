export { SyncEngine, inScope, isSourceUnchanged } from "./engine";
export type { SyncEngineDeps } from "./engine";
export { mergeMeetings, MergeError } from "./merge";
export type { MergeMeetingsDeps, MergeResult } from "./merge";
export {
	bucketKey,
	dateParts,
	joinPath,
	renderTemplate,
	sanitizeTitle,
	uniqueName,
} from "./paths";
export type { DateParts } from "./paths";
export {
	formatDuration,
	renderArtifacts,
	renderFrontmatter,
	renderIndex,
} from "./renderer";
export type { RenderArtifactsInput, RenderIndexInput, RenderedFile } from "./renderer";
export { SyncRunner, describeError, formatSummary } from "./runner";
export type { SyncRunnerDeps, SyncTrigger } from "./runner";
export {
	assignNumber,
	buildSourceIndex,
	effectiveSyncSince,
	findBySource,
	intervalFromDuration,
	normalizeData,
	sourceIndexKey,
} from "./state";
export {
	resolveIdentity,
	normalizedTitle,
	normalizedTitleSimilarity,
} from "./identity";
export type { IdentityResolution, ResolvableMeeting } from "./identity";
export {
	DEFAULT_SETTINGS,
	emptyState,
} from "./types";
export type {
	CliClient,
	FileRecord,
	Interval,
	MeetingRecord,
	PluginData,
	Settings,
	SourceBinding,
	SourceName,
	SourceSnapshot,
	SyncOptions,
	SyncStateData,
	SyncSummary,
	VaultIO,
} from "./types";
