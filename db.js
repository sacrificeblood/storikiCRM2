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
  // Every fanpage, creative, link, account, campaign, geo, etc. is its own row here.
  // Saving one entity is a single UPDATE on a single row — it can never collide with,
  // race against, or overwrite a save of a DIFFERENT entity, unlike the old single-blob design.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (type);`);

  // Deleted items live here for the "История" (trash/restore) feature.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trash (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data JSONB NOT NULL,
      label TEXT,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_trash_deleted_at ON trash (deleted_at DESC);`);

  // Legacy single-blob storage — kept only so the one-time migration endpoint can read
  // whatever the old version last saved. Nothing new is written here going forward.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT
    );
  `);

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
