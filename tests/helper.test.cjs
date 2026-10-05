const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('private pipe protocol preserves fragmented UTF-8 and multiple packets', () => {
  const {PacketDecoder} = require('../core/cdp-pipe.cjs');
  const seen=[];
  const decoder=new PacketDecoder(packet=>seen.push(packet));
  const bytes=Buffer.from('{"id":1,"result":{"text":"русский"}}\0{"method":"event"}\0');
  for(const b of bytes) decoder.push(Buffer.from([b]));
  assert.deepEqual(seen,[{id:1,result:{text:'русский'}},{method:'event'}]);
});
test('oversized and malformed protocol messages fail closed', () => {
  const {PacketDecoder} = require('../core/cdp-pipe.cjs');
  assert.throws(()=>new PacketDecoder(()=>{},8).push(Buffer.alloc(9,1)),/размер/);
  assert.throws(()=>new PacketDecoder(()=>{}).push(Buffer.from('garbage\0')),/JSON/);
});
test('translation is limited to trusted local dashboard URLs', () => {
  const {allowedTarget} = require('../core/launcher.cjs');
  for(const url of ['app://dd/','app://dd/dashboard/settings','app://dd/index.html']) assert.equal(allowedTarget(url),true);
  for(const url of ['https://hub.docker.com/','app://dd.evil/','app://other/','file:///tmp/index.html','app://dd@evil/']) assert.equal(allowedTarget(url),false);
});
test('install survives removal of downloaded folder and preserves application bytes', () => {
  const {installHelper,removeHelper} = require('../core/control.cjs');
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'docker-ru-test-'));
  try{
    const app=path.join(root,'vendor');fs.mkdirSync(app);fs.writeFileSync(path.join(app,'Docker Desktop'),'original');
    const before=fs.readFileSync(path.join(app,'Docker Desktop'));
    const state=path.join(root,'state');
    const config={app,executable:path.join(app,'Docker Desktop'),cli:path.join(app,'docker'),platform:'linux',node:process.execPath};
    installHelper(config,state,{shortcut:false});
    assert.equal(fs.readFileSync(path.join(app,'Docker Desktop')).equals(before),true);
    assert.ok(fs.existsSync(path.join(state,'package','launcher.cjs')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(state,'config.json'))).app,app);
    installHelper(config,state,{shortcut:false});
    removeHelper(state,{shortcut:false});
    assert.equal(fs.existsSync(path.join(state,'config.json')),false);
    assert.equal(fs.readFileSync(path.join(app,'Docker Desktop')).equals(before),true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('foreign state directories and links are rejected without deletion', () => {
  const {installHelper,removeHelper} = require('../core/control.cjs');
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'docker-ru-test-'));
  try{
    fs.writeFileSync(path.join(root,'personal'),'keep');
    assert.throws(()=>removeHelper(root,{shortcut:false}),/рус.*ификатор|принадлежит/i);
    assert.equal(fs.readFileSync(path.join(root,'personal'),'utf8'),'keep');
    const link=path.join(root,'link');fs.symlinkSync(root,link,'dir');
    assert.throws(()=>installHelper({platform:'linux'},link,{shortcut:false}),/ссылк/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('signal-terminated GUI counts as exited for normal fallback', () => {
  const {hasExited} = require('../core/launcher.cjs');
  assert.equal(hasExited({exitCode:null,signalCode:'SIGTERM'}),true);
  assert.equal(hasExited({exitCode:0,signalCode:null}),true);
  assert.equal(hasExited({exitCode:null,signalCode:null}),false);
});
test('stale helper state permits reinstall and removal without signalling reused PID', () => {
  const {installHelper,removeHelper,OWNER} = require('../core/control.cjs');
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'docker-ru-test-'));
  try{
    const config={app:root,executable:path.join(root,'GUI'),cli:path.join(root,'cli'),platform:'linux',node:process.execPath};
    installHelper(config,root+'/state',{shortcut:false});
    const runtime=root+'/state/runtime.json';
    fs.writeFileSync(runtime,JSON.stringify({owner:OWNER,pid:process.pid,token:'old',status:'ready'}));
    installHelper(config,root+'/state',{shortcut:false});
    assert.equal(fs.existsSync(runtime),false);
    fs.writeFileSync(runtime,JSON.stringify({owner:OWNER,pid:process.pid,token:'old',status:'ready'}));
    removeHelper(root+'/state',{shortcut:false});
    assert.equal(fs.existsSync(root+'/state/config.json'),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Electron child processes do not obstruct dashboard shutdown', () => {
  const {classifyProcesses} = require('../core/launcher.cjs');
  const rows=[{pid:1,command:'/app/Docker Desktop --name=dashboard'},{pid:2,command:'/app/Docker Desktop --type=renderer'},{pid:3,command:'/app/Docker Desktop --type=gpu-process'},{pid:4,command:'/app/Docker Desktop --type=crashpad-handler'}];
  const result=classifyProcesses(rows);
  assert.deepEqual(result.gui,[rows[0]]);
  assert.deepEqual(result.unknown,[]);
  assert.equal(classifyProcesses([{pid:4,command:'/app/Docker Desktop --reason=unknown'}]).unknown.length,1);
});
