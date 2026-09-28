import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@shared/schema';

// Lazy: nothing connects (or even checks DATABASE_URL) until the first
// query. Agent mode (PIDECK_MODE=agent) imports SystemService, which imports
// this module, and must never open a database connection.
let instance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!instance) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. Please check your .env file.");
    }
    instance = drizzle(postgres(process.env.DATABASE_URL), { schema });
  }
  return instance;
}
