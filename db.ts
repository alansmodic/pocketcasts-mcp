// User store, backed by Railway Postgres via Bun's built-in SQL client.
//
// One row per enrolled user. The bearer token is represented only by its hash
// (`token_hash`); the user's Pocket Casts tokens live encrypted in `enc_tokens`.

import { SQL } from "bun";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL env var is required (Railway Postgres provides this automatically).");
  process.exit(1);
}

const sql = new SQL(connectionString);

export type UserRow = {
  id: string;
  pc_email: string;
  enc_tokens: string;
};

/** Create the table if it doesn't exist. Safe to call on every boot. */
export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      token_hash   TEXT UNIQUE NOT NULL,
      pc_email     TEXT NOT NULL,
      enc_tokens   TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_pc_email_idx ON users (pc_email)`;
}

/**
 * Enroll (or re-enroll) a user. Keyed by Pocket Casts email so re-enrolling
 * rotates the bearer and refreshes the stored session rather than duplicating.
 * Returns the new user id.
 */
export async function upsertUser(params: {
  email: string;
  tokenHash: string;
  encTokens: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await sql`DELETE FROM users WHERE pc_email = ${params.email}`;
  await sql`
    INSERT INTO users (id, token_hash, pc_email, enc_tokens)
    VALUES (${id}, ${params.tokenHash}, ${params.email}, ${params.encTokens})
  `;
  return id;
}

/** Look up a user by bearer-token hash, stamping last_used_at. */
export async function findByTokenHash(tokenHash: string): Promise<UserRow | null> {
  const rows = (await sql`
    UPDATE users SET last_used_at = now()
    WHERE token_hash = ${tokenHash}
    RETURNING id, pc_email, enc_tokens
  `) as UserRow[];
  return rows[0] ?? null;
}

/** Persist freshly-refreshed (and re-encrypted) Pocket Casts tokens for a user. */
export async function updateTokens(id: string, encTokens: string): Promise<void> {
  await sql`UPDATE users SET enc_tokens = ${encTokens} WHERE id = ${id}`;
}

/** Delete a user by bearer-token hash. Returns rows removed (0 or 1). */
export async function deleteByTokenHash(tokenHash: string): Promise<number> {
  const rows = (await sql`
    DELETE FROM users WHERE token_hash = ${tokenHash} RETURNING id
  `) as { id: string }[];
  return rows.length;
}

/** Delete a user by id (used by the in-assistant "delete my account" tool). */
export async function deleteById(id: string): Promise<number> {
  const rows = (await sql`
    DELETE FROM users WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length;
}
