// Three isolated browser contexts against the local HTTPS site.
// All Firebase requests are mocked; test saves never reach the real database.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const old=process.env.COOP3_BASE||'C:/Users/Sandro/AppData/Local/Temp/claude/C--Users-Sandro-Downloads-kirbynet-site-retroarchz/e3b5f5db-70b9-4102-bf9d-fc366a56b2cf/scratchpad';
const puppeteer=require(path.join(old,'web/node_modules/puppeteer-core'));
const output=path.join(__dirname,'.runtime/site-e2e');fs.mkdirSync(output,{recursive:true});
const original='c4091f572d52436c86ceaa0c5718cfb22dc2d59d',variant='b3121dfb3be248bcd51cf83815c463a72e2781e1';
const prefix='QZ'+[...crypto.randomBytes(2)].map(x=>String.fromCharCode(65+x%26)).join('');
const t0=Date.now(),log=(...xs)=>console.log(((Date.now()-t0)/1000).toFixed(1),...xs);
(async()=>{
  const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:[
    '--host-resolver-rules=MAP retroarchz.github.io 127.0.0.1:8447','--ignore-certificate-errors','--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--mute-audio']});
  const pages=[],errors=[],cloudWrites=[];
  try{
    for(let j=0;j<3;j++){
      const ctx=await browser.createBrowserContext(),page=await ctx.newPage(),name='coop3-teste-p'+(j+1);
      const save=fs.readFileSync(path.join(old,'qz',['sandro.sav','quarto.sav','terceiro.sav'][j])).toString('base64');
      const remote=new Map();
      await page.setViewport({width:1000,height:800});await page.setRequestInterception(true);
      page.on('request',async r=>{
        const url=r.url();
        if(/firebaseio\.com/.test(url)){
          const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'*'};
          if(r.method()==='OPTIONS')return r.respond({status:204,headers});
          const sha=url.match(/\/([^/]+)\.json$/)?.[1];
          if(r.method()!=='GET'){cloudWrites.push({player:j+1,sha,method:r.method()});remote.set(sha,JSON.parse(r.postData()));}
          const data=remote.get(sha)||(sha===original?{d:save,t:1000,dev:'fixture'}:null);
          return r.respond({status:200,headers,contentType:'application/json',body:JSON.stringify(data)});
        }
        if(/ipify\.org|icanhazip\.com/.test(url))return r.respond({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'text/plain',body:'198.51.100.175'});
        return r.continue();
      });
      page.on('pageerror',e=>{errors.push(e.message);log('page error',j+1,e.message);});
      await page.evaluateOnNewDocument((name,save,sha)=>{
        localStorage.setItem('kirbynet.sys','gba');localStorage.setItem('kirbynet.name',name);
        localStorage.setItem(`kirbynet.save.${name}.${sha}`,save);
        localStorage.setItem(`kirbynet.savet.${name}.${sha}`,JSON.stringify({t:1000,synced:1000}));
      },name,save,original);
      await page.goto('https://retroarchz.github.io/',{waitUntil:'load'});
      await page.waitForFunction(()=>document.querySelector('#g-library option[value="PokemonQuetzalCoop3Teste.gba"]'),{timeout:30000});
      await page.evaluate(pre=>{prefixP=Promise.resolve(pre);const s=document.getElementById('g-library');s.value='PokemonQuetzalCoop3Teste.gba';s.onchange();},prefix);
      await page.waitForFunction(sha=>Guest.rom&&Guest.romSha1===sha,{timeout:60000},variant);
      const seeded=await page.evaluate(async({oldSha,newSha})=>{await freshSave();return {original:localStorage.getItem(saveKey(who(),oldSha)),copy:localStorage.getItem(saveKey(who(),newSha)),cable:LinkHLE.supports(newSha),engine:SYS.engineV};},{oldSha:original,newSha:variant});
      assert(seeded.original===save,'original save changed for P'+(j+1));assert(seeded.copy===save,'test save was not copied for P'+(j+1));assert(seeded.cable);assert.equal(seeded.engine,'4');
      pages.push({page,name,save});log('P'+(j+1),'test ROM loaded and isolated save copied');
    }
    await pages[0].page.click('#g-create');
    await pages[0].page.waitForFunction(()=>SiteRoom.code&&!document.getElementById('lobby').classList.contains('hidden'),{timeout:60000});
    const code=await pages[0].page.evaluate(()=>SiteRoom.code);log('room created');
    for(let j=1;j<3;j++){
      await pages[j].page.evaluate(code=>guestJoin(code),code);
      await pages[j].page.waitForFunction(()=>Play.net&&Play.net.slot>=0,{timeout:60000});log('P'+(j+1),'joined');
    }
    await pages[0].page.waitForFunction(()=>SiteRoom.players.filter(Boolean).length===3,{timeout:60000});
    assert(await pages[0].page.evaluate(()=>SiteRoom.isFree()));
    await pages[0].page.click('#btn-start');
    const states=[];
    for(let j=0;j<3;j++){
      await pages[j].page.waitForFunction(sha=>Play.run&&Play.run.cabo===sha&&Play.run.stat.lastF>30,{timeout:120000},variant);
      const state=await pages[j].page.evaluate(({oldSha,newSha})=>({slot:Play.run.slot,n:Play.run.n,worldN:Play.run.worldN,cable:Play.run.cabo,free:Play.run.free,frames:Play.run.stat.lastF,original:localStorage.getItem(saveKey(who(),oldSha)),testSaveBytes:loadMySave().length}),{oldSha:original,newSha:variant});
      assert.equal(state.slot,j);assert.equal(state.n,1);assert.equal(state.worldN,3);assert.equal(state.cable,variant);assert.equal(state.original,pages[j].save);assert.equal(state.testSaveBytes,131072);
      delete state.original;states.push(state);
      await pages[j].page.screenshot({path:path.join(output,'P'+(j+1)+'.png')});
    }
    assert.equal(errors.length,0);assert(!cloudWrites.some(w=>w.sha===original));
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({states,errors,cloudWrites},null,2));
    log('PASS',JSON.stringify(states));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
