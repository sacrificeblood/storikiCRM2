const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const publicDir=path.join(root,'public');
const failures=[];

for(const file of ['server.js','db.js','public/app.js','public/storage-shim.js']){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  try{new vm.Script(source,{filename:file});}catch(error){failures.push(error.message);}
}

const htmlFiles=fs.readdirSync(publicDir).filter(file=>file.endsWith('.html'));
const allHtml=htmlFiles.map(file=>({file,source:fs.readFileSync(path.join(publicDir,file),'utf8')}));
for(const {file,source} of allHtml){
  const scripts=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(Boolean);
  scripts.forEach((script,index)=>{try{new vm.Script(script,{filename:`${file}:inline-${index+1}`});}catch(error){failures.push(error.message);}});
  const ids=[...source.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1]).filter(id=>!id.includes('${'));
  const duplicates=ids.filter((id,index)=>ids.indexOf(id)!==index);
  if(duplicates.length)failures.push(`${file}: duplicate ids: ${[...new Set(duplicates)].join(', ')}`);
}

const index=allHtml.find(item=>item.file==='index.html')?.source||'';
const staticIds=new Set([...index.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1]));
const appSource=fs.readFileSync(path.join(publicDir,'app.js'),'utf8');
const referenced=[...appSource.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map(match=>match[1]);
const created=new Set([...appSource.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)].map(match=>match[1]));
created.add('reportTotals');
const missing=[...new Set(referenced.filter(id=>!staticIds.has(id)&&!created.has(id)))];
if(missing.length)failures.push(`public/app.js: ids missing from index.html: ${missing.join(', ')}`);

if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(`Static checks passed: ${htmlFiles.length} HTML files, ${staticIds.size} index ids`);
