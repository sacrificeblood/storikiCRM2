(function(){
  // ---------- REST storage shim (talks to our own Node/Postgres backend) ----------
  window.storage = {
    async get(key, shared){
      const res = await fetch('/api/kv/' + encodeURIComponent(key), { credentials: 'include' });
      if(res.status === 404){ throw new Error('Key not found: ' + key); }
      if(!res.ok){ throw new Error('Storage error (' + res.status + ')'); }
      const data = await res.json();
      return { key, value: data.value, shared: !!shared };
    },
    async set(key, value, shared){
      const res = await fetch('/api/kv/' + encodeURIComponent(key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({ value })
      });
      if(!res.ok){ throw new Error('Storage error (' + res.status + ')'); }
      return { key, value, shared: !!shared };
    },
    async delete(key, shared){
      const res = await fetch('/api/kv/' + encodeURIComponent(key), { method: 'DELETE', credentials: 'include' });
      if(!res.ok){ throw new Error('Storage error (' + res.status + ')'); }
      return { key, deleted: true, shared: !!shared };
    },
    async list(prefix, shared){
      const res = await fetch('/api/kv?prefix=' + encodeURIComponent(prefix||''), { credentials: 'include' });
      if(!res.ok){ throw new Error('Storage error (' + res.status + ')'); }
      const data = await res.json();
      return { keys: data.keys, prefix, shared: !!shared };
    }
  };

  // No login required — the board starts immediately. Access is only as private as the URL itself.
  window.__startBoard();
})();
