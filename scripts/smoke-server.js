const http=require('http');
const fs=require('fs');
const path=require('path');

const port=Number(process.env.SMOKE_PORT||4173);
const publicRoot=path.join(__dirname,'..','public');
const entities=[];
const trash=[];
const user={id:'smoke-admin',email:'smoke@local.test',name:'Smoke Admin',role:'admin',workspaceId:null,permissions:{}};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};

function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>5_000_000)reject(Error('body too large'));});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});req.on('error',reject);});}
function entityParts(pathname){const match=pathname.match(/^\/api\/entities\/([^/]+)\/([^/]+)$/);return match&&{type:decodeURIComponent(match[1]),id:decodeURIComponent(match[2])};}

http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    const pathname=url.pathname;
    if(pathname==='/api/auth/me') return json(res,200,{user});
    if(pathname==='/api/auth/logout') return json(res,200,{ok:true});
    if(pathname==='/api/canvases') return json(res,200,{canvases:[{id:'main',owner_id:user.id,owner_name:user.name,name:'Smoke CRM'}]});
    if(pathname==='/api/entities'&&req.method==='GET') return json(res,200,{entities});
    const entity=entityParts(pathname);
    if(entity&&req.method==='PUT'){
      const data=await body(req),index=entities.findIndex(item=>item.id===entity.id);
      const row={id:entity.id,type:entity.type,data,updated_at:new Date().toISOString()};
      if(index<0)entities.push(row);else entities[index]=row;
      return json(res,200,{ok:true});
    }
    if(entity&&req.method==='DELETE'){
      const index=entities.findIndex(item=>item.id===entity.id&&item.type===entity.type);
      if(index>=0)entities.splice(index,1);
      return json(res,200,{ok:true});
    }
    if(pathname==='/api/entities/bulk')return json(res,200,{ok:true,count:0});
    if(pathname==='/api/trash'&&req.method==='GET')return json(res,200,{entries:trash});
    if(pathname==='/api/trash'&&req.method==='POST'){trash.unshift({...await body(req),deleted_at:new Date().toISOString()});return json(res,200,{ok:true});}
    if(/^\/api\/trash\//.test(pathname))return json(res,200,{ok:true});
    if(/^\/api\/kv\//.test(pathname))return req.method==='GET'?json(res,404,{error:'not found'}):json(res,200,{ok:true});
    if(pathname==='/api/time')return json(res,200,{now:new Date().toISOString()});
    if(pathname==='/api/telegram-recipients')return json(res,200,{recipients:[]});
    if(/^\/api\/tasks\/.+\/start-reminder-timer$/.test(pathname))return json(res,200,{ok:true,startedAt:new Date().toISOString(),reactivated:false});
    if(pathname.startsWith('/api/'))return json(res,404,{error:'Smoke API route not implemented'});
    const requested=pathname==='/'?'index.html':pathname.replace(/^\//,'');
    const file=path.resolve(publicRoot,requested);
    if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())return json(res,404,{error:'not found'});
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(res);
  }catch(error){json(res,500,{error:error.message});}
}).listen(port,'127.0.0.1',()=>console.log(`UI smoke server: http://127.0.0.1:${port}`));
