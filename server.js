require('dotenv').config();
const express = require('express');
const path = require('path');
const { pool, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Telegram notifications for the Tasks board ----------
// Fully optional: if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set, this quietly does nothing.
const TASK_COLUMN_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const KYIV_TIMEZONE = 'Europe/Kyiv';
async function sendTelegramMessage(text){
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if(!token || !chatId) return;
  try{
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    if(!res.ok){
      const body = await res.text();
      console.error('Telegram send failed:', res.status, body);
    }
  }catch(e){
    console.error('Telegram send error:', e.message);
  }
}

// Atomically reserve an event before delivering it. This is what prevents duplicated
// messages when the browser sends the same save/delete request twice.
async function sendTaskTelegramOnce(taskId, eventKey, text){
  const claim = await pool.query(
    `INSERT INTO task_notification_log (task_id, event_key) VALUES ($1,$2)
     ON CONFLICT DO NOTHING RETURNING task_id`,
    [taskId, eventKey]
  );
  if(claim.rowCount) await sendTelegramMessage(text);
}

function kyivNow(){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((out, p) => { out[p.type] = p.value; return out; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function validDailyTime(value){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')); }

async function deliverDueTaskReminders(){
  const { date, minuteOfDay } = kyivNow();
  const result = await pool.query(`SELECT id, data FROM entities WHERE type='task'`);
  for(const row of result.rows){
    const task = row.data || {};
    if(!task.dailyReminder || !validDailyTime(task.reminderTime)) continue;
    if(task.completedForDate === date) continue;
    const [hours, minutes] = task.reminderTime.split(':').map(Number);
    const dueAt = hours * 60 + minutes;
    // Due time plus every five minutes afterwards. The notification log makes this
    // safe even if the process runs the check more than once in a minute.
    if(minuteOfDay < dueAt || (minuteOfDay - dueAt) % 5 !== 0) continue;
    const interval = Math.floor((minuteOfDay - dueAt) / 5);
    await sendTaskTelegramOnce(
      row.id,
      `reminder:${date}:${interval}`,
      `⏰ <b>Выполни это задание!</b>\n${escapeHtmlTg(task.title || '(без названия)')}` +
        (task.description ? `\n${escapeHtmlTg(task.description)}` : '')
    );
  }
}

async function seedDefaultDailyTasks(){
  const defaults = [
    { id:'daily-spend-yesterday', title:'Внести spend за вчерашний день в таблицу', description:'Заполнить spend за вчерашний день.', reminderTime:'10:00' },
    { id:'daily-spend-revenue-chat', title:'Выписать spend / revenue в чат', description:'Отправить spend и revenue в чат.', reminderTime:'20:00' }
  ];
  for(const task of defaults){
    await pool.query(
      `INSERT INTO entities (id, type, data, updated_at) VALUES ($1,'task',$2,now()) ON CONFLICT (id) DO NOTHING`,
      [task.id, JSON.stringify({ ...task, column:'todo', createdAt:Date.now(), dailyReminder:true })]
    );
  }
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // index.html must NEVER be cached — it's what decides which app.js?v=N gets loaded.
    // A cached index.html means the browser can be stuck loading an old build forever,
    // even after a fresh deploy, even in incognito, since it never re-checks with the server.
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Quick way to check from a browser whether the database is actually reachable:
// just open https://your-site/api/health
app.get('/api/health', async (req, res) => {
  try{
    const result = await pool.query('SELECT NOW() as now, (SELECT count(*) FROM entities) as entities');
    res.json({ ok: true, db: 'connected', serverTime: result.rows[0].now, entityCount: Number(result.rows[0].entities) });
  }catch(e){
    res.status(500).json({ ok: false, db: 'error', error: e.message });
  }
});

const ACTIVITY_LOG_LIMIT = 300;
async function logActivity(action){
  try{
    await pool.query('INSERT INTO activity_log (user_email, action) VALUES ($1,$2)', ['team', action]);
    await pool.query(
      `DELETE FROM activity_log WHERE id NOT IN (
         SELECT id FROM activity_log ORDER BY created_at DESC LIMIT $1
       )`,
      [ACTIVITY_LOG_LIMIT]
    );
  }catch(e){ console.error('activity log failed', e.message); }
}

// ---------- ENTITIES: one row per fanpage / creative / account / campaign / etc ----------
// Every entity is saved and deleted INDEPENDENTLY of every other entity — there is no shared
// document to overwrite, so two people editing different things (or the same person editing
// quickly) can never clobber each other's work the way a single-blob save could.

app.get('/api/entities', async (req, res) => {
  try{
    const result = await pool.query('SELECT id, type, data, updated_at FROM entities');
    res.json({ entities: result.rows });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.put('/api/entities/:type/:id', async (req, res) => {
  try{
    const { type, id } = req.params;
    const data = req.body;
    if(typeof data !== 'object' || data === null) return res.status(400).json({ error: 'body must be a JSON object' });

    let notifyMsg = null;
    let notifyEventKey = null;
    if(type === 'task'){
      const existing = await pool.query('SELECT data FROM entities WHERE id=$1', [id]);
      if(!existing.rows.length){
        notifyEventKey = 'created';
        notifyMsg = `🆕 <b>Новая задача:</b> ${escapeHtmlTg(data.title || '(без названия)')}` +
          (data.description ? `\n${escapeHtmlTg(data.description)}` : '');
      }else{
        const oldData = existing.rows[0].data || {};
        if(oldData.column !== data.column){
          const fromLabel = TASK_COLUMN_LABELS[oldData.column] || oldData.column || '—';
          const toLabel = TASK_COLUMN_LABELS[data.column] || data.column || '—';
          notifyEventKey = `column:${oldData.column || ''}:${data.column || ''}`;
          notifyMsg = `↪️ <b>${escapeHtmlTg(data.title || '(без названия)')}</b>: ${fromLabel} → ${toLabel}`;
        }
      }
    }

    await pool.query(
      `INSERT INTO entities (id, type, data, updated_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, updated_at=now()`,
      [id, type, JSON.stringify(data)]
    );

    if(notifyMsg) await sendTaskTelegramOnce(id, notifyEventKey, notifyMsg);
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

function escapeHtmlTg(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

app.delete('/api/entities/:type/:id', async (req, res) => {
  try{
    const { type, id } = req.params;
    let notifyMsg = null;
    if(type === 'task'){
      const existing = await pool.query('SELECT data FROM entities WHERE id=$1', [id]);
      if(existing.rows.length){
        notifyMsg = `🗑️ <b>Задача удалена:</b> ${escapeHtmlTg((existing.rows[0].data||{}).title || id)}`;
      }
    }
    await pool.query('DELETE FROM entities WHERE id=$1', [id]);
    if(notifyMsg) await sendTaskTelegramOnce(id, 'deleted', notifyMsg);
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

// Bulk import — used once by the client-side migration to move data out of the old
// single-blob format. Also handy for restoring from an export.
app.post('/api/entities/bulk', async (req, res) => {
  const items = req.body && req.body.items;
  if(!Array.isArray(items)) return res.status(400).json({ error: 'body must be { items: [...] }' });
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    for(const item of items){
      if(!item || !item.id || !item.type) continue;
      await client.query(
        `INSERT INTO entities (id, type, data, updated_at) VALUES ($1,$2,$3, now())
         ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, updated_at=now()`,
        [item.id, item.type, JSON.stringify(item.data || {})]
      );
    }
    await client.query('COMMIT');
    logActivity('bulk imported ' + items.length + ' entities');
    res.json({ ok: true, count: items.length });
  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }finally{
    client.release();
  }
});

// ---------- TRASH: deleted items, kept for "История" restore ----------

app.get('/api/trash', async (req, res) => {
  try{
    const result = await pool.query('SELECT id, type, data, label, deleted_at FROM trash ORDER BY deleted_at DESC LIMIT 200');
    res.json({ entries: result.rows });
  }catch(e){
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.post('/api/trash', async (req, res) => {
  try{
    const { id, type, data, label } = req.body || {};
    if(!id || !type) return res.status(400).json({ error: 'id and type required' });
    await pool.query(
      `INSERT INTO trash (id, type, data, label, deleted_at) VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, label=$4, deleted_at=now()`,
      [id, type, JSON.stringify(data || {}), label || '']
    );
    // keep only the most recent 200 trash entries so this table never grows unbounded
    await pool.query(`DELETE FROM trash WHERE id NOT IN (SELECT id FROM trash ORDER BY deleted_at DESC LIMIT 200)`);
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.delete('/api/trash/:id', async (req, res) => {
  try{
    await pool.query('DELETE FROM trash WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }catch(e){
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

// restore = move a trash row back into entities, then remove it from trash
app.post('/api/trash/:id/restore', async (req, res) => {
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const found = await client.query('SELECT id, type, data FROM trash WHERE id=$1', [req.params.id]);
    if(!found.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'trash entry not found' });
    }
    const { id, type, data } = found.rows[0];
    await client.query(
      `INSERT INTO entities (id, type, data, updated_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, updated_at=now()`,
      [id, type, JSON.stringify(data)]
    );
    await client.query('DELETE FROM trash WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    logActivity('restored ' + type + ' ' + id);
    res.json({ ok: true, type, data });
  }catch(e){
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }finally{
    client.release();
  }
});

// ---------- LEGACY: read-only access to the old single-blob storage, kept only so the
// one-time client-side migration can pull the old data out. Nothing writes here anymore. ----------
app.get('/api/kv/:key', async (req, res) => {
  try{
    const result = await pool.query('SELECT value FROM board_state WHERE key=$1', [req.params.key]);
    if(!result.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ value: result.rows[0].value });
  }catch(e){
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

// Called once, right after a successful migration, so the old blob can never be re-read and
// re-imported again later (e.g. if a transient DB hiccup ever makes the new entities table look
// empty when it isn't — with the old blob gone, there is nothing left to wrongly migrate from).
app.delete('/api/kv/:key', async (req, res) => {
  try{
    await pool.query('DELETE FROM board_state WHERE key=$1', [req.params.key]);
    res.json({ ok: true });
  }catch(e){
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
  .then(async () => {
    await seedDefaultDailyTasks();
    app.listen(PORT, () => console.log('Server running on port ' + PORT));
    deliverDueTaskReminders().catch(e => console.error('task reminder check failed:', e.message));
    setInterval(() => deliverDueTaskReminders().catch(e => console.error('task reminder check failed:', e.message)), 60 * 1000);
  })
  .catch(e => {
    console.error('Failed to init database schema:', e.message);
    process.exit(1);
  });
