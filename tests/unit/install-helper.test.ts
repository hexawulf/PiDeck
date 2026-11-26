import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
// @ts-expect-error ESM script without .d.ts declarations
import { setAdminPassword } from "../../scripts/install-helper.mjs";

describe("install-helper setAdminPassword (AUTHN-001)", () => {
  it("invalidates active user_sessions rows when user_sessions table exists", async () => {
    const defaultHash = await bcrypt.hash("admin", 4);
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT password_hash FROM users")) {
          return { rows: [{ password_hash: defaultHash }] };
        }
        if (sql.includes("to_regclass('public.user_sessions')")) {
          return { rows: [{ tbl: "user_sessions" }] };
        }
        return { rows: [] };
      }),
    };

    const result = await setAdminPassword(client, "NewStrongPass!9", { force: true });
    expect(result).toBe("set");
    expect(queries.some((q) => q.includes("INSERT INTO users"))).toBe(true);
    expect(queries.some((q) => q.includes("DELETE FROM user_sessions"))).toBe(true);
  });

  it("skips DELETE FROM user_sessions when user_sessions table does not exist", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT password_hash FROM users")) {
          return { rows: [] };
        }
        if (sql.includes("to_regclass('public.user_sessions')")) {
          return { rows: [{ tbl: null }] };
        }
        return { rows: [] };
      }),
    };

    const result = await setAdminPassword(client, "NewStrongPass!9");
    expect(result).toBe("set");
    expect(queries.some((q) => q.includes("INSERT INTO users"))).toBe(true);
    expect(queries.some((q) => q.includes("DELETE FROM user_sessions"))).toBe(false);
  });

  it("does not clear user_sessions when custom password is unchanged without force", async () => {
    const customHash = await bcrypt.hash("ExistingPass!9", 4);
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT password_hash FROM users")) {
          return { rows: [{ password_hash: customHash }] };
        }
        return { rows: [] };
      }),
    };

    const result = await setAdminPassword(client, "NewStrongPass!9", { force: false });
    expect(result).toBe("unchanged-custom");
    expect(queries.some((q) => q.includes("DELETE FROM user_sessions"))).toBe(false);
  });
});
