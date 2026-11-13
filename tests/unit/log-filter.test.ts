import { describe, expect, it } from "vitest";
import {
  hasNestedQuantifier, lineFilter, LogFilterError, parsePattern,
} from "../../server/services/log-filter";

const rejects = (fn: () => unknown, msg: RegExp) => {
  expect(fn).toThrow(LogFilterError);
  expect(fn).toThrow(msg);
};

describe("parsePattern", () => {
  it("returns null when there is no filter", () => {
    expect(parsePattern(undefined)).toBeNull();
    expect(parsePattern("")).toBeNull();
    expect(parsePattern("   ")).toBeNull();
  });

  it("is literal unless wrapped in /…/ (at least one char inside)", () => {
    expect(parsePattern("--help")).toEqual({ kind: "literal", source: "--help" });
    expect(parsePattern("a.*b")).toEqual({ kind: "literal", source: "a.*b" });
    expect(parsePattern("/err(or)?/")).toEqual({ kind: "regex", source: "err(or)?" });
    expect(parsePattern("//")).toEqual({ kind: "literal", source: "//" });
  });

  it("caps length and rejects newline, CR, NUL and non-strings", () => {
    expect(parsePattern("x".repeat(200))).not.toBeNull();
    rejects(() => parsePattern("x".repeat(201)), /too long/);
    rejects(() => parsePattern("a\nb"), /newline/);
    rejects(() => parsePattern("a\rb"), /newline/);
    rejects(() => parsePattern("a\0b"), /NUL/);
    rejects(() => parsePattern(["a", "b"]), /single string/);
  });
});

describe("hasNestedQuantifier", () => {
  it.each(["(a+)+", "(a*)*", "(a|a)+", "(.*)*", "(a?)*", "((ab)+)+", "(?:x+){2,}", "(\\d+)*", "((a)?)+"])(
    "flags %s", (src) => expect(hasNestedQuantifier(src)).toBe(true));

  it.each(["a+b*", "(ab)+", "(error|warn)", "(\\d{4})-\\d+", "[(a+)]+", "\\(a+\\)+", "(?:ab)*", "^\\[\\w+\\]"])(
    "allows %s", (src) => expect(hasNestedQuantifier(src)).toBe(false));
});

describe("lineFilter (hostLogs)", () => {
  const lines = ["ERROR disk full", "warn: slow", "info ok", "a.*b literal", "use --help"];
  const run = (raw: string) => lines.filter(lineFilter(raw)!);

  it("matches plain text as a case-insensitive substring", () => {
    expect(run("error")).toEqual(["ERROR disk full"]);
    expect(run("a.*b")).toEqual(["a.*b literal"]); // not a regex
    expect(run("--help")).toEqual(["use --help"]);
    expect(run("error|warn")).toEqual([]); // literal "|"
  });

  it("uses a case-insensitive RegExp only for /…/", () => {
    expect(run("/^(error|info)/")).toEqual(["ERROR disk full", "info ok"]);
  });

  it("returns null for no filter", () => expect(lineFilter(undefined)).toBeNull());

  it("rejects long, nested-quantifier and invalid regexes with 400", () => {
    expect(lineFilter(`/${"a".repeat(100)}/`)).not.toBeNull();
    rejects(() => lineFilter(`/${"a".repeat(101)}/`), /regex too long/);
    rejects(() => lineFilter("/(a+)+$/"), /regex too complex/);
    rejects(() => lineFilter("/(.*)*x/"), /regex too complex/);
    rejects(() => lineFilter("/(a|a)+/"), /regex too complex/);
    rejects(() => lineFilter("/foo(/"), /invalid regex/);
    try { lineFilter("/[/"); } catch (e) { expect((e as LogFilterError).status).toBe(400); }
  });

  it("still applies the overall 200-char cap to substrings", () => {
    rejects(() => lineFilter("x".repeat(201)), /too long/);
  });
});
