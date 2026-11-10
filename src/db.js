// Storage. Postgres when DATABASE_URL is set (production); embedded PGlite otherwise (local dev).
// Same SQL runs on both.
import fs from 'node:fs';

let impl = null;
export let dbKind = 'none';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    business_name TEXT NOT NULL,
    owner_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'INR',
    default_tax_pct DOUBLE PRECISION NOT NULL DEFAULT 18,
    default_terms TEXT NOT NULL DEFAULT '',
    default_valid_days INTEGER NOT NULL DEFAULT 15,
    quote_prefix TEXT NOT NULL DEFAULT 'Q-',
    next_number INTEGER NOT NULL DEFAULT 1,
    mcp_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS rate_items (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    public_token TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source TEXT NOT NULL DEFAULT 'manual',
    client_name TEXT NOT NULL DEFAULT '',
    client_phone TEXT NOT NULL DEFAULT '',
    client_email TEXT NOT NULL DEFAULT '',
    site_address TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    intro TEXT NOT NULL DEFAULT '',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    discount DOUBLE PRECISION NOT NULL DEFAULT 0,
    tax_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    terms TEXT NOT NULL DEFAULT '',
    valid_until TEXT NOT NULL DEFAULT '',
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    accepted_name TEXT NOT NULL DEFAULT '',
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS quotes_ws_idx ON quotes(workspace_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS quote_events (
    id SERIAL PRIMARY KEY,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS events_quote_idx ON quote_events(quote_id, id)`,
];

export async function initDb() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl: process.env.PGSSL === 'no-verify' ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (e) => console.error('pg pool error', e.message));
    impl = (text, params) => pool.query(text, params);
    dbKind = 'postgres';
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.DATA_DIR || './data/pglite';
    let db;
    if (dir === 'memory') db = new PGlite();
    else { fs.mkdirSync(dir, { recursive: true }); db = new PGlite(dir); }
    impl = (text, params) => db.query(text, params);
    dbKind = 'pglite';
  }
  for (const stmt of SCHEMA) await impl(stmt);
}

export async function q(text, params = []) {
  return (await impl(text, params)).rows;
}
export async function one(text, params = []) {
  return (await q(text, params))[0] || null;
}
