(function(){
  const STORAGE_KEY = 'crm-board-data-v2';
  const OLD_STORAGE_KEY = 'crm-board-data';
  const MAX_URLS = 4;
  function normalizePostUrls(raw){
    if(!Array.isArray(raw)) return [];
    return raw.filter(u=>u!=null).map(u=>{
      if(typeof u === 'string') return { naming: '', url: u };
      return { naming: u.naming || '', url: u.url || '' };
    }).filter(u=>u.url).slice(0, MAX_URLS);
  }
  let state = { layers: [], fanpages: [], creatives: [], links: [], fanpageRegistry: [], reports: {}, deletedItems: [], currentLayerId: null };
  const VIEW_STATE_KEY = 'adboard-view-state';
  function loadViewState(){
    try{
      const raw = localStorage.getItem(VIEW_STATE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  }
  function saveViewState(){
    try{
      localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ zoom, panX, panY, currentView }));
    }catch(e){ /* private browsing or storage disabled — just skip persistence */ }
  }
  const savedView = loadViewState();

  let currentView = savedView && savedView.currentView ? savedView.currentView : 'board';
  let dragging = null;
  let connecting = null;

  const boardOuter = document.getElementById('board-outer');
  const boardView = document.getElementById('board-view');
  const boardCanvas = document.getElementById('board-canvas');
  const tableView = document.getElementById('table-view');
  const fanpageView = document.getElementById('fanpage-view');
  const reportView = document.getElementById('report-view');
  const svg = document.getElementById('board-svg');
  const loadingBox = document.getElementById('loadingBox');
  const tableWrap = document.getElementById('tableWrap');

  let zoom = (savedView && typeof savedView.zoom === 'number') ? savedView.zoom : 1;
  let panX = (savedView && typeof savedView.panX === 'number') ? savedView.panX : 30;
  let panY = (savedView && typeof savedView.panY === 'number') ? savedView.panY : 30;
  let panning = null;
  const ZOOM_MIN = 0.25, ZOOM_MAX = 2.5;

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  function applyTransform(){
    boardCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    document.getElementById('zoomPct').textContent = Math.round(zoom*100) + '%';
    saveViewState();
  }

  function toCanvasCoords(clientX, clientY){
    const rect = boardView.getBoundingClientRect();
    return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
  }

  function zoomBy(factor){
    const rect = boardView.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    const oldZoom = zoom;
    const newZoom = clamp(oldZoom*factor, ZOOM_MIN, ZOOM_MAX);
    panX = cx - (cx-panX) * (newZoom/oldZoom);
    panY = cy - (cy-panY) * (newZoom/oldZoom);
    zoom = newZoom;
    applyTransform();
  }

  function updateBoardViewportHeight(){
    const headerH = document.querySelector('header').offsetHeight;
    const topbarH = document.querySelector('.board-topbar').offsetHeight;
    const h = window.innerHeight - headerH - topbarH - 2;
    boardView.style.height = Math.max(360, h) + 'px';
  }
  window.addEventListener('resize', updateBoardViewportHeight);

  boardView.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const rect = boardView.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const oldZoom = zoom;
    // Scale the zoom step by how big the actual wheel/trackpad delta was, instead of a fixed
    // per-event jump — Mac trackpads fire many small-delta events per gesture, so a flat step
    // per event made zoom feel jumpy. This keeps trackpad pinch/scroll smooth while still giving
    // a normal mouse wheel notch a sensible single step.
    const dy = clamp(e.deltaY, -100, 100);
    const factor = Math.exp(-dy * 0.0016);
    const newZoom = clamp(oldZoom*factor, ZOOM_MIN, ZOOM_MAX);
    panX = mouseX - (mouseX - panX) * (newZoom/oldZoom);
    panY = mouseY - (mouseY - panY) * (newZoom/oldZoom);
    zoom = newZoom;
    applyTransform();
  }, {passive:false});

  boardView.addEventListener('mousedown', (e)=>{
    if(e.target.closest('.note')) return;
    if(e.button !== 0) return;
    panning = { startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
    boardView.classList.add('panning');
  });
  document.addEventListener('mousemove', (e)=>{
    if(panning){
      panX = panning.panX0 + (e.clientX - panning.startX);
      panY = panning.panY0 + (e.clientY - panning.startY);
      applyTransform();
    }
  });
  document.addEventListener('mouseup', ()=>{
    if(panning){ panning = null; boardView.classList.remove('panning'); }
  });

  document.getElementById('zoomInBtn').addEventListener('click', ()=>zoomBy(1.25));
  document.getElementById('zoomOutBtn').addEventListener('click', ()=>zoomBy(0.8));
  document.getElementById('zoomResetBtn').addEventListener('click', ()=>{
    zoom = 1; panX = 30; panY = 30; applyTransform();
  });

  function uid(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return Math.abs(h); }
  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=String(s==null?'':s); return d.innerHTML; }
  function shortLinkLabel(url){
    try{
      const u = new URL(url);
      let path = u.pathname + u.search;
      if(path.length > 22) path = path.slice(0, 22) + '…';
      return u.hostname.replace(/^www\./,'') + (path === '/' ? '' : path);
    }catch(e){
      return url.length > 34 ? url.slice(0, 34) + '…' : url;
    }
  }

  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 1800);
  }

  function ensureAtLeastOneLayer(){
    if(state.layers.length === 0){
      const l = { id: uid(), name: 'Слой 1' };
      state.layers.push(l);
    }
    if(!state.currentLayerId || !state.layers.find(l=>l.id===state.currentLayerId)){
      state.currentLayerId = state.layers[0].id;
    }
  }

  async function loadState(){
    try{
      const res = await window.storage.get(STORAGE_KEY, false);
      if(res && res.value){
        const parsed = JSON.parse(res.value);
        state.layers = parsed.layers || [];
        state.fanpages = parsed.fanpages || [];
        state.creatives = parsed.creatives || [];
        state.links = (parsed.links || []).map(l=>{
          if(l.postUrl){ l.postUrls = [l.postUrl]; delete l.postUrl; }
          l.postUrls = normalizePostUrls(l.postUrls);
          if(!l.createdAt) l.createdAt = Date.now();
          return l;
        });
        state.currentLayerId = parsed.currentLayerId || null;
        state.deletedItems = parsed.deletedItems || [];
        state.reports = parsed.reports || {};

        if(Array.isArray(parsed.fanpageRegistry)){
          state.fanpageRegistry = parsed.fanpageRegistry;
        }else{
          // one-time migration: board fanpages used to carry geo/gender/status/pageUrl —
          // move whatever was already filled in into the new, independent registry
          state.fanpageRegistry = state.fanpages
            .filter(f => f.geo || f.gender || (f.status && f.status !== 'inactive') || f.pageUrl)
            .map(f => ({
              id: uid(), name: f.name, geo: f.geo || '', gender: f.gender || '',
              status: f.status || 'inactive', pageUrl: f.pageUrl || '', createdAt: Date.now()
            }));
          state.fanpages.forEach(f=>{ delete f.geo; delete f.gender; delete f.status; delete f.pageUrl; });
        }
      } else {
        // try migrating legacy single-layer data (pre-layers version)
        try{
          const oldRes = await window.storage.get(OLD_STORAGE_KEY, false);
          if(oldRes && oldRes.value){
            const old = JSON.parse(oldRes.value);
            const defaultLayer = { id: uid(), name: 'Слой 1' };
            state.layers = [defaultLayer];
            state.fanpages = (old.fanpages||[]).map(f=>({...f, layerId: defaultLayer.id}));
            state.creatives = (old.creatives||[]).map(c=>({...c, layerId: defaultLayer.id}));
            state.links = (old.links||[]).map(l=>{
              let urls = Array.isArray(l.postUrls) ? l.postUrls : (l.postUrl ? [l.postUrl] : []);
              return { id:l.id, fanpageId:l.fanpageId, creativeId:l.creativeId, geo:l.geo||'', postUrls:normalizePostUrls(urls), createdAt:l.createdAt||Date.now(), layerId: defaultLayer.id };
            });
            state.currentLayerId = defaultLayer.id;
            showToast('Старые данные перенесены в «Слой 1»');
          }
        }catch(e2){ /* nothing to migrate */ }
      }
    }catch(e){
      // nothing saved yet
    }
    // any fanpage/creative/link missing a layerId (older partial saves) gets bucketed into a default layer
    const orphanFan = state.fanpages.filter(f=>!f.layerId);
    const orphanCre = state.creatives.filter(c=>!c.layerId);
    const orphanLink = state.links.filter(l=>!l.layerId);
    if(orphanFan.length || orphanCre.length || orphanLink.length){
      let bucket = state.layers[0];
      if(!bucket){ bucket = { id: uid(), name: 'Слой 1' }; state.layers.push(bucket); }
      orphanFan.forEach(f=>f.layerId=bucket.id);
      orphanCre.forEach(c=>c.layerId=bucket.id);
      orphanLink.forEach(l=>l.layerId=bucket.id);
    }
    ensureAtLeastOneLayer();

    loadingBox.style.display='none';
    hideAllViews();
    if(currentView === 'table'){
      setActiveTab('tabTableBtn');
      tableView.style.display='block';
    }else if(currentView === 'fanpage'){
      setActiveTab('tabFanpageBtn');
      fanpageView.style.display='block';
    }else if(currentView === 'report'){
      setActiveTab('tabReportBtn');
      reportView.style.display='block';
    }else{
      boardOuter.style.display='flex';
    }
    setupTableDelegation();
    setupFanpageTableDelegation();
    setupAccsDelegation();
    setupCreoDelegation();
    setupCampaignDelegation();
    setupGeoCipherDelegation();
    setupReportDelegation();
    applyTransform();
    render();
    saveState(true);
  }

  function mergeEntityArray(localArr, remoteArr, deletedIds){
    const map = new Map();
    (remoteArr||[]).forEach(item => { if(item && item.id && !deletedIds.has(item.id)) map.set(item.id, item); });
    (localArr||[]).forEach(item => { if(item && item.id && !deletedIds.has(item.id)) map.set(item.id, item); });
    return Array.from(map.values());
  }

  // Returns true if merging in remote data actually changed anything locally.
  function mergeReports(localReports, remoteReports){
    const merged = JSON.parse(JSON.stringify(remoteReports || {}));
    const localSpendRev = (localReports || {}).spendRev || {};
    if(!merged.spendRev) merged.spendRev = {};
    Object.keys(localSpendRev).forEach(monthKey => {
      if(!merged.spendRev[monthKey]) merged.spendRev[monthKey] = {};
      Object.keys(localSpendRev[monthKey]).forEach(day => {
        merged.spendRev[monthKey][day] = localSpendRev[monthKey][day]; // local wins on same-day overlap
      });
    });
    return merged;
  }

  function applyRemoteMerge(remote){
    const before = JSON.stringify({ f: state.fanpages, c: state.creatives, r: state.fanpageRegistry, l: state.links, rep: state.reports });

    const localTrash = state.deletedItems || [];
    const remoteTrash = remote.deletedItems || [];
    const trashById = new Map();
    remoteTrash.forEach(t => t && t.id && trashById.set(t.id, t));
    localTrash.forEach(t => t && t.id && trashById.set(t.id, t));
    let mergedTrash = Array.from(trashById.values()).sort((a,b)=>(b.deletedAt||0)-(a.deletedAt||0));
    if(mergedTrash.length > MAX_TRASH) mergedTrash = mergedTrash.slice(0, MAX_TRASH);
    state.deletedItems = mergedTrash;

    const deletedIds = new Set(mergedTrash.map(t => t.data && t.data.id).filter(Boolean));

    state.fanpages = mergeEntityArray(state.fanpages, remote.fanpages, deletedIds);
    state.creatives = mergeEntityArray(state.creatives, remote.creatives, deletedIds);
    state.fanpageRegistry = mergeEntityArray(state.fanpageRegistry, remote.fanpageRegistry, deletedIds);
    state.links = mergeEntityArray(state.links, remote.links, deletedIds)
      .filter(l => state.fanpages.some(f=>f.id===l.fanpageId) && state.creatives.some(c=>c.id===l.creativeId));
    state.reports = mergeReports(state.reports, remote.reports);
    ensureReportsShape();
    const remoteAccs = (remote.reports||{}).accs;
    const remoteAccsObj = (remoteAccs && !Array.isArray(remoteAccs)) ? remoteAccs : { agents:[], socs:[], accounts:[] };
    state.reports.accs.agents = mergeEntityArray(state.reports.accs.agents, remoteAccsObj.agents, deletedIds);
    state.reports.accs.socs = mergeEntityArray(state.reports.accs.socs, remoteAccsObj.socs, deletedIds)
      .filter(s => state.reports.accs.agents.some(a=>a.id===s.agentId));
    state.reports.accs.accounts = mergeEntityArray(state.reports.accs.accounts, remoteAccsObj.accounts, deletedIds)
      .filter(a => state.reports.accs.socs.some(s=>s.id===a.socId));

    ensureReportsShape();
    const remoteCreo = (remote.reports||{}).creoChecker || { days:{} };
    const remoteCreoDays = (remoteCreo.days && typeof remoteCreo.days === 'object') ? remoteCreo.days : {};
    const localCreoDays = state.reports.creoChecker.days || {};
    const allDayKeys = new Set([...Object.keys(localCreoDays), ...Object.keys(remoteCreoDays)]);
    allDayKeys.forEach(dayKey => {
      const localDay = localCreoDays[dayKey] || { geos: [], creatives: [] };
      const remoteDay = remoteCreoDays[dayKey] || { geos: [], creatives: [] };
      const mergedGeos = mergeEntityArray(localDay.geos, remoteDay.geos, deletedIds);
      const mergedCreatives = mergeEntityArray(localDay.creatives, remoteDay.creatives, deletedIds)
        .filter(c => mergedGeos.some(g=>g.id===c.geoId));
      localCreoDays[dayKey] = { geos: mergedGeos, creatives: mergedCreatives };
    });
    state.reports.creoChecker.days = localCreoDays;

    ensureReportsShape();
    const remoteCamp = (remote.reports||{}).campaign || { days: {} };
    const remoteCampDays = (remoteCamp.days && typeof remoteCamp.days === 'object') ? remoteCamp.days : {};
    const localCampDays = state.reports.campaign.days || {};
    const allCampDayKeys = new Set([...Object.keys(localCampDays), ...Object.keys(remoteCampDays)]);
    allCampDayKeys.forEach(dayKey => {
      const localDay = localCampDays[dayKey] || { geos: [], campaigns: [] };
      const remoteDay = remoteCampDays[dayKey] || { geos: [], campaigns: [] };
      const mergedGeos = mergeEntityArray(localDay.geos, remoteDay.geos, deletedIds);
      const mergedCamps = mergeEntityArray(localDay.campaigns, remoteDay.campaigns, deletedIds)
        .filter(c => mergedGeos.some(g=>g.id===c.geoId));
      localCampDays[dayKey] = { geos: mergedGeos, campaigns: mergedCamps };
    });
    state.reports.campaign.days = localCampDays;

    state.reports.geoCipher = mergeEntityArray(state.reports.geoCipher, (remote.reports||{}).geoCipher, deletedIds);

    if(Array.isArray(remote.layers)){
      const layerIds = new Set((state.layers||[]).map(l=>l.id));
      remote.layers.forEach(l => { if(l && l.id && !layerIds.has(l.id)) state.layers.push(l); });
    }

    const after = JSON.stringify({ f: state.fanpages, c: state.creatives, r: state.fanpageRegistry, l: state.links, rep: state.reports });
    return before !== after;
  }

  let saveTimer = null;
  let pendingSaves = 0;
  let saveQueue = Promise.resolve();
  function saveState(immediate){
    clearTimeout(saveTimer);
    saveTimer = null;
    const doSave = async () => {
      pendingSaves++;
      updateSaveIndicator();
      try{
        // Save FIRST, immediately, with nothing in front of it — this is the request that must
        // survive a page refresh, so it can't be delayed behind any other network round trip.
        const result = await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);
        if(!result){ showToast('Не удалось сохранить данные'); }
      }catch(e){
        showToast('Ошибка сохранения: ' + (e.message||e));
      }finally{
        pendingSaves = Math.max(0, pendingSaves - 1);
        updateSaveIndicator();
      }
    };
    // Chain through a single queue: rapid consecutive saves (e.g. creating several things back
    // to back) must reach the server in the same order they were made. Firing them in parallel
    // lets slower and faster requests finish out of order over the network, so an OLDER save can
    // land after a newer one and silently overwrite it — exactly the "works, then reload loses
    // some of it" symptom. Queuing guarantees each save only starts once the previous one lands.
    const runQueued = () => { saveQueue = saveQueue.then(doSave, doSave); };
    if(immediate){ runQueued(); } else { saveTimer = setTimeout(()=>{ saveTimer = null; runQueued(); }, 350); }
  }

  // Background reconciliation with whatever other open tabs/people have saved — runs on its own
  // schedule (not tied to the moment of editing), so it never stands between "I made an edit" and
  // "that edit is safely on the server". If it discovers something new, it adopts it and re-saves.
  let syncing = false;
  async function backgroundSync(){
    if(syncing || pendingSaves > 0) return;
    syncing = true;
    try{
      const res = await fetch('/api/kv/' + encodeURIComponent(STORAGE_KEY), { credentials: 'include' });
      if(res.ok){
        const data = await res.json();
        const remote = JSON.parse(data.value);
        const changed = applyRemoteMerge(remote);
        if(changed){
          await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);
          render();
        }
      }
    }catch(e){
      console.error('background sync failed:', e);
    }finally{
      syncing = false;
    }
  }
  setInterval(backgroundSync, 8000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) backgroundSync(); });

  function updateSaveIndicator(){
    const el = document.getElementById('saveIndicator');
    if(!el) return;
    el.textContent = pendingSaves > 0 ? 'Сохранение…' : 'Сохранено ✓';
    el.style.color = pendingSaves > 0 ? 'var(--amber)' : 'var(--text-dim)';
  }
  window.addEventListener('beforeunload', (e)=>{
    if(pendingSaves > 0 || saveTimer){
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function activeFanpages(){ return state.fanpages; }
  function activeCreatives(){ return state.creatives; }
  function activeLinks(){ return state.links; }

  // ---------- BOARD RENDER ----------
  function ensurePosition(item, index, side){
    if(typeof item.x === 'number' && typeof item.y === 'number') return;
    item.x = side === 'fan' ? 580 : 40;
    item.y = 30 + index * 112;
  }

  function computeCanvasSize(fans, cres){
    let maxX = 1000, maxY = 700;
    [...fans, ...cres].forEach(n=>{
      maxX = Math.max(maxX, (n.x||0) + 420);
      maxY = Math.max(maxY, (n.y||0) + 320);
    });
    return { w: Math.max(3000, maxX), h: Math.max(2000, maxY) };
  }

  function renderBoard(){
    const fans = activeFanpages();
    const cres = activeCreatives();
    fans.forEach((f,i)=>ensurePosition(f,i,'fan'));
    cres.forEach((c,i)=>ensurePosition(c,i,'cre'));

    boardCanvas.querySelectorAll('.note').forEach(n=>n.remove());

    const { w, h } = computeCanvasSize(fans, cres);
    boardCanvas.style.width = w + 'px';
    boardCanvas.style.height = h + 'px';
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.style.width = w + 'px';
    svg.style.height = h + 'px';

    fans.forEach((f, idx) => boardCanvas.appendChild(makeNote(f, 'fan', idx)));
    cres.forEach((c, idx) => boardCanvas.appendChild(makeNote(c, 'cre', idx)));

    updateBoardViewportHeight();
    applyTransform();
    drawStrings();
  }

  function makeNote(item, kind, idx){
    const div = document.createElement('div');
    div.className = 'note ' + kind;
    div.style.left = item.x + 'px';
    div.style.top = item.y + 'px';
    div.dataset.id = item.id;
    div.dataset.kind = kind;

    const del = document.createElement('button');
    del.className='del'; del.textContent='×'; del.title='Удалить';
    del.addEventListener('click', safe((e)=>{ e.stopPropagation(); deleteNode(item.id, kind); }));
    div.appendChild(del);

    const edit = document.createElement('button');
    edit.className='del edit-btn'; edit.textContent='✎'; edit.title='Редактировать';
    edit.addEventListener('mousedown', (e)=>e.stopPropagation());
    edit.addEventListener('click', safe((e)=>{ e.stopPropagation(); openNodeEditor(item.id, kind); }));
    div.appendChild(edit);

    const spacer = document.createElement('div');
    spacer.className = 'icon-spacer';
    div.appendChild(spacer);

    const name = document.createElement('div'); name.className='name'; name.textContent = item.name;
    div.appendChild(name);

    const linkCount = activeLinks().filter(l => kind==='fan' ? l.fanpageId===item.id : l.creativeId===item.id).length;
    const sub = document.createElement('div'); sub.className='sub';
    sub.textContent = (kind==='fan' ? 'Фанпейдж' : 'Креатив') + ' · связей: ' + linkCount;
    div.appendChild(sub);

    if(kind === 'cre' && item.description){
      const desc = document.createElement('div');
      desc.className = 'sub';
      desc.style.cssText = 'margin-top:4px; opacity:0.85; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;';
      desc.textContent = '📝 ' + item.description;
      desc.title = item.description;
      div.appendChild(desc);
    }

    const connector = document.createElement('div');
    connector.className='connector';
    div.appendChild(connector);

    div.addEventListener('mousedown', (e)=>{
      if(e.target === connector || e.target === del || e.target === edit) return;
      const c = toCanvasCoords(e.clientX, e.clientY);
      dragging = { id:item.id, kind, offsetX: c.x - item.x, offsetY: c.y - item.y, startClientX: e.clientX, startClientY: e.clientY, moved:false };
      e.preventDefault();
      e.stopPropagation();
    });

    connector.addEventListener('mousedown', (e)=>{
      e.stopPropagation(); e.preventDefault();
      const anchorX = kind === 'fan' ? item.x : item.x + 190;
      const c = toCanvasCoords(e.clientX, e.clientY);
      connecting = {
        fromId: item.id,
        fromKind: kind,
        x1: anchorX, y1: item.y + 37,
        mouseX: c.x, mouseY: c.y
      };
      div.classList.add('linking-src');
    });

    return div;
  }

  // Geometry for a link's curve + matching label position (label sits exactly on the curve at t=0.5).
  // Sibling connections (same fanpage+creative pair) are offset perpendicular to the connection
  // direction — this keeps them visually separated at any angle, not just for near-horizontal lines.
  function computeGeometry(fanNode, creNode, link){
    const baseX1 = fanNode.x, baseY1 = fanNode.y + 37;
    const baseX2 = creNode.x + 190, baseY2 = creNode.y + 37;

    const siblings = activeLinks().filter(l=>l.fanpageId===link.fanpageId && l.creativeId===link.creativeId);
    const idx = Math.max(0, siblings.findIndex(l=>l.id===link.id));
    const count = siblings.length;
    const mid = (count-1)/2;
    const spread = count > 1 ? (idx - mid) : 0; // e.g. count=2 -> -0.5, 0.5 ; count=3 -> -1,0,1

    const dx = baseX2 - baseX1, dy = baseY2 - baseY1;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const px = -dy/len, py = dx/len; // unit vector perpendicular to the connection

    const jitter = ((hashStr(link.id) % 5) - 2) * 3;
    const anchorOffset = spread * 22 + jitter; // shifts BOTH endpoints, so lines stay parallel end-to-end
    const bowOffset = spread * 34;             // extra curve on top of the parallel shift

    const x1 = baseX1 + px*anchorOffset, y1 = baseY1 + py*anchorOffset;
    const x2 = baseX2 + px*anchorOffset, y2 = baseY2 + py*anchorOffset;

    const midX = (x1+x2)/2, midY = (y1+y2)/2;
    const mx = midX + px*bowOffset;
    const my = midY + py*bowOffset + 32; // small constant sag for a hanging-string feel

    // point on the quadratic bezier at t = 0.5
    const labelX = 0.25*x1 + 0.5*mx + 0.25*x2;
    const labelY = 0.25*y1 + 0.5*my + 0.25*y2;

    return { x1, y1, x2, y2, mx, my, labelX, labelY };
  }

  function drawStrings(){
    svg.innerHTML = '';
    const fanMap = {}; activeFanpages().forEach(f=>fanMap[f.id]=f);
    const creMap = {}; activeCreatives().forEach(c=>creMap[c.id]=c);

    activeLinks().forEach(link => {
      const f = fanMap[link.fanpageId], c = creMap[link.creativeId];
      if(!f || !c) return;
      const geo = computeGeometry(f, c, link);

      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', `M ${geo.x1} ${geo.y1} Q ${geo.mx} ${geo.my} ${geo.x2} ${geo.y2}`);
      path.setAttribute('stroke', link.postUrls && link.postUrls.length ? 'var(--green)' : 'var(--teal)');
      path.classList.add('signal-line');
      path.style.pointerEvents = 'stroke';
      path.addEventListener('click', ()=>openLinkModal(link));
      svg.appendChild(path);

      if(link.geo){
        const text = link.geo;
        const w = Math.max(26, text.length * 6.4 + 12);
        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x', geo.labelX - w/2);
        rect.setAttribute('y', geo.labelY - 12);
        rect.setAttribute('width', w);
        rect.setAttribute('height', 16);
        rect.setAttribute('rx', 4);
        rect.classList.add('link-label-bg');
        svg.appendChild(rect);

        const label = document.createElementNS('http://www.w3.org/2000/svg','text');
        label.setAttribute('x', geo.labelX);
        label.setAttribute('y', geo.labelY - 1);
        label.setAttribute('text-anchor','middle');
        label.classList.add('link-label-text');
        label.style.pointerEvents='none';
        label.textContent = text;
        svg.appendChild(label);
      }
    });

    if(connecting){
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', `M ${connecting.x1} ${connecting.y1} Q ${(connecting.x1+connecting.mouseX)/2} ${(connecting.y1+connecting.mouseY)/2+55} ${connecting.mouseX} ${connecting.mouseY}`);
      path.classList.add('signal-line-preview');
      svg.appendChild(path);
    }
  }

  document.addEventListener('mousemove', (e)=>{
    if(dragging){
      const item = (dragging.kind==='fan' ? state.fanpages : state.creatives).find(i=>i.id===dragging.id);
      if(!item) return;
      const c = toCanvasCoords(e.clientX, e.clientY);
      item.x = c.x - dragging.offsetX;
      item.y = c.y - dragging.offsetY;
      const el = boardCanvas.querySelector(`.note[data-id="${item.id}"][data-kind="${dragging.kind}"]`);
      if(el){ el.style.left = item.x+'px'; el.style.top = item.y+'px'; }
      const { w, h } = computeCanvasSize(activeFanpages(), activeCreatives());
      boardCanvas.style.width = w + 'px'; boardCanvas.style.height = h + 'px';
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      svg.style.width = w + 'px'; svg.style.height = h + 'px';
      drawStrings();
    }
    if(connecting){
      const c = toCanvasCoords(e.clientX, e.clientY);
      connecting.mouseX = c.x;
      connecting.mouseY = c.y;
      drawStrings();
    }
  });

  document.addEventListener('mouseup', (e)=>{
    if(dragging){
      const moved = Math.abs(e.clientX - dragging.startClientX) > 5 || Math.abs(e.clientY - dragging.startClientY) > 5;
      if(!moved){
        openNodeEditor(dragging.id, dragging.kind);
      }
      // note: pure repositioning is NOT saved by itself anymore — only actual creates/edits/
      // deletes trigger a save. A dragged position still gets written the next time any real
      // edit happens (the whole board state is serialized together), just not on every nudge.
      dragging = null;
    }
    if(connecting){
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const wantKind = connecting.fromKind === 'fan' ? 'cre' : 'fan';
      const noteEl = el ? el.closest('.note.' + wantKind) : null;
      boardCanvas.querySelectorAll('.linking-src').forEach(n=>n.classList.remove('linking-src'));
      if(noteEl){
        const targetId = noteEl.dataset.id;
        const fanpageId = connecting.fromKind === 'fan' ? connecting.fromId : targetId;
        const creativeId = connecting.fromKind === 'fan' ? targetId : connecting.fromId;
        openLinkModal(null, fanpageId, creativeId);
      }
      connecting = null;
      drawStrings();
    }
  });

  const MAX_TRASH = 50;
  function pushToTrash(type, data, label){
    if(!Array.isArray(state.deletedItems)) state.deletedItems = [];
    state.deletedItems.unshift({ id: uid(), type, data: JSON.parse(JSON.stringify(data)), label, deletedAt: Date.now() });
    if(state.deletedItems.length > MAX_TRASH) state.deletedItems.length = MAX_TRASH;
  }

  function deleteNode(id, kind){
    const item = (kind==='fan'?state.fanpages:state.creatives).find(i=>i.id===id);
    if(!item) return;
    const linkedCount = state.links.filter(l => kind==='fan'? l.fanpageId===id : l.creativeId===id).length;
    const msg = linkedCount>0
      ? `Удалить "${item.name}"? Также будет удалено связей: ${linkedCount}.`
      : `Удалить "${item.name}"?`;
    if(!confirm(msg)) return;

    const fanMap = {}; state.fanpages.forEach(f=>fanMap[f.id]=f);
    const creMap = {}; state.creatives.forEach(c=>creMap[c.id]=c);
    const cascaded = state.links.filter(l => kind==='fan'? l.fanpageId===id : l.creativeId===id);
    cascaded.forEach(l=>{
      const fn = fanMap[l.fanpageId] ? fanMap[l.fanpageId].name : '?';
      const cn = creMap[l.creativeId] ? creMap[l.creativeId].name : '?';
      pushToTrash('link', l, fn + ' → ' + cn);
    });
    pushToTrash(kind, item, item.name);

    if(kind==='fan'){
      state.fanpages = state.fanpages.filter(i=>i.id!==id);
      state.links = state.links.filter(l=>l.fanpageId!==id);
    }else{
      state.creatives = state.creatives.filter(i=>i.id!==id);
      state.links = state.links.filter(l=>l.creativeId!==id);
    }
    saveState(true);
    render();
  }

  function restoreTrashItem(trashId){
    const entry = (state.deletedItems||[]).find(t=>t.id===trashId);
    if(!entry) return;
    if(entry.type === 'link'){
      const fanExists = state.fanpages.some(f=>f.id===entry.data.fanpageId);
      const creExists = state.creatives.some(c=>c.id===entry.data.creativeId);
      if(!fanExists || !creExists){
        showToast('Сначала восстановите фанпейдж и креатив для этой связи');
        return;
      }
      state.links.push(entry.data);
    }else if(entry.type === 'fan' || entry.type === 'cre'){
      if(!state.layers.some(l=>l.id===entry.data.layerId)){
        entry.data.layerId = state.currentLayerId;
      }
      (entry.type==='fan' ? state.fanpages : state.creatives).push(entry.data);
    }else if(entry.type === 'freg'){
      state.fanpageRegistry.push(entry.data);
    }else if(entry.type === 'accagent'){
      ensureReportsShape();
      state.reports.accs.agents.push(entry.data);
    }else if(entry.type === 'accsoc'){
      ensureReportsShape();
      if(!state.reports.accs.agents.some(a=>a.id===entry.data.agentId)){
        showToast('Сначала восстановите агента для этого soc');
        return;
      }
      state.reports.accs.socs.push(entry.data);
    }else if(entry.type === 'acc'){
      ensureReportsShape();
      if(!state.reports.accs.socs.some(s=>s.id===entry.data.socId)){
        showToast('Сначала восстановите soc для этого аккаунта');
        return;
      }
      state.reports.accs.accounts.push(entry.data);
    }else if(entry.type === 'creogeo'){
      ensureReportsShape();
      const dayKey = entry.data._creoDay || todayStr();
      const day = ensureCreoDay(dayKey);
      day.geos.push(entry.data);
    }else if(entry.type === 'creocreative'){
      ensureReportsShape();
      const dayKey = entry.data._creoDay || todayStr();
      const day = ensureCreoDay(dayKey);
      if(!day.geos.some(g=>g.id===entry.data.geoId)){
        showToast('Сначала восстановите гео для этого креатива (за ' + fmtDM(dayKey) + ')');
        return;
      }
      day.creatives.push(entry.data);
    }else if(entry.type === 'campgeo'){
      ensureReportsShape();
      const dayKey = entry.data._campDay || todayStr();
      const day = ensureCampDay(dayKey);
      day.geos.push(entry.data);
    }else if(entry.type === 'campcampaign'){
      ensureReportsShape();
      const dayKey = entry.data._campDay || todayStr();
      const day = ensureCampDay(dayKey);
      if(!day.geos.some(g=>g.id===entry.data.geoId)){
        showToast('Сначала восстановите гео для этой кампании (за ' + fmtDM(dayKey) + ')');
        return;
      }
      day.campaigns.push(entry.data);
    }else if(entry.type === 'geocipher'){
      ensureReportsShape();
      state.reports.geoCipher.push(entry.data);
    }
    state.deletedItems = state.deletedItems.filter(t=>t.id!==trashId);
    saveState(true);
    render();
    showToast('Восстановлено');
  }

  // ---------- ADD NODE MODAL ----------
  function openNodeEditor(id, kind){
    const arr = kind === 'fan' ? state.fanpages : state.creatives;
    const item = arr.find(i => i.id === id);
    if(!item) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${kind==='fan' ? 'Фанпейдж' : 'Нейминг креатива'}</h3>`;

    const nameField = document.createElement('div'); nameField.className='field';
    nameField.innerHTML = `<label>Название</label>`;
    const nameInput = document.createElement('input');
    nameInput.value = item.name;
    nameField.appendChild(nameInput);
    modal.appendChild(nameField);

    let descInput = null;
    if(kind === 'cre'){
      const descField = document.createElement('div'); descField.className='field';
      descField.innerHTML = `<label>Описание</label>`;
      descInput = document.createElement('textarea');
      descInput.rows = 3;
      descInput.placeholder = 'Заметки по креативу, суть, для чего он...';
      descInput.style.cssText = 'padding:9px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; background:var(--panel-2); color:var(--text); font-family:inherit; resize:vertical;';
      descInput.value = item.description || '';
      descField.appendChild(descInput);
      modal.appendChild(descField);
    }

    const actions = document.createElement('div'); actions.className='modal-actions';
    const delBtn = document.createElement('button');
    delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
    delBtn.addEventListener('click', safe(()=>{
      document.body.removeChild(overlay);
      deleteNode(id, kind);
    }));
    actions.appendChild(delBtn);
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите название'); return; }
      item.name = nameInput.value.trim();
      if(kind === 'cre'){ item.description = descInput.value.trim(); }
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.focus();
  }

  function addRegistryPrompt(){
    showSimpleModal({
      title: 'Новый фанпейдж (реестр)',
      label: 'Название фанпейджа',
      placeholder: 'Введите название',
      onSubmit: (val) => {
        state.fanpageRegistry.push({ id: uid(), name: val.trim(), status: 'inactive', geo:'', gender:'', pageUrl:'', createdAt: Date.now() });
        saveState(true);
        render();
      }
    });
  }

  function openBulkAddFanpages(){
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>Добавить фанпейджи списком</h3><p class="muted" style="font-size:12.5px;margin-top:-8px;">По одному названию на строку. Можно вставить сразу хоть сотню.</p>`;

    const field = document.createElement('div'); field.className = 'field';
    field.innerHTML = `<label>Названия (каждое с новой строки)</label>`;
    const textarea = document.createElement('textarea');
    textarea.rows = 10;
    textarea.placeholder = 'Например:\nАккаунт 1\nАккаунт 2\nАккаунт 3\n...';
    textarea.style.cssText = 'padding:9px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; background:var(--panel-2); color:var(--text); font-family:inherit; resize:vertical;';
    field.appendChild(textarea);
    modal.appendChild(field);

    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const spacer = document.createElement('div'); spacer.className = 'spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const addBtn = document.createElement('button'); addBtn.className='btn btn-fan'; addBtn.textContent='Добавить все'; addBtn.type='button';
    addBtn.addEventListener('click', safe(()=>{
      const names = textarea.value.split('\n').map(s=>s.trim()).filter(Boolean);
      if(names.length === 0){ showToast('Список пуст'); return; }
      names.forEach(name => {
        state.fanpageRegistry.push({ id: uid(), name, status: 'inactive', geo:'', gender:'', pageUrl:'', createdAt: Date.now() });
      });
      saveState(true);
      render();
      document.body.removeChild(overlay);
      showToast(`Добавлено фанпейджей: ${names.length}`);
    }));
    actions.appendChild(addBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    textarea.focus();
  }

  function addNodePrompt(kind, pos){
    const label = kind==='fan' ? 'Название фанпейджа' : 'Нейминг креатива';
    showSimpleModal({
      title: kind==='fan' ? 'Новый фанпейдж' : 'Новый нейминг креатива',
      label, placeholder:'Введите название',
      onSubmit: (val) => {
        const arr = kind==='fan' ? state.fanpages : state.creatives;
        const item = { id: uid(), name: val.trim(), layerId: state.currentLayerId };
        if(pos){
          item.x = Math.round(pos.x - 95);
          item.y = Math.round(pos.y - 37);
        }
        arr.push(item);
        saveState(true);
        render();
      }
    });
  }

  // ---------- RIGHT-CLICK CONTEXT MENU ----------
  let ctxKeyHandler = null;
  function removeContextMenu(){
    const m = document.getElementById('ctxMenu');
    if(m) m.remove();
    if(ctxKeyHandler){ document.removeEventListener('keydown', ctxKeyHandler); ctxKeyHandler = null; }
  }
  function showContextMenu(clientX, clientY, canvasPos){
    removeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'ctxMenu';
    menu.className = 'ctx-menu';
    document.body.appendChild(menu);

    const fanBtn = document.createElement('button');
    fanBtn.className = 'ctx-item'; fanBtn.textContent = '+ Фанпейдж здесь';
    fanBtn.addEventListener('click', ()=>{ removeContextMenu(); addNodePrompt('fan', canvasPos); });
    menu.appendChild(fanBtn);

    const creBtn = document.createElement('button');
    creBtn.className = 'ctx-item cre-item'; creBtn.textContent = '+ Нейминг креатива здесь';
    creBtn.addEventListener('click', ()=>{ removeContextMenu(); addNodePrompt('cre', canvasPos); });
    menu.appendChild(creBtn);

    // position, then clamp so it stays on screen
    menu.style.left = clientX + 'px';
    menu.style.top = clientY + 'px';
    const rect = menu.getBoundingClientRect();
    if(rect.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - rect.width - 8) + 'px';
    if(rect.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - rect.height - 8) + 'px';

    // close on a subsequent left click, or Escape — NOT on 'contextmenu', since that would
    // immediately kill the very next right-click used to reopen the menu
    setTimeout(()=>{
      document.addEventListener('click', removeContextMenu, { once:true });
      ctxKeyHandler = (e)=>{ if(e.key === 'Escape') removeContextMenu(); };
      document.addEventListener('keydown', ctxKeyHandler);
    }, 0);
  }

  boardView.addEventListener('contextmenu', safe((e)=>{
    if(e.target.closest('.note')){ removeContextMenu(); return; }
    e.preventDefault();
    const canvasPos = toCanvasCoords(e.clientX, e.clientY);
    showContextMenu(e.clientX, e.clientY, canvasPos);
  }));
  // right-clicking anywhere outside the board should also tidy up a stray open menu
  document.addEventListener('contextmenu', (e)=>{
    if(!boardView.contains(e.target)) removeContextMenu();
  });

  function showSimpleModal({title, label, placeholder, onSubmit}){
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
    const wrap = document.createElement('div'); wrap.className='field';
    const lab = document.createElement('label'); lab.textContent = label;
    const inp = document.createElement('input'); inp.placeholder = placeholder || '';
    wrap.appendChild(lab); wrap.appendChild(inp);
    modal.appendChild(wrap);

    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!inp.value.trim()){ showToast('Введите название'); return; }
      onSubmit(inp.value);
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    inp.addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveBtn.click(); });
    inp.focus();
  }

  // ---------- LAYER MANAGER ----------
  function timeAgo(ts){
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff/60000);
    if(min < 1) return 'только что';
    if(min < 60) return min + ' мин назад';
    const hr = Math.floor(min/60);
    if(hr < 24) return hr + ' ч назад';
    const days = Math.floor(hr/24);
    return days + ' дн назад';
  }

  function fmtBytes(n){
    if(n < 1024) return n + ' Б';
    return Math.round(n/1024) + ' КБ';
  }

  const BACKUPS_PASSWORD = '7897';
  function askBackupsPassword(onSuccess){
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '320px';
    modal.innerHTML = `<h3>Бэкапы защищены паролем</h3>`;
    const field = document.createElement('div'); field.className = 'field';
    field.innerHTML = `<label>Пароль</label>`;
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = '••••';
    field.appendChild(input);
    modal.appendChild(field);

    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    const okBtn = document.createElement('button'); okBtn.className='btn btn-fan'; okBtn.textContent='Войти'; okBtn.type='button';
    const trySubmit = ()=>{
      if(input.value === BACKUPS_PASSWORD){
        document.body.removeChild(overlay);
        onSuccess();
      }else{
        showToast('Неверный пароль');
        input.value = '';
        input.focus();
      }
    };
    okBtn.addEventListener('click', trySubmit);
    input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') trySubmit(); });
    actions.appendChild(okBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    input.focus();
  }

  async function openBackupsManager(){
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>Бэкапы</h3><p class="muted" style="font-size:12.5px;margin-top:-8px;">Сервер автоматически сохраняет предыдущую версию перед каждым изменением (последние ${30}). Можно откатиться на любую из них.</p>`;

    const list = document.createElement('div');
    list.innerHTML = '<div class="muted" style="font-size:13px; padding:10px 0;">Загрузка…</div>';
    modal.appendChild(list);

    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const closeBtn = document.createElement('button'); closeBtn.className='btn btn-plain'; closeBtn.textContent='Готово'; closeBtn.type='button';
    closeBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(closeBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });

    try{
      const res = await fetch('/api/kv/' + encodeURIComponent(STORAGE_KEY) + '/history', { credentials: 'include' });
      const data = await res.json();
      const entries = data.entries || [];
      if(entries.length === 0){
        list.innerHTML = '<div class="muted" style="font-size:13px; padding:10px 0;">Пока нет ни одного бэкапа — они появятся после первого изменения доски.</div>';
        return;
      }
      list.innerHTML = '';
      entries.forEach(entry => {
        const row = document.createElement('div'); row.className='layer-row';
        const info = document.createElement('div');
        info.style.cssText = 'flex:1; font-size:13px;';
        info.innerHTML = `${timeAgo(new Date(entry.saved_at).getTime())} <span class="muted" style="font-size:11px;">· ${fmtBytes(entry.size)} · ${new Date(entry.saved_at).toLocaleString('ru-RU')}</span>`;
        row.appendChild(info);
        const restoreBtn = document.createElement('button');
        restoreBtn.textContent = '↺'; restoreBtn.title = 'Восстановить эту версию';
        restoreBtn.style.cssText = 'width:28px; height:28px; border-radius:6px; border:1px solid var(--border); background:var(--panel-2); color:var(--green); cursor:pointer; font-size:15px;';
        restoreBtn.addEventListener('click', safe(async ()=>{
          if(!confirm('Откатить доску на состояние от ' + new Date(entry.saved_at).toLocaleString('ru-RU') + '? Текущая версия тоже сохранится в бэкапы перед откатом.')) return;
          const r = await fetch('/api/kv/' + encodeURIComponent(STORAGE_KEY) + '/restore/' + entry.id, { method:'POST', credentials:'include' });
          if(!r.ok){ showToast('Не удалось восстановить бэкап'); return; }
          document.body.removeChild(overlay);
          showToast('Восстановлено, перезагружаю доску…');
          loadingBox.style.display = 'block';
          loadingBox.textContent = 'Загрузка доски…';
          location.reload();
        }));
        row.appendChild(restoreBtn);
        list.appendChild(row);
      });
    }catch(e){
      list.innerHTML = '<div class="muted" style="font-size:13px; padding:10px 0;">Не удалось загрузить список бэкапов: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function openTrashManager(){
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>История удалений</h3><p class="muted" style="font-size:12.5px;margin-top:-8px;">Последние ${MAX_TRASH} удалённых фанпейджей, креативов и связей — можно вернуть.</p>`;

    const list = document.createElement('div');
    modal.appendChild(list);

    function renderList(){
      list.innerHTML = '';
      const items = state.deletedItems || [];
      if(items.length === 0){
        const empty = document.createElement('div');
        empty.className = 'muted'; empty.style.cssText='font-size:13px; padding:10px 0;';
        empty.textContent = 'Пока ничего не удалялось.';
        list.appendChild(empty);
        return;
      }
      items.forEach(entry => {
        const row = document.createElement('div'); row.className='layer-row';
        const typeLabel = entry.type === 'fan' ? 'Фанпейдж (доска)' : entry.type === 'cre' ? 'Креатив' : entry.type === 'freg' ? 'Фанпейдж (реестр)'
          : entry.type === 'acc' ? 'Аккаунт (Accs)' : entry.type === 'accsoc' ? 'Soc (Accs)' : entry.type === 'accagent' ? 'Агент (Accs)'
          : entry.type === 'creogeo' ? 'Гео (CreoChecker)' : entry.type === 'creocreative' ? 'Креатив (CreoChecker)'
          : entry.type === 'campgeo' ? 'Гео (Campaign)' : entry.type === 'campcampaign' ? 'Кампания (Campaign)'
          : entry.type === 'geocipher' ? 'GEO (Шифр)' : 'Связь';
        const info = document.createElement('div');
        info.style.cssText = 'flex:1; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        info.innerHTML = `<span class="muted" style="font-size:11px;">${typeLabel} · ${timeAgo(entry.deletedAt)}</span><br>${escapeHtml(entry.label||'—')}`;
        row.appendChild(info);
        const restoreBtn = document.createElement('button');
        restoreBtn.textContent = '↺'; restoreBtn.title = 'Восстановить';
        restoreBtn.style.cssText = 'width:28px; height:28px; border-radius:6px; border:1px solid var(--border); background:var(--panel-2); color:var(--green); cursor:pointer; font-size:15px;';
        restoreBtn.addEventListener('click', safe(()=>{
          restoreTrashItem(entry.id);
          renderList();
        }));
        row.appendChild(restoreBtn);
        list.appendChild(row);
      });
    }
    renderList();

    const actions = document.createElement('div'); actions.className='modal-actions';
    if((state.deletedItems||[]).length){
      const clearBtn = document.createElement('button');
      clearBtn.className='btn btn-danger'; clearBtn.textContent='Очистить историю'; clearBtn.type='button';
      clearBtn.addEventListener('click', safe(()=>{
        if(!confirm('Очистить всю историю удалений? Восстановить будет уже нельзя.')) return;
        state.deletedItems = [];
        saveState(true);
        renderList();
      }));
      actions.appendChild(clearBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const closeBtn = document.createElement('button'); closeBtn.className='btn btn-plain'; closeBtn.textContent='Готово'; closeBtn.type='button';
    closeBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(closeBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
  }

  // ---------- LINK MODAL (geo + up to 4 post urls) ----------
  function openLinkModal(existingLink, fanpageId, creativeId){
    const isEdit = !!existingLink;
    const fan = state.fanpages.find(f=>f.id === (isEdit?existingLink.fanpageId:fanpageId));
    const cre = state.creatives.find(c=>c.id === (isEdit?existingLink.creativeId:creativeId));

    let urls = isEdit
      ? (existingLink.postUrls.length ? existingLink.postUrls.map(u=>({...u})) : [{naming:'', url:''}])
      : [{naming:'', url:''}];

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${isEdit?'Связь: ':'Новая связь: '}${escapeHtml(fan?fan.name:'?')} → ${escapeHtml(cre?cre.name:'?')}</h3>`;

    const geoField = document.createElement('div'); geoField.className='field';
    geoField.innerHTML = `<label>Гео</label>`;
    const geoInput = document.createElement('input');
    geoInput.placeholder = 'например, US, DE, PL';
    geoInput.value = isEdit ? (existingLink.geo||'') : '';
    geoField.appendChild(geoInput);
    modal.appendChild(geoField);

    const urlsField = document.createElement('div'); urlsField.className='field';
    urlsField.innerHTML = `<label>Ссылки на посты (до ${MAX_URLS})</label>`;
    const urlsList = document.createElement('div');
    urlsList.style.display='flex'; urlsList.style.flexDirection='column'; urlsList.style.gap='8px';
    urlsField.appendChild(urlsList);
    const addUrlBtn = document.createElement('button');
    addUrlBtn.className='add-url-btn'; addUrlBtn.textContent='+ Добавить ссылку';
    addUrlBtn.type='button';
    urlsField.appendChild(addUrlBtn);
    modal.appendChild(urlsField);

    function renderUrlRows(){
      urlsList.innerHTML = '';
      urls.forEach((val, i) => {
        const group = document.createElement('div');
        group.style.cssText = 'border:1px solid var(--border); border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px;';

        const topRow = document.createElement('div'); topRow.className='url-row';
        const namingInp = document.createElement('input');
        namingInp.placeholder = `Нейминг для залива ${i+1}`;
        namingInp.value = val.naming || '';
        namingInp.addEventListener('input', ()=>{ urls[i].naming = namingInp.value; });
        topRow.appendChild(namingInp);
        if(urls.length > 1){
          const rm = document.createElement('button');
          rm.className='url-remove'; rm.textContent='×'; rm.type='button'; rm.title='Удалить эту ссылку';
          rm.addEventListener('click', ()=>{ urls.splice(i,1); renderUrlRows(); });
          topRow.appendChild(rm);
        }
        group.appendChild(topRow);

        const urlInp = document.createElement('input');
        urlInp.placeholder = `Ссылка на пост ${i+1}`;
        urlInp.value = val.url || '';
        urlInp.addEventListener('input', ()=>{ urls[i].url = urlInp.value; });
        group.appendChild(urlInp);

        urlsList.appendChild(group);
      });
      addUrlBtn.disabled = urls.length >= MAX_URLS;
    }
    addUrlBtn.addEventListener('click', ()=>{
      if(urls.length < MAX_URLS){ urls.push({naming:'', url:''}); renderUrlRows(); }
    });
    renderUrlRows();

    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить связь'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{
        if(confirm('Удалить эту связь?')){
          pushToTrash('link', existingLink, (fan?fan.name:'?') + ' → ' + (cre?cre.name:'?'));
          state.links = state.links.filter(l=>l.id!==existingLink.id);
          saveState(true);
          render();
          document.body.removeChild(overlay);
        }
      }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      const cleanUrls = urls
        .map(u => ({ naming: (u.naming||'').trim(), url: (u.url||'').trim() }))
        .filter(u => u.url)
        .slice(0, MAX_URLS);
      const geo = geoInput.value.trim();
      if(isEdit){
        existingLink.geo = geo;
        existingLink.postUrls = cleanUrls;
      }else{
        state.links.push({ id: uid(), fanpageId, creativeId, geo, postUrls: cleanUrls, layerId: state.currentLayerId, createdAt: Date.now() });
      }
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    geoInput.focus();
  }

  // ---------- TABLE RENDER ----------
  function populateFilterOptions(){
    const fFan = document.getElementById('fFan');
    const fCre = document.getElementById('fCre');
    const fGeo = document.getElementById('fGeo');
    const curFan = fFan.value, curCre = fCre.value, curGeo = fGeo.value;

    const scopeLinks = state.links;

    const fanMap = {}; state.fanpages.forEach(f=>fanMap[f.id]=f);
    const creMap = {}; state.creatives.forEach(c=>creMap[c.id]=c);

    // only offer fanpages/creatives that are actually referenced by a real link — anything
    // that's been deleted from the board (or is an orphaned leftover) won't show up as a filter
    const fanOptions = Array.from(new Set(scopeLinks.map(l=>l.fanpageId)))
      .filter(id => fanMap[id])
      .map(id => ({ id, name: fanMap[id].name }))
      .sort((a,b) => a.name.localeCompare(b.name));
    const creOptions = Array.from(new Set(scopeLinks.map(l=>l.creativeId)))
      .filter(id => creMap[id])
      .map(id => ({ id, name: creMap[id].name }))
      .sort((a,b) => a.name.localeCompare(b.name));

    fFan.innerHTML = '<option value="">Все фанпейджи</option>' +
      fanOptions.map(f=>`<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    fCre.innerHTML = '<option value="">Все креативы</option>' +
      creOptions.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    const geos = Array.from(new Set(scopeLinks.map(l=>l.geo).filter(Boolean))).sort();
    fGeo.innerHTML = '<option value="">Все гео</option>' +
      geos.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');

    fFan.value = curFan; fCre.value = curCre; fGeo.value = curGeo;
  }

  function copyToClipboard(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(
        ()=>showToast('Скопировано'),
        ()=>fallbackCopy(text)
      );
    }else{
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text){
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Скопировано');
    }catch(e){
      showToast('Не удалось скопировать: ' + e.message);
    }
  }

  function setupTableDelegation(){
    tableWrap.addEventListener('click', (e)=>{
      const copyBtn = e.target.closest('.link-copy-btn');
      const copyBadge = e.target.closest('.link-copy-badge');
      const copyNamingBtn = e.target.closest('.link-copy-naming-btn');
      const openBtn = e.target.closest('.link-open-btn');
      if(copyBtn){ copyToClipboard(copyBtn.dataset.url); return; }
      if(copyBadge){ copyToClipboard(copyBadge.dataset.naming); return; }
      if(copyNamingBtn){ copyToClipboard(copyNamingBtn.dataset.naming); return; }
      if(openBtn){ window.open(openBtn.dataset.url, '_blank', 'noopener'); return; }

      const editBtn = e.target.closest('.edit-link');
      const delBtn = e.target.closest('.del-link');
      if(!editBtn && !delBtn) return;
      const tr = e.target.closest('tr');
      if(!tr) return;
      const id = tr.dataset.linkId;
      const link = state.links.find(l=>l.id===id);
      if(!link) return;
      if(editBtn){
        openLinkModal(link);
      }else if(delBtn){
        if(confirm('Удалить эту связь?')){
          const fan = state.fanpages.find(f=>f.id===link.fanpageId);
          const cre = state.creatives.find(c=>c.id===link.creativeId);
          pushToTrash('link', link, (fan?fan.name:'?') + ' → ' + (cre?cre.name:'?'));
          state.links = state.links.filter(l=>l.id!==id);
          saveState(true);
          render();
        }
      }
    });
  }

  function deleteRegistryEntry(id){
    const item = state.fanpageRegistry.find(f=>f.id===id);
    if(!item) return;
    if(!confirm(`Удалить запись "${item.name}" из реестра фанпейджей? На доску это не повлияет.`)) return;
    pushToTrash('freg', item, item.name);
    state.fanpageRegistry = state.fanpageRegistry.filter(f=>f.id!==id);
    saveState(true);
    render();
  }

  function openRegistryEditor(id){
    const item = state.fanpageRegistry.find(f=>f.id===id);
    if(!item) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>Фанпейдж (реестр)</h3>`;

    const nameField = document.createElement('div'); nameField.className='field';
    nameField.innerHTML = `<label>Название</label>`;
    const nameInput = document.createElement('input');
    nameInput.value = item.name;
    nameField.appendChild(nameInput);
    modal.appendChild(nameField);

    const geoField = document.createElement('div'); geoField.className='field';
    geoField.innerHTML = `<label>Гео (где находится аккаунт)</label>`;
    const geoInput = document.createElement('input');
    geoInput.placeholder = 'например, US, DE, PL';
    geoInput.value = item.geo || '';
    geoField.appendChild(geoInput);
    modal.appendChild(geoField);

    const genderField = document.createElement('div'); genderField.className='field';
    genderField.innerHTML = `<label>Пол аккаунта</label>`;
    const genderSelect = document.createElement('select');
    genderSelect.innerHTML = `
      <option value="">Не указано</option>
      <option value="M">Мужчина (М)</option>
      <option value="F">Женщина (Ж)</option>
    `;
    genderSelect.value = item.gender || '';
    genderField.appendChild(genderSelect);
    modal.appendChild(genderField);

    const statusField = document.createElement('div'); statusField.className='field';
    statusField.innerHTML = `<label>Статус</label>`;
    const statusSelect = document.createElement('select');
    statusSelect.innerHTML = `
      <option value="active">Используется</option>
      <option value="inactive">Не используется</option>
    `;
    statusSelect.value = item.status === 'active' ? 'active' : 'inactive';
    statusField.appendChild(statusSelect);
    modal.appendChild(statusField);

    const urlField = document.createElement('div'); urlField.className='field';
    urlField.innerHTML = `<label>Ссылка на фанпейдж</label>`;
    const urlInput = document.createElement('input');
    urlInput.placeholder = 'https://facebook.com/...';
    urlInput.value = item.pageUrl || '';
    urlField.appendChild(urlInput);
    modal.appendChild(urlField);

    const actions = document.createElement('div'); actions.className='modal-actions';
    const delBtn = document.createElement('button');
    delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
    delBtn.addEventListener('click', safe(()=>{
      document.body.removeChild(overlay);
      deleteRegistryEntry(id);
    }));
    actions.appendChild(delBtn);
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите название'); return; }
      item.name = nameInput.value.trim();
      item.geo = geoInput.value.trim();
      item.gender = genderSelect.value;
      item.status = statusSelect.value;
      item.pageUrl = urlInput.value.trim();
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.focus();
  }

  function setupFanpageTableDelegation(){
    const wrap = document.getElementById('fanpageTableWrap');
    wrap.addEventListener('click', safe((e)=>{
      const copyBtn = e.target.closest('.link-copy-btn');
      const openBtn = e.target.closest('.link-open-btn');
      if(copyBtn){ copyToClipboard(copyBtn.dataset.url); return; }
      if(openBtn){ window.open(openBtn.dataset.url, '_blank', 'noopener'); return; }

      const statusToggle = e.target.closest('.status-toggle');
      const genderToggle = e.target.closest('.gender-toggle');
      if(statusToggle){
        const fp = state.fanpageRegistry.find(f=>f.id===statusToggle.dataset.fanId);
        if(fp){
          fp.status = fp.status === 'active' ? 'inactive' : 'active';
          saveState(true);
          render();
        }
        return;
      }
      if(genderToggle){
        const fp = state.fanpageRegistry.find(f=>f.id===genderToggle.dataset.fanId);
        if(fp){
          fp.gender = fp.gender === 'M' ? 'F' : (fp.gender === 'F' ? '' : 'M');
          saveState(true);
          render();
        }
        return;
      }

      const editBtn = e.target.closest('.edit-fan');
      const delBtn = e.target.closest('.del-fan');
      if(!editBtn && !delBtn) return;
      const tr = e.target.closest('tr');
      if(!tr) return;
      const id = tr.dataset.fanId;
      if(editBtn){ openRegistryEditor(id); }
      else if(delBtn){ deleteRegistryEntry(id); }
    }));
  }

  function populateFanpageFilterOptions(){
    const geoSelect = document.getElementById('fpGeo');
    const cur = geoSelect.value;
    const geos = Array.from(new Set(state.fanpageRegistry.map(f=>f.geo).filter(Boolean))).sort();
    geoSelect.innerHTML = '<option value="">Все</option>' +
      geos.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    geoSelect.value = cur;
  }

  function renderFanpageTable(){
    populateFanpageFilterOptions();
    const search = (document.getElementById('fpSearch').value || '').toLowerCase().trim();
    const geoFilter = document.getElementById('fpGeo').value;
    const statusFilter = document.getElementById('fpStatus').value;
    const genderFilter = document.getElementById('fpGender').value;

    let rows = state.fanpageRegistry.slice();
    if(geoFilter) rows = rows.filter(f => f.geo === geoFilter);
    if(statusFilter) rows = rows.filter(f => (f.status === 'active' ? 'active' : 'inactive') === statusFilter);
    if(genderFilter) rows = rows.filter(f => f.gender === genderFilter);
    if(search){
      rows = rows.filter(f =>
        f.name.toLowerCase().includes(search) ||
        (f.geo||'').toLowerCase().includes(search) ||
        (f.pageUrl||'').toLowerCase().includes(search)
      );
    }
    rows.sort((a,b) => a.name.localeCompare(b.name));

    document.getElementById('fpResultCount').textContent = `Найдено: ${rows.length}`;
    const wrap = document.getElementById('fanpageTableWrap');

    if(rows.length === 0){
      wrap.innerHTML = '<div class="empty-state">Записей не найдено. Добавьте новую кнопкой выше — это отдельный реестр, не связанный с карточками на доске.</div>';
      return;
    }

    let html = '<table><thead><tr><th>Название</th><th>Гео</th><th>Пол</th><th>Статус</th><th>Ссылка</th><th>Действия</th></tr></thead><tbody>';
    rows.forEach(f => {
      const isActive = f.status === 'active';
      const statusHtml = !isActive
        ? `<button type="button" class="badge-layer status-toggle" data-fan-id="${f.id}" title="Клик — переключить на «Используется»" style="border-color:var(--danger); color:var(--danger); background:rgba(224,80,127,0.12); cursor:pointer; font-family:inherit;">Не используется</button>`
        : `<button type="button" class="badge-fan status-toggle" data-fan-id="${f.id}" title="Клик — переключить на «Не используется»" style="cursor:pointer; font-family:inherit; border:none;">Используется</button>`;
      const genderLabel = f.gender === 'M' ? 'М' : f.gender === 'F' ? 'Ж' : '— (клик)';
      const genderHtml = `<button type="button" class="badge-cre gender-toggle" data-fan-id="${f.id}" title="Клик — сменить пол (М → Ж → не указано)" style="cursor:pointer; font-family:inherit; border:none;">${genderLabel}</button>`;
      const linkHtml = f.pageUrl
        ? `<a href="${escapeHtml(f.pageUrl)}" target="_blank" rel="noopener" title="${escapeHtml(f.pageUrl)}">${escapeHtml(shortLinkLabel(f.pageUrl))}</a>
           <button type="button" class="link-icon-btn link-copy-btn" data-url="${escapeHtml(f.pageUrl)}" title="Копировать">📋</button>
           <button type="button" class="link-icon-btn link-open-btn" data-url="${escapeHtml(f.pageUrl)}" title="Открыть">↗</button>`
        : '<span class="muted">—</span>';
      html += `<tr data-fan-id="${f.id}">
        <td><span class="badge-fan">${escapeHtml(f.name)}</span></td>
        <td>${escapeHtml(f.geo || '—')}</td>
        <td>${genderHtml}</td>
        <td>${statusHtml}</td>
        <td class="link-cell">${linkHtml}</td>
        <td class="row-actions">
          <button class="btn-plain edit-fan" type="button">✎ Изм.</button>
          <button class="btn-danger del-fan" type="button">✕ Удалить</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  // ---------- REPORT VIEW (Отчётность) ----------
  const REPORT_SHEETS = ['spendRev', 'accs', 'creoChecker', 'campaign', 'geoCipher']; // more sheets get added here later, one at a time
  let currentReportSheet = 'spendRev';
  let currentReportMonth = null; // 'YYYY-MM'

  const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DOW_NAMES = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  function defaultMonthKey(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }
  function monthKeyToLabel(key){
    const [y,m] = key.split('-').map(Number);
    return MONTH_NAMES[m-1] + ' ' + y;
  }
  function daysInMonth(key){
    const [y,m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  function shiftMonth(key, delta){
    let [y,m] = key.split('-').map(Number);
    m += delta;
    while(m<1){ m+=12; y--; }
    while(m>12){ m-=12; y++; }
    return y + '-' + String(m).padStart(2,'0');
  }
  function getDayEntry(sheet, monthKey, day){
    ensureReportsShape();
    if(!state.reports[sheet][monthKey]) state.reports[sheet][monthKey] = {};
    if(!state.reports[sheet][monthKey][day]) state.reports[sheet][monthKey][day] = { spend:0, revenue:0 };
    return state.reports[sheet][monthKey][day];
  }
  function fmtPlain(n){
    return (Math.round(n*100)/100).toLocaleString('ru-RU', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }
  function fmtMoney(n){
    const s = (Math.round(Math.abs(n)*100)/100).toLocaleString('ru-RU', { minimumFractionDigits:2, maximumFractionDigits:2 });
    return (n > 0 ? '+' : (n < 0 ? '−' : '')) + s;
  }
  function fmtPct(n){
    const s = Math.abs(n).toFixed(1) + '%';
    return (n > 0 ? '+' : (n < 0 ? '−' : '')) + s;
  }
  function pnlColor(n){
    return n > 0 ? '#4caf6b' : (n < 0 ? 'var(--danger)' : 'var(--text-dim)');
  }

  function renderReportView(){
    ensureReportsShape();
    document.getElementById('accsView').style.display = 'none';
    document.getElementById('creoView').style.display = 'none';
    document.getElementById('campaignView').style.display = 'none';
    document.getElementById('geoCipherView').style.display = 'none';
    document.getElementById('reportMonthBar').style.display = 'none';
    document.getElementById('reportTableWrap').style.display = 'none';
    if(currentReportSheet === 'accs'){
      document.getElementById('accsView').style.display = 'block';
      renderAccsView();
    }else if(currentReportSheet === 'creoChecker'){
      document.getElementById('creoView').style.display = 'block';
      renderCreoView();
    }else if(currentReportSheet === 'campaign'){
      document.getElementById('campaignView').style.display = 'block';
      renderCampaignView();
    }else if(currentReportSheet === 'geoCipher'){
      document.getElementById('geoCipherView').style.display = 'block';
      renderGeoCipherView();
    }else{
      document.getElementById('reportMonthBar').style.display = 'flex';
      document.getElementById('reportTableWrap').style.display = 'block';
      if(!currentReportMonth) currentReportMonth = defaultMonthKey();
      document.getElementById('reportMonthLabel').textContent = monthKeyToLabel(currentReportMonth);
      renderReportTable();
    }
  }

  function recomputeReportRow(day){
    const entry = getDayEntry(currentReportSheet, currentReportMonth, day);
    const spend = Number(entry.spend)||0, revenue = Number(entry.revenue)||0;
    const profit = revenue - spend;
    const roi = spend > 0 ? (profit/spend*100) : null;
    const profitCell = document.querySelector(`.report-profit[data-day="${day}"]`);
    const roiCell = document.querySelector(`.report-roi[data-day="${day}"]`);
    if(profitCell){ profitCell.textContent = fmtMoney(profit); profitCell.style.color = pnlColor(profit); }
    if(roiCell){ roiCell.textContent = roi===null ? '—' : fmtPct(roi); roiCell.style.color = roi===null?'var(--text-dim)':pnlColor(roi); }
  }

  function recomputeReportTotals(){
    const days = daysInMonth(currentReportMonth);
    let totalSpend=0, totalRevenue=0;
    for(let d=1; d<=days; d++){
      const entry = getDayEntry(currentReportSheet, currentReportMonth, d);
      totalSpend += Number(entry.spend)||0;
      totalRevenue += Number(entry.revenue)||0;
    }
    const totalProfit = totalRevenue - totalSpend;
    const totalRoi = totalSpend>0 ? (totalProfit/totalSpend*100) : null;
    const row = document.getElementById('reportTotals');
    if(!row) return;
    row.querySelector('.tot-spend').textContent = fmtPlain(totalSpend);
    row.querySelector('.tot-revenue').textContent = fmtPlain(totalRevenue);
    const tp = row.querySelector('.tot-profit');
    tp.textContent = fmtMoney(totalProfit); tp.style.color = pnlColor(totalProfit);
    const tr = row.querySelector('.tot-roi');
    tr.textContent = totalRoi===null ? '—' : fmtPct(totalRoi);
    tr.style.color = totalRoi===null ? 'var(--text-dim)' : pnlColor(totalRoi);
  }

  function renderReportTable(){
    const wrap = document.getElementById('reportTableWrap');
    const days = daysInMonth(currentReportMonth);
    const [y,m] = currentReportMonth.split('-').map(Number);

    let html = '<table class="report-table"><thead><tr><th>День</th><th>Spend</th><th>Revenue</th><th>Profit</th><th>ROI</th></tr></thead><tbody>';
    for(let d=1; d<=days; d++){
      const entry = getDayEntry(currentReportSheet, currentReportMonth, d);
      const dow = new Date(y, m-1, d).getDay();
      const isWeekend = dow===0 || dow===6;
      const spend = Number(entry.spend)||0, revenue = Number(entry.revenue)||0;
      const profit = revenue - spend;
      const roi = spend > 0 ? (profit/spend*100) : null;
      html += `<tr class="${isWeekend?'weekend-row':''}">
        <td>${d} <span class="muted" style="font-size:11px;">${DOW_NAMES[dow]}</span></td>
        <td><input type="number" step="0.01" class="report-input report-spend" data-day="${d}" value="${entry.spend || ''}" placeholder="0"></td>
        <td><input type="number" step="0.01" class="report-input report-revenue" data-day="${d}" value="${entry.revenue || ''}" placeholder="0"></td>
        <td class="report-profit" data-day="${d}" style="color:${pnlColor(profit)};">${fmtMoney(profit)}</td>
        <td class="report-roi" data-day="${d}" style="color:${roi===null?'var(--text-dim)':pnlColor(roi)};">${roi===null?'—':fmtPct(roi)}</td>
      </tr>`;
    }
    html += '</tbody><tfoot><tr id="reportTotals"><td><strong>Итого за месяц</strong></td><td class="tot-spend">0</td><td class="tot-revenue">0</td><td class="tot-profit">0</td><td class="tot-roi">—</td></tr></tfoot></table>';
    wrap.innerHTML = html;
    recomputeReportTotals();
  }

  function setupReportDelegation(){
    const wrap = document.getElementById('reportTableWrap');
    wrap.addEventListener('input', safe((e)=>{
      const inp = e.target;
      if(!inp.classList.contains('report-input')) return;
      const day = inp.dataset.day;
      const entry = getDayEntry(currentReportSheet, currentReportMonth, day);
      const val = inp.value === '' ? 0 : parseFloat(inp.value);
      if(inp.classList.contains('report-spend')) entry.spend = isNaN(val) ? 0 : val;
      else entry.revenue = isNaN(val) ? 0 : val;
      recomputeReportRow(day);
      recomputeReportTotals();
      saveState();
    }));
  }

  document.getElementById('reportPrevMonth').addEventListener('click', safe(()=>{
    currentReportMonth = shiftMonth(currentReportMonth || defaultMonthKey(), -1);
    document.getElementById('reportMonthLabel').textContent = monthKeyToLabel(currentReportMonth);
    renderReportTable();
  }));
  document.getElementById('reportNextMonth').addEventListener('click', safe(()=>{
    currentReportMonth = shiftMonth(currentReportMonth || defaultMonthKey(), 1);
    document.getElementById('reportMonthLabel').textContent = monthKeyToLabel(currentReportMonth);
    renderReportTable();
  }));
  document.getElementById('reportTodayBtn').addEventListener('click', safe(()=>{
    currentReportMonth = defaultMonthKey();
    document.getElementById('reportMonthLabel').textContent = monthKeyToLabel(currentReportMonth);
    renderReportTable();
  }));
  function setActiveSheetTab(sheet){
    document.getElementById('sheetSpendRevBtn').classList.toggle('active', sheet==='spendRev');
    document.getElementById('sheetAccsBtn').classList.toggle('active', sheet==='accs');
    document.getElementById('sheetCreoBtn').classList.toggle('active', sheet==='creoChecker');
    document.getElementById('sheetCampaignBtn').classList.toggle('active', sheet==='campaign');
    document.getElementById('sheetGeoCipherBtn').classList.toggle('active', sheet==='geoCipher');
  }
  document.getElementById('sheetSpendRevBtn').addEventListener('click', safe(()=>{
    currentReportSheet = 'spendRev';
    setActiveSheetTab('spendRev');
    renderReportView();
  }));
  document.getElementById('sheetAccsBtn').addEventListener('click', safe(()=>{
    currentReportSheet = 'accs';
    setActiveSheetTab('accs');
    renderReportView();
  }));
  document.getElementById('sheetCreoBtn').addEventListener('click', safe(()=>{
    currentReportSheet = 'creoChecker';
    setActiveSheetTab('creoChecker');
    renderReportView();
  }));
  document.getElementById('sheetCampaignBtn').addEventListener('click', safe(()=>{
    currentReportSheet = 'campaign';
    setActiveSheetTab('campaign');
    renderReportView();
  }));
  document.getElementById('sheetGeoCipherBtn').addEventListener('click', safe(()=>{
    currentReportSheet = 'geoCipher';
    setActiveSheetTab('geoCipher');
    renderReportView();
  }));

  // ---------- ACCS SHEET (Agent -> Soc [AdsPower ID + Pixel] -> Accounts) ----------
  const ACC_STATUSES = {
    approved:      { label: 'Approved',      color: '#4caf6b' },
    perfect:       { label: 'Perfect',       color: '#e876b0' },
    disabled:      { label: 'Disabled',      color: 'var(--danger)' },
    not_spending:  { label: 'Not spending',  color: 'var(--amber)' },
    payment_error: { label: 'Payment error', color: '#e08a3d' }
  };
  let collapsedAccGroups = new Set();
  function todayStr(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function ensureReportsShape(){
    if(!state.reports) state.reports = {};
    if(!state.reports.spendRev) state.reports.spendRev = {};
    if(Array.isArray(state.reports.accs)){
      // migrate the old flat-list shape (agent/soc/adsPower/pixel were per-account) into the
      // new Agent -> Soc (AdsPower+Pixel) -> Account hierarchy
      const old = state.reports.accs;
      const agents = [], socs = [], accounts = [];
      const agentIdByName = new Map();
      const socIdByKey = new Map();
      old.forEach(rec => {
        const agentName = rec.agent || 'Без агента';
        let agentId = agentIdByName.get(agentName);
        if(!agentId){ agentId = uid(); agentIdByName.set(agentName, agentId); agents.push({ id: agentId, name: agentName }); }
        const socKey = agentId + '|' + (rec.soc||'') + '|' + (rec.adsPowerId||'');
        let socId = socIdByKey.get(socKey);
        if(!socId){
          socId = uid();
          socIdByKey.set(socKey, socId);
          socs.push({ id: socId, agentId, name: rec.soc || 'Без soc', adsPowerId: rec.adsPowerId || '', pixel: rec.pixel || '' });
        }
        accounts.push({
          id: rec.id || uid(), socId, accId: rec.accId || '', dateIssued: rec.dateIssued || todayStr(),
          dateBan: rec.dateBan || '', status: rec.status || 'approved', note: rec.note || ''
        });
      });
      state.reports.accs = { agents, socs, accounts };
    }else if(!state.reports.accs || typeof state.reports.accs !== 'object'){
      state.reports.accs = { agents: [], socs: [], accounts: [] };
    }else{
      if(!Array.isArray(state.reports.accs.agents)) state.reports.accs.agents = [];
      if(!Array.isArray(state.reports.accs.socs)) state.reports.accs.socs = [];
      if(!Array.isArray(state.reports.accs.accounts)) state.reports.accs.accounts = [];
    }
    if(!state.reports.creoChecker || typeof state.reports.creoChecker !== 'object'){
      state.reports.creoChecker = { days: {} };
    }else if(!state.reports.creoChecker.days || typeof state.reports.creoChecker.days !== 'object'){
      // migrate from earlier flat/dailyStats shapes into a single "today" day-sheet, best effort
      const legacyGeos = Array.isArray(state.reports.creoChecker.geos) ? state.reports.creoChecker.geos : [];
      const legacyCreatives = Array.isArray(state.reports.creoChecker.creatives) ? state.reports.creoChecker.creatives : [];
      const bucketDay = todayStr();
      const fixedCreatives = legacyCreatives.map(c => {
        let stats = null;
        if(c.dailyStats && typeof c.dailyStats === 'object'){
          const key = c.currentDate && c.dailyStats[c.currentDate] ? c.currentDate : Object.keys(c.dailyStats)[0];
          stats = key ? c.dailyStats[key] : null;
        }
        stats = stats || { spend:c.spend||0, uniqClick:c.uniqClick||0, cpuc:c.cpuc||0, leads:c.leads||0, cpl:c.cpl||0, reg:c.reg||0, cpr:c.cpr||0, purch:c.purch||0, cfd:c.cfd||0, rev:c.rev||0, profit:c.profit||0, roi:c.roi||0 };
        return {
          id: c.id, geoId: c.geoId, name: c.name||'', feed: c.feed||'', dateFeed: c.dateFeed||'',
          os: c.os||'all', status: c.status||'active', offReason: c.offReason||'', firstSeenDate: c.startDate || bucketDay,
          ...stats
        };
      });
      state.reports.creoChecker = { days: { [bucketDay]: { geos: legacyGeos, creatives: fixedCreatives } } };
    }
    if(!state.reports.campaign || typeof state.reports.campaign !== 'object' || !state.reports.campaign.days){
      state.reports.campaign = { days: {} };
    }
    if(!Array.isArray(state.reports.geoCipher)) state.reports.geoCipher = [];
  }

  function accsData(){ ensureReportsShape(); return state.reports.accs; }

  // ---- Agent CRUD ----
  function openAgentEditor(id){
    const isEdit = !!id;
    const acc = accsData();
    const item = isEdit ? acc.agents.find(a=>a.id===id) : { id: uid(), name: '' };
    if(isEdit && !item) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.maxWidth = '340px';
    modal.innerHTML = `<h3>${isEdit ? 'Агент' : 'Новый агент'}</h3>`;
    const field = document.createElement('div'); field.className='field';
    field.innerHTML = `<label>Имя агента</label>`;
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'например, Иван';
    nameInput.value = item.name || '';
    field.appendChild(nameInput);
    modal.appendChild(field);

    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteAgent(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите имя агента'); return; }
      item.name = nameInput.value.trim();
      if(!isEdit) acc.agents.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveBtn.click(); });
    nameInput.focus();
  }
  function deleteAgent(id){
    const acc = accsData();
    const item = acc.agents.find(a=>a.id===id);
    if(!item) return;
    const socsUnder = acc.socs.filter(s=>s.agentId===id);
    const socIds = new Set(socsUnder.map(s=>s.id));
    const accsUnder = acc.accounts.filter(a=>socIds.has(a.socId));
    if(!confirm(`Удалить агента "${item.name}" вместе с ${socsUnder.length} soc и ${accsUnder.length} аккаунтами?`)) return;
    accsUnder.forEach(a => pushToTrash('acc', a, item.name + ' / ' + (a.accId||'—')));
    socsUnder.forEach(s => pushToTrash('accsoc', s, item.name + ' / ' + s.name));
    pushToTrash('accagent', item, item.name);
    acc.accounts = acc.accounts.filter(a=>!socIds.has(a.socId));
    acc.socs = acc.socs.filter(s=>s.agentId!==id);
    acc.agents = acc.agents.filter(a=>a.id!==id);
    saveState(true);
    render();
  }

  // ---- Soc CRUD ----
  function openSocEditor(agentId, id){
    const isEdit = !!id;
    const acc = accsData();
    const item = isEdit ? acc.socs.find(s=>s.id===id) : { id: uid(), agentId, name:'', adsPowerId:'', pixel:'' };
    if(isEdit && !item) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${isEdit?'Soc':'Новый Soc'}</h3>`;

    function field(label, input){
      const f = document.createElement('div'); f.className='field';
      f.innerHTML = `<label>${label}</label>`; f.appendChild(input); modal.appendChild(f); return f;
    }
    const nameInput = document.createElement('input'); nameInput.placeholder='например, Facebook'; nameInput.value = item.name || '';
    field('Soc', nameInput);
    const adsPowerInput = document.createElement('input'); adsPowerInput.placeholder='ID профиля AdsPower'; adsPowerInput.value = item.adsPowerId || '';
    field('Id AdsPower', adsPowerInput);
    const pixelInput = document.createElement('input'); pixelInput.placeholder='ID пикселя'; pixelInput.value = item.pixel || '';
    field('Пиксель', pixelInput);

    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteSoc(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите название soc'); return; }
      item.name = nameInput.value.trim();
      item.adsPowerId = adsPowerInput.value.trim();
      item.pixel = pixelInput.value.trim();
      if(!isEdit) accsData().socs.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.focus();
  }
  function deleteSoc(id){
    const acc = accsData();
    const item = acc.socs.find(s=>s.id===id);
    if(!item) return;
    const accsUnder = acc.accounts.filter(a=>a.socId===id);
    if(!confirm(`Удалить soc "${item.name}" вместе с ${accsUnder.length} аккаунтами?`)) return;
    accsUnder.forEach(a => pushToTrash('acc', a, item.name + ' / ' + (a.accId||'—')));
    pushToTrash('accsoc', item, item.name);
    acc.accounts = acc.accounts.filter(a=>a.socId!==id);
    acc.socs = acc.socs.filter(s=>s.id!==id);
    saveState(true);
    render();
  }

  // ---- Account CRUD ----
  function openAccountEditor(socId, id){
    const isEdit = !!id;
    const acc = accsData();
    const item = isEdit ? acc.accounts.find(a=>a.id===id) : { id: uid(), socId, accId:'', dateIssued: todayStr(), dateBan:'', status:'approved', note:'' };
    if(isEdit && !item) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${isEdit?'Аккаунт':'Новый аккаунт'}</h3>`;

    function field(label, input){
      const f = document.createElement('div'); f.className='field';
      f.innerHTML = `<label>${label}</label>`; f.appendChild(input); modal.appendChild(f); return f;
    }
    const accIdInput = document.createElement('input'); accIdInput.placeholder='ID аккаунта'; accIdInput.value = item.accId || '';
    field('Id Acc', accIdInput);
    const dateIssuedInput = document.createElement('input'); dateIssuedInput.type='date'; dateIssuedInput.value = item.dateIssued || todayStr();
    field('Дата выдачи', dateIssuedInput);
    const dateBanInput = document.createElement('input'); dateBanInput.type='date'; dateBanInput.value = item.dateBan || '';
    field('Date ban', dateBanInput);

    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteAccount(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!accIdInput.value.trim()){ showToast('Введите Id Acc'); return; }
      item.accId = accIdInput.value.trim();
      item.dateIssued = dateIssuedInput.value;
      item.dateBan = dateBanInput.value;
      if(!isEdit) accsData().accounts.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    accIdInput.focus();
  }
  function deleteAccount(id){
    const acc = accsData();
    const item = acc.accounts.find(a=>a.id===id);
    if(!item) return;
    if(!confirm(`Удалить аккаунт "${item.accId||'—'}"?`)) return;
    pushToTrash('acc', item, item.accId || '—');
    acc.accounts = acc.accounts.filter(a=>a.id!==id);
    saveState(true);
    render();
  }

  // ---- click-to-change status ----
  function openStatusPicker(accountId){
    const acc = accsData();
    const item = acc.accounts.find(a=>a.id===accountId);
    if(!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.maxWidth = '300px';
    modal.innerHTML = `<h3>Статус аккаунта</h3>`;
    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    Object.keys(ACC_STATUSES).forEach(key => {
      const st = ACC_STATUSES[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = st.label + (item.status===key ? ' ✓' : '');
      btn.style.cssText = `padding:9px 12px; border-radius:6px; border:1px solid ${st.color}; background:${st.color}18; color:${st.color}; cursor:pointer; font-weight:700; font-size:13px; text-align:left;`;
      btn.addEventListener('click', safe(()=>{
        item.status = key;
        saveState(true);
        render();
        document.body.removeChild(overlay);
      }));
      list.appendChild(btn);
    });
    modal.appendChild(list);
    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
  }

  // ---- click-to-edit note ----
  function openNotePopup(accountId){
    const acc = accsData();
    const item = acc.accounts.find(a=>a.id===accountId);
    if(!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>Заметка — ${escapeHtml(item.accId||'—')}</h3>`;
    const field = document.createElement('div'); field.className='field';
    const textarea = document.createElement('textarea');
    textarea.rows = 5;
    textarea.style.cssText = 'padding:9px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; background:var(--panel-2); color:var(--text); font-family:inherit; resize:vertical;';
    textarea.value = item.note || '';
    field.appendChild(textarea);
    modal.appendChild(field);
    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      item.note = textarea.value.trim();
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    textarea.focus();
  }

  function populateAccFilterOptions(){
    const acc = accsData();
    const agentSel = document.getElementById('accAgentFilter');
    const socSel = document.getElementById('accSocFilter');
    const curAgent = agentSel.value, curSoc = socSel.value;
    agentSel.innerHTML = '<option value="">Все</option>' + acc.agents.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    socSel.innerHTML = '<option value="">Все</option>' + acc.socs.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    agentSel.value = curAgent; socSel.value = curSoc;
  }

  function renderAccsView(){
    const acc = accsData();
    populateAccFilterOptions();
    const search = (document.getElementById('accSearch').value || '').toLowerCase().trim();
    const agentFilter = document.getElementById('accAgentFilter').value;
    const socFilter = document.getElementById('accSocFilter').value;
    const statusFilter = document.getElementById('accStatusFilter').value;

    const socById = {}; acc.socs.forEach(s=>socById[s.id]=s);

    let agents = acc.agents.slice();
    if(agentFilter) agents = agents.filter(a=>a.id===agentFilter);

    let totalShown = 0;
    let html = '';

    agents.sort((a,b)=>a.name.localeCompare(b.name)).forEach(agent => {
      let socsOfAgent = acc.socs.filter(s=>s.agentId===agent.id);
      if(socFilter) socsOfAgent = socsOfAgent.filter(s=>s.id===socFilter);

      // pre-filter accounts per soc to know whether this agent/soc should show at all
      const socBlocks = [];
      socsOfAgent.sort((a,b)=>a.name.localeCompare(b.name)).forEach(soc => {
        let accountsOfSoc = acc.accounts.filter(a=>a.socId===soc.id);
        if(statusFilter) accountsOfSoc = accountsOfSoc.filter(a=>a.status===statusFilter);
        if(search){
          const socMatches = soc.name.toLowerCase().includes(search) || (soc.adsPowerId||'').toLowerCase().includes(search) || (soc.pixel||'').toLowerCase().includes(search);
          if(!socMatches){
            accountsOfSoc = accountsOfSoc.filter(a => (a.accId||'').toLowerCase().includes(search) || (a.note||'').toLowerCase().includes(search));
          }
        }
        if(statusFilter || search){
          if(accountsOfSoc.length === 0 && !(search && (soc.name.toLowerCase().includes(search) || (soc.adsPowerId||'').toLowerCase().includes(search) || (soc.pixel||'').toLowerCase().includes(search)) && !statusFilter)) return;
        }
        socBlocks.push({ soc, accountsOfSoc });
      });

      if((socFilter || statusFilter || search) && socBlocks.length === 0){
        if(!(search && agent.name.toLowerCase().includes(search))) return;
      }

      totalShown += socBlocks.reduce((s,b)=>s+b.accountsOfSoc.length, 0);

      const agentKey = 'ag:' + agent.id;
      const agentOpen = !collapsedAccGroups.has(agentKey);
      const agentAccCount = socBlocks.reduce((s,b)=>s+b.accountsOfSoc.length, 0);
      html += `<div class="accs-group">
        <div class="accs-agent-header" data-group-key="${agentKey}">
          <span class="accs-caret ${agentOpen?'open':''}">▸</span>
          <span style="flex:1;">${escapeHtml(agent.name)} <span class="count">— ${socBlocks.length} soc, ${agentAccCount} акк.</span></span>
          <button type="button" class="accs-mini-btn add-soc-btn" data-agent-id="${agent.id}" title="Добавить soc">+ Soc</button>
          <button type="button" class="accs-mini-btn edit-agent-btn" data-agent-id="${agent.id}" title="Переименовать">✎</button>
          <button type="button" class="accs-mini-btn del-agent-btn" data-agent-id="${agent.id}" title="Удалить">✕</button>
        </div>`;
      if(agentOpen){
        socBlocks.forEach(({soc, accountsOfSoc}) => {
          const socKey = agentKey + '|soc:' + soc.id;
          const socOpen = !collapsedAccGroups.has(socKey);
          html += `<div class="accs-soc-block">
            <div class="accs-soc-header" data-group-key="${socKey}">
              <span class="accs-caret ${socOpen?'open':''}">▸</span>
              <span style="flex:1;">${escapeHtml(soc.name)}
                <span class="count">— AdsPower: ${escapeHtml(soc.adsPowerId||'—')} · Пиксель: ${escapeHtml(soc.pixel||'—')} · ${accountsOfSoc.length} акк.</span>
              </span>
              <button type="button" class="accs-mini-btn add-acc-btn" data-soc-id="${soc.id}" title="Добавить аккаунт">+ Acc</button>
              <button type="button" class="accs-mini-btn edit-soc-btn" data-soc-id="${soc.id}" title="Изменить soc">✎</button>
              <button type="button" class="accs-mini-btn del-soc-btn" data-soc-id="${soc.id}" title="Удалить soc">✕</button>
            </div>`;
          if(socOpen){
            if(accountsOfSoc.length === 0){
              html += `<div class="muted" style="padding:8px 12px 8px 46px; font-size:12px;">Нет аккаунтов — добавьте кнопкой «+ Acc» выше.</div>`;
            }else{
              html += `<table class="accs-table"><thead><tr>
                <th>Id Acc</th><th>Дата выдачи</th><th>Date ban</th><th>Статус</th><th>Заметка</th><th></th>
              </tr></thead><tbody>`;
              accountsOfSoc.forEach(a => {
                const st = ACC_STATUSES[a.status] || ACC_STATUSES.approved;
                html += `<tr data-acc-id="${a.id}">
                  <td>${escapeHtml(a.accId || '—')}</td>
                  <td class="acc-date-cell" data-acc-id="${a.id}">${escapeHtml(a.dateIssued || '—')}</td>
                  <td>${escapeHtml(a.dateBan || '—')}</td>
                  <td><button type="button" class="accs-status-badge status-click" data-acc-id="${a.id}" style="color:${st.color}; border-color:${st.color}; background:${st.color}22;">${st.label}</button></td>
                  <td><button type="button" class="accs-note-btn note-click" data-acc-id="${a.id}" title="${a.note ? escapeHtml(a.note) : 'Добавить заметку'}">${a.note ? '📝' : '+ заметка'}</button></td>
                  <td style="text-align:right;">
                    <button type="button" class="accs-mini-btn edit-acc-btn" data-acc-id="${a.id}" title="Изменить">✎</button>
                    <button type="button" class="accs-mini-btn del-acc-btn" data-acc-id="${a.id}" title="Удалить">✕</button>
                  </td>
                </tr>`;
              });
              html += '</tbody></table>';
            }
          }
          html += '</div>';
        });
      }
      html += '</div>';
    });

    document.getElementById('accResultCount').textContent = `Найдено: ${totalShown}`;
    const wrap = document.getElementById('accsTreeWrap');
    wrap.innerHTML = html || '<div class="empty-state">Ничего не найдено. Начните с кнопки «+ Добавить агента» выше.</div>';
  }

  function setupAccsDelegation(){
    const wrap = document.getElementById('accsTreeWrap');
    wrap.addEventListener('click', safe((e)=>{
      const addSocBtn = e.target.closest('.add-soc-btn');
      if(addSocBtn){ openSocEditor(addSocBtn.dataset.agentId, null); return; }
      const editAgentBtn = e.target.closest('.edit-agent-btn');
      if(editAgentBtn){ openAgentEditor(editAgentBtn.dataset.agentId); return; }
      const delAgentBtn = e.target.closest('.del-agent-btn');
      if(delAgentBtn){ deleteAgent(delAgentBtn.dataset.agentId); return; }

      const addAccBtn = e.target.closest('.add-acc-btn');
      if(addAccBtn){ openAccountEditor(addAccBtn.dataset.socId, null); return; }
      const editSocBtn = e.target.closest('.edit-soc-btn');
      if(editSocBtn){ openSocEditor(null, editSocBtn.dataset.socId); return; }
      const delSocBtn = e.target.closest('.del-soc-btn');
      if(delSocBtn){ deleteSoc(delSocBtn.dataset.socId); return; }

      const statusBtn = e.target.closest('.status-click');
      if(statusBtn){ openStatusPicker(statusBtn.dataset.accId); return; }
      const noteBtn = e.target.closest('.note-click');
      if(noteBtn){ openNotePopup(noteBtn.dataset.accId); return; }
      const editAccBtn = e.target.closest('.edit-acc-btn');
      if(editAccBtn){ openAccountEditor(null, editAccBtn.dataset.accId); return; }
      const delAccBtn = e.target.closest('.del-acc-btn');
      if(delAccBtn){ deleteAccount(delAccBtn.dataset.accId); return; }

      const groupHeader = e.target.closest('.accs-agent-header, .accs-soc-header');
      if(groupHeader){
        const key = groupHeader.dataset.groupKey;
        if(collapsedAccGroups.has(key)) collapsedAccGroups.delete(key);
        else collapsedAccGroups.add(key);
        renderAccsView();
        return;
      }
    }));
  }

  document.getElementById('addAccBtn').addEventListener('click', safe(()=>openAgentEditor(null)));
  ['accSearch','accAgentFilter','accSocFilter','accStatusFilter'].forEach(id=>{
    document.getElementById(id).addEventListener('input', renderAccsView);
    document.getElementById(id).addEventListener('change', renderAccsView);
  });
  document.getElementById('clearAccFiltersBtn').addEventListener('click', ()=>{
    ['accSearch','accAgentFilter','accSocFilter','accStatusFilter'].forEach(id=>document.getElementById(id).value='');
    renderAccsView();
  });

  // ---------- CREOCHECKER SHEET (each day is its own independent Geo -> Creative sheet) ----------
  const CREO_OS = {
    ios: { label: 'iOS', color: '#5a9fd6' },
    pwa: { label: 'PWA', color: '#a97fe0' },
    all: { label: 'ALL', color: 'var(--amber)' }
  };
  const CREO_STATUS = {
    active: { label: 'Активен', color: '#4caf6b' },
    off:    { label: 'Офф',     color: 'var(--danger)' }
  };
  const CREO_STAT_FIELDS = ['spend','uniqClick','cpuc','leads','cpl','reg','cpr','purch','cfd','rev','profit','roi'];
  const CREO_STAT_LABELS = { spend:'Spend', uniqClick:'Uniq click', cpuc:'Cpuc', leads:'Leads', cpl:'Cpl', reg:'Reg', cpr:'Cpr', purch:'Purch', cfd:'C.FD', rev:'Rev', profit:'Profit', roi:'Roi' };
  let collapsedCreoGroups = new Set();
  let currentCreoDay = null; // 'YYYY-MM-DD'

  function fmtDM(dateStr){
    if(!dateStr) return '';
    const parts = dateStr.split('-');
    if(parts.length !== 3) return dateStr;
    return parts[2] + '.' + parts[1];
  }
  function fmtDMY(dateStr){
    if(!dateStr) return '';
    const parts = dateStr.split('-');
    if(parts.length !== 3) return dateStr;
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }
  function addOneDay(dateStr){
    const d = new Date((dateStr || todayStr()) + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function subOneDay(dateStr){
    const d = new Date((dateStr || todayStr()) + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function nowStamp(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return pad(d.getDate())+'.'+pad(d.getMonth()+1)+'.'+d.getFullYear()+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  }

  // every day is a fully independent little database: its own geos[] and creatives[] —
  // nothing here is shared between days except by explicit "перенести на след. день"
  function ensureCreoDay(dayKey){
    if(!state.reports.creoChecker.days) state.reports.creoChecker.days = {};
    if(!state.reports.creoChecker.days[dayKey]){
      state.reports.creoChecker.days[dayKey] = { geos: [], creatives: [] };
    }
    const d = state.reports.creoChecker.days[dayKey];
    if(!Array.isArray(d.geos)) d.geos = [];
    if(!Array.isArray(d.creatives)) d.creatives = [];
    return d;
  }
  function creoDayData(){
    ensureReportsShape();
    if(!currentCreoDay) currentCreoDay = todayStr();
    return ensureCreoDay(currentCreoDay);
  }

  function parseStatsPaste(text){
    const matches = text.match(/\d+(?:[.,]\d+)?/g);
    if(!matches || matches.length < 12) return null;
    const nums = matches.slice(0,12).map(s => parseFloat(s.replace(',', '.')));
    const result = {};
    CREO_STAT_FIELDS.forEach((f,i)=>{ result[f] = nums[i]; });
    return result;
  }

  // ---- Geo CRUD (scoped to the current day) ----
  function openCreoGeoEditor(id){
    const isEdit = !!id;
    const data = creoDayData();
    const item = isEdit ? data.geos.find(g=>g.id===id) : { id: uid(), name: '' };
    if(isEdit && !item) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.maxWidth = '320px';
    modal.innerHTML = `<h3>${isEdit ? 'Гео' : 'Новое гео'}</h3>`;
    const field = document.createElement('div'); field.className='field';
    field.innerHTML = `<label>Название гео</label>`;
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'например, PL'; nameInput.value = item.name || '';
    field.appendChild(nameInput);
    modal.appendChild(field);
    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteCreoGeo(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите гео'); return; }
      item.name = nameInput.value.trim();
      if(!isEdit) data.geos.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveBtn.click(); });
    nameInput.focus();
  }
  function deleteCreoGeo(id){
    const data = creoDayData();
    const item = data.geos.find(g=>g.id===id);
    if(!item) return;
    const creativesUnder = data.creatives.filter(c=>c.geoId===id);
    if(!confirm(`Удалить гео "${item.name}" (за ${fmtDM(currentCreoDay)}) вместе с ${creativesUnder.length} креативами? Другие дни это не затронет.`)) return;
    creativesUnder.forEach(c => pushToTrash('creocreative', {...c, _creoDay: currentCreoDay}, item.name + ' / ' + c.name));
    pushToTrash('creogeo', {...item, _creoDay: currentCreoDay}, item.name);
    data.creatives = data.creatives.filter(c=>c.geoId!==id);
    data.geos = data.geos.filter(g=>g.id!==id);
    saveState(true);
    render();
  }

  // ---- Creative CRUD (scoped to the current day) ----
  function openCreativeEditor(geoId, id){
    const isEdit = !!id;
    const data = creoDayData();
    const item = isEdit ? data.creatives.find(c=>c.id===id) : {
      id: uid(), geoId, name:'', feed:'', dateFeed:'', os:'all', status:'active', offReason:'',
      firstSeenDate: currentCreoDay,
      spend:0, uniqClick:0, cpuc:0, leads:0, cpl:0, reg:0, cpr:0, purch:0, cfd:0, rev:0, profit:0, roi:0
    };
    if(isEdit && !item) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${isEdit?'Креатив':'Новый креатив'} <span class="muted" style="font-size:11px;font-weight:400;">— лист ${fmtDM(currentCreoDay)}</span></h3>`;
    function field(label, input){
      const f = document.createElement('div'); f.className='field';
      f.innerHTML = `<label>${label}</label>`; f.appendChild(input); modal.appendChild(f); return f;
    }
    const nameInput = document.createElement('input'); nameInput.placeholder='название креатива'; nameInput.value = item.name || '';
    field('Name', nameInput);
    const osSelect = document.createElement('select');
    osSelect.innerHTML = Object.keys(CREO_OS).map(k=>`<option value="${k}">${CREO_OS[k].label}</option>`).join('');
    osSelect.value = item.os || 'all';
    field('OS', osSelect);

    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteCreative(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите название'); return; }
      item.name = nameInput.value.trim();
      item.os = osSelect.value;
      if(!isEdit) data.creatives.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.focus();
  }
  function deleteCreative(id){
    const data = creoDayData();
    const item = data.creatives.find(c=>c.id===id);
    if(!item) return;
    if(!confirm(`Удалить креатив "${item.name}" с листа ${fmtDM(currentCreoDay)}? Копии на других днях (если переносили) это не затронет.`)) return;
    pushToTrash('creocreative', {...item, _creoDay: currentCreoDay}, item.name + ' (' + fmtDM(currentCreoDay) + ')');
    data.creatives = data.creatives.filter(c=>c.id!==id);
    saveState(true);
    render();
  }

  // ---- перенос креатива на завтрашний лист (создаёт лист, если его ещё нет) ----
  function transferCreativeToNextDay(id){
    const today = creoDayData();
    const item = today.creatives.find(c=>c.id===id);
    if(!item) return;
    const nextDayKey = addOneDay(currentCreoDay);
    const nextDay = ensureCreoDay(nextDayKey);
    const geoName = (today.geos.find(g=>g.id===item.geoId) || {}).name || 'Без гео';
    let targetGeo = nextDay.geos.find(g=>g.name===geoName);
    if(!targetGeo){ targetGeo = { id: uid(), name: geoName }; nextDay.geos.push(targetGeo); }
    const already = nextDay.creatives.some(c => c.name===item.name && c.geoId===targetGeo.id && c.firstSeenDate===(item.firstSeenDate||currentCreoDay));
    if(already){ showToast(`«${item.name}» уже есть на листе ${fmtDM(nextDayKey)}`); return; }
    nextDay.creatives.push({
      id: uid(), geoId: targetGeo.id, name: item.name, feed: item.feed || '', dateFeed: item.dateFeed || '',
      os: item.os, status: 'active', offReason: '', firstSeenDate: item.firstSeenDate || currentCreoDay,
      spend:0, uniqClick:0, cpuc:0, leads:0, cpl:0, reg:0, cpr:0, purch:0, cfd:0, rev:0, profit:0, roi:0
    });
    saveState(true);
    render();
    showToast(`«${item.name}» перенесён на лист ${fmtDM(nextDayKey)} (с пустыми показателями)`);
  }

  // ---- Feed popup (auto-stamps Date Feed when the text actually changes) ----
  function openFeedEditor(id){
    const data = creoDayData();
    const item = data.creatives.find(c=>c.id===id);
    if(!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>Feed — ${escapeHtml(item.name||'—')}</h3><p class="muted" style="font-size:12px;margin-top:-8px;">Date Feed проставится сама, как только вы измените текст.</p>`;
    const field = document.createElement('div'); field.className='field';
    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.style.cssText = 'padding:9px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; background:var(--panel-2); color:var(--text); font-family:inherit; resize:vertical;';
    textarea.value = item.feed || '';
    field.appendChild(textarea);
    modal.appendChild(field);
    if(item.dateFeed){
      const dateNote = document.createElement('div');
      dateNote.className = 'muted'; dateNote.style.fontSize='11.5px';
      dateNote.textContent = 'Последнее обновление: ' + item.dateFeed;
      modal.appendChild(dateNote);
    }
    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      const newVal = textarea.value.trim();
      if(newVal !== (item.feed||'')){
        item.feed = newVal;
        item.dateFeed = nowStamp();
      }
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    textarea.focus();
  }

  // ---- click-to-change status (Active / Off + reason) ----
  function openCreativeStatusEditor(id){
    const data = creoDayData();
    const item = data.creatives.find(c=>c.id===id);
    if(!item) return;
    let pendingStatus = item.status || 'active';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.maxWidth = '340px';
    modal.innerHTML = `<h3>Статус — ${escapeHtml(item.name||'—')}</h3>`;

    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex; gap:8px; margin-bottom:14px;';
    const activeBtn = document.createElement('button');
    const offBtn = document.createElement('button');
    function paintToggle(){
      activeBtn.style.cssText = `flex:1; padding:9px; border-radius:6px; cursor:pointer; font-weight:700; font-size:13px; border:1px solid ${CREO_STATUS.active.color}; background:${pendingStatus==='active'?CREO_STATUS.active.color+'33':'transparent'}; color:${CREO_STATUS.active.color};`;
      offBtn.style.cssText = `flex:1; padding:9px; border-radius:6px; cursor:pointer; font-weight:700; font-size:13px; border:1px solid ${CREO_STATUS.off.color}; background:${pendingStatus==='off'?CREO_STATUS.off.color+'33':'transparent'}; color:${CREO_STATUS.off.color};`;
    }
    activeBtn.type='button'; activeBtn.textContent = 'Активен';
    offBtn.type='button'; offBtn.textContent = 'Офф';
    activeBtn.addEventListener('click', ()=>{ pendingStatus='active'; paintToggle(); });
    offBtn.addEventListener('click', ()=>{ pendingStatus='off'; paintToggle(); reasonInput.focus(); });
    paintToggle();
    toggleRow.appendChild(activeBtn); toggleRow.appendChild(offBtn);
    modal.appendChild(toggleRow);

    const field = document.createElement('div'); field.className='field';
    field.innerHTML = `<label>Причина офф (коротко)</label>`;
    const reasonInput = document.createElement('input');
    reasonInput.placeholder = 'например, слабый CTR';
    reasonInput.value = item.offReason || '';
    field.appendChild(reasonInput);
    modal.appendChild(field);

    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      item.status = pendingStatus;
      item.offReason = pendingStatus === 'off' ? reasonInput.value.trim() : '';
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
  }

  // ---- paste-in-one-line stats (updates THIS day's row; pasting again just overwrites it,
  // it never creates or advances a day by itself) ----
  function openStatsPasteModal(id){
    const data = creoDayData();
    const item = data.creatives.find(c=>c.id===id);
    if(!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>Вставить показатели — ${escapeHtml(item.name||'—')} (${fmtDM(currentCreoDay)})</h3>
      <p class="muted" style="font-size:12px;margin-top:-8px;">Вставьте строку в порядке: Spend, Uniq click, Cpuc, Leads, Cpl, Reg, Cpr, Purch, C.FD, Rev, Profit, Roi. Можно вставлять сколько угодно раз за день — это просто обновит эту же строку. Например:<br>
      <span style="color:var(--text-dim);">$560,31 1937 $0,29 491 $1,14 124 $4,52 15 $37,35 $810,00 $249,69 44,6%</span></p>`;
    const field = document.createElement('div'); field.className='field';
    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.style.cssText = 'padding:9px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; background:var(--panel-2); color:var(--text); font-family:inherit; resize:vertical;';
    textarea.placeholder = 'Вставьте сюда всю строку показателей';
    field.appendChild(textarea);
    modal.appendChild(field);
    const preview = document.createElement('div');
    preview.style.cssText = 'font-size:11.5px; color:var(--text-dim); margin-top:6px; min-height:16px;';
    modal.appendChild(preview);
    textarea.addEventListener('input', ()=>{
      const parsed = parseStatsPaste(textarea.value);
      preview.textContent = parsed ? ('Распознано: ' + CREO_STAT_FIELDS.map(f=>CREO_STAT_LABELS[f]+'='+parsed[f]).join(', ')) : (textarea.value.trim() ? 'Не удалось распознать 12 чисел — проверьте строку' : '');
    });
    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Вставить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      const parsed = parseStatsPaste(textarea.value);
      if(!parsed){ showToast('Не удалось распознать 12 чисел в строке'); return; }
      Object.assign(item, parsed);
      saveState(true);
      render();
      document.body.removeChild(overlay);
      showToast('Показатели за ' + fmtDM(currentCreoDay) + ' обновлены');
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    textarea.focus();
  }

  function fmtStat(n, isMoney){
    const num = Number(n)||0;
    return isMoney ? ('$'+fmtPlain(num)) : (Number.isInteger(num) ? String(num) : fmtPlain(num));
  }

  function populateCreoFilterOptions(){
    const data = creoDayData();
    const geoSel = document.getElementById('creoGeoFilter');
    const cur = geoSel.value;
    geoSel.innerHTML = '<option value="">Все</option>' + data.geos.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    geoSel.value = cur;
  }

  function renderCreoDayBar(){
    document.getElementById('creoDayLabel').textContent = fmtDMY(currentCreoDay);
  }

  function renderCreoView(){
    if(!currentCreoDay) currentCreoDay = todayStr();
    renderCreoDayBar();
    const data = creoDayData();
    populateCreoFilterOptions();
    const search = (document.getElementById('creoSearch').value || '').toLowerCase().trim();
    const geoFilter = document.getElementById('creoGeoFilter').value;
    const osFilter = document.getElementById('creoOsFilter').value;

    let geos = data.geos.slice();
    if(geoFilter) geos = geos.filter(g=>g.id===geoFilter);

    let totalShown = 0;
    let html = '';

    geos.sort((a,b)=>a.name.localeCompare(b.name)).forEach(geo => {
      let creatives = data.creatives.filter(c=>c.geoId===geo.id);
      if(osFilter) creatives = creatives.filter(c=>c.os===osFilter);
      if(search){
        const geoMatches = geo.name.toLowerCase().includes(search);
        if(!geoMatches){
          creatives = creatives.filter(c =>
            (c.name||'').toLowerCase().includes(search) ||
            (c.feed||'').toLowerCase().includes(search)
          );
        }
      }
      if((geoFilter || osFilter || search) && creatives.length === 0){
        if(!(search && geo.name.toLowerCase().includes(search) && !osFilter)) return;
      }

      totalShown += creatives.length;
      const geoKey = 'geo:' + geo.id;
      const geoOpen = !collapsedCreoGroups.has(geoKey);
      html += `<div class="accs-group">
        <div class="accs-agent-header" data-group-key="${geoKey}">
          <span class="accs-caret ${geoOpen?'open':''}">▸</span>
          <span style="flex:1;">${escapeHtml(geo.name)} <span class="count">— ${creatives.length} креативов</span></span>
          <button type="button" class="accs-mini-btn add-creative-btn" data-geo-id="${geo.id}" title="Добавить креатив">+ Креатив</button>
          <button type="button" class="accs-mini-btn edit-geo-btn" data-geo-id="${geo.id}" title="Изменить">✎</button>
          <button type="button" class="accs-mini-btn del-geo-btn" data-geo-id="${geo.id}" title="Удалить">✕</button>
        </div>`;
      if(geoOpen){
        if(creatives.length === 0){
          html += `<div class="muted" style="padding:8px 12px 8px 30px; font-size:12px;">Нет креативов на этом дне — добавьте кнопкой «+ Креатив» выше.</div>`;
        }else{
          html += `<div class="creo-table-scroll"><table class="creo-table"><thead><tr>
            <th>Name</th><th>С какого дня</th><th>Feed</th><th>Date Feed</th><th>OS</th><th>Статус</th><th>Причина офф</th>
            <th>Spend</th><th>Uniq click</th><th>Cpuc</th><th>Leads</th><th>Cpl</th><th>Reg</th><th>Cpr</th>
            <th>Purch</th><th>C.FD</th><th>Rev</th><th>Profit</th><th>ROI%</th><th></th>
          </tr></thead><tbody>`;
          creatives.forEach(c => {
            const os = CREO_OS[c.os] || CREO_OS.all;
            const st = CREO_STATUS[c.status] || CREO_STATUS.active;
            const profitColor = pnlColor(Number(c.profit)||0);
            html += `<tr data-creative-id="${c.id}">
              <td><strong>${escapeHtml(c.name||'—')}</strong></td>
              <td>${escapeHtml(fmtDM(c.firstSeenDate) || '—')}</td>
              <td><button type="button" class="creo-feed-btn feed-click" data-creative-id="${c.id}" title="${c.feed?escapeHtml(c.feed):'Добавить feed'}">${c.feed?escapeHtml(c.feed):'+ feed'}</button></td>
              <td>${escapeHtml(c.dateFeed||'—')}</td>
              <td><span class="os-badge" style="color:${os.color}; border-color:${os.color}; background:${os.color}22;">${os.label}</span></td>
              <td><button type="button" class="os-badge status-click" data-creative-id="${c.id}" style="color:${st.color}; border-color:${st.color}; background:${st.color}22; cursor:pointer; font-family:inherit;">${st.label}</button></td>
              <td>${c.status==='off' && c.offReason ? escapeHtml(c.offReason) : '<span class="muted">—</span>'}</td>
              <td>${fmtStat(c.spend,true)}</td>
              <td>${fmtStat(c.uniqClick,false)}</td>
              <td>${fmtStat(c.cpuc,true)}</td>
              <td>${fmtStat(c.leads,false)}</td>
              <td>${fmtStat(c.cpl,true)}</td>
              <td>${fmtStat(c.reg,false)}</td>
              <td>${fmtStat(c.cpr,true)}</td>
              <td>${fmtStat(c.purch,false)}</td>
              <td>${fmtStat(c.cfd,true)}</td>
              <td>${fmtStat(c.rev,true)}</td>
              <td style="color:${profitColor}; font-weight:700;">${fmtStat(c.profit,true)}</td>
              <td style="color:${profitColor}; font-weight:700;">${(Number(c.roi)||0).toFixed(1)}%</td>
              <td>
                <button type="button" class="creo-paste-btn paste-stats-btn" data-creative-id="${c.id}">📋 Вставить</button>
                <button type="button" class="accs-mini-btn transfer-day-btn" data-creative-id="${c.id}" title="Перенести на следующий день">→ на завтра</button>
                <button type="button" class="accs-mini-btn edit-creative-btn" data-creative-id="${c.id}" title="Изменить">✎</button>
                <button type="button" class="accs-mini-btn del-creative-btn" data-creative-id="${c.id}" title="Удалить">✕</button>
              </td>
            </tr>`;
          });
          html += '</tbody></table></div>';
        }
      }
      html += '</div>';
    });

    document.getElementById('creoResultCount').textContent = `Найдено: ${totalShown}`;
    const wrap = document.getElementById('creoTreeWrap');
    wrap.innerHTML = html || '<div class="empty-state">На этом дне пока пусто. Начните с кнопки «+ Добавить гео» выше — или перенесите креатив с предыдущего дня.</div>';
  }

  function setupCreoDelegation(){
    const wrap = document.getElementById('creoTreeWrap');
    wrap.addEventListener('click', safe((e)=>{
      const addCreativeBtn = e.target.closest('.add-creative-btn');
      if(addCreativeBtn){ openCreativeEditor(addCreativeBtn.dataset.geoId, null); return; }
      const editGeoBtn = e.target.closest('.edit-geo-btn');
      if(editGeoBtn){ openCreoGeoEditor(editGeoBtn.dataset.geoId); return; }
      const delGeoBtn = e.target.closest('.del-geo-btn');
      if(delGeoBtn){ deleteCreoGeo(delGeoBtn.dataset.geoId); return; }

      const feedBtn = e.target.closest('.feed-click');
      if(feedBtn){ openFeedEditor(feedBtn.dataset.creativeId); return; }
      const statusBtn = e.target.closest('.status-click');
      if(statusBtn){ openCreativeStatusEditor(statusBtn.dataset.creativeId); return; }
      const transferBtn = e.target.closest('.transfer-day-btn');
      if(transferBtn){ transferCreativeToNextDay(transferBtn.dataset.creativeId); return; }
      const pasteBtn = e.target.closest('.paste-stats-btn');
      if(pasteBtn){ openStatsPasteModal(pasteBtn.dataset.creativeId); return; }
      const editCreativeBtn = e.target.closest('.edit-creative-btn');
      if(editCreativeBtn){ openCreativeEditor(null, editCreativeBtn.dataset.creativeId); return; }
      const delCreativeBtn = e.target.closest('.del-creative-btn');
      if(delCreativeBtn){ deleteCreative(delCreativeBtn.dataset.creativeId); return; }

      const groupHeader = e.target.closest('.accs-agent-header');
      if(groupHeader){
        const key = groupHeader.dataset.groupKey;
        if(collapsedCreoGroups.has(key)) collapsedCreoGroups.delete(key);
        else collapsedCreoGroups.add(key);
        renderCreoView();
        return;
      }
    }));
  }

  document.getElementById('addGeoBtn').addEventListener('click', safe(()=>openCreoGeoEditor(null)));
  document.getElementById('creoPrevDay').addEventListener('click', safe(()=>{
    currentCreoDay = subOneDay(currentCreoDay || todayStr());
    renderCreoView();
  }));
  document.getElementById('creoNextDay').addEventListener('click', safe(()=>{
    // browsing forward always works even if nothing was ever transferred — the day sheet
    // is created (empty) the moment you look at it
    currentCreoDay = addOneDay(currentCreoDay || todayStr());
    ensureCreoDay(currentCreoDay);
    renderCreoView();
  }));
  document.getElementById('creoTodayBtn').addEventListener('click', safe(()=>{
    currentCreoDay = todayStr();
    renderCreoView();
  }));
  ['creoSearch','creoGeoFilter','creoOsFilter'].forEach(id=>{
    document.getElementById(id).addEventListener('input', renderCreoView);
    document.getElementById(id).addEventListener('change', renderCreoView);
  });
  document.getElementById('clearCreoFiltersBtn').addEventListener('click', ()=>{
    ['creoSearch','creoGeoFilter','creoOsFilter'].forEach(id=>document.getElementById(id).value='');
    renderCreoView();
  });

  // ---------- CAMPAIGN SHEET (Geo -> Campaigns, day-sheets like CreoChecker, + duplication) ----------
  const CAMP_STATUS = {
    active: { label: 'Актив',   color: '#4caf6b' },
    reject: { label: 'Реджект', color: 'var(--danger)' },
    paused: { label: 'Пауза',   color: 'var(--amber)' }
  };
  let collapsedCampGroups = new Set();
  let currentCampDay = null;

  function campData(){
    ensureReportsShape();
    if(!currentCampDay) currentCampDay = todayStr();
    if(!state.reports.campaign.days[currentCampDay]){
      state.reports.campaign.days[currentCampDay] = { geos: [], campaigns: [] };
    }
    const d = state.reports.campaign.days[currentCampDay];
    if(!Array.isArray(d.geos)) d.geos = [];
    if(!Array.isArray(d.campaigns)) d.campaigns = [];
    return d;
  }
  function ensureCampDay(dayKey){
    if(!state.reports.campaign.days[dayKey]){
      state.reports.campaign.days[dayKey] = { geos: [], campaigns: [] };
    }
    const d = state.reports.campaign.days[dayKey];
    if(!Array.isArray(d.geos)) d.geos = [];
    if(!Array.isArray(d.campaigns)) d.campaigns = [];
    return d;
  }

  // ---- Geo CRUD ----
  function openCampGeoEditor(id){
    const isEdit = !!id;
    const data = campData();
    const item = isEdit ? data.geos.find(g=>g.id===id) : { id: uid(), name: '' };
    if(isEdit && !item) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.maxWidth = '320px';
    modal.innerHTML = `<h3>${isEdit ? 'Гео' : 'Новое гео'}</h3>`;
    const field = document.createElement('div'); field.className='field';
    field.innerHTML = `<label>Название гео</label>`;
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'например, Bolivia'; nameInput.value = item.name || '';
    field.appendChild(nameInput);
    modal.appendChild(field);
    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteCampGeo(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите гео'); return; }
      item.name = nameInput.value.trim();
      if(!isEdit) data.geos.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveBtn.click(); });
    nameInput.focus();
  }
  function deleteCampGeo(id){
    const data = campData();
    const item = data.geos.find(g=>g.id===id);
    if(!item) return;
    const campsUnder = data.campaigns.filter(c=>c.geoId===id);
    if(!confirm(`Удалить гео "${item.name}" (за ${fmtDM(currentCampDay)}) вместе с ${campsUnder.length} кампаниями? Другие дни это не затронет.`)) return;
    campsUnder.forEach(c => pushToTrash('campcampaign', {...c, _campDay: currentCampDay}, item.name + ' / ' + c.name));
    pushToTrash('campgeo', {...item, _campDay: currentCampDay}, item.name);
    data.campaigns = data.campaigns.filter(c=>c.geoId!==id);
    data.geos = data.geos.filter(g=>g.id!==id);
    saveState(true);
    render();
  }

  // ---- automation: collect FP/domain suggestions the user has already typed ----
  function collectCampAutocomplete(){
    const domains = new Set();
    const bids = new Set();
    const pixels = new Set();
    Object.values(state.reports.campaign.days || {}).forEach(day => {
      (day.campaigns||[]).forEach(c => {
        if(c.domain) domains.add(c.domain);
        if(c.bidBudget) bids.add(c.bidBudget);
        if(c.pixel) pixels.add(c.pixel);
      });
    });
    ((state.reports.accs && state.reports.accs.socs) || []).forEach(s => { if(s.pixel) pixels.add(s.pixel); });
    const fpNames = (state.fanpageRegistry || []).map(f=>f.name).filter(Boolean);
    const fpList = document.getElementById('fpAutocomplete');
    fpList.innerHTML = fpNames.map(n=>`<option value="${escapeHtml(n)}">`).join('');
    const domList = document.getElementById('domainAutocomplete');
    domList.innerHTML = Array.from(domains).map(n=>`<option value="${escapeHtml(n)}">`).join('');
    const bidList = document.getElementById('bidBudgetAutocomplete');
    bidList.innerHTML = Array.from(bids).map(n=>`<option value="${escapeHtml(n)}">`).join('');
    const pixelList = document.getElementById('pixelAutocomplete');
    pixelList.innerHTML = Array.from(pixels).map(n=>`<option value="${escapeHtml(n)}">`).join('');
  }

  // ---- Campaign CRUD ----
  function openCampaignEditor(geoId, id){
    const isEdit = !!id;
    const data = campData();
    const item = isEdit ? data.campaigns.find(c=>c.id===id) : {
      id: uid(), geoId, name:'', status:'active', comment:'', task:'',
      creative:'', bidBudget:'', adsetsCount:1, dateFeed: todayStr(),
      cabinet:'', pixel:'', domain:'', fp:''
    };
    if(isEdit && !item) return;
    collectCampAutocomplete();

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${isEdit?'Кампания':'Новая кампания'} <span class="muted" style="font-size:11px;font-weight:400;">— лист ${fmtDM(currentCampDay)}</span></h3>`;
    function field(label, input){
      const f = document.createElement('div'); f.className='field';
      f.innerHTML = `<label>${label}</label>`; f.appendChild(input); modal.appendChild(f); return f;
    }
    const nameInput = document.createElement('input'); nameInput.placeholder='название кампании'; nameInput.value = item.name || '';
    field('Название кампании', nameInput);
    const creativeInput = document.createElement('input'); creativeInput.placeholder='например, BOpassbak00082'; creativeInput.value = item.creative || '';
    field('Крео', creativeInput);
    const bidInput = document.createElement('input'); bidInput.placeholder='например, 1-1-1 500$ CBO bid100'; bidInput.value = item.bidBudget || '';
    bidInput.setAttribute('list', 'bidBudgetAutocomplete');
    field('БИД/Бюджет', bidInput);
    const adsetsInput = document.createElement('input'); adsetsInput.type='number'; adsetsInput.min='0'; adsetsInput.value = item.adsetsCount ?? 1;
    field('Кол-во адсетов', adsetsInput);
    const dateInput = document.createElement('input'); dateInput.type='date'; dateInput.value = item.dateFeed || currentCampDay;
    field('Дата залива', dateInput);
    const cabinetInput = document.createElement('input'); cabinetInput.placeholder='ID кабинета'; cabinetInput.value = item.cabinet || '';
    field('Кабинет', cabinetInput);
    const pixelInput = document.createElement('input'); pixelInput.placeholder='ID пикселя'; pixelInput.value = item.pixel || '';
    pixelInput.setAttribute('list', 'pixelAutocomplete');
    field('Пиксель', pixelInput);
    const domainInput = document.createElement('input'); domainInput.placeholder='например, apple.com'; domainInput.value = item.domain || '';
    domainInput.setAttribute('list', 'domainAutocomplete');
    field('Домен', domainInput);
    const fpInput = document.createElement('input'); fpInput.placeholder='фанпейдж'; fpInput.value = item.fp || '';
    fpInput.setAttribute('list', 'fpAutocomplete');
    field('FP', fpInput);

    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteCampaign(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!nameInput.value.trim()){ showToast('Введите название кампании'); return; }
      item.name = nameInput.value.trim();
      item.creative = creativeInput.value.trim();
      item.bidBudget = bidInput.value.trim();
      item.adsetsCount = Number(adsetsInput.value) || 0;
      item.dateFeed = dateInput.value || currentCampDay;
      item.cabinet = cabinetInput.value.trim();
      item.pixel = pixelInput.value.trim();
      item.domain = domainInput.value.trim();
      item.fp = fpInput.value.trim();
      if(!isEdit) data.campaigns.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    nameInput.focus();
  }
  function deleteCampaign(id){
    const data = campData();
    const item = data.campaigns.find(c=>c.id===id);
    if(!item) return;
    if(!confirm(`Удалить кампанию "${item.name}" с листа ${fmtDM(currentCampDay)}?`)) return;
    pushToTrash('campcampaign', {...item, _campDay: currentCampDay}, item.name + ' (' + fmtDM(currentCampDay) + ')');
    data.campaigns = data.campaigns.filter(c=>c.id!==id);
    saveState(true);
    render();
  }

  // ---- дублирование: в том же дне, или на завтра ----
  function duplicateCampaignSameDay(id){
    const data = campData();
    const item = data.campaigns.find(c=>c.id===id);
    if(!item) return;
    const copy = { ...item, id: uid(), name: item.name + ' (копия)' };
    data.campaigns.push(copy);
    saveState(true);
    render();
    showToast('Кампания продублирована');
  }
  function transferCampaignToNextDay(id){
    const today = campData();
    const item = today.campaigns.find(c=>c.id===id);
    if(!item) return;
    const nextDayKey = addOneDay(currentCampDay);
    const nextDay = ensureCampDay(nextDayKey);
    const geoName = (today.geos.find(g=>g.id===item.geoId) || {}).name || 'Без гео';
    let targetGeo = nextDay.geos.find(g=>g.name===geoName);
    if(!targetGeo){ targetGeo = { id: uid(), name: geoName }; nextDay.geos.push(targetGeo); }
    nextDay.campaigns.push({
      ...item, id: uid(), geoId: targetGeo.id, dateFeed: nextDayKey
    });
    saveState(true);
    render();
    showToast(`«${item.name}» перенесена на лист ${fmtDM(nextDayKey)}`);
  }

  // ---- click-to-edit: статус+коммент, задача ----
  function openCampStatusEditor(id){
    const data = campData();
    const item = data.campaigns.find(c=>c.id===id);
    if(!item) return;
    let pendingStatus = item.status || 'active';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.maxWidth = '360px';
    modal.innerHTML = `<h3>Статус — ${escapeHtml(item.name||'—')}</h3>`;
    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex; gap:6px; margin-bottom:14px;';
    const buttons = {};
    Object.keys(CAMP_STATUS).forEach(key=>{
      const st = CAMP_STATUS[key];
      const btn = document.createElement('button');
      btn.type='button'; btn.textContent = st.label;
      buttons[key] = btn;
      btn.addEventListener('click', ()=>{ pendingStatus = key; paint(); });
      toggleRow.appendChild(btn);
    });
    function paint(){
      Object.keys(CAMP_STATUS).forEach(key=>{
        const st = CAMP_STATUS[key];
        buttons[key].style.cssText = `flex:1; padding:8px; border-radius:6px; cursor:pointer; font-weight:700; font-size:12.5px; border:1px solid ${st.color}; background:${pendingStatus===key?st.color+'33':'transparent'}; color:${st.color};`;
      });
    }
    paint();
    modal.appendChild(toggleRow);
    const field = document.createElement('div'); field.className='field';
    field.innerHTML = `<label>Коммент (коротко)</label>`;
    const commentInput = document.createElement('input');
    commentInput.placeholder = 'например, реджект 19.08 2:00';
    commentInput.value = item.comment || '';
    field.appendChild(commentInput);
    modal.appendChild(field);
    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      item.status = pendingStatus;
      item.comment = commentInput.value.trim();
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
  }
  function openCampTaskEditor(id){
    const data = campData();
    const item = data.campaigns.find(c=>c.id===id);
    if(!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>Задача — ${escapeHtml(item.name||'—')}</h3>`;
    const field = document.createElement('div'); field.className='field';
    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.style.cssText = 'padding:9px 10px; border:1px solid var(--border); border-radius:6px; font-size:14px; background:var(--panel-2); color:var(--text); font-family:inherit; resize:vertical;';
    textarea.value = item.task || '';
    field.appendChild(textarea);
    modal.appendChild(field);
    const actions = document.createElement('div'); actions.className='modal-actions';
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', ()=>document.body.removeChild(overlay));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      item.task = textarea.value.trim();
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    textarea.focus();
  }

  function populateCampFilterOptions(){
    const data = campData();
    const geoSel = document.getElementById('campGeoFilter');
    const cur = geoSel.value;
    geoSel.innerHTML = '<option value="">Все</option>' + data.geos.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    geoSel.value = cur;
  }

  function renderCampaignView(){
    if(!currentCampDay) currentCampDay = todayStr();
    document.getElementById('campDayLabel').textContent = fmtDMY(currentCampDay);
    const data = campData();
    populateCampFilterOptions();
    const search = (document.getElementById('campSearch').value || '').toLowerCase().trim();
    const geoFilter = document.getElementById('campGeoFilter').value;
    const statusFilter = document.getElementById('campStatusFilter').value;

    let geos = data.geos.slice();
    if(geoFilter) geos = geos.filter(g=>g.id===geoFilter);

    let totalShown = 0;
    let html = '';

    geos.sort((a,b)=>a.name.localeCompare(b.name)).forEach(geo => {
      let camps = data.campaigns.filter(c=>c.geoId===geo.id);
      if(statusFilter) camps = camps.filter(c=>c.status===statusFilter);
      if(search){
        const geoMatches = geo.name.toLowerCase().includes(search);
        if(!geoMatches){
          camps = camps.filter(c =>
            (c.name||'').toLowerCase().includes(search) ||
            (c.creative||'').toLowerCase().includes(search) ||
            (c.cabinet||'').toLowerCase().includes(search) ||
            (c.domain||'').toLowerCase().includes(search) ||
            (c.fp||'').toLowerCase().includes(search) ||
            (c.task||'').toLowerCase().includes(search) ||
            (c.comment||'').toLowerCase().includes(search)
          );
        }
      }
      if((geoFilter || statusFilter || search) && camps.length === 0){
        if(!(search && geo.name.toLowerCase().includes(search) && !statusFilter)) return;
      }

      totalShown += camps.length;
      const totalAdsets = camps.reduce((s,c)=>s+(Number(c.adsetsCount)||0), 0);
      const geoKey = 'geo:' + geo.id;
      const geoOpen = !collapsedCampGroups.has(geoKey);
      html += `<div class="accs-group">
        <div class="accs-agent-header" data-group-key="${geoKey}">
          <span class="accs-caret ${geoOpen?'open':''}">▸</span>
          <span style="flex:1;">${escapeHtml(geo.name)} <span class="count">— ${camps.length} кампаний, ${totalAdsets} адсетов</span></span>
          <button type="button" class="accs-mini-btn add-camp-btn" data-geo-id="${geo.id}" title="Добавить кампанию">+ Кампания</button>
          <button type="button" class="accs-mini-btn edit-camp-geo-btn" data-geo-id="${geo.id}" title="Изменить">✎</button>
          <button type="button" class="accs-mini-btn del-camp-geo-btn" data-geo-id="${geo.id}" title="Удалить">✕</button>
        </div>`;
      if(geoOpen){
        if(camps.length === 0){
          html += `<div class="muted" style="padding:8px 12px 8px 30px; font-size:12px;">Нет кампаний на этом дне — добавьте кнопкой «+ Кампания» выше.</div>`;
        }else{
          html += `<div class="creo-table-scroll"><table class="camp-table"><thead><tr>
            <th>Название кампании</th><th>Статус / Коммент</th><th>Задача</th><th>Крео</th><th>БИД/Бюджет</th>
            <th>Кол-во адсетов</th><th>Дата залива</th><th>Кабинет</th><th>Пиксель</th><th>Домен</th><th>FP</th><th></th>
          </tr></thead><tbody>`;
          camps.forEach(c => {
            const st = CAMP_STATUS[c.status] || CAMP_STATUS.active;
            const rowClass = c.status==='reject' ? 'camp-row-reject' : c.status==='paused' ? 'camp-row-paused' : 'camp-row-active';
            const domainHtml = c.domain
              ? `<a class="camp-domain-link" href="${c.domain.match(/^https?:\/\//) ? escapeHtml(c.domain) : 'https://'+escapeHtml(c.domain)}" target="_blank" rel="noopener">${escapeHtml(c.domain)}</a>`
              : '<span class="muted">—</span>';
            html += `<tr data-campaign-id="${c.id}" class="${rowClass}">
              <td><strong>${escapeHtml(c.name||'—')}</strong></td>
              <td>
                <button type="button" class="os-badge status-camp-click" data-campaign-id="${c.id}" style="color:${st.color}; border-color:${st.color}; background:${st.color}22; cursor:pointer; font-family:inherit;">${st.label}</button>
                ${c.comment ? `<div class="muted" style="font-size:10.5px; margin-top:2px;">${escapeHtml(c.comment)}</div>` : ''}
              </td>
              <td><button type="button" class="camp-task-btn task-click" data-campaign-id="${c.id}" title="${c.task?escapeHtml(c.task):'Добавить задачу'}">${c.task?escapeHtml(c.task):'+ задача'}</button></td>
              <td>${escapeHtml(c.creative||'—')}</td>
              <td>${escapeHtml(c.bidBudget||'—')}</td>
              <td>${Number(c.adsetsCount)||0}</td>
              <td>${escapeHtml(fmtDMY(c.dateFeed)||'—')}</td>
              <td>${escapeHtml(c.cabinet||'—')}</td>
              <td>${escapeHtml(c.pixel||'—')}</td>
              <td>${domainHtml}</td>
              <td>${escapeHtml(c.fp||'—')}</td>
              <td>
                <button type="button" class="accs-mini-btn dup-same-day-btn" data-campaign-id="${c.id}" title="Дублировать в этом же дне">⧉ Дубль</button>
                <button type="button" class="accs-mini-btn transfer-camp-day-btn" data-campaign-id="${c.id}" title="Перенести на следующий день">→ на завтра</button>
                <button type="button" class="accs-mini-btn edit-camp-btn" data-campaign-id="${c.id}" title="Изменить">✎</button>
                <button type="button" class="accs-mini-btn del-camp-btn" data-campaign-id="${c.id}" title="Удалить">✕</button>
              </td>
            </tr>`;
          });
          html += '</tbody></table></div>';
        }
      }
      html += '</div>';
    });

    document.getElementById('campResultCount').textContent = `Найдено: ${totalShown}`;
    const wrap = document.getElementById('campTreeWrap');
    wrap.innerHTML = html || '<div class="empty-state">На этом дне пока пусто. Начните с кнопки «+ Добавить гео» выше — или перенесите кампанию с предыдущего дня.</div>';
  }

  function setupCampaignDelegation(){
    const wrap = document.getElementById('campTreeWrap');
    wrap.addEventListener('click', safe((e)=>{
      const addCampBtn = e.target.closest('.add-camp-btn');
      if(addCampBtn){ openCampaignEditor(addCampBtn.dataset.geoId, null); return; }
      const editGeoBtn = e.target.closest('.edit-camp-geo-btn');
      if(editGeoBtn){ openCampGeoEditor(editGeoBtn.dataset.geoId); return; }
      const delGeoBtn = e.target.closest('.del-camp-geo-btn');
      if(delGeoBtn){ deleteCampGeo(delGeoBtn.dataset.geoId); return; }

      const statusBtn = e.target.closest('.status-camp-click');
      if(statusBtn){ openCampStatusEditor(statusBtn.dataset.campaignId); return; }
      const taskBtn = e.target.closest('.task-click');
      if(taskBtn){ openCampTaskEditor(taskBtn.dataset.campaignId); return; }
      const dupBtn = e.target.closest('.dup-same-day-btn');
      if(dupBtn){ duplicateCampaignSameDay(dupBtn.dataset.campaignId); return; }
      const transferBtn = e.target.closest('.transfer-camp-day-btn');
      if(transferBtn){ transferCampaignToNextDay(transferBtn.dataset.campaignId); return; }
      const editCampBtn = e.target.closest('.edit-camp-btn');
      if(editCampBtn){ openCampaignEditor(null, editCampBtn.dataset.campaignId); return; }
      const delCampBtn = e.target.closest('.del-camp-btn');
      if(delCampBtn){ deleteCampaign(delCampBtn.dataset.campaignId); return; }

      const groupHeader = e.target.closest('.accs-agent-header');
      if(groupHeader){
        const key = groupHeader.dataset.groupKey;
        if(collapsedCampGroups.has(key)) collapsedCampGroups.delete(key);
        else collapsedCampGroups.add(key);
        renderCampaignView();
        return;
      }
    }));
  }

  document.getElementById('addCampGeoBtn').addEventListener('click', safe(()=>openCampGeoEditor(null)));
  document.getElementById('campPrevDay').addEventListener('click', safe(()=>{
    currentCampDay = subOneDay(currentCampDay || todayStr());
    renderCampaignView();
  }));
  document.getElementById('campNextDay').addEventListener('click', safe(()=>{
    currentCampDay = addOneDay(currentCampDay || todayStr());
    ensureCampDay(currentCampDay);
    renderCampaignView();
  }));
  document.getElementById('campTodayBtn').addEventListener('click', safe(()=>{
    currentCampDay = todayStr();
    renderCampaignView();
  }));
  ['campSearch','campGeoFilter','campStatusFilter'].forEach(id=>{
    document.getElementById(id).addEventListener('input', renderCampaignView);
    document.getElementById(id).addEventListener('change', renderCampaignView);
  });
  document.getElementById('clearCampFiltersBtn').addEventListener('click', ()=>{
    ['campSearch','campGeoFilter','campStatusFilter'].forEach(id=>document.getElementById(id).value='');
    renderCampaignView();
  });

  // ---------- ШИФР GEO (flat reference table: Geo / Solo / Europe — no day-splitting, it's a lookup) ----------
  function openGeoCipherEditor(id){
    const isEdit = !!id;
    const item = isEdit ? state.reports.geoCipher.find(g=>g.id===id) : { id: uid(), geo:'', solo:'', europe:'' };
    if(isEdit && !item) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const modal = document.createElement('div');
    modal.className = 'modal'; modal.style.maxWidth = '360px';
    modal.innerHTML = `<h3>${isEdit?'GEO':'Новое GEO'}</h3>`;
    function field(label, input){
      const f = document.createElement('div'); f.className='field';
      f.innerHTML = `<label>${label}</label>`; f.appendChild(input); modal.appendChild(f); return f;
    }
    const geoInput = document.createElement('input'); geoInput.placeholder='например, Bolivia'; geoInput.value = item.geo || '';
    field('Geo', geoInput);
    const soloInput = document.createElement('input'); soloInput.placeholder='например, BO'; soloInput.value = item.solo || '';
    field('Solo (шифр для наименований)', soloInput);
    const europeInput = document.createElement('input'); europeInput.placeholder='впишите значение'; europeInput.value = item.europe || '';
    field('Europe', europeInput);

    const actions = document.createElement('div'); actions.className='modal-actions';
    if(isEdit){
      const delBtn = document.createElement('button');
      delBtn.className='btn btn-danger'; delBtn.textContent='Удалить'; delBtn.type='button';
      delBtn.addEventListener('click', safe(()=>{ document.body.removeChild(overlay); deleteGeoCipher(id); }));
      actions.appendChild(delBtn);
    }
    const spacer = document.createElement('div'); spacer.className='spacer'; actions.appendChild(spacer);
    const cancelBtn = document.createElement('button'); cancelBtn.className='btn btn-plain'; cancelBtn.textContent='Отмена'; cancelBtn.type='button';
    cancelBtn.addEventListener('click', safe(()=>document.body.removeChild(overlay)));
    actions.appendChild(cancelBtn);
    const saveBtn = document.createElement('button'); saveBtn.className='btn btn-fan'; saveBtn.textContent='Сохранить'; saveBtn.type='button';
    saveBtn.addEventListener('click', safe(()=>{
      if(!geoInput.value.trim()){ showToast('Введите Geo'); return; }
      item.geo = geoInput.value.trim();
      item.solo = soloInput.value.trim();
      item.europe = europeInput.value.trim();
      if(!isEdit) state.reports.geoCipher.push(item);
      saveState(true);
      render();
      document.body.removeChild(overlay);
    }));
    actions.appendChild(saveBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); });
    geoInput.focus();
  }
  function deleteGeoCipher(id){
    const item = state.reports.geoCipher.find(g=>g.id===id);
    if(!item) return;
    if(!confirm(`Удалить GEO "${item.geo}"?`)) return;
    pushToTrash('geocipher', item, item.geo);
    state.reports.geoCipher = state.reports.geoCipher.filter(g=>g.id!==id);
    saveState(true);
    render();
  }

  function setupGeoCipherDelegation(){
    const wrap = document.getElementById('geoCipherTableWrap');
    wrap.addEventListener('click', safe((e)=>{
      const editBtn = e.target.closest('.edit-gc');
      const delBtn = e.target.closest('.del-gc');
      if(!editBtn && !delBtn) return;
      const tr = e.target.closest('tr');
      if(!tr) return;
      const id = tr.dataset.gcId;
      if(editBtn){ openGeoCipherEditor(id); }
      else if(delBtn){ deleteGeoCipher(id); }
    }));
  }

  function renderGeoCipherView(){
    const search = (document.getElementById('gcSearch').value || '').toLowerCase().trim();

    let rows = state.reports.geoCipher.slice();
    if(search){
      rows = rows.filter(g =>
        (g.geo||'').toLowerCase().includes(search) ||
        (g.solo||'').toLowerCase().includes(search) ||
        (g.europe||'').toLowerCase().includes(search)
      );
    }
    rows.sort((a,b)=>a.geo.localeCompare(b.geo));

    document.getElementById('gcResultCount').textContent = `Найдено: ${rows.length}`;
    const wrap = document.getElementById('geoCipherTableWrap');
    if(rows.length === 0){
      wrap.innerHTML = '<div class="empty-state">Пока пусто. Добавьте GEO кнопкой выше.</div>';
      return;
    }
    let html = '<table><thead><tr><th>Geo</th><th>Solo</th><th>Europe</th><th>Действия</th></tr></thead><tbody>';
    rows.forEach(g => {
      const europeHtml = g.europe ? `<span class="badge-layer">${escapeHtml(g.europe)}</span>` : '<span class="muted">—</span>';
      html += `<tr data-gc-id="${g.id}">
        <td><span class="badge-fan">${escapeHtml(g.geo)}</span></td>
        <td>${g.solo ? `<span class="badge-cre">${escapeHtml(g.solo)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${europeHtml}</td>
        <td class="row-actions">
          <button class="btn-plain edit-gc" type="button">✎ Изм.</button>
          <button class="btn-danger del-gc" type="button">✕ Удалить</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  document.getElementById('addGeoCipherBtn').addEventListener('click', safe(()=>openGeoCipherEditor(null)));
  ['gcSearch'].forEach(id=>{
    document.getElementById(id).addEventListener('input', renderGeoCipherView);
    document.getElementById(id).addEventListener('change', renderGeoCipherView);
  });
  document.getElementById('clearGcFiltersBtn').addEventListener('click', ()=>{
    ['gcSearch'].forEach(id=>document.getElementById(id).value='');
    renderGeoCipherView();
  });

  function renderTable(){
    populateFilterOptions();
    const search = (document.getElementById('fSearch').value || '').toLowerCase().trim();
    const fFan = document.getElementById('fFan').value;
    const fCre = document.getElementById('fCre').value;
    const fGeo = document.getElementById('fGeo').value;

    const fanMap = {}; state.fanpages.forEach(f=>fanMap[f.id]=f);
    const creMap = {}; state.creatives.forEach(c=>creMap[c.id]=c);

    let rows = state.links.map(l => ({
      link: l,
      fan: fanMap[l.fanpageId],
      cre: creMap[l.creativeId]
    }));

    if(fFan) rows = rows.filter(r=>r.fan && r.fan.id===fFan);
    if(fCre) rows = rows.filter(r=>r.cre && r.cre.id===fCre);
    if(fGeo) rows = rows.filter(r=>r.link.geo===fGeo);
    if(search){
      rows = rows.filter(r =>
        (r.fan && r.fan.name.toLowerCase().includes(search)) ||
        (r.cre && r.cre.name.toLowerCase().includes(search)) ||
        (r.link.geo||'').toLowerCase().includes(search) ||
        (r.link.postUrls||[]).some(u=>u.url.toLowerCase().includes(search) || (u.naming||'').toLowerCase().includes(search))
      );
    }
    rows.sort((a,b)=>(b.link.createdAt||0)-(a.link.createdAt||0));

    document.getElementById('resultCount').textContent = `Найдено: ${rows.length}`;

    if(rows.length === 0){
      tableWrap.innerHTML = '<div class="empty-state">Связей не найдено. Создайте связь на доске, соединив фанпейдж с креативом.</div>';
      return;
    }

    let html = '<table><thead><tr><th>Фанпейдж</th><th>Креатив</th><th>Гео</th><th>Ссылки на посты</th><th>Действия</th></tr></thead><tbody>';
    rows.forEach(r => {
      const fanName = r.fan ? `<span class="badge-fan">${escapeHtml(r.fan.name)}</span>` : '<span class="muted">удалён</span>';
      const creName = r.cre ? `<span class="badge-cre">${escapeHtml(r.cre.name)}</span>` : '<span class="muted">удалён</span>';
      const urls = r.link.postUrls || [];
      const urlsHtml = urls.length
        ? urls.map((u,i)=>{
            const cbId = 'exp-' + r.link.id + '-' + i;
            const shortNaming = u.naming
              ? (u.naming.length > 24 ? escapeHtml(u.naming.slice(0,24)) + '…' : escapeHtml(u.naming))
              : ('Ссылка ' + (i+1));
            return `<div class="link-entry">
              <input type="checkbox" class="link-expand-cb" id="${cbId}">
              <div class="link-row">
                <span class="num">${i+1}.</span>
                <label class="link-toggle-btn" for="${cbId}" title="Показать полностью">▸</label>
                <button type="button" class="badge-layer link-naming-short link-copy-badge" data-naming="${escapeHtml(u.naming||'')}" title="Клик — скопировать нейминг">${shortNaming}</button>
                <button type="button" class="link-icon-btn link-open-btn" data-url="${escapeHtml(u.url)}" title="Открыть ссылку в новой вкладке">↗</button>
              </div>
              <div class="link-full-details">
                ${u.naming ? `<div><strong>Нейминг:</strong> ${escapeHtml(u.naming)}</div>` : ''}
                <div><strong>Ссылка:</strong> <a href="${escapeHtml(u.url)}" target="_blank" rel="noopener">${escapeHtml(u.url)}</a></div>
                <div class="link-actions">
                  ${u.naming ? `<button type="button" class="link-action-btn link-copy-naming-btn" data-naming="${escapeHtml(u.naming)}">📋 Копировать нейминг</button>` : ''}
                  <button type="button" class="link-action-btn link-copy-btn" data-url="${escapeHtml(u.url)}">📋 Копировать ссылку</button>
                  <button type="button" class="link-action-btn link-open-btn" data-url="${escapeHtml(u.url)}">↗ Открыть</button>
                </div>
              </div>
            </div>`;
          }).join('')
        : '<span class="muted">—</span>';
      html += `<tr data-link-id="${r.link.id}">
        <td>${fanName}</td>
        <td>${creName}</td>
        <td>${escapeHtml(r.link.geo || '—')}</td>
        <td class="link-cell">${urlsHtml}</td>
        <td class="row-actions">
          <button class="btn-plain edit-link" type="button">✎ Изм.</button>
          <button class="btn-danger del-link" type="button">✕ Удалить</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    tableWrap.innerHTML = html;
  }

  // ---------- VIEW SWITCH ----------
  function render(){
    try{
      if(currentView === 'board'){ renderBoard(); }
      else if(currentView === 'fanpage'){ renderFanpageTable(); }
      else if(currentView === 'report'){ renderReportView(); }
      else { renderTable(); }
    }catch(e){
      console.error(e);
      showErrorBanner((e && e.message) ? e.message : String(e));
    }
  }

  function setActiveTab(id){
    ['tabBoardBtn','tabTableBtn','tabFanpageBtn','tabReportBtn'].forEach(btnId=>{
      document.getElementById(btnId).classList.toggle('active', btnId===id);
    });
  }
  function hideAllViews(){
    boardOuter.style.display='none'; tableView.style.display='none';
    fanpageView.style.display='none'; reportView.style.display='none';
  }
  function switchToBoardView(){
    currentView = 'board';
    setActiveTab('tabBoardBtn');
    hideAllViews(); boardOuter.style.display='flex';
    saveViewState();
    render();
  }
  function switchToTableView(){
    currentView = 'table';
    setActiveTab('tabTableBtn');
    hideAllViews(); tableView.style.display='block';
    saveViewState();
    render();
  }
  function switchToFanpageView(){
    currentView = 'fanpage';
    setActiveTab('tabFanpageBtn');
    hideAllViews(); fanpageView.style.display='block';
    saveViewState();
    render();
  }
  function switchToReportView(){
    currentView = 'report';
    setActiveTab('tabReportBtn');
    hideAllViews(); reportView.style.display='block';
    saveViewState();
    render();
  }
  document.getElementById('tabBoardBtn').addEventListener('click', switchToBoardView);
  document.getElementById('tabTableBtn').addEventListener('click', switchToTableView);
  document.getElementById('tabFanpageBtn').addEventListener('click', switchToFanpageView);
  document.getElementById('tabReportBtn').addEventListener('click', switchToReportView);

  function showErrorBanner(message){
    let banner = document.getElementById('errorBanner');
    if(!banner){
      banner = document.createElement('div');
      banner.id = 'errorBanner';
      banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; background:#4a1420; border-bottom:2px solid var(--danger); color:#ffd7de; padding:12px 18px; font-size:13.5px; display:flex; align-items:flex-start; gap:12px; box-shadow:0 4px 20px rgba(0,0,0,0.5); max-height:40vh; overflow-y:auto;';
      const text = document.createElement('div');
      text.id = 'errorBannerText';
      text.style.cssText = 'flex:1; white-space:pre-wrap; font-family:monospace; line-height:1.5;';
      banner.appendChild(text);
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕ Закрыть';
      closeBtn.type = 'button';
      closeBtn.style.cssText = 'background:none; border:1px solid var(--danger); color:#ffd7de; padding:5px 10px; border-radius:5px; cursor:pointer; white-space:nowrap; font-size:12px;';
      closeBtn.addEventListener('click', ()=>{ banner.remove(); });
      banner.appendChild(closeBtn);
      document.body.appendChild(banner);
    }
    const textEl = document.getElementById('errorBannerText');
    const stamp = new Date().toLocaleTimeString('ru-RU');
    textEl.textContent = `[${stamp}] Ошибка: ${message}\n\nСкопируйте этот текст и отправьте его — так я смогу починить именно эту причину, а не гадать.`;
  }

  function safe(fn){
    return function(...args){
      try{ return fn.apply(this, args); }
      catch(e){
        console.error(e);
        showErrorBanner((e && e.message) ? e.message : String(e));
        showToast('Ошибка: ' + (e && e.message ? e.message : e));
      }
    };
  }

  document.getElementById('addFanBtn').addEventListener('click', safe(()=>addNodePrompt('fan')));
  document.getElementById('addCreBtn').addEventListener('click', safe(()=>addNodePrompt('cre')));
  document.getElementById('trashBtn').addEventListener('click', safe(openTrashManager));
  document.getElementById('backupsBtn').addEventListener('click', safe(()=>askBackupsPassword(openBackupsManager)));
  document.getElementById('resetBtn').addEventListener('click', ()=>{
    if(!confirm('Удалить ВСЕ данные (доска и реестр фанпейджей)? Это необратимо.')) return;
    state = { layers: [], fanpages: [], creatives: [], links: [], fanpageRegistry: [], reports: {}, deletedItems: [], currentLayerId: null };
    ensureAtLeastOneLayer();
    saveState(true);
    render();
  });

  ['fSearch','fFan','fCre','fGeo'].forEach(id=>{
    document.getElementById(id).addEventListener('input', renderTable);
    document.getElementById(id).addEventListener('change', renderTable);
  });
  document.getElementById('clearFiltersBtn').addEventListener('click', ()=>{
    ['fSearch','fFan','fCre','fGeo'].forEach(id=>document.getElementById(id).value='');
    renderTable();
  });

  ['fpSearch','fpGeo','fpStatus','fpGender'].forEach(id=>{
    document.getElementById(id).addEventListener('input', renderFanpageTable);
    document.getElementById(id).addEventListener('change', renderFanpageTable);
  });
  document.getElementById('clearFpFiltersBtn').addEventListener('click', ()=>{
    ['fpSearch','fpGeo','fpStatus','fpGender'].forEach(id=>document.getElementById(id).value='');
    renderFanpageTable();
  });
  document.getElementById('addFanFromListBtn').addEventListener('click', safe(addRegistryPrompt));
  document.getElementById('bulkAddFanBtn').addEventListener('click', safe(openBulkAddFanpages));

  window.addEventListener('error', (e)=>{
    console.error(e.error || e.message);
    showErrorBanner((e.error && e.error.message) ? e.error.message : String(e.message||e));
  });
  window.addEventListener('unhandledrejection', (e)=>{
    console.error(e.reason);
    showErrorBanner((e.reason && e.reason.message) ? e.reason.message : String(e.reason));
  });

  window.__startBoard = loadState;
})();
