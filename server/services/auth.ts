import bcrypt from "bcrypt";
import { storage } from "../storage";

export class AuthService {
  static async validatePassword(password: string): Promise<boolean> {
    const user = await storage.getUserByUsername("admin");
    if (!user) return false;
    
    return bcrypt.compare(password, user.password);
  }

  static async createSession(): Promise<string> {
    const user = await storage.getUserByUsername("admin");
    if (!user) throw new Error("Admin user not found");
    
    const session = await storage.createSession(user.id);
    return session.id;
  }

  static async validateSession(sessionId: string): Promise<boolean> {
    const session = await storage.getSession(sessionId);
    return !!session;
  }

  static async deleteSession(sessionId: string): Promise<void> {
    await storage.deleteSession(sessionId);
  }
}
