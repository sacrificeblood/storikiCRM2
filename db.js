const { Pool } = require('pg');

if(!process.env.DATABASE_URL){
  console.error('DATABASE_URL is not set. Create a free Postgres database (Neon, Supabase, etc.) and put its connection string in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

async function initSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_state_history (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_history_key_time ON board_state_history (key, saved_at DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = { pool, initSchema };
