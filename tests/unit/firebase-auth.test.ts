import { describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn(),
  applicationDefault: vi.fn(),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: verifyIdTokenMock }),
}));

import {
  getFirebaseAllowedEmails,
  getFirebasePublicConfig,
  isFirebaseEnabled,
  verifyFirebaseLogin,
} from "../../server/services/firebase-auth";

describe("firebase-auth service", () => {
  describe("isFirebaseEnabled", () => {
    it("returns true only for true, 1, or yes (case-insensitive)", () => {
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "true" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "TRUE" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "1" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "yes" })).toBe(true);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "false" })).toBe(false);
      expect(isFirebaseEnabled({ FIREBASE_ENABLED: "0" })).toBe(false);
      expect(isFirebaseEnabled({})).toBe(false);
    });
  });

  describe("getFirebaseAllowedEmails", () => {
    it("splits, trims, and lowercases comma-separated emails", () => {
      const env = {
        FIREBASE_ALLOWED_EMAILS: "admin@example.com, ops@example.com,  test@DOMAIN.COM ",
      };
      expect(getFirebaseAllowedEmails(env)).toEqual([
        "admin@example.com",
        "ops@example.com",
        "test@domain.com",
      ]);
    });

    it("handles empty or missing variable gracefully", () => {
      expect(getFirebaseAllowedEmails({})).toEqual([]);
      expect(getFirebaseAllowedEmails({ FIREBASE_ALLOWED_EMAILS: "  " })).toEqual([]);
    });
  });

  describe("getFirebasePublicConfig", () => {
    it("returns enabled: false when disabled", () => {
      expect(getFirebasePublicConfig({})).toEqual({ enabled: false });
    });

    it("returns public config parameters when enabled", () => {
      const env = {
        FIREBASE_ENABLED: "true",
        FIREBASE_CLIENT_API_KEY: "AIzaSyFakeKey",
        FIREBASE_CLIENT_AUTH_DOMAIN: "pideck.firebaseapp.com",
        FIREBASE_PROJECT_ID: "pideck-auth",
        FIREBASE_CLIENT_APP_ID: "1:12345:web:6789",
      };
      expect(getFirebasePublicConfig(env)).toEqual({
        enabled: true,
        apiKey: "AIzaSyFakeKey",
        authDomain: "pideck.firebaseapp.com",
        projectId: "pideck-auth",
        appId: "1:12345:web:6789",
      });
    });
  });

  describe("verifyFirebaseLogin", () => {
    it("rejects with status 503 if Firebase is disabled", async () => {
      await expect(verifyFirebaseLogin("some-token", { FIREBASE_ENABLED: "false" })).rejects.toMatchObject({
        status: 503,
      });
    });

    it("rejects with status 400 if token is missing or blank", async () => {
      await expect(verifyFirebaseLogin("", { FIREBASE_ENABLED: "true" })).rejects.toMatchObject({
        status: 400,
      });
    });

    it("passes checkRevoked=true to verifyIdToken (AUTHN-007)", async () => {
      verifyIdTokenMock.mockReset();
      verifyIdTokenMock.mockResolvedValueOnce({
        uid: "uid-1",
        email: "allowed@example.com",
        email_verified: true,
        name: "Allowed User",
      });

      const user = await verifyFirebaseLogin("  tok-123  ", {
        FIREBASE_ENABLED: "true",
        FIREBASE_ALLOWED_EMAILS: "allowed@example.com",
      });
      expect(verifyIdTokenMock).toHaveBeenCalledWith("tok-123", true);
      expect(user).toEqual({
        uid: "uid-1",
        email: "allowed@example.com",
        name: "Allowed User",
      });

      verifyIdTokenMock.mockRejectedValueOnce(new Error("auth/id-token-revoked"));
      await expect(
        verifyFirebaseLogin("revoked-tok", {
          FIREBASE_ENABLED: "true",
          FIREBASE_ALLOWED_EMAILS: "allowed@example.com",
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(verifyIdTokenMock).toHaveBeenLastCalledWith("revoked-tok", true);
    });
  });
});
