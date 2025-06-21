-- Check if the users table exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
        -- Create the users table if it doesn't exist (e.g., fresh install)
        CREATE TABLE "users" (
            "id" serial PRIMARY KEY NOT NULL,
            "username" text NOT NULL UNIQUE,
            "password_hash" text NOT NULL,
            "last_password_change" timestamp DEFAULT now(),
            "failed_login_attempts" integer DEFAULT 0,
            "account_locked_until" timestamp
        );
        -- If you have a default admin user to insert on fresh install, do it here.
        -- This hash is for 'admin': $2b$10$hAevPiEi8nM5HzWk4VcJteq3NIQb3GgHIfDu/aeMCUImiuVfApa8C
        -- You might want to prompt the admin to change this immediately after first login.
        INSERT INTO "users" ("username", "password_hash", "last_password_change", "failed_login_attempts")
        VALUES ('admin', '$2b$10$hAevPiEi8nM5HzWk4VcJteq3NIQb3GgHIfDu/aeMCUImiuVfApa8C', NOW(), 0);
    ELSE
        -- Alter the existing users table
        -- Check if the 'password' column exists before trying to rename it
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password') THEN
            ALTER TABLE "users" RENAME COLUMN "password" TO "password_hash";
        END IF;

        -- Add new columns if they don't exist
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "password_hash" text, -- In case table existed but without password_hash (e.g. only username)
        ADD COLUMN IF NOT EXISTS "last_password_change" timestamp,
        ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer,
        ADD COLUMN IF NOT EXISTS "account_locked_until" timestamp;

        -- Update existing admin user if necessary, or set defaults
        -- This ensures the admin user (if exists) has the new fields populated.
        UPDATE "users"
        SET
            "password_hash" = COALESCE("password_hash", '$2b$10$hAevPiEi8nM5HzWk4VcJteq3NIQb3GgHIfDu/aeMCUImiuVfApa8C'), -- Set if null
            "last_password_change" = COALESCE("last_password_change", now()),
            "failed_login_attempts" = COALESCE("failed_login_attempts", 0)
        WHERE "username" = 'admin';

        -- If password_hash was just added and is still null for admin, it means it was a very old schema
        -- This ensures the admin user has a default password hash.
        IF (SELECT "password_hash" FROM "users" WHERE "username" = 'admin' LIMIT 1) IS NULL THEN
             UPDATE "users" SET "password_hash" = '$2b$10$hAevPiEi8nM5HzWk4VcJteq3NIQb3GgHIfDu/aeMCUImiuVfApa8C'
             WHERE "username" = 'admin';
        END IF;

    END IF;
END $$;

-- Optional: Add an index on username for faster lookups if not already implicitly created by UNIQUE
CREATE INDEX IF NOT EXISTS "idx_users_username" ON "users" ("username");

COMMENT ON COLUMN "users"."password_hash" IS 'Stores the bcrypt hash of the user password.';
COMMENT ON COLUMN "users"."last_password_change" IS 'Timestamp of the last successful password change.';
COMMENT ON COLUMN "users"."failed_login_attempts" IS 'Counter for consecutive failed login attempts.';
COMMENT ON COLUMN "users"."account_locked_until" IS 'Timestamp until which the account is locked due to failed attempts. NULL if not locked.';
