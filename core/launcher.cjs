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
function ensureDashboardClosed(config,checkCancel=()=>{}){
  checkCancel();
  const rows=processes(config);
  // SIGTERM is app.quit() in Docker Electron and can shut down the backend.
  // Never close an existing dashboard on the user's behalf.
  if(rows.length)throw new Error('Docker уже открыт. Для первого русского запуска полностью выйдите из Docker через его меню, затем повторите пункт 2. Помощник не закрывает Docker и не останавливает контейнеры автоматически.');
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
  let activeAttach;
  const sessions=new Map();
  const setStatus=status=>atomic(lock,JSON.stringify({owner:OWNER,pid:process.pid,token,status}));
  function checkCancel(){
    const file=path.join(state,'stop.json');
    if(stopped||(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).token===token)){
      const error=new Error('Запуск отменён пользователем.');error.code='CANCELLED';throw error;
    }
  }
  async function cleanup(){
    if(stopped)return;stopped=true;
    // Wait for an in-flight command to register its returned session/script.
    // checkCancel stops that operation before it can issue another command.
    if(activeAttach){try{await activeAttach;}catch{}}
    if(client&&!client.closed){
      const deadline=Date.now()+5000;
      for(const [id,script] of sessions.values()){
        if(Date.now()>deadline)break;
        if(script){try{await client.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:script},id,500);}catch{console.error('[Предупреждение] Не удалось удалить скрипт будущих страниц. Для полного отключения перевода самостоятельно выйдите из Docker.');}}
        try{await client.call('Runtime.evaluate',{expression:'if(location.protocol==="app:"&&location.hostname==="dd"){globalThis.__dockerRussian?.stop(true)}'},id,500);}catch{console.error('[Предупреждение] Не удалось восстановить текст текущей страницы. Для полного отключения перевода самостоятельно выйдите из Docker.');}
      }
    }
    // Closing the debugging pipe can close Electron too. Keep it alive after
    // removing translation until the user exits Docker. Never signal the GUI.
    if(client&&(!child||hasExited(child))){try{client.close();}catch{}}
    sessions.clear();
    if(fs.existsSync(lock)){try{if(JSON.parse(fs.readFileSync(lock,'utf8')).token===token)fs.unlinkSync(lock);}catch{}}
    const stop=path.join(state,'stop.json');if(fs.existsSync(stop)){try{if(JSON.parse(fs.readFileSync(stop,'utf8')).token===token)fs.unlinkSync(stop);}catch{}}
  }
  const disable=()=>cleanup().finally(()=>{if(!child||hasExited(child))process.exit(0);});
  process.on('SIGTERM',disable);
  process.on('SIGINT',disable);
  try{
    console.log('Подготовка оригинального Docker. Подписанные файлы не меняются.');
    ensureDashboardClosed(config,checkCancel);
    child=spawn(config.executable,['--name=dashboard','--reason=docker-russian','--remote-debugging-pipe'],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
    child.on('exit',(code,signal)=>console.log('Процесс окна Docker завершился: код '+code+', сигнал '+(signal||'нет')+'.'));
    client=new PipeClient(child);
    let pipeError;
    client.on('closed',error=>{pipeError=error;});
    // Establish the single-instance dashboard before Desktop CLI can create
    // its normal dashboard. Docker GUI waits for the backend during startup.
    await client.call('Browser.getVersion');checkCancel();
    await startEngine(config,checkCancel);checkCancel();
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
        sessions.set(target.targetId,[sessionId,null]);
        checkCancel();await client.call('Page.enable',{},sessionId);checkCancel();
        const script=await client.call('Page.addScriptToEvaluateOnNewDocument',{source},sessionId);
        sessions.set(target.targetId,[sessionId,script.identifier]);checkCancel();
        const applied=await client.call('Runtime.evaluate',{expression:source},sessionId);checkCancel();
        if(applied.exceptionDetails)throw new Error('Не удалось подключить перевод к окну Docker.');
        if(!ready){ready=true;setStatus('ready');console.log('[ОК] Перевод подключён к локальному окну Docker.');}
      }
    }
    async function trackedAttach(){
      const work=attach();activeAttach=work;
      try{await work;}finally{if(activeAttach===work)activeAttach=null;}
    }
    for(let i=0;i<40&&!ready;i++){await trackedAttach();if(!ready)await sleep(250);}
    if(!ready)throw new Error('В этой сборке не найден поддерживаемый интерфейс app://dd. Обычный Docker будет открыт без перевода.');
    while(!stopped&&!client.closed){
      const stop=path.join(state,'stop.json');
      if(fs.existsSync(stop)&&JSON.parse(fs.readFileSync(stop,'utf8')).token===token){await cleanup();break;}
      await trackedAttach();await sleep(500);
    }
    if(!stopped&&client.closed&&!hasExited(child))throw pipeError||new Error('Канал интерфейса закрылся. Окно Docker оставлено без изменений.');
  }catch(error){if(error.code==='CANCELLED'){cancelled=true;console.log('[ОК] Запуск отменён.');}else{failure=true;console.error('[Ошибка] '+error.message);}}
  finally{
    await cleanup();
    if(child&&!hasExited(child)){
      console.log('[ОК] Перевод отключён. Окно и движок Docker оставлены открытыми; служебный канал завершится после выхода из Docker.');
      await new Promise(resolve=>child.once('exit',resolve));
    }
  }
  if(failure)process.exitCode=1;
}
module.exports={allowedTarget,engineStatus,processes,hasExited,classifyProcesses,ensureDashboardClosed,run};
if(require.main===module)run(process.argv[2]).catch(error=>{console.error('[Ошибка] '+error.message);process.exitCode=1;});
