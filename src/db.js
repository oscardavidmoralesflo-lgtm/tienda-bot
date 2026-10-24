import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const schema = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

// int8 -> number, numeric -> number (los IDs de Telegram caben en un número JS)
const INT8 = 20;
const NUMERIC = 1700;

let impl;

export async function initDb() {
  if (config.databaseUrl) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(INT8, (v) => Number(v));
    pg.types.setTypeParser(NUMERIC, (v) => parseFloat(v));
    const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 5,
    });
    // DB_SCHEMA permite compartir un proyecto de Supabase sin mezclar tablas
    if (config.dbSchema) {
      pool.on('connect', (c) => {
        c.query(`SET search_path TO "${config.dbSchema}"`).catch(() => {});
      });
      const exists = await pool.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [config.dbSchema]);
      if (!exists.rows.length) await pool.query(`CREATE SCHEMA "${config.dbSchema}"`);
    }
    impl = {
      kind: 'postgres',
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const r = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return r;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    mkdirSync('./data', { recursive: true });
    const db = new PGlite('./data/pglite', {
      parsers: { [INT8]: (v) => Number(v), [NUMERIC]: (v) => parseFloat(v) },
    });
    impl = {
      kind: 'local',
      query: (text, params) => db.query(text, params),
      exec: (text) => db.exec(text),
      tx: (fn) => db.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
    };
  }
  await impl.exec(schema);
  return impl.kind;
}

export const query = (text, params = []) => impl.query(text, params);
export const one = async (text, params = []) => (await impl.query(text, params)).rows[0] || null;
export const many = async (text, params = []) => (await impl.query(text, params)).rows;
export const tx = (fn) => impl.tx(fn);
