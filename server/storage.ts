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
    
    // Create default admin user with password "admin"
    this.createUser({
      username: "admin",
      password: "$2b$10$8K1p/a0dL8/jz1Q5E.SBfuI5tMY5fwFfFjq8YjFhH5vZ5UQF.IqKy" // "admin" hashed
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
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
