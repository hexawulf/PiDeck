// About shows the version (linked to its GitHub tag) and the release date.
// Both come from package.json; this keeps them honest against the changelog.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatReleaseDate, releaseUrl } from "../../client/src/components/modals/about-modal";

const root = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");

describe("release metadata", () => {
  it("the newest changelog entry is the package version, with the package's release date", () => {
    const top = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/m.exec(changelog);
    expect(top, "CHANGELOG.md needs a '## [x.y.z] - YYYY-MM-DD' entry").not.toBeNull();
    expect(top![1]).toBe(pkg.version);
    expect(top![2]).toBe(pkg.releaseDate);
  });

  it("package-lock.json and the README name the same version", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toContain(`**Current version: ${pkg.version}**`);
  });

  it("the About link points at the v-prefixed GitHub tag", () => {
    expect(releaseUrl("2.10.0")).toBe("https://github.com/hexawulf/PiDeck/releases/tag/v2.10.0");
  });

  it("formats the release date as a calendar day", () => {
    expect(formatReleaseDate("2026-11-13")).toBe("13 November 2026");
    expect(formatReleaseDate("2026-01-05")).toBe("5 January 2026");
    expect(formatReleaseDate(pkg.releaseDate)).not.toBe("unknown");
    expect(formatReleaseDate("")).toBe("unknown");
    expect(formatReleaseDate("2026-13-01")).toBe("unknown");
  });
});
