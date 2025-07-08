import bcrypt from "bcrypt";
import { storage } from "../storage";
import type { User } from "@shared/schema"; // Import User type

interface ValidationResult {
  isValid: boolean;
  user?: User | null; // Use specific User type, allow null
  error?: string;     // Implicitly string | undefined
}

export class AuthService {
  static async validatePassword(password: string): Promise<ValidationResult> {
    try {
      const user = await storage.getUserByUsername("admin");
      if (!user) {
        console.error("[AuthService.validatePassword] Admin user not found in storage.");
        return { isValid: false, user: null, error: "user_not_found" };
      }

      // Check if account is locked
      if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
        console.warn(`[AuthService.validatePassword] Account for user ${user.username} is locked until ${user.account_locked_until}.`);
        return { isValid: false, user, error: "account_locked" };
      }
      
      // console.log(`[AuthService.validatePassword] Attempting to validate password. Input: "${password}", Stored Hash: "${user.password_hash}"`);

      const result = await bcrypt.compare(password, user.password_hash);
      // console.log(`[AuthService.validatePassword] bcrypt.compare result: ${result}`);

      if (result) {
        // Password is valid, reset failed attempts if any
        if (user.failed_login_attempts && user.failed_login_attempts > 0) {
          user.failed_login_attempts = 0;
          user.account_locked_until = null; // This is fine as account_locked_until can be null in DB
          await storage.updateUser(user);
        }
        return { isValid: true, user, error: undefined }; // Changed null to undefined
      } else {
        // Password is not valid, handle failed attempt
        user.failed_login_attempts = (user.failed_login_attempts || 0) + 1;
        if (user.failed_login_attempts >= 5) { // 5 failed attempts
          const lockoutDuration = 15 * 60 * 1000; // 15 minutes
          user.account_locked_until = new Date(Date.now() + lockoutDuration);
          console.warn(`[AuthService.validatePassword] User ${user.username} account locked due to too many failed attempts.`);
        }
        await storage.updateUser(user);
        return { isValid: false, user, error: "invalid_password" };
      }
    } catch (error) {
      console.error("[AuthService.validatePassword] Error during bcrypt.compare:", error);
      return { isValid: false, user: null, error: "bcrypt_error" };
    }
  }

  // static async createSession(): Promise<string> {
  //   // For now, session creation is still tied to 'admin'. This might need generalization later.
  //   const user = await storage.getUserByUsername("admin");
  //   if (!user) throw new Error("Admin user not found for session creation");
    
  //   const session = await storage.createSession(user.id);
  //   return session.id;
  // }

  // static async validateSession(sessionId: string): Promise<boolean> {
  //   const session = await storage.getSession(sessionId);
  //   return !!session;
  // }

  // static async deleteSession(sessionId: string): Promise<void> {
  //   await storage.deleteSession(sessionId);
  // }

  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 10; // Standard practice
    return bcrypt.hash(password, saltRounds);
  }

  static validatePasswordStrength(password: string): { isValid: boolean; message?: string } {
    if (password.length < 8) {
      return { isValid: false, message: "Password must be at least 8 characters long." };
    }
    if (!/[a-z]/.test(password)) {
      return { isValid: false, message: "Password must contain at least one lowercase letter." };
    }
    if (!/[A-Z]/.test(password)) {
      return { isValid: false, message: "Password must contain at least one uppercase letter." };
    }
    if (!/[0-9]/.test(password)) {
      return { isValid: false, message: "Password must contain at least one number." };
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
      return { isValid: false, message: "Password must contain at least one special character." };
    }
    return { isValid: true };
  }
}
