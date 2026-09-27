import { describe, expect, it } from "vitest";
import {
  grepArgs, hasNestedQuantifier, lineFilter, LogFilterError, parseTail,
} from "../../server/services/log-filter";

const rejects = (fn: () => unknown, msg: RegExp) => {
  expect(fn).toThrow(LogFilterError);
  expect(fn).toThrow(msg);
};

describe("parseTail (rasplogs ?tail=)", () => {
  it.each([
    [undefined, 1000], ["", 1000], ["0", 1000], [0, 1000], ["-5", 1], ["99999", 10000],
    ["abc", 1000], ["250", 250], ["1", 1], ["10000", 10000], ["12abc", 12],
  ])("%j → %i", (input, out) => expect(parseTail(input)).toBe(out));
});

describe("grepArgs (rasplogs)", () => {
  it("returns null when there is no filter", () => {
    expect(grepArgs(undefined)).toBeNull();
    expect(grepArgs("")).toBeNull();
    expect(grepArgs("   ")).toBeNull();
  });

  it("puts leading-dash patterns after -e as fixed strings, then ends options", () => {
    expect(grepArgs("--help")).toEqual(["-F", "-e", "--help", "--"]);
    expect(grepArgs("-r")).toEqual(["-F", "-e", "-r", "--"]);
    expect(grepArgs("-f/etc/shadow")).toEqual(["-F", "-e", "-f/etc/shadow", "--"]);
  });

  it("treats regex metacharacters literally unless wrapped in /…/", () => {
    expect(grepArgs("a.*b")).toEqual(["-F", "-e", "a.*b", "--"]);
    expect(grepArgs("/err(or)?/")).toEqual(["-e", "err(or)?", "--"]);
    expect(grepArgs("/-v/")).toEqual(["-e", "-v", "--"]);
    expect(grepArgs("//")).toEqual(["-F", "-e", "//", "--"]); // too short to be a regex
  });

  it("caps length and rejects newline, CR, NUL and non-strings", () => {
    expect(grepArgs("x".repeat(200))).not.toBeNull();
    rejects(() => grepArgs("x".repeat(201)), /too long/);
    rejects(() => grepArgs("a\nb"), /newline/);
    rejects(() => grepArgs("a\rb"), /newline/);
    rejects(() => grepArgs("a\0b"), /NUL/);
    rejects(() => grepArgs(["a", "b"]), /single string/);
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
