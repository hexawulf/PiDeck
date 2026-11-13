import bcrypt from "bcrypt";
import { storage } from "../storage";
import type { User } from "@shared/schema"; // Import User type

interface ValidationResult {
  isValid: boolean;
  user?: User | null; // Use specific User type, allow null
  error?: string;     // Implicitly string | undefined
}

export class AuthService {
  /**
   * Compare against the admin's stored hash. No lockout here any more: that
   * is per client address in services/login-lockout.ts (PD-17); the
   * failed_login_attempts / account_locked_until columns are no longer used.
   */
  static async validatePassword(password: string): Promise<ValidationResult> {
    try {
      const user = await storage.getUserByUsername("admin");
      if (!user) {
        console.error("[AuthService.validatePassword] Admin user not found in storage.");
        return { isValid: false, user: null, error: "user_not_found" };
      }
      const result = await bcrypt.compare(password, user.password_hash);
      return result ? { isValid: true, user, error: undefined } : { isValid: false, user, error: "invalid_password" };
    } catch (error) {
      console.error("[AuthService.validatePassword] Error during bcrypt.compare:", error);
      return { isValid: false, user: null, error: "bcrypt_error" };
    }
  }

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
