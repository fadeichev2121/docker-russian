// SPDX-License-Identifier: MIT
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {PipeClient}=require('./cdp-pipe.cjs');
const {OWNER,safePath,atomic,assertOwned,verifyVendor}=require('./control.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function allowedTarget(url){try{const u=new URL(url);return u.protocol==='app:'&&u.hostname==='dd'&&!u.username&&!u.password&&!u.port;}catch{return false;}}
function processes(config){
  if(config.platform==='win32'){
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:DRU_EXE } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'],{env:{...process.env,DRU_EXE:config.executable},windowsHide:true,encoding:'utf8',timeout:10000});
    if(result.status!==0)throw new Error('Не удалось определить процессы интерфейса.');
    const data=result.stdout.trim();if(!data)return [];const rows=JSON.parse(data);return (Array.isArray(rows)?rows:[rows]).map(r=>({pid:r.ProcessId,exe:r.ExecutablePath,command:r.CommandLine||''}));
  }
  const r=spawnSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8',timeout:10000});
  if(r.status!==0)throw new Error('Не удалось определить процессы интерфейса.');
  return r.stdout.split('\n').flatMap(line=>{
    const m=/^\s*(\d+)\s+(.+)$/.exec(line);if(!m)return [];
    const command=m[2];if(command!==config.executable&&!command.startsWith(config.executable+' '))return [];
    return [{pid:Number(m[1]),exe:config.executable,command}];
  });
}
function hasExited(child) { return child.exitCode !== null || child.signalCode !== null; }
function classifyProcesses(rows) {
  const gui = rows.filter(p => /(?:^|\s)--name=dashboard(?:\s|$)/.test(p.command) && !/(?:^|\s)--type=/.test(p.command));
  const unknown = rows.filter(p => !gui.includes(p) && !/(?:^|\s)--type=(renderer|gpu-process|utility|zygote|broker|crashpad-handler)(?:\s|$)/.test(p.command));
  return {gui, unknown};
}
async function closeDashboard(config,checkCancel=()=>{}){
  checkCancel();
  const rows=processes(config);
  // Docker's backend, VM and containers have different executables. Never stop them.
  const {gui,unknown}=classifyProcesses(rows);
  if(unknown.length)throw new Error('Есть процесс Docker с неизвестным режимом запуска. Закройте окно Docker Desktop и повторите пункт 2. Движок не остановлен.');
  for(const p of gui){
    checkCancel();
    // Recheck immediately before signalling; refuse changed commands/PIDs.
    if(!processes(config).some(now=>now.pid===p.pid&&now.command===p.command))continue;
    try{process.kill(p.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  for(let i=0;i<40;i++){checkCancel();if(!classifyProcesses(processes(config)).gui.length)return;await sleep(150);}
  throw new Error('Окно Docker не завершилось. Закройте его и повторите пункт 2. Принудительное завершение не выполнялось.');
}
function engineStatus(config){
  const r=spawnSync(config.cli,['desktop','status','--format','json'],{encoding:'utf8',windowsHide:true,timeout:5000});
  if(r.status!==0)return 'unavailable';
  let d;try{d=JSON.parse(r.stdout);}catch{throw new Error('Эта версия Docker не поддерживает ожидаемый статус Desktop CLI. Используйте обычный Docker; файлы приложения сохранены.');}
  return d.Status||d.status;
}
async function startEngine(config,checkCancel=()=>{}){
  const deadline=Date.now()+45000;
  checkCancel();
  const status=engineStatus(config);
  if(status==='running')return;
  if(status!=='stopped'&&status!=='unavailable')throw new Error('Docker запускается или останавливается. Дождитесь завершения и повторите пункт 2.');
  checkCancel();
  const r=spawnSync(config.cli,['desktop','start','--detach'],{encoding:'utf8',windowsHide:true,timeout:15000});
  if(r.status!==0)throw new Error('Docker не смог запуститься. Откройте обычный Docker и проверьте его настройку.');
  while(Date.now()<deadline){checkCancel();await sleep(500);if(engineStatus(config)==='running'){checkCancel();return;}}
  throw new Error('Движок Docker ещё запускается. Повторите пункт 2 через несколько секунд.');
}
async function run(configFile){
  safePath(configFile);const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(config.owner!==OWNER||path.resolve(configFile)!==path.join(config.state,'config.json'))throw new Error('Некорректная конфигурация.');
  assertOwned(config.state);verifyVendor(config);
  const state=config.state,lock=path.join(state,'runtime.json'),token=crypto.randomUUID();
  safePath(lock);
  fs.writeFileSync(lock,JSON.stringify({owner:OWNER,pid:process.pid,token,status:'starting'}),{flag:'wx',mode:0o600});
  let child,client,stopped=false,ready=false,failure=false,cancelled=false;
  const sessions=new Map();
  const setStatus=status=>atomic(lock,JSON.stringify({owner:OWNER,pid:process.pid,token,status}));
  function checkCancel(){
    const file=path.join(state,'stop.json');
    if(stopped||(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).token===token)){
      const error=new Error('Запуск отменён пользователем.');error.code='CANCELLED';throw error;
    }
  }
  async function cleanup(restore){
    if(stopped)return;stopped=true;
    if(client&&!client.closed){
      const deadline=Date.now()+5000;
      for(const [id,script] of sessions.values()){
        if(Date.now()>deadline)break;
        try{
          await client.call('Runtime.evaluate',{expression:'if(location.protocol==="app:"&&location.hostname==="dd"){globalThis.__dockerRussian?.stop(true)}'},id,500);
          await client.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:script},id,500);
        }catch{}
      }
      try{client.close();}catch{}
    }
    if(child&&!hasExited(child)){
      await Promise.race([new Promise(r=>child.once('exit',r)),sleep(1000)]);
      if(!hasExited(child)){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2000)]);}
    }
    // Fall back to the original GUI only after our own child has exited.
    if(restore&&child&&hasExited(child)){
      const normal=spawn(config.executable,['--name=dashboard','--reason=ru-helper-fallback'],{detached:true,stdio:'ignore',windowsHide:true});normal.on('error',()=>{});normal.unref();
    }
    if(fs.existsSync(lock)){try{if(JSON.parse(fs.readFileSync(lock,'utf8')).token===token)fs.unlinkSync(lock);}catch{}}
    const stop=path.join(state,'stop.json');if(fs.existsSync(stop)){try{if(JSON.parse(fs.readFileSync(stop,'utf8')).token===token)fs.unlinkSync(stop);}catch{}}
  }
  process.on('SIGTERM',()=>cleanup(true).finally(()=>process.exit(0)));
  process.on('SIGINT',()=>cleanup(true).finally(()=>process.exit(0)));
  try{
    console.log('Подготовка оригинального Docker. Подписанные файлы не меняются.');
    await startEngine(config,checkCancel);checkCancel();await closeDashboard(config,checkCancel);checkCancel();
    child=spawn(config.executable,['--name=dashboard','--reason=docker-russian','--remote-debugging-pipe'],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
    client=new PipeClient(child);
    await client.call('Browser.getVersion');checkCancel();
    const runtime=fs.readFileSync(path.join(__dirname,'ui-runtime.js'),'utf8');
    const dictionary=fs.readFileSync(path.join(__dirname,'ru.json'),'utf8');JSON.parse(dictionary);
    const source='if(location.protocol==="app:"&&location.hostname==="dd"){'+runtime.replace('__RU_DICTIONARY__',dictionary)+'}';
    async function attach(){
      checkCancel();
      const {targetInfos}=await client.call('Target.getTargets');checkCancel();
      const current=new Set(targetInfos.map(t=>t.targetId));for(const key of sessions.keys())if(!current.has(key))sessions.delete(key);
      for(const target of targetInfos){
        checkCancel();
        if(target.type!=='page'||!allowedTarget(target.url)||sessions.has(target.targetId))continue;
        const {sessionId}=await client.call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
        checkCancel();await client.call('Page.enable',{},sessionId);checkCancel();
        const script=await client.call('Page.addScriptToEvaluateOnNewDocument',{source},sessionId);checkCancel();
        const applied=await client.call('Runtime.evaluate',{expression:source},sessionId);checkCancel();
        if(applied.exceptionDetails)throw new Error('Не удалось подключить перевод к окну Docker.');
        sessions.set(target.targetId,[sessionId,script.identifier]);
        if(!ready){ready=true;setStatus('ready');console.log('[ОК] Перевод подключён к локальному окну Docker.');}
      }
    }
    for(let i=0;i<40&&!ready;i++){await attach();if(!ready)await sleep(250);}
    if(!ready)throw new Error('В этой сборке не найден поддерживаемый интерфейс app://dd. Обычный Docker будет открыт без перевода.');
    while(!stopped&&!client.closed){
      const stop=path.join(state,'stop.json');
      if(fs.existsSync(stop)&&JSON.parse(fs.readFileSync(stop,'utf8')).token===token){await cleanup(true);break;}
      await attach();await sleep(500);
    }
  }catch(error){if(error.code==='CANCELLED'){cancelled=true;console.log('[ОК] Запуск отменён.');}else{failure=true;console.error('[Ошибка] '+error.message);}}
  finally{await cleanup(failure||cancelled);}
  if(failure)process.exitCode=1;
}
module.exports={allowedTarget,engineStatus,processes,hasExited,classifyProcesses,closeDashboard,run};
if(require.main===module)run(process.argv[2]).catch(error=>{console.error('[Ошибка] '+error.message);process.exitCode=1;});
