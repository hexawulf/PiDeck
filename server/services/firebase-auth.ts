import fs from "fs";
import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { sanitizeLogValue } from "./log-sanitize";

export interface FirebasePublicConfig {
  enabled: boolean;
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}

export interface VerifiedFirebaseUser {
  email: string;
  uid: string;
  name?: string;
}

let firebaseAdminApp: App | null = null;

export function isFirebaseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const val = (env.FIREBASE_ENABLED || "").trim().toLowerCase();
  return val === "true" || val === "1" || val === "yes";
}

export function getFirebaseAllowedEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.FIREBASE_ALLOWED_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function getFirebasePublicConfig(env: NodeJS.ProcessEnv = process.env): FirebasePublicConfig {
  const enabled = isFirebaseEnabled(env);
  if (!enabled) {
    return { enabled: false };
  }
  return {
    enabled: true,
    apiKey: (env.FIREBASE_CLIENT_API_KEY || "").trim() || undefined,
    authDomain: (env.FIREBASE_CLIENT_AUTH_DOMAIN || "").trim() || undefined,
    projectId: (env.FIREBASE_PROJECT_ID || "").trim() || undefined,
    appId: (env.FIREBASE_CLIENT_APP_ID || "").trim() || undefined,
  };
}

export function getFirebaseAdminApp(env: NodeJS.ProcessEnv = process.env): App {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  const existingApps = getApps();
  if (existingApps && existingApps.length > 0 && existingApps[0]) {
    firebaseAdminApp = existingApps[0];
    return firebaseAdminApp;
  }

  let credential: Credential | undefined;
  let projectId = (env.FIREBASE_PROJECT_ID || "").trim() || undefined;

  const keyPath = (env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  const rawJson = (env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();

  if (keyPath) {
    try {
      const content = fs.readFileSync(keyPath, "utf8");
      const parsed = JSON.parse(content);
      credential = cert(parsed);
      if (!projectId && parsed.project_id) {
        projectId = parsed.project_id;
      }
    } catch (err) {
      console.error(`[Firebase] Failed to load service account key from ${keyPath}:`, err);
      throw new Error(`Failed to load Firebase service account from ${keyPath}`, { cause: err });
    }
  } else if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      credential = cert(parsed);
      if (!projectId && parsed.project_id) {
        projectId = parsed.project_id;
      }
    } catch (err) {
      console.error("[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", err);
      throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON", { cause: err });
    }
  } else {
    // Fall back to Google Application Default Credentials
    credential = applicationDefault();
  }

  firebaseAdminApp = initializeApp({
    credential,
    projectId,
  });

  return firebaseAdminApp;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

export async function verifyFirebaseLogin(
  idToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerifiedFirebaseUser> {
  if (!isFirebaseEnabled(env)) {
    throw new HttpError(503, "Firebase authentication is disabled on this host.");
  }

  if (!idToken || typeof idToken !== "string" || !idToken.trim()) {
    throw new HttpError(400, "Missing or invalid ID token.");
  }

  let app: App;
  try {
    app = getFirebaseAdminApp(env);
  } catch (e) {
    throw new HttpError(500, "Firebase Admin is not configured properly on the server.", { cause: e });
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth(app).verifyIdToken(idToken.trim(), true);
  } catch (e: unknown) {
    console.warn("[Firebase] Failed to verify ID token:", sanitizeLogValue(e instanceof Error ? e.message : e, 200));
    throw new HttpError(401, "Invalid or expired Firebase ID token.", { cause: e });
  }

  const email = (decoded.email || "").trim().toLowerCase();
  if (!email || !decoded.email_verified) {
    throw new HttpError(403, "Google account email is missing or not verified.");
  }

  const allowedEmails = getFirebaseAllowedEmails(env);
  if (allowedEmails.length === 0) {
    console.error("[Firebase] No allowed emails configured in FIREBASE_ALLOWED_EMAILS.");
    throw new HttpError(403, "No authorized accounts configured on this host.");
  }

  if (!allowedEmails.includes(email)) {
    console.warn(`[Firebase Auth] Access denied: Account '${sanitizeLogValue(email, 120)}' is not in FIREBASE_ALLOWED_EMAILS.`);
    throw new HttpError(403, `Account '${email}' is not authorized to access PiDeck.`);
  }

  return {
    email,
    uid: decoded.uid,
    name: decoded.name,
  };
}
