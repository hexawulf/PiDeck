import bcrypt from "bcryptjs";
import { storage } from "../storage";

export class AuthService {
  static async validatePassword(password: string): Promise<boolean> {
    const user = await storage.getUserByUsername("admin");
    if (!user) {
      console.error("[AuthService.validatePassword] Admin user not found in storage.");
      return false;
    }
    
    console.log(`[AuthService.validatePassword] Attempting to validate password. Input: "${password}", Stored Hash: "${user.password}"`);

    try {
      const result = await bcrypt.compare(password, user.password);
      console.log(`[AuthService.validatePassword] bcrypt.compare result: ${result}`);
      return result;
    } catch (error) {
      console.error("[AuthService.validatePassword] Error during bcrypt.compare:", error);
      return false; // Or rethrow, depending on desired error handling
    }
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
