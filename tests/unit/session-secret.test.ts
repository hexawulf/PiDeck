import { describe, expect, it } from "vitest";
import { resolveSessionSecret } from "../../server/config";

describe("resolveSessionSecret (SECRETS-002)", () => {
  it("rejects missing, whitespace, placeholder, and short secrets in production", () => {
    expect(() => resolveSessionSecret({ NODE_ENV: "production" })).toThrow(/must be set/i);
    expect(() => resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "   " })).toThrow(/must be set/i);
    expect(() =>
      resolveSessionSecret({
        NODE_ENV: "production",
        SESSION_SECRET: "CHANGE_ME_SESSION_SECRET_LONG_RANDOM",
      }),
    ).toThrow(/placeholder/i);
    expect(() =>
      resolveSessionSecret({
        NODE_ENV: "production",
        SESSION_SECRET: "change_me_lowercase_still_rejected_1234567890",
      }),
    ).toThrow(/placeholder/i);
    expect(() =>
      resolveSessionSecret({
        NODE_ENV: "production",
        SESSION_SECRET: "too-short-secret",
      }),
    ).toThrow(/at least 32/i);
  });

  it("accepts a trimmed 32+ char non-placeholder secret in production", () => {
    const valid = "a".repeat(32);
    expect(resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: `  ${valid}  ` })).toBe(valid);
  });

  it("uses an ephemeral random fallback outside production instead of a hardcoded literal", () => {
    const a = resolveSessionSecret({ NODE_ENV: "development" });
    const b = resolveSessionSecret({ NODE_ENV: "development" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(resolveSessionSecret({ NODE_ENV: "test", SESSION_SECRET: "CHANGE_ME_SESSION_SECRET_LONG_RANDOM" })).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
