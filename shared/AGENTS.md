# Shared (Types & Schema) - Agent Instructions

## Package Identity
**What**: Shared TypeScript types, Drizzle schema, and Zod validators for PiDeck  
**Tech**: Drizzle ORM, Zod, TypeScript

## Purpose
This folder contains **all shared type definitions** used by both client and server:
- **Database schema** (Drizzle tables)
- **Zod validators** (input validation)
- **TypeScript types** (API contracts, domain models)

## Setup & Usage
No separate build step required - TypeScript resolves via path alias `@shared/*`

**Import in client**:
```typescript
import type { SystemInfo, DockerContainer, User } from '@shared/schema'
```

**Import in server**:
```typescript
import { users, historicalMetrics, insertUserSchema } from '@shared/schema'
import type { SystemInfo } from '@shared/schema'
```

## Patterns & Conventions

### File Organization
```
shared/
└── schema.ts         # Single file with all types, schemas, and tables
```

**Why single file?**  
- Small codebase with tightly coupled types
- Easier to maintain consistency
- No circular dependency issues

### Schema Structure
**Location**: `shared/schema.ts`

**Contains**:
1. **Drizzle Tables** - Database schema with `pgTable()`
2. **Zod Schemas** - Input validation with `z.object()`
3. **TypeScript Types** - API contracts and domain models
4. **Inferred Types** - From Drizzle/Zod (e.g., `typeof users.$inferSelect`)

### Adding Database Tables (Drizzle)
**Pattern**:
```typescript
import { pgTable, text, serial, integer, timestamp } from 'drizzle-orm/pg-core'
import { createInsertSchema } from 'drizzle-zod'

export const myTable = pgTable('my_table', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  count: integer('count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
})

// Auto-generate Zod schema for inserts
export const insertMyTableSchema = createInsertSchema(myTable)

// Infer TypeScript types
export type MyTable = typeof myTable.$inferSelect
export type InsertMyTable = typeof myTable.$inferInsert
```

**After adding/changing tables**:
```bash
npm run db:push   # Apply schema to database
```

### Adding API Types
**Pattern**:
```typescript
export type MyApiResponse = {
  data: string[]
  count: number
  error?: string
}

export type MyApiRequest = {
  filter: string
  limit: number
}
```

**Usage in server**:
```typescript
import type { MyApiResponse } from '@shared/schema'
router.get('/api/my-endpoint', (req, res) => {
  const response: MyApiResponse = { data: [], count: 0 }
  res.json(response)
})
```

**Usage in client**:
```typescript
import type { MyApiResponse } from '@shared/schema'
const { data } = useQuery<MyApiResponse>({
  queryKey: ['/api/my-endpoint'],
})
```

### Adding Zod Validators
**Pattern**:
```typescript
import { z } from 'zod'

export const myInputSchema = z.object({
  username: z.string().min(3).max(50),
  age: z.number().int().min(0).max(150),
  email: z.string().email().optional(),
})

export type MyInput = z.infer<typeof myInputSchema>
```

**Usage in server** (input validation):
```typescript
import { myInputSchema } from '@shared/schema'

router.post('/api/my-endpoint', (req, res) => {
  const result = myInputSchema.safeParse(req.body)
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues })
  }
  const validated = result.data
  // Use validated data
})
```

## Touch Points / Key Files

### Single Source of Truth
- **Everything**: `shared/schema.ts` - All types, schemas, tables in one file

### Key Exports
- **Tables**: `users`, `sessions`, `historicalMetrics`
- **Schemas**: `insertUserSchema`, `loginSchema`, `diskIOSchema`, `networkBandwidthSchema`
- **Types**: `User`, `SystemInfo`, `DockerContainer`, `PM2Process`, `HistoricalMetric`

## JIT Index Hints
```bash
# Find a type definition
rg -n "export type" shared/schema.ts

# Find a Drizzle table
rg -n "pgTable" shared/schema.ts

# Find a Zod schema
rg -n "z\.object" shared/schema.ts

# Find inferred types
rg -n "\$inferSelect|\$inferInsert" shared/schema.ts

# See all exports
rg -n "^export" shared/schema.ts
```

## Common Gotchas
- **Schema changes**: ALWAYS run `npm run db:push` after editing Drizzle tables
- **Type imports**: Use `import type { }` for types, `import { }` for tables/schemas
- **Zod validation**: Use `.safeParse()` not `.parse()` to avoid throwing exceptions
- **Circular refs**: Avoid by keeping all types in single file
- **Timestamps**: Use `timestamp('field', { mode: 'string' })` for postgres.js compatibility

## Pre-PR Checks
```bash
# From project root
npm run check          # TypeScript validation

# If you changed Drizzle schema
npm run db:push        # Apply to database
```

**Checklist**:
- [ ] All new tables have corresponding inferred types
- [ ] Zod schemas exist for user input validation
- [ ] Types exported and used in both client and server
- [ ] Database changes applied with `npm run db:push`
