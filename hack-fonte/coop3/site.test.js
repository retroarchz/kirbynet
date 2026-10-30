// Site integration: save seeding is one-way, respects resets, and keeps ROM identities distinct.
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
const original='c4091f572d52436c86ceaa0c5718cfb22dc2d59d',variant='cee4fb273fd301762c2dc29d65d83db08f1d68ca',previous='84e4248d13c0a43a765319e5a0c40ae7570e7c3f';
function sandbox({local={},remote={},meta={},late}={}){
  const items=new Map(Object.entries(local).map(([r,d])=>[`kirbynet.save.sandro.${r}`,d]));
  for(const [r,m]of Object.entries(meta))items.set(`kirbynet.savet.sandro.${r}`,JSON.stringify(m));
  const requests=[],writes=[];let now=1000;
  const s={console,TextEncoder,crypto:crypto.webcrypto,enc:s=>new TextEncoder().encode(s),sha1Hex:b=>crypto.createHash('sha1').update(b).digest('hex'),
    Date:class extends Date{static now(){return now;}},toast:()=>{},setTimeout:()=>0,clearTimeout:()=>{},
    localStorage:{getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,String(v)),removeItem:k=>items.delete(k),get length(){return items.size;},key:i=>[...items.keys()][i]},
    fetch:async(url,opts={})=>{const r=url.match(/\/([^/]+)\.json$/)[1];requests.push(r);if(opts.method){writes.push([r,JSON.parse(opts.body)]);return{ok:true};}if(late&&r===original)now=2000;return{ok:true,json:async()=>remote[r]??null};}};
  vm.createContext(s);vm.runInContext(fs.readFileSync(path.join(root,'cloud.js'),'utf8')+'\nglobalThis.testCloud=Cloud;',s);
  return{cloud:s.testCloud,items,requests,writes};
}
(async()=>{
  let x=sandbox({local:{[original]:'local-original'},meta:{[original]:{t:100,synced:100}},remote:{[original]:{d:'newer-cloud-original',t:200}}});
  assert.equal(await x.cloud.sync('sandro',variant),true);
  assert.equal(x.items.get(`kirbynet.save.sandro.${variant}`),'newer-cloud-original');
  assert.equal(x.items.get(`kirbynet.save.sandro.${original}`),'local-original');
  assert.equal(x.writes.length,1);assert.equal(x.writes[0][0],variant);
  x=sandbox({local:{[original]:'base',[variant]:'test-progress'},meta:{[variant]:{t:300,synced:300}},remote:{[variant]:{d:'test-progress',t:300},[original]:{d:'base-newer',t:400}}});
  await x.cloud.sync('sandro',variant);assert.equal(x.items.get(`kirbynet.save.sandro.${variant}`),'test-progress');assert(!x.requests.includes(original));
  for(const reset of [{remote:{[variant]:{d:'',t:300},[original]:{d:'base',t:100}}},{meta:{[variant]:{t:300,synced:300}},remote:{[original]:{d:'base',t:100}}}]){
    x=sandbox(reset);await x.cloud.sync('sandro',variant);assert(!x.items.has(`kirbynet.save.sandro.${variant}`));assert(!x.requests.includes(original));assert.equal(x.writes.length,0);
  }
  x=sandbox({local:{[original]:'old-local'},meta:{[original]:{t:100}},remote:{[original]:{d:'',t:200}}});await x.cloud.sync('sandro',variant);assert.equal(x.writes.length,0);assert(!x.items.has(`kirbynet.save.sandro.${variant}`));
  x=sandbox({local:{[original]:'local-only'}});await x.cloud.sync('sandro',variant);assert.equal(x.items.get(`kirbynet.save.sandro.${variant}`),'local-only');assert(x.writes.every(([r])=>r===variant));
  x=sandbox({remote:{[original]:{d:'late',t:100}},late:true});await x.cloud.sync('sandro',variant,1500);assert.equal(x.writes.length,0);assert(!x.items.has(`kirbynet.save.sandro.${variant}`));
  x=sandbox({local:{[previous]:'old-test',[original]:'base'},meta:{[previous]:{t:500},[original]:{t:100}}});await x.cloud.sync('sandro',variant);assert.equal(x.items.get(`kirbynet.save.sandro.${variant}`),'old-test');assert.equal(x.items.get(`kirbynet.save.sandro.${previous}`),'old-test');assert(x.writes.every(([r])=>r===variant));
  x=sandbox();await x.cloud.sync('',variant);assert.equal(x.requests.length,0);
  const link=require(path.join(root,'linkhle.js'));assert(link.supports(original));assert(link.supports(variant));assert(link.supports(previous));assert(link.GAMES[previous].coop);assert.equal(link.GAMES['b3121dfb3be248bcd51cf83815c463a72e2781e1'],link.GAMES[original]);assert.equal(link.GAMES[variant].link,link.GAMES[original].link);assert(link.GAMES[variant].coop);
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'roms/index.json')));
  for(const [file,sha]of [['PokemonQuetzalPtBrAlpha9v1.gba',original],['PokemonQuetzalCoop3Teste.gba',variant]]){
    assert(catalog.some(g=>g.file===file));assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(root,'roms',file))).digest('hex'),sha);
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),versions=[...html.matchAll(/(?:ASSET_V = "|\?v=)(\d+)/g)].map(m=>m[1]);assert(versions.length>5);assert.equal(new Set(versions).size,1);
  console.log('PASS: original/test ROM identities, cable support, isolated save copies, reset handling, seed deadline, catalogue and asset versions');
})().catch(e=>{console.error(e);process.exitCode=1;});
