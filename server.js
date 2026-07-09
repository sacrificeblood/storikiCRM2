require('dotenv').config();
const express = require('express');
const path = require('path');
const { pool, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Quick way to check from a browser whether the database is actually reachable:
// just open https://your-site/api/health
app.get('/api/health', async (req, res) => {
  try{
    const result = await pool.query('SELECT NOW() as now, (SELECT count(*) FROM board_state) as keys');
    res.json({ ok: true, db: 'connected', serverTime: result.rows[0].now, savedKeys: Number(result.rows[0].keys) });
  }catch(e){
    res.status(500).json({ ok: false, db: 'error', error: e.message });
  }
});

async function logActivity(action){
  try{ await pool.query('INSERT INTO activity_log (user_email, action) VALUES ($1,$2)', ['team', action]); }
  catch(e){ console.error('activity log failed', e.message); }
}

// ---------- KEY/VALUE BOARD STORAGE (open — no login required) ----------
app.get('/api/kv', async (req, res) => {
  try{
    const prefix = req.query.prefix || '';
    const result = await pool.query('SELECT key FROM board_state WHERE key LIKE $1', [prefix + '%']);
    res.json({ keys: result.rows.map(r => r.key) });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.get('/api/kv/:key', async (req, res) => {
  try{
    const result = await pool.query('SELECT value FROM board_state WHERE key=$1', [req.params.key]);
    if(!result.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ value: result.rows[0].value });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.put('/api/kv/:key', async (req, res) => {
  try{
    const { value } = req.body || {};
    if(typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
    await pool.query(
      `INSERT INTO board_state (key, value, updated_at) VALUES ($1,$2, now())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
      [req.params.key, value]
    );
    logActivity('updated ' + req.params.key);
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.delete('/api/kv/:key', async (req, res) => {
  try{
    await pool.query('DELETE FROM board_state WHERE key=$1', [req.params.key]);
    logActivity('deleted ' + req.params.key);
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.get('/api/activity', async (req, res) => {
  try{
    const result = await pool.query('SELECT action, created_at FROM activity_log ORDER BY created_at DESC LIMIT 100');
    res.json({ entries: result.rows });
  }catch(e){
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log('Server running on port ' + PORT));
  })
  .catch(e => {
    console.error('Failed to init database schema:', e.message);
    process.exit(1);
  });
