import { describe, expect, it, vi } from "vitest";
import type { InsertUser, User } from "@shared/schema";
import {
  adminPasswordIsDefault,
  DEFAULT_ADMIN_HASH,
  ensureAdminUserExists,
  type IStorage,
  markAdminPasswordChanged,
} from "../../server/storage";

function mockStore(existing?: User): { store: IStorage; created: InsertUser[] } {
  const created: InsertUser[] = [];
  const store: IStorage = {
    async getUser() {
      return existing;
    },
    async getUserByUsername() {
      return existing;
    },
    async updateUser(u) {
      return u;
    },
    async createUser(u) {
      created.push(u);
      return {
        id: 1,
        username: u.username,
        password_hash: u.password_hash,
        last_password_change: new Date(),
        failed_login_attempts: 0,
        account_locked_until: null,
      };
    },
  };
  return { store, created };
}

describe("ensureAdminUserExists (SECRETS-003)", () => {
  it("refuses to auto-seed admin/admin in production when users table is empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, created } = mockStore(undefined);
    const res = await ensureAdminUserExists({ store, env: { NODE_ENV: "production" } });
    expect(res).toEqual({ seeded: false, usesDefault: false });
    expect(created).toHaveLength(0);
    expect(adminPasswordIsDefault()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still seeds default admin in non-production for local development", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, created } = mockStore(undefined);
    const res = await ensureAdminUserExists({ store, env: { NODE_ENV: "development" } });
    expect(res.seeded).toBe(true);
    expect(res.usesDefault).toBe(true);
    expect(created).toEqual([{ username: "admin", password_hash: DEFAULT_ADMIN_HASH }]);
    expect(adminPasswordIsDefault()).toBe(true);
    markAdminPasswordChanged();
    expect(adminPasswordIsDefault()).toBe(false);
    log.mockRestore();
    warn.mockRestore();
  });
});
