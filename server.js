require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { pool, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Telegram notifications for the Tasks board ----------
// Fully optional: if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set, this quietly does nothing.
const TASK_COLUMN_LABELS = { todo: 'To Do', in_progress: 'In Progress', confirm: 'Подтвердить', done: 'Done' };
const KYIV_TIMEZONE = 'Europe/Kyiv';
async function sendTelegramMessage(text){
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if(!token || !chatId) return false;
  try{
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    if(!res.ok){
      const body = await res.text();
      console.error('Telegram send failed:', res.status, body);
      return false;
    }
    return true;
  }catch(e){
    console.error('Telegram send error:', e.message);
    return false;
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
    if(!task.dailyReminder || task.remindersEnabled === false || !validDailyTime(task.reminderTime)) continue;
    if(task.completedForDate === date) continue;
    const manualStartedAt = Date.parse(task.manualReminderStartedAt || '');
    if(Number.isFinite(manualStartedAt)){
      const elapsed = Date.now() - manualStartedAt;
      if(elapsed < 5 * 60 * 1000) continue;
      const interval = Math.floor(elapsed / (5 * 60 * 1000));
      await sendTaskTelegramOnce(
        row.id,
        `manual-timer:${manualStartedAt}:${interval}`,
        `⏰ <b>Выполни это задание!</b>\n${escapeHtmlTg(task.title || '(без названия)')}` +
          (task.description ? `\n${escapeHtmlTg(task.description)}` : '')
      );
      continue;
    }
    const [hours, minutes] = task.reminderTime.split(':').map(Number);
    const dueAt = hours * 60 + minutes;
    // Due time plus every five minutes afterwards. The notification log makes this
    // safe even if the process runs the check more than once in a minute.
    // Do not require the process to wake up on an exact five-minute boundary.
    // Railway can restart or briefly pause a container; the next check should
    // still deliver the currently due reminder instead of silently skipping it.
    if(minuteOfDay < dueAt) continue;
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
      [task.id, JSON.stringify({ ...task, column:'todo', createdAt:Date.now(), dailyReminder:true, remindersEnabled:true })]
    );
  }
}

app.use(express.json({ limit: '5mb' }));

// ---------- Authentication and workspace isolation ----------
const SESSION_COOKIE = 'minon_session';
const SESSION_DAYS = 14;
function uid(){ return crypto.randomBytes(18).toString('base64url'); }
function hashToken(token){ return crypto.createHash('sha256').update(token).digest('hex'); }
function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(password,salt,64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored){
  const [,salt,expected]=String(stored||'').split(':');
  if(!salt || !expected) return false;
  const actual=crypto.scryptSync(password,salt,64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}
function readCookie(req, name){
  const raw=req.headers.cookie||'';
  const found=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  return found ? decodeURIComponent(found.slice(name.length+1)) : '';
}
function unauthenticated(req,res,message){
  // Browser pages should land on the login form, while API clients still receive
  // a machine-readable 401 for their own recovery logic.
  if(!req.path.startsWith('/api/')) return res.redirect('/login');
  return res.status(401).json({error:message});
}
const FEATURE_TYPES={
  dashboard:['layer','fan','cre','link','freg'], notes:['note','noteLink'], tasks:['task'],
  reports:['spendRevDay','launchPlan'], accs:['accagent','accsoc','acc'], creatives:['creogeo','creocreative'], campaigns:['campgeo','campcampaign','geocipher']
};
function featureForType(type){ return Object.keys(FEATURE_TYPES).find(key=>FEATURE_TYPES[key].includes(type)); }
function publicUser(row){ return { id:row.id, email:row.email, name:row.display_name, role:row.role, workspaceId:row.workspace_id, permissions:row.permissions||{}, graphX:row.graph_x, graphY:row.graph_y }; }
function hasEditAccess(user,type){ return user.role!=='assistant' || !!user.permissions?.[featureForType(type)]; }
async function requireAuth(req,res,next){
  try{
    const token=readCookie(req,SESSION_COOKIE);
    if(!token) return unauthenticated(req,res,'Требуется вход');
    const result=await pool.query(
      `SELECT u.id,u.email,u.display_name,u.role,u.workspace_id,u.permissions,u.graph_x,u.graph_y FROM user_sessions s
       JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [hashToken(token)]
    );
    if(!result.rows.length) return unauthenticated(req,res,'Сессия истекла');
    req.user=publicUser(result.rows[0]);
    next();
  }catch(e){ next(e); }
}
function requireRole(...roles){ return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'Недостаточно прав'}); }
function workspaceFor(req){ return req.canvasId || (req.user.role==='admin' ? 'main' : req.user.workspaceId); }
function canEditEntity(req, type, existing){
  if(req.user.role==='admin') return true;
  if(req.user.role==='assistant') return hasEditAccess(req.user,type) && (type!=='task' || !!existing);
  return true;
}
function isDailyTaskCompletion(user, type, existing, nextData){
  return user.role==='assistant' && type==='task' && !!existing?.data?.dailyReminder && nextData?.column==='done';
}
function setSessionCookie(res, token){
  res.cookie(SESSION_COOKIE,token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:SESSION_DAYS*24*60*60*1000,path:'/'});
}
async function seedAdmin(){
  const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const password=String(process.env.ADMIN_PASSWORD||'');
  if(!email || !password) return;
  const exists=await pool.query('SELECT id FROM users WHERE email=$1',[email]);
  if(!exists.rows.length){
    await pool.query('INSERT INTO users (id,email,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5)',[uid(),email,'Администратор','admin',hashPassword(password)]);
    console.log('Initial admin account created');
  }
  const admin=await pool.query(`SELECT id FROM users WHERE email=$1 AND role='admin'`,[email]);
  if(admin.rows.length) await pool.query(`INSERT INTO crm_canvases (id,owner_id,name) VALUES ('main',$1,'CRM админа') ON CONFLICT (id) DO NOTHING`,[admin.rows[0].id]);
}

app.post('/api/auth/login', async (req,res)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    const result=await pool.query('SELECT * FROM users WHERE email=$1 AND active=true',[email]);
    if(!result.rows.length || !verifyPassword(password,result.rows[0].password_hash)) return res.status(401).json({error:'Неверный email или пароль'});
    const token=uid();
    await pool.query('INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now() + ($3 || \' days\')::interval)',[hashToken(token),result.rows[0].id,String(SESSION_DAYS)]);
    setSessionCookie(res,token);
    res.json({user:publicUser(result.rows[0])});
  }catch(e){ console.error('login failed',e); res.status(500).json({error:'Не удалось выполнить вход'}); }
});
app.post('/api/auth/logout', requireAuth, async (req,res)=>{
  await pool.query('DELETE FROM user_sessions WHERE token_hash=$1',[hashToken(readCookie(req,SESSION_COOKIE))]);
  res.clearCookie(SESSION_COOKIE,{path:'/'}); res.json({ok:true});
});
app.get('/api/auth/me', requireAuth, (req,res)=>res.json({user:req.user}));

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

// The client uses this for countdowns, so a laptop with an incorrect clock cannot
// make a Kiev-time task look overdue or postpone its visible reminder.
app.get('/api/time', (req, res) => {
  res.json({ now: new Date().toISOString(), kyiv: kyivNow() });
});

// Everything below this line is private workspace data.
app.use('/api', requireAuth);
app.use('/api', async (req,res,next)=>{
  const canvasId=String(req.query.canvas||'');
  if(!canvasId) return next();
  try{
    const found=await pool.query('SELECT owner_id FROM crm_canvases WHERE id=$1',[canvasId]);
    if(!found.rows.length) return res.status(404).json({error:'CRM-полотно не найдено'});
    if(req.user.role!=='admin' && found.rows[0].owner_id!==req.user.id){
      const access=await pool.query('SELECT 1 FROM canvas_access WHERE canvas_id=$1 AND user_id=$2',[canvasId,req.user.id]);
      if(!access.rows.length) return res.status(403).json({error:'Нет доступа к полотну'});
    }
    req.canvasId=canvasId; next();
  }catch(e){next(e);}
});

app.get('/api/canvases', async (req,res)=>{
  const sql=req.user.role==='admin'
    ? `SELECT c.*,u.display_name AS owner_name FROM crm_canvases c JOIN users u ON u.id=c.owner_id ORDER BY c.created_at`
    : `SELECT c.*,u.display_name AS owner_name FROM crm_canvases c JOIN users u ON u.id=c.owner_id WHERE c.owner_id=$1 OR EXISTS(SELECT 1 FROM canvas_access a WHERE a.canvas_id=c.id AND a.user_id=$1) ORDER BY c.created_at`;
  const result=await pool.query(sql,req.user.role==='admin'?[]:[req.user.id]); res.json({canvases:result.rows});
});
app.get('/api/canvas-graph', requireRole('admin'), async (req,res)=>{
  const [users,canvases,access]=await Promise.all([
    pool.query(`SELECT id,email,display_name,role,workspace_id,permissions,active,graph_x,graph_y FROM users ORDER BY created_at`),
    pool.query(`SELECT c.*,u.display_name AS owner_name FROM crm_canvases c JOIN users u ON u.id=c.owner_id ORDER BY c.created_at`),
    pool.query(`SELECT canvas_id,user_id FROM canvas_access`)
  ]);
  res.json({users:users.rows.map(publicUser).map((u,i)=>({...u,active:users.rows[i].active})),canvases:canvases.rows,access:access.rows});
});
app.post('/api/canvases', async (req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'Управление CRM-полотнами доступно только администратору'});
  const name=String(req.body?.name||'').trim(); if(!name) return res.status(400).json({error:'Введите название полотна'});
  const ownerId=req.user.role==='admin'?String(req.body?.ownerId||''):req.user.id;
  if(req.user.role==='admin' && !(await pool.query(`SELECT id FROM users WHERE id=$1 AND role='buyer'`,[ownerId])).rows.length) return res.status(400).json({error:'Выберите баера'});
  const id=uid(); await pool.query('INSERT INTO crm_canvases (id,owner_id,name) VALUES ($1,$2,$3)',[id,ownerId,name]); res.status(201).json({id,name});
});
app.post('/api/canvases/:id/share', async (req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'Управление CRM-полотнами доступно только администратору'});
  const found=await pool.query('SELECT owner_id FROM crm_canvases WHERE id=$1',[req.params.id]); if(!found.rows.length) return res.status(404).json({error:'Полотно не найдено'});
  if(req.user.role!=='admin' && found.rows[0].owner_id!==req.user.id) return res.status(403).json({error:'Недостаточно прав'});
  const assistantId=String(req.body?.assistantId||'');
  const assistant=await pool.query(`SELECT id,workspace_id FROM users WHERE id=$1 AND role='assistant'`,[assistantId]);
  if(!assistant.rows.length) return res.status(400).json({error:'Связать можно только ассистента'});
  if(req.user.role==='buyer' && assistant.rows[0].workspace_id!==req.user.id) return res.status(403).json({error:'Этот ассистент не относится к вашему аккаунту'});
  await pool.query('INSERT INTO canvas_access (canvas_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[req.params.id,assistantId]); res.json({ok:true});
});
app.delete('/api/canvases/:id/share/:userId', async (req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'Управление CRM-полотнами доступно только администратору'});
  const found=await pool.query('SELECT owner_id FROM crm_canvases WHERE id=$1',[req.params.id]);
  if(!found.rows.length) return res.status(404).json({error:'Полотно не найдено'});
  if(req.user.role!=='admin' && found.rows[0].owner_id!==req.user.id) return res.status(403).json({error:'Недостаточно прав'});
  await pool.query('DELETE FROM canvas_access WHERE canvas_id=$1 AND user_id=$2',[req.params.id,req.params.userId]); res.json({ok:true});
});
app.patch('/api/canvases/:id', async (req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'Управление CRM-полотнами доступно только администратору'});
  const found=await pool.query('SELECT owner_id FROM crm_canvases WHERE id=$1',[req.params.id]);
  if(!found.rows.length) return res.status(404).json({error:'Полотно не найдено'});
  if(req.user.role!=='admin' && found.rows[0].owner_id!==req.user.id) return res.status(403).json({error:'Недостаточно прав'});
  const ownerId=req.body?.ownerId?String(req.body.ownerId):null;
  if(ownerId){
    if(req.user.role!=='admin') return res.status(403).json({error:'Только админ может сменить владельца полотна'});
    if(req.params.id==='main') return res.status(400).json({error:'Главное CRM-полотно защищено от повторной передачи'});
    const buyer=await pool.query(`SELECT id FROM users WHERE id=$1 AND role='buyer' AND active=true`,[ownerId]);
    if(!buyer.rows.length) return res.status(400).json({error:'Полотно можно прикрепить только к активному баеру'});
  }
  await pool.query('UPDATE crm_canvases SET name=COALESCE($2,name),graph_x=COALESCE($3,graph_x),graph_y=COALESCE($4,graph_y),owner_id=COALESCE($5,owner_id) WHERE id=$1',[req.params.id,req.body?.name||null,Number.isFinite(req.body?.x)?Math.round(req.body.x):null,Number.isFinite(req.body?.y)?Math.round(req.body.y):null,ownerId]); res.json({ok:true});
});
app.delete('/api/canvases/:id', async (req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'Управление CRM-полотнами доступно только администратору'});
  const found=await pool.query('SELECT owner_id FROM crm_canvases WHERE id=$1',[req.params.id]);
  if(!found.rows.length) return res.status(404).json({error:'Полотно не найдено'});
  if(req.user.role!=='admin' && found.rows[0].owner_id!==req.user.id) return res.status(403).json({error:'Недостаточно прав'});
  if((await pool.query('SELECT count(*)::int AS n FROM crm_canvases WHERE owner_id=$1',[found.rows[0].owner_id])).rows[0].n<=1) return res.status(400).json({error:'Нельзя удалить единственное полотно баера'});
  if((await pool.query('SELECT 1 FROM entities WHERE workspace_id=$1 LIMIT 1',[req.params.id])).rows.length) return res.status(409).json({error:'Сначала очистите данные этого CRM-полотна'});
  await pool.query('DELETE FROM crm_canvases WHERE id=$1',[req.params.id]); res.json({ok:true});
});

app.get('/api/users', requireRole('admin'), async (req,res)=>{
  try{
    const result=req.user.role==='admin'
      ? await pool.query('SELECT id,email,display_name,role,workspace_id,permissions,active,graph_x,graph_y,created_at FROM users ORDER BY created_at')
      : await pool.query(`SELECT id,email,display_name,role,workspace_id,permissions,active,graph_x,graph_y,created_at FROM users WHERE workspace_id=$1 ORDER BY created_at`,[req.user.workspaceId]);
    res.json({users:result.rows.map(publicUser).map((user,index)=>({...user,active:result.rows[index].active}))});
  }catch(e){ res.status(500).json({error:'Не удалось загрузить пользователей'}); }
});

app.post('/api/users', requireRole('admin'), async (req,res)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase();
    const displayName=String(req.body?.name||'').trim();
    const password=String(req.body?.password||'');
    const requestedRole=String(req.body?.role||'assistant');
    if(!/^\S+@\S+\.\S+$/.test(email) || !displayName || password.length<8) return res.status(400).json({error:'Укажите имя, корректный email и пароль от 8 символов'});
    if(!['buyer','assistant'].includes(requestedRole)) return res.status(400).json({error:'Недопустимая роль'});
    const id=uid();
    const workspaceId=requestedRole==='buyer' ? id : String(req.body?.workspaceId||'');
    if(requestedRole==='assistant'){
      const buyer=await pool.query(`SELECT id FROM users WHERE id=$1 AND role='buyer' AND active=true`,[workspaceId]);
      if(!buyer.rows.length) return res.status(400).json({error:'Выберите активного баера для ассистента'});
    }
    const permissions=requestedRole==='assistant' && req.body?.permissions && typeof req.body.permissions==='object' ? req.body.permissions : {};
    await pool.query(
      'INSERT INTO users (id,email,display_name,role,workspace_id,permissions,password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id,email,displayName,requestedRole,workspaceId,JSON.stringify(permissions),hashPassword(password)]
    );
    if(requestedRole==='buyer') await pool.query(`INSERT INTO crm_canvases (id,owner_id,name) VALUES ($1,$1,'Основная CRM') ON CONFLICT DO NOTHING`,[id]);
    res.status(201).json({user:{id,email,name:displayName,role:requestedRole,workspaceId}});
  }catch(e){
    if(e.code==='23505') return res.status(409).json({error:'Этот email уже используется'});
    console.error('create user failed',e); res.status(500).json({error:'Не удалось создать пользователя'});
  }
});

app.patch('/api/users/:id', requireRole('admin','buyer'), async (req,res)=>{
  try{
    const target=await pool.query('SELECT id,role,workspace_id FROM users WHERE id=$1',[req.params.id]);
    if(!target.rows.length) return res.status(404).json({error:'Пользователь не найден'});
    const row=target.rows[0];
    if(req.user.role==='buyer'){
      const isOwnGraphNode=row.id===req.user.id || (row.role==='assistant' && row.workspace_id===req.user.id);
      const onlyPosition=Object.keys(req.body||{}).every(key=>['x','y'].includes(key));
      if(!isOwnGraphNode || !onlyPosition) return res.status(403).json({error:'Недостаточно прав'});
    }
    const permissions=req.body?.permissions && typeof req.body.permissions==='object' ? req.body.permissions : null;
    const workspaceId=req.body?.workspaceId ? String(req.body.workspaceId) : null;
    if(permissions && row.role!=='assistant') return res.status(400).json({error:'Права модулей назначаются только ассистенту'});
    if(workspaceId && row.role==='assistant'){
      const buyer=await pool.query(`SELECT id FROM users WHERE id=$1 AND role='buyer'`,[workspaceId]);
      if(!buyer.rows.length) return res.status(400).json({error:'Связать можно только с баером'});
    }
    const graphX=Number.isFinite(req.body?.x)?Math.round(req.body.x):null, graphY=Number.isFinite(req.body?.y)?Math.round(req.body.y):null;
    const active=typeof req.body?.active==='boolean'?req.body.active:null;
    await pool.query('UPDATE users SET active=COALESCE($2,active), permissions=COALESCE($3,permissions), workspace_id=COALESCE($4,workspace_id),graph_x=COALESCE($5,graph_x),graph_y=COALESCE($6,graph_y) WHERE id=$1',[row.id,active,permissions?JSON.stringify(permissions):null,workspaceId,graphX,graphY]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:'Не удалось обновить пользователя'}); }
});

const ACTIVITY_LOG_LIMIT = 300;
async function logActivity(user, action){
  try{
    await pool.query('INSERT INTO activity_log (user_email, action, workspace_id) VALUES ($1,$2,$3)', [user?.email||'system', action, user?.workspaceId||'main']);
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
    const result = await pool.query('SELECT id, type, data, updated_at FROM entities WHERE workspace_id=$1',[workspaceFor(req)]);
    res.json({ entities: result.rows });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

// Starts a five-minute repeat timer for a daily task. The timestamp is stored
// server-side so it survives a browser refresh and Railway restart.
app.post('/api/tasks/:id/start-reminder-timer', async (req, res) => {
  try{
    if(!['admin','buyer'].includes(req.user.role)) return res.status(403).json({error:'Запускать таймер может администратор или баер'});
    const workspaceId=workspaceFor(req);
    const found = await pool.query(`SELECT data FROM entities WHERE id=$1 AND type='task' AND workspace_id=$2`, [req.params.id,workspaceId]);
    if(!found.rows.length) return res.status(404).json({ error:'task not found' });
    const task = found.rows[0].data || {};
    if(!task.dailyReminder) return res.status(400).json({ error:'task is not daily' });
    const startedAt = new Date().toISOString();
    task.manualReminderStartedAt = startedAt;
    task.remindersEnabled = true;
    await pool.query(`UPDATE entities SET data=$3, updated_at=now() WHERE id=$1 AND workspace_id=$2`, [req.params.id,workspaceId,JSON.stringify(task)]);
    res.json({ ok:true, startedAt });
  }catch(e){
    console.error('manual reminder timer failed', e);
    res.status(500).json({ error:e.message });
  }
});

app.put('/api/entities/:type/:id', async (req, res) => {
  try{
    const { type, id } = req.params;
    let data = req.body;
    if(typeof data !== 'object' || data === null) return res.status(400).json({ error: 'body must be a JSON object' });

    const workspaceId=workspaceFor(req);
    const existingResult=await pool.query('SELECT type,data,workspace_id FROM entities WHERE id=$1',[id]);
    const existing=existingResult.rows[0];
    if(existing && existing.type!==type) return res.status(400).json({error:'Тип записи нельзя изменить'});
    if(existing && existing.workspace_id!==workspaceId) return res.status(403).json({error:'Нет доступа к этому пространству'});
    const assistantDailyCompletion=isDailyTaskCompletion(req.user,type,existing,data);
    if(!canEditEntity(req,type,existing) && !assistantDailyCompletion) return res.status(403).json({error:'Недостаточно прав для изменения'});
    if(type==='task' && req.user.role!=='admin'){
      if(!existing){
        if(req.user.role!=='buyer') return res.status(403).json({error:'Создавать задачи может администратор или баер'});
        // Buyers create regular delegated tasks. Scheduled daily reminders remain
        // an administrator-managed workflow.
        data={
          id:String(data.id||id),
          title:String(data.title||'').trim(),
          description:String(data.description||'').trim(),
          column:'todo',
          createdAt:Number.isFinite(data.createdAt)?data.createdAt:Date.now(),
          dailyReminder:false,
          remindersEnabled:false
        };
      }else{
        // Non-admins can move existing cards without changing their content. Buyers
        // may confirm any task; assistants may additionally confirm daily tasks even
        // when they have no general Tasks editing grant.
        const oldData=existing.data||{};
        const nextColumn=String(data.column||oldData.column||'todo');
        data={...oldData,column:nextColumn};
        if(nextColumn==='done'){
          data.completedAt=String(req.body?.completedAt||kyivNow().date);
          if(oldData.dailyReminder){
            data.completedForDate=String(req.body?.completedForDate||kyivNow().date);
            delete data.manualReminderStartedAt;
          }
        }else{
          delete data.completedAt;
          if(oldData.dailyReminder) delete data.completedForDate;
        }
      }
    }

    let notifyMsg = null;
    let notifyEventKey = null;
    if(type === 'task'){
      const taskExisting = await pool.query('SELECT data FROM entities WHERE id=$1 AND workspace_id=$2', [id,workspaceId]);
      if(!taskExisting.rows.length){
        notifyEventKey = 'created';
        notifyMsg = `🆕 <b>Новая задача:</b> ${escapeHtmlTg(data.title || '(без названия)')}` +
          (data.description ? `\n${escapeHtmlTg(data.description)}` : '');
      }else{
        const oldData = taskExisting.rows[0].data || {};
        if(oldData.column !== data.column){
          const fromLabel = TASK_COLUMN_LABELS[oldData.column] || oldData.column || '—';
          const toLabel = TASK_COLUMN_LABELS[data.column] || data.column || '—';
          notifyEventKey = `column:${oldData.column || ''}:${data.column || ''}`;
          notifyMsg = `↪️ <b>${escapeHtmlTg(data.title || '(без названия)')}</b>: ${fromLabel} → ${toLabel}`;
        }
      }
    }

    await pool.query(
      `INSERT INTO entities (id, type, data, workspace_id, updated_at) VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, workspace_id=$4, updated_at=now()`,
      [id, type, JSON.stringify(data), workspaceId]
    );

    if(notifyMsg) await sendTaskTelegramOnce(id, notifyEventKey, notifyMsg);
    logActivity(req.user, `${existing ? 'Изменил' : 'Создал'}: ${type}`);
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
    const workspaceId=workspaceFor(req);
    const found=await pool.query('SELECT type,data,workspace_id FROM entities WHERE id=$1',[id]);
    if(!found.rows.length) return res.status(404).json({error:'Не найдено'});
    if(found.rows[0].type!==type) return res.status(400).json({error:'Неверный тип записи'});
    if(found.rows[0].workspace_id!==workspaceId || !canEditEntity(req,type,found.rows[0]) || type==='task' && req.user.role!=='admin') return res.status(403).json({error:'Недостаточно прав для удаления'});
    let notifyMsg = null;
    if(type === 'task'){
      const existing = await pool.query('SELECT data FROM entities WHERE id=$1 AND workspace_id=$2', [id,workspaceId]);
      if(existing.rows.length){
        notifyMsg = `🗑️ <b>Задача удалена:</b> ${escapeHtmlTg((existing.rows[0].data||{}).title || id)}`;
      }
    }
    await pool.query('DELETE FROM entities WHERE id=$1 AND workspace_id=$2', [id,workspaceId]);
    if(notifyMsg) await sendTaskTelegramOnce(id, 'deleted', notifyMsg);
    logActivity(req.user, `Удалил: ${type}`);
    res.json({ ok: true });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

// Bulk import — used once by the client-side migration to move data out of the old
// single-blob format. Also handy for restoring from an export.
app.post('/api/entities/bulk', async (req, res) => {
  if(req.user.role!=='admin') return res.status(403).json({error:'Только администратор может выполнять импорт'});
  const items = req.body && req.body.items;
  if(!Array.isArray(items)) return res.status(400).json({ error: 'body must be { items: [...] }' });
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    for(const item of items){
      if(!item || !item.id || !item.type) continue;
      await client.query(
        `INSERT INTO entities (id, type, data, workspace_id, updated_at) VALUES ($1,$2,$3,'main', now())
         ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, workspace_id='main', updated_at=now()`,
        [item.id, item.type, JSON.stringify(item.data || {})]
      );
    }
    await client.query('COMMIT');
    logActivity(req.user, 'Импортировал ' + items.length + ' записей');
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
    const result = await pool.query('SELECT id, type, data, label, deleted_at FROM trash WHERE workspace_id=$1 ORDER BY deleted_at DESC LIMIT 200',[workspaceFor(req)]);
    res.json({ entries: result.rows });
  }catch(e){
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.post('/api/trash', async (req, res) => {
  try{
    const { id, type, data, label } = req.body || {};
    if(!id || !type) return res.status(400).json({ error: 'id and type required' });
    if(!canEditEntity(req,type,{}) || type==='task' && req.user.role!=='admin') return res.status(403).json({error:'Недостаточно прав'});
    await pool.query(
      `INSERT INTO trash (id, type, data, label, workspace_id, deleted_at) VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, label=$4, workspace_id=$5, deleted_at=now()`,
      [id, type, JSON.stringify(data || {}), label || '', workspaceFor(req)]
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
    if(req.user.role!=='admin') return res.status(403).json({error:'Недостаточно прав'});
    await pool.query('DELETE FROM trash WHERE id=$1 AND workspace_id=$2', [req.params.id,workspaceFor(req)]);
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
    const found = await client.query('SELECT id, type, data, workspace_id FROM trash WHERE id=$1 AND workspace_id=$2', [req.params.id,workspaceFor(req)]);
    if(!found.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'trash entry not found' });
    }
    const { id, type, data, workspace_id } = found.rows[0];
    if(!canEditEntity(req,type,{}) || type==='task' && req.user.role!=='admin'){
      await client.query('ROLLBACK'); return res.status(403).json({error:'Недостаточно прав'});
    }
    await client.query(
      `INSERT INTO entities (id, type, data, workspace_id, updated_at) VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (id) DO UPDATE SET type=$2, data=$3, workspace_id=$4, updated_at=now()`,
      [id, type, JSON.stringify(data), workspace_id]
    );
    await client.query('DELETE FROM trash WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    logActivity(req.user, `Восстановил: ${type}`);
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
    if(req.user.role!=='admin') return res.status(403).json({error:'Недостаточно прав'});
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
    if(req.user.role!=='admin') return res.status(403).json({error:'Недостаточно прав'});
    await pool.query('DELETE FROM board_state WHERE key=$1', [req.params.key]);
    res.json({ ok: true });
  }catch(e){
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.get('/api/activity', async (req, res) => {
  try{
    if(!['admin','buyer'].includes(req.user.role)) return res.status(403).json({error:'Недостаточно прав'});
    const result=req.user.role==='admin'
      ? await pool.query('SELECT user_email, action, created_at FROM activity_log ORDER BY created_at DESC LIMIT 100')
      : await pool.query('SELECT user_email, action, created_at FROM activity_log WHERE workspace_id=$1 AND user_email<>$2 ORDER BY created_at DESC LIMIT 100',[req.user.workspaceId,req.user.email]);
    res.json({ entries: result.rows });
  }catch(e){
    res.status(500).json({ error: 'DB error: ' + e.message });
  }
});

app.get('/login', (req,res)=>res.sendFile(path.join(__dirname,'public','login.html')));
app.get('/login.html', (req,res)=>res.sendFile(path.join(__dirname,'public','login.html')));

// Source files for the app are delivered only after a valid session. The browser
// necessarily receives the client UI after login; the database, roles and rules live
// on the server and cannot be extracted from that UI.
app.use(requireAuth);
app.get('/people.html', (req,res,next)=>req.user.role==='admin'
  ? res.sendFile(path.join(__dirname,'public','people.html'))
  : res.redirect('/'));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('app.js') || filePath.endsWith('storage-shim.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  }
}));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initSchema()
  .then(async () => {
    await seedAdmin();
    await seedDefaultDailyTasks();
    app.listen(PORT, () => console.log('Server running on port ' + PORT));
    deliverDueTaskReminders().catch(e => console.error('task reminder check failed:', e.message));
    setInterval(() => deliverDueTaskReminders().catch(e => console.error('task reminder check failed:', e.message)), 60 * 1000);
  })
  .catch(e => {
    console.error('Failed to init database schema:', e.message);
    process.exit(1);
  });
