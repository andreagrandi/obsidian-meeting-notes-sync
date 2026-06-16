import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * One-command release bump invoked as `npm run release <major.minor.patch>`.
 * Mirrors the version into every manifest, commits, and tags it for the workflow.
 */

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
	throw new Error(`Usage: npm run release <major.minor.patch> (got: ${version ?? "<nothing>"})`);
}

const git = (cmd) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();

const branch = git("rev-parse --abbrev-ref HEAD");
if (branch !== "master") {
	throw new Error(`Releases are cut from master; you are on "${branch}".`);
}
if (git("status --porcelain")) {
	throw new Error("Working tree is not clean; commit or stash changes first.");
}
if (git("tag --list " + version)) {
	throw new Error(`Tag ${version} already exists.`);
}

/** Read a JSON file, apply a mutation, and write it back with the repo's tab style. */
function patchJson(path, mutate) {
	const value = JSON.parse(readFileSync(path, "utf8"));
	mutate(value);
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

patchJson("package.json", (pkg) => {
	pkg.version = version;
});

let minAppVersion;
patchJson("manifest.json", (manifest) => {
	minAppVersion = manifest.minAppVersion;
	manifest.version = version;
});

patchJson("versions.json", (versions) => {
	versions[version] = minAppVersion;
});

patchJson("package-lock.json", (lock) => {
	lock.version = version;
	if (lock.packages?.[""]) {
		lock.packages[""].version = version;
	}
});

git("add package.json manifest.json versions.json package-lock.json");
git(`commit -m "release: v${version}"`);
git(`tag -a ${version} -m "release: v${version}"`);

console.log(`Tagged ${version}. Push the release with:`);
console.log(`  git push origin master && git push origin ${version}`);
