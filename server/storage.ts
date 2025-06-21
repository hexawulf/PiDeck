import { users, sessions, type User, type InsertUser, type Session } from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createSession(userId: number): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  deleteSession(sessionId: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private sessions: Map<string, Session>;
  private currentUserId: number;

  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.currentUserId = 1;
    
    // Create default admin user with password "admin" - initialize synchronously
    this.initializeAdminUser();
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async updateUser(user: User): Promise<User> {
    if (!this.users.has(user.id)) {
      throw new Error(`User with id ${user.id} not found.`);
    }
    this.users.set(user.id, user);
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    // Ensure all fields are present, providing defaults for new ones
    const newUser: User = {
      id,
      username: insertUser.username,
      password_hash: insertUser.password_hash,
      last_password_change: new Date(),
      failed_login_attempts: 0,
      account_locked_until: null, // Explicitly null
    };
    this.users.set(id, newUser);
    return newUser;
  }

  async createSession(userId: number): Promise<Session> {
    const sessionId = Math.random().toString(36).substring(2, 15) + 
                     Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    const session: Session = {
      id: sessionId,
      userId,
      expiresAt,
    };
    
    this.sessions.set(sessionId, session);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const session = this.sessions.get(sessionId);
    if (session && session.expiresAt > new Date()) {
      return session;
    }
    if (session) {
      this.sessions.delete(sessionId);
    }
    return undefined;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  private initializeAdminUser(): void {
    // Use the fresh hash we just generated for "admin"
    const adminUser: User = {
      id: 1, // Assuming admin user always has ID 1 in MemStorage
      username: "admin",
      password_hash: "$2b$10$hAevPiEi8nM5HzWk4VcJteq3NIQb3GgHIfDu/aeMCUImiuVfApa8C", // "admin"
      last_password_change: new Date(),
      failed_login_attempts: 0,
      account_locked_until: null, // Explicitly null for Date type compatibility
    };
    this.users.set(adminUser.id, adminUser);
    this.currentUserId = Math.max(this.currentUserId, adminUser.id + 1); // Ensure currentUserId is ahead
  }

  async cleanExpiredSessions(): Promise<void> {
    const now = new Date();
    const expiredSessions: string[] = [];
    this.sessions.forEach((session, sessionId) => {
      if (session.expiresAt <= now) {
        expiredSessions.push(sessionId);
      }
    });
    expiredSessions.forEach(sessionId => this.sessions.delete(sessionId));
  }
}

export const storage = new MemStorage();
