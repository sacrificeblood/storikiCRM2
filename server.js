require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const INVITE_CODE = process.env.INVITE_CODE || '';
const COOKIE_NAME = 'token';

if(!JWT_SECRET){
  console.error('JWT_SECRET is not set in .env — generate a long random string and set it there.');
  process.exit(1);
}

app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function signToken(email){
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next){
  const token = req.cookies[COOKIE_NAME];
  if(!token) return res.status(401).json({ error: 'Не авторизован' });
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    req.userEmail = payload.email;
    next();
  }catch(e){
    return res.status(401).json({ error: 'Сессия истекла, войдите снова' });
  }
}

function setAuthCookie(res, email){
  res.cookie(COOKIE_NAME, signToken(email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

async function logActivity(email, action){
  try{ await pool.query('INSERT INTO activity_log (user_email, action) VALUES ($1,$2)', [email, action]); }
  catch(e){ console.error('activity log failed', e.message); }
}

// ---------- AUTH ROUTES ----------
app.post('/api/register', async (req, res) => {
  try{
    const { email, password, inviteCode } = req.body || {};
    if(!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });
    if(password.length < 6) return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    if(INVITE_CODE && inviteCode !== INVITE_CODE){
      return res.status(403).json({ error: 'Неверный код приглашения' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if(existing.rows.length){ return res.status(409).json({ error: 'Такой email уже зарегистрирован' }); }
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (email, password_hash) VALUES ($1,$2)', [email.toLowerCase(), hash]);
    setAuthCookie(res, email.toLowerCase());
    logActivity(email.toLowerCase(), 'registered');
    res.json({ email: email.toLowerCase() });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

app.post('/api/login', async (req, res) => {
  try{
    const { email, password } = req.body || {};
    if(!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });
    const result = await pool.query('SELECT password_hash FROM users WHERE email=$1', [email.toLowerCase()]);
    if(!result.rows.length) return res.status(401).json({ error: 'Неверный email или пароль' });
    const ok = await bcrypt.compare(password, result.rows[0].password_hash);
    if(!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
    setAuthCookie(res, email.toLowerCase());
    logActivity(email.toLowerCase(), 'logged in');
    res.json({ email: email.toLowerCase() });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ email: req.userEmail });
});

// ---------- KEY/VALUE BOARD STORAGE ----------
app.get('/api/kv', requireAuth, async (req, res) => {
  const prefix = req.query.prefix || '';
  const result = await pool.query('SELECT key FROM board_state WHERE key LIKE $1', [prefix + '%']);
  res.json({ keys: result.rows.map(r => r.key) });
});

app.get('/api/kv/:key', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT value FROM board_state WHERE key=$1', [req.params.key]);
  if(!result.rows.length) return res.status(404).json({ error: 'not found' });
  res.json({ value: result.rows[0].value });
});

app.put('/api/kv/:key', requireAuth, async (req, res) => {
  const { value } = req.body || {};
  if(typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
  await pool.query(
    `INSERT INTO board_state (key, value, updated_at, updated_by) VALUES ($1,$2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now(), updated_by=$3`,
    [req.params.key, value, req.userEmail]
  );
  logActivity(req.userEmail, 'updated ' + req.params.key);
  res.json({ ok: true });
});

app.delete('/api/kv/:key', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM board_state WHERE key=$1', [req.params.key]);
  logActivity(req.userEmail, 'deleted ' + req.params.key);
  res.json({ ok: true });
});

// simple activity feed, handy for debugging who changed what
app.get('/api/activity', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT user_email, action, created_at FROM activity_log ORDER BY created_at DESC LIMIT 100');
  res.json({ entries: result.rows });
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
