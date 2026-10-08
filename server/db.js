import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8').replace(/^﻿/, '');

// Production: set DATABASE_URL (Postgres). Dev/tests: embedded Postgres (PGlite), same SQL.
export async function openDb() {
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL) || 20,
    });
    await pool.query(schema);
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const out = await fn({ query: (s, p) => c.query(s, p) });
          await c.query('COMMIT');
          return out;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  // On Windows keep the dev database outside OneDrive-synced folders, which can lock its files.
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'MessHub', 'pglite') : './data/pglite';
  const dir = process.env.PGLITE_DIR || local;
  console.log(`Database folder: ${path.resolve(dir)}`);
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  await db.exec(schema);
  return {
    kind: 'pglite',
    query: (sql, params) => db.query(sql, params),
    tx: (fn) => db.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
  };
}
