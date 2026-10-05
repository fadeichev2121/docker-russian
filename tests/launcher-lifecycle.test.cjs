'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {installHelper,OWNER}=require('../core/control.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
async function waitFor(check,description){const end=Date.now()+5000;while(Date.now()<end){if(check())return;await sleep(30);}throw new Error('Timeout: '+description);}
for (const cancel of [false,true]) test(cancel?'cancellation during an in-flight script install removes it without closing Docker':'cold start establishes the GUI pipe before starting the engine; disabling translation leaves the GUI alive',async()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'docker-ru-lifecycle-'));
  let helper,guiPID;
  try{
    const state=root+'/state',events=root+'/events';
    // Stand-ins for Docker only: no real GUI, engine or container is launched.
    const guiSource=`
const fs=require('node:fs');const events=${JSON.stringify(events)};
fs.writeFileSync(${JSON.stringify(root+'/gui.pid')},String(process.pid));fs.appendFileSync(events,'gui-spawn\\n');
const input=fs.createReadStream(null,{fd:3});let buffer='';
input.on('data',chunk=>{buffer+=chunk.toString();let n;while((n=buffer.indexOf('\\0'))!==-1){const q=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);fs.appendFileSync(events,q.method+'\\n');let result={};if(q.method==='Target.getTargets')result={targetInfos:[{targetId:'page',type:'page',url:'app://dd/dashboard'}]};if(q.method==='Target.attachToTarget')result={sessionId:'session'};if(q.method==='Page.addScriptToEvaluateOnNewDocument')result={identifier:'script'};const reply=()=>fs.writeSync(4,JSON.stringify({id:q.id,result})+'\\0');if(${cancel}&&q.method==='Page.addScriptToEvaluateOnNewDocument'){const r=JSON.parse(fs.readFileSync(${JSON.stringify(state+'/runtime.json')}));process.kill(r.pid,'SIGTERM');setTimeout(reply,80);}else reply();}});
input.on('end',()=>{fs.appendFileSync(events,'pipe-eof-shutdown\\n');process.exit(104);});
process.on('SIGTERM',()=>{fs.appendFileSync(events,'sigterm-shutdown\\n');process.exit(104);});
`;
    fs.writeFileSync(root+'/fake-gui.cjs',guiSource);
    const executable=root+'/Docker Desktop';
    fs.writeFileSync(executable,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(root+'/fake-gui.cjs')+' "$@"\n',{mode:0o755});
    const cli=root+'/docker';
    const cliSource=`const fs=require('node:fs');const events=${JSON.stringify(events)};const command=process.argv[3];fs.appendFileSync(events,'engine-'+command+'\\n');if(command==='status'){console.log(JSON.stringify({Status:fs.existsSync(${JSON.stringify(root+'/engine.running')})?'running':'stopped'}));}else if(command==='start'){if(!fs.existsSync(${JSON.stringify(root+'/gui.pid')})){console.error('Starting the engine first creates a conflicting dashboard');process.exit(1);}fs.writeFileSync(${JSON.stringify(root+'/engine.running')},'running');}`;
    fs.writeFileSync(root+'/fake-cli.cjs',cliSource);
    fs.writeFileSync(cli,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(root+'/fake-cli.cjs')+' "$@"\n',{mode:0o755});
    installHelper({app:root,executable,cli,platform:'linux',node:process.execPath},state,{shortcut:false});
    helper=spawn(process.execPath,[path.resolve(__dirname,'../core/launcher.cjs'),state+'/config.json'],{stdio:['ignore','pipe','pipe']});
    let output='';helper.stdout.on('data',b=>output+=b);helper.stderr.on('data',b=>output+=b);
    if(!cancel) await waitFor(()=>{
      assert.equal(helper.exitCode,null,output);
      return fs.existsSync(state+'/runtime.json')&&JSON.parse(fs.readFileSync(state+'/runtime.json')).status==='ready';
    },'translated ready');
    else await waitFor(()=>fs.existsSync(events)&&fs.readFileSync(events,'utf8').includes('Page.addScriptToEvaluateOnNewDocument'),'script install');
    guiPID=Number(fs.readFileSync(root+'/gui.pid','utf8'));
    const sequence=fs.readFileSync(events,'utf8').trim().split('\n');
    assert.ok(sequence.indexOf('Browser.getVersion')<sequence.indexOf('engine-start'),sequence.join(','));
    if(!cancel){
      const runtime=JSON.parse(fs.readFileSync(state+'/runtime.json'));assert.equal(runtime.owner,OWNER);
      fs.writeFileSync(state+'/stop.json',JSON.stringify({token:runtime.token}));
    }
    await waitFor(()=>!fs.existsSync(state+'/runtime.json'),'translation disabled');
    process.kill(guiPID,0);
    const after=fs.readFileSync(events,'utf8');assert.match(after,/Page.removeScriptToEvaluateOnNewDocument/);assert.doesNotMatch(after,/sigterm-shutdown|pipe-eof-shutdown/);
  }finally{
    // These PIDs are our temporary fixture processes, never Docker processes.
    if(guiPID){try{process.kill(guiPID,'SIGKILL');}catch{}}
    if(helper){helper.kill('SIGKILL');await Promise.race([new Promise(r=>helper.once('exit',r)),sleep(500)]);}
    fs.rmSync(root,{recursive:true,force:true});
  }
});
