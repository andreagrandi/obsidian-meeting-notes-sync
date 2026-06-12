import { readFileSync, writeFileSync } from "node:fs";

// Driven by `npm version`: npm sets the new version in package.json first and
// exposes it here, then this script mirrors it into manifest.json and records
// the (version -> minAppVersion) pair in versions.json.
const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	throw new Error("npm_package_version is not set; run this via `npm version`.");
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);
