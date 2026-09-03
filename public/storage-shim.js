(function(){
  const workspace=()=>window.activeWorkspace&&window.activeWorkspace!=='main'?`?workspace=${encodeURIComponent(window.activeWorkspace)}`:'';
  // ---------- Entities API — one call per entity, never a shared document ----------
  window.entitiesApi = {
    async loadAll(){
      const res = await fetch('/api/entities'+workspace(), { credentials: 'include' });
      if(!res.ok) throw new Error('Failed to load entities (' + res.status + ')');
      const data = await res.json();
      return data.entities || [];
    },
    async saveEntity(type, id, data){
      const res = await fetch('/api/entities/' + encodeURIComponent(type) + '/' + encodeURIComponent(id)+workspace(), {
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
      const res = await fetch('/api/entities/' + encodeURIComponent(type) + '/' + encodeURIComponent(id)+workspace(), {
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
      window.activeWorkspace=user.role==='admin'?(localStorage.getItem('minon-admin-workspace')||'main'):user.workspaceId;
      if(user.role==='admin'){
        const users=await (await fetch('/api/users',{credentials:'include'})).json();
        const select=document.getElementById('workspaceSwitcher'); select.style.display='inline-block';
        select.innerHTML='<option value="main">Моя CRM</option>'+users.users.filter(x=>x.role==='buyer').map(x=>`<option value="${x.id}">CRM: ${x.name}</option>`).join('');
        select.value=window.activeWorkspace;
        select.addEventListener('change',()=>{localStorage.setItem('minon-admin-workspace',select.value);location.reload();});
      }
      document.body.dataset.role=user.role;
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
