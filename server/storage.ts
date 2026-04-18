import pkg from "pg";
const { Pool } = pkg;
import { type User, type InsertUser } from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  updateUser(user: User): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export const pool = new Pool({
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

}

export const storage = new PgStorage();

async function ensureAdminUserExists() {
  try {
    const admin = await storage.getUserByUsername("admin");
    if (!admin) {
      console.log("[PgStorage] Admin user not found — creating default admin.");
      const adminPasswordHash = "$2b$10$hAevPiEi8nM5HzWk4VcJteq3NIQb3GgHIfDu/aeMCUImiuVfApa8C";
      await storage.createUser({ username: "admin", password_hash: adminPasswordHash });
      console.log("[PgStorage] Default admin user created.");
    }
  } catch (error) {
    console.error("[PgStorage] Error ensuring admin user exists:", error);
  }
}

ensureAdminUserExists().catch(err => {
  console.error("[PgStorage] Failed to ensure admin user during module load:", err);
});
