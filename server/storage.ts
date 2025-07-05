import { Pool } from "pg";
import { users, sessions, type User, type InsertUser, type Session } from "@shared/schema";
import dotenv from 'dotenv';

dotenv.config(); // Ensure environment variables are loaded

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  updateUser(user: User): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  // Session methods will remain using MemStore via express-session, so they are not part of PgStorage
  // createSession(userId: number): Promise<Session>;
  // getSession(sessionId: string): Promise<Session | undefined>;
  // deleteSession(sessionId: string): Promise<void>;
  // cleanExpiredSessions(): Promise<void>;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', () => {
  console.log('[PgStorage] Connected to PostgreSQL database.');
});

pool.on('error', (err) => {
  console.error('[PgStorage] Unexpected error on idle client', err);
  process.exit(-1);
});

export class PgStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const res = await pool.query<User>(
      'SELECT id, username, password_hash, last_password_change, failed_login_attempts, account_locked_until FROM users WHERE id = $1',
      [id]
    );
    return res.rows[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const res = await pool.query<User>(
      'SELECT id, username, password_hash, last_password_change, failed_login_attempts, account_locked_until FROM users WHERE username = $1',
      [username]
    );
    return res.rows[0];
  }

  async updateUser(user: User): Promise<User | undefined> {
    const res = await pool.query<User>(
      `UPDATE users
       SET password_hash = $1, last_password_change = $2, failed_login_attempts = $3, account_locked_until = $4
       WHERE id = $5 RETURNING id, username, password_hash, last_password_change, failed_login_attempts, account_locked_until`,
      [user.password_hash, user.last_password_change, user.failed_login_attempts, user.account_locked_until, user.id]
    );
    if (res.rowCount === 0) {
        console.warn(`[PgStorage.updateUser] Attempted to update non-existent user with ID: ${user.id}`);
        return undefined;
    }
    return res.rows[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    // Note: The 'users' table schema has SERIAL PRIMARY KEY for id, so it's auto-generated.
    // last_password_change defaults to now() in DB.
    // failed_login_attempts defaults to 0 in DB.
    // account_locked_until can be NULL.
    const res = await pool.query<User>(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, password_hash, last_password_change, failed_login_attempts, account_locked_until`,
      [insertUser.username, insertUser.password_hash]
    );
    return res.rows[0];
  }

  // The following methods were part of MemStorage for sessions.
  // Since express-session with MemStore (from 'memorystore') is already configured in server/routes.ts,
  // we don't need to implement session storage here if we are fine with sessions being in-memory
  // and not persisted in PostgreSQL. The task description focuses on user password management.

  // async createSession(userId: number): Promise<Session> { /* ... */ }
  // async getSession(sessionId: string): Promise<Session | undefined> { /* ... */ }
  // async deleteSession(sessionId: string): Promise<void> { /* ... */ }
  // async cleanExpiredSessions(): Promise<void> { /* ... */ }
}

// Export an instance of PgStorage
export const storage = new PgStorage();

// Helper function to ensure the admin user exists, as was done in MemStorage.
// This is more of a one-time setup or verification step.
// In a real production app, this might be a migration or seed script.
async function ensureAdminUserExists() {
  try {
    const admin = await storage.getUserByUsername("admin");
    if (!admin) {
      console.log("[PgStorage] Admin user not found. Creating one with default password 'admin'.");
      // This is the hash for "admin"
      const adminPasswordHash = "$2b$10$hAevPiEi8nM5HzWk4VcJteq3NIQb3GgHIfDu/aeMCUImiuVfApa8C";
      await storage.createUser({
        username: "admin",
        password_hash: adminPasswordHash,
      });
      console.log("[PgStorage] Default admin user created.");
    } else {
      // console.log("[PgStorage] Admin user already exists.");
      // Optionally, verify/update the password if it's different from the default,
      // but this could be controversial if the admin changed it intentionally.
      // For now, just ensure it exists.
    }
  } catch (error) {
    console.error("[PgStorage] Error ensuring admin user exists:", error);
    // This might happen if the database isn't ready or schema doesn't exist.
    // Consider how to handle this gracefully. For now, logging the error.
  }
}

// Call this function when the module loads to ensure the admin user is there.
// This mimics the behavior of MemStorage which initialized the admin user in its constructor.
// However, we need to be careful about running async operations at the module level.
// A better approach for production would be a separate seeding script or migration.
// For this exercise, we'll call it and log potential issues.
ensureAdminUserExists().catch(err => {
  console.error("[PgStorage] Failed to ensure admin user during module load:", err);
});
