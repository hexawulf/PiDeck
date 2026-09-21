import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { envPasswordMatches, expectedEnvPassword } from "../../server/services/env-password";

describe("env password", () => {
  it("no env configured → never matches (DB path is used)", () => {
    expect(envPasswordMatches("anything", {})).toBe(false);
    expect(envPasswordMatches("", {})).toBe(false);
  });

  it("APP_PASSWORD matches (trimmed) and rejects others", () => {
    const env = { APP_PASSWORD: " s3cret \n" };
    expect(envPasswordMatches("s3cret", env)).toBe(true);
    expect(envPasswordMatches(" s3cret ", env)).toBe(true);
    expect(envPasswordMatches("s3cre", env)).toBe(false);
  });

  it("APP_PASSWORD wins over APP_PASSWORD_FILE", () => {
    expect(expectedEnvPassword({ APP_PASSWORD: "a", APP_PASSWORD_FILE: "/nope" })).toBe("a");
  });

  it("reads APP_PASSWORD_FILE when APP_PASSWORD is empty", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pideck-")), "pw");
    fs.writeFileSync(f, "from-file\n");
    expect(envPasswordMatches("from-file", { APP_PASSWORD: "", APP_PASSWORD_FILE: f })).toBe(true);
  });

  it("unreadable file → no env password", () => {
    expect(expectedEnvPassword({ APP_PASSWORD_FILE: "/definitely/missing" })).toBe("");
  });
});
