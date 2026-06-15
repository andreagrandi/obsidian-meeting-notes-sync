/**
 * Path planning: turn a meeting + frozen number into sanitized vault paths.
 * Pure logic, no Obsidian or filesystem access.
 */

const MAX_TITLE_LENGTH = 60;
/** Characters invalid in Obsidian filenames or wiki-links (PLAN §7). */
const INVALID_CHARS = /[*"\\/<>:|?#^[\]]/g;

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const MONTH_SHORT_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** Date components resolved from a meeting's ISO createdAt, in UTC. */
export interface DateParts {
	year: string;
	month: string;
	monthName: string;
	day: string;
	date: string;
}

/** Parse the YYYY-MM-DD portion of an ISO timestamp without timezone drift. */
export function dateParts(createdAt: string): DateParts {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt);
	if (match) {
		const [, year = "", month = "", day = ""] = match;
		return withMonthName({ year, month, day, date: `${year}-${month}-${day}` });
	}
	const parsed = new Date(createdAt);
	if (Number.isNaN(parsed.getTime())) {
		return withMonthName({ year: "0000", month: "00", day: "00", date: "0000-00-00" });
	}
	const year = String(parsed.getUTCFullYear()).padStart(4, "0");
	const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
	const day = String(parsed.getUTCDate()).padStart(2, "0");
	return withMonthName({ year, month, day, date: `${year}-${month}-${day}` });
}

function withMonthName(parts: Omit<DateParts, "monthName">): DateParts {
	const index = Number.parseInt(parts.month, 10) - 1;
	const monthName = MONTH_NAMES[index] ?? "";
	return { ...parts, monthName };
}

/** The "{year}/{month}" bucket a meeting's number is counted within. */
export function bucketKey(createdAt: string): string {
	const { year, month } = dateParts(createdAt);
	return `${year}/${month}`;
}

/** Abbreviated month name (e.g. "06" -> "Jun"); empty for an out-of-range month. */
export function monthShortName(month: string): string {
	const index = Number.parseInt(month, 10) - 1;
	return MONTH_SHORT_NAMES[index] ?? "";
}

/** Day with its English ordinal suffix (e.g. "02" -> "2nd", "21" -> "21st"). */
export function ordinalDay(day: string): string {
	const n = Number.parseInt(day, 10);
	if (!Number.isFinite(n)) {
		return "";
	}
	const mod100 = n % 100;
	if (mod100 >= 11 && mod100 <= 13) {
		return `${n}th`;
	}
	const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
	return `${n}${suffix}`;
}

/** Sanitize a title for use as a folder/file name (PLAN §7). */
export function sanitizeTitle(raw: string): string {
	let title = (raw ?? "").replace(INVALID_CHARS, "-").replace(/\s+/g, " ").trim();
	if (title.length > MAX_TITLE_LENGTH) {
		title = title.slice(0, MAX_TITLE_LENGTH).trim();
	}
	title = title.replace(/^[.\s]+|[.\s]+$/g, "");
	return title.length > 0 ? title : "Untitled Meeting";
}

/** Join path segments, trimming stray slashes and collapsing duplicates. */
export function joinPath(...parts: string[]): string {
	return parts
		.map((part) => part.replace(/^\/+|\/+$/g, ""))
		.filter((part) => part.length > 0)
		.join("/")
		.replace(/\/{2,}/g, "/");
}

/**
 * Render a path template against a meeting. Supported tokens are resolved from
 * the meeting's createdAt; unknown tokens are left in place verbatim.
 */
export function renderTemplate(
	template: string,
	meeting: { createdAt: string; title: string },
	n: number,
): string {
	const { year, month, monthName, day, date } = dateParts(meeting.createdAt);
	const values: Record<string, string> = {
		year,
		month,
		monthName,
		monthShort: monthShortName(month),
		day,
		dayOrdinal: ordinalDay(day),
		date,
		n: String(n),
		title: sanitizeTitle(meeting.title),
	};
	return template.replace(/\{(\w+)\}/g, (token, name: string) =>
		Object.prototype.hasOwnProperty.call(values, name) ? values[name] ?? token : token,
	);
}

/**
 * Return a name unique within `used`, appending a " (suffixId)" disambiguator
 * on collision (PLAN §7). Records the chosen name in `used`.
 */
export function uniqueName(base: string, suffixId: string, used: Set<string>): string {
	let name = base;
	let counter = 2;
	while (used.has(name)) {
		const suffix = counter === 2 ? suffixId : `${suffixId}-${counter}`;
		name = sanitizeTitle(`${base} (${suffix})`);
		counter += 1;
	}
	used.add(name);
	return name;
}
