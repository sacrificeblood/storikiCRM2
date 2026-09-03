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
  await pool.query(`ALTER TABLE entities ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'main';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_entities_workspace ON entities (workspace_id);`);

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
  await pool.query(`ALTER TABLE trash ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'main';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_trash_workspace ON trash (workspace_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','buyer','assistant')),
      workspace_id TEXT,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_workspace ON users (workspace_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions (user_id);`);

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
  await pool.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'main';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log (workspace_id, created_at DESC);`);

  // A durable idempotency guard for Telegram. Browser saves can be retried or overlap,
  // but one task event must result in one chat message.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_notification_log (
      task_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (task_id, event_key)
    );
  `);
}

module.exports = { pool, initSchema };
