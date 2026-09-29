-- idx_users_username duplicates the users_username_unique constraint's index. Prod
-- has it (old hand-written migration, now migrations/legacy/); databases made by
-- drizzle-kit push (2.3/2.4 installer) do not, hence IF EXISTS.
DROP INDEX IF EXISTS "idx_users_username";
