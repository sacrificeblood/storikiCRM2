(function(){
  // ---------- Entities API — one call per entity, never a shared document ----------
  window.entitiesApi = {
    async loadAll(){
      const res = await fetch('/api/entities', { credentials: 'include' });
      if(!res.ok) throw new Error('Failed to load entities (' + res.status + ')');
      const data = await res.json();
      return data.entities || [];
    },
    async saveEntity(type, id, data){
      const res = await fetch('/api/entities/' + encodeURIComponent(type) + '/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify(data)
      });
      if(!res.ok) throw new Error('Failed to save ' + type + ' (' + res.status + ')');
      return true;
    },
    async deleteEntity(type, id){
      const res = await fetch('/api/entities/' + encodeURIComponent(type) + '/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'include',
        keepalive: true
      });
      if(!res.ok) throw new Error('Failed to delete ' + type + ' (' + res.status + ')');
      return true;
    },
    async startTaskReminderTimer(id){
      const res = await fetch('/api/tasks/' + encodeURIComponent(id) + '/start-reminder-timer', {
        method: 'POST', credentials: 'include'
      });
      if(!res.ok){
        const data = await res.json().catch(()=>({}));
        throw new Error(data.error || 'Не удалось запустить таймер');
      }
      return await res.json();
    },
    async bulkImport(items){
      const res = await fetch('/api/entities/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items })
      });
      if(!res.ok) throw new Error('Bulk import failed (' + res.status + ')');
      return await res.json();
    },
    async loadTrash(){
      const res = await fetch('/api/trash', { credentials: 'include' });
      if(!res.ok) throw new Error('Failed to load trash (' + res.status + ')');
      const data = await res.json();
      return data.entries || [];
    },
    async pushTrash(id, type, data, label){
      const res = await fetch('/api/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({ id, type, data, label })
      });
      if(!res.ok) throw new Error('Failed to push trash (' + res.status + ')');
      return true;
    },
    async deleteTrash(id){
      const res = await fetch('/api/trash/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' });
      if(!res.ok) throw new Error('Failed to delete trash entry (' + res.status + ')');
      return true;
    },
    async restoreTrash(id){
      const res = await fetch('/api/trash/' + encodeURIComponent(id) + '/restore', { method: 'POST', credentials: 'include' });
      if(!res.ok) throw new Error('Failed to restore (' + res.status + ')');
      return await res.json();
    },
    async legacyGet(key){
      const res = await fetch('/api/kv/' + encodeURIComponent(key), { credentials: 'include' });
      if(res.status === 404) return null;
      if(!res.ok) throw new Error('Legacy fetch failed (' + res.status + ')');
      const data = await res.json();
      return data.value;
    },
    async legacyDelete(key){
      const res = await fetch('/api/kv/' + encodeURIComponent(key), { method: 'DELETE', credentials: 'include' });
      if(!res.ok) throw new Error('Legacy delete failed (' + res.status + ')');
      return true;
    }
  };

  async function startAuthenticatedBoard(){
    try{
      const res=await fetch('/api/auth/me',{credentials:'include'});
      if(!res.ok) return location.replace('/login');
      const {user}=await res.json();
      window.currentUser=user;
      document.body.dataset.role=user.role;
      if(user.role==='assistant'){
        const tabs={dashboard:'tabDashboardBtn',reports:'tabReportBtn',tasks:'tabTasksBtn',notes:'tabNotesBtn'};
        Object.entries(tabs).forEach(([right,id])=>{ if(!user.permissions?.[right]) document.getElementById(id).style.display='none'; });
        const sheets={reports:['sheetSpendRevBtn'],accs:['sheetAccsBtn'],creatives:['sheetCreoBtn'],campaigns:['sheetCampaignBtn','sheetGeoCipherBtn']};
        Object.entries(sheets).forEach(([right,ids])=>ids.forEach(id=>{if(!user.permissions?.[right])document.getElementById(id).style.display='none';}));
        if(!user.permissions?.reports && !user.permissions?.accs && !user.permissions?.creatives && !user.permissions?.campaigns) document.getElementById('tabReportBtn').style.display='none';
      }
      if(user.role==='admin') document.getElementById('peopleBtn').style.display='inline-flex';
      if(user.role==='buyer') document.getElementById('activityBtn').style.display='inline-flex';
      if(user.role!=='admin'){ document.getElementById('trashBtn').style.display='none'; document.getElementById('backupsBtn').style.display='none'; document.getElementById('peopleBtn').style.display='none'; }
      if(user.role!=='admin') document.getElementById('addTaskBtn').style.display='none';
      document.getElementById('peopleBtn').addEventListener('click',()=>location.href='/people.html');
      document.getElementById('activityBtn').addEventListener('click',()=>location.href='/activity.html');
      document.getElementById('logoutBtn').addEventListener('click',async()=>{
        await fetch('/api/auth/logout',{method:'POST',credentials:'include'}); location.replace('/login');
      });
      window.__startBoard();
    }catch(e){ location.replace('/login'); }
  }
  startAuthenticatedBoard();
})();
