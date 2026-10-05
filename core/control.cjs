#!/usr/bin/env node
// SPDX-License-Identifier: MIT
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const OWNER='docker-russian-helper-v3';
const VERSION='3.0.0';
const FILES=['control.cjs','launcher.cjs','cdp-pipe.cjs','ui-runtime.js','ru.json'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const shell=s=>"'"+s.replace(/'/g,"'\\''")+"'";
const xml=s=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function statePath(){
  if(process.platform==='darwin')return path.join(os.homedir(),'Library','Application Support','docker-russian');
  if(process.platform==='win32')return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'docker-russian');
  return path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'docker-russian');
}
function safePath(target){
  let current=path.resolve(target);
  while(true){
    try{const st=fs.lstatSync(current);if(st.isSymbolicLink())throw new Error('Путь содержит ссылку: '+current);}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
}
function atomic(file,data,mode=0o600){
  safePath(file);const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,data,{mode,flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function readJSON(file){safePath(file);return JSON.parse(fs.readFileSync(file,'utf8'));}
function assertOwned(state,create=false){
  safePath(state);
  const marker=path.join(state,'owner.json');safePath(marker);
  if(!fs.existsSync(state)){
    if(!create)throw new Error('Русификатор ещё не установлен. Выберите пункт 1.');
    fs.mkdirSync(state,{recursive:true,mode:0o700});atomic(marker,JSON.stringify({owner:OWNER}));
  }
  if(!fs.existsSync(marker) || readJSON(marker).owner!==OWNER)throw new Error('Каталог не принадлежит русификатору. Файлы сохранены: '+state);
  if(process.platform!=='win32' && fs.statSync(state).uid!==process.getuid())throw new Error('Каталог русификатора принадлежит другому пользователю.');
  return state;
}
function defaultApp(){
  if(process.platform==='darwin')return '/Applications/Docker.app';
  if(process.platform==='win32')return path.join(process.env.ProgramFiles||'C:\\Program Files','Docker','Docker');
  return '/opt/docker-desktop';
}
function existing(candidates){return candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());}
function discover(app){
  app=path.resolve(app||defaultApp());safePath(app);
  let executable,cli;
  if(process.platform==='darwin'){
    executable=existing([path.join(app,'Contents','MacOS','Docker Desktop.app','Contents','MacOS','Docker Desktop')]);
    cli=existing([path.join(app,'Contents','Resources','bin','docker')]);
  }else if(process.platform==='win32'){
    executable=existing([path.join(app,'frontend','Docker Desktop.exe'),path.join(app,'Docker Desktop.exe')]);
    cli=existing([path.join(app,'resources','bin','docker.exe')]);
  }else{
    executable=existing([path.join(app,'Docker Desktop'),path.join(app,'bin','Docker Desktop')]);
    cli=existing([path.join(app,'resources','bin','docker'),'/usr/bin/docker','/usr/local/bin/docker']);
  }
  if(!executable||!cli)throw new Error('Docker Desktop не найден или отличается структура установки. Укажите --app ПУТЬ. Нужен именно Docker Desktop, а не только Docker Engine.');
  return {app,executable,cli,platform:process.platform,node:process.execPath};
}
function verifyVendor(config){
  for(const name of ['app','executable','cli'])if(!fs.existsSync(config[name]))throw new Error('Docker перемещён или удалён. Повторите пункт 1: '+config[name]);
  if(config.platform==='darwin'){
    const result=spawnSync('/usr/bin/codesign',['--verify','--deep','--strict',config.app],{encoding:'utf8',timeout:30000});
    if(result.status!==0)throw new Error('Официальная подпись Docker не проходит проверку. Если ранее ставили ASAR-патч, восстановите Docker официальным установщиком. Этот помощник файлы Docker не исправляет.');
  }
}
function shortcutPath(platform){
  if(platform==='darwin')return path.join(os.homedir(),'Applications','Docker Desktop RU.app');
  if(platform==='win32')return path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Microsoft','Windows','Start Menu','Programs','Docker Desktop RU.lnk');
  return path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'applications','docker-desktop-ru.desktop');
}
function writeShortcut(config,state){
  const shortcut=shortcutPath(config.platform);safePath(shortcut);
  const control=path.join(config.package,'control.cjs');
  if(config.platform==='darwin'){
    const marker=path.join(shortcut,'Contents','docker-russian-owner');
    if(fs.existsSync(shortcut)&&(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==state))throw new Error('Ярлык Docker Desktop RU уже существует и не принадлежит этому русификатору.');
    fs.mkdirSync(path.join(shortcut,'Contents','MacOS'),{recursive:true});
    atomic(marker,state);
    const plist='<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>launch</string><key>CFBundleIdentifier</key><string>io.github.fadeichev2121.docker-russian</string><key>CFBundleName</key><string>Docker Desktop RU</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>'+VERSION+'</string></dict></plist>';
    atomic(path.join(shortcut,'Contents','Info.plist'),plist,0o644);
    const launch='#!/bin/sh\n'+shell(config.node)+' '+shell(control)+' launch --state '+shell(state)+' > '+shell(path.join(state,'shortcut.log'))+' 2>&1\nresult=$?\nif [ "$result" -ne 0 ]; then /usr/bin/osascript -e '+shell('display alert "Docker Desktop RU" message "Не удалось открыть русский интерфейс. Откройте установщик и выберите пункт 5 — журнал."')+'; fi\nexit "$result"\n';
    atomic(path.join(shortcut,'Contents','MacOS','launch'),launch,0o755);
  }else if(config.platform==='win32'){
    const marker=shortcut+'.owner';
    if(fs.existsSync(shortcut)&&(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==state))throw new Error('Существующий ярлык не принадлежит русификатору.');
    fs.mkdirSync(path.dirname(shortcut),{recursive:true});
    const env={...process.env,DRU_LINK:shortcut,DRU_NODE:config.node,DRU_ARGS:'"'+control+'" launch --state "'+state+'"'};
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:DRU_LINK);$s.TargetPath=$env:DRU_NODE;$s.Arguments=$env:DRU_ARGS;$s.WindowStyle=7;$s.Description="Docker Russian UI launcher";$s.Save()'],{env,windowsHide:true,encoding:'utf8'});
    if(r.status!==0)throw new Error('Не удалось создать ярлык в меню Пуск.');atomic(marker,state);
  }else{
    const quote=s=>'"'+s.replace(/[\\"`$]/g,'\\$&')+'"';
    if(fs.existsSync(shortcut)&&!fs.readFileSync(shortcut,'utf8').includes('X-Docker-Russian-State='+state+'\n'))throw new Error('Существующий ярлык не принадлежит русификатору.');
    fs.mkdirSync(path.dirname(shortcut),{recursive:true});
    atomic(shortcut,'[Desktop Entry]\nType=Application\nName=Docker Desktop RU\nComment=Русский интерфейс оригинального Docker Desktop\nExec='+[config.node,control,'launch','--state',state].map(quote).join(' ')+'\nIcon=docker-desktop\nTerminal=false\nCategories=Development;\nX-Docker-Russian-State='+state+'\n',0o644);
  }
  return shortcut;
}
function runtimeAlive(state) {
  const file = path.join(state, 'runtime.json');
  if (!fs.existsSync(file)) return false;
  safePath(file);
  const runtime = readJSON(file);
  if (runtime.owner !== OWNER || !Number.isInteger(runtime.pid) || runtime.pid <= 0 || typeof runtime.token !== 'string') throw new Error('Некорректное состояние помощника. Файл сохранён.');
  const config = loadConfig(state);
  const expected = path.join(config.package, 'launcher.cjs');
  const configFile = path.join(state, 'config.json');
  let command = '';
  if (process.platform === 'win32') {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$p=Get-CimInstance Win32_Process -Filter ("ProcessId = " + $env:DRU_PID); if ($p) { $p.CommandLine }'], {env:{...process.env, DRU_PID:String(runtime.pid)},encoding:'utf8',windowsHide:true,timeout:5000});
    if (r.status !== 0) throw new Error('Не удалось проверить процесс помощника.');
    command = r.stdout.trim();
  } else {
    const r = spawnSync('/bin/ps', ['-p', String(runtime.pid), '-o', 'command='], {encoding:'utf8',timeout:5000});
    if (r.error || (r.status !== 0 && r.status !== 1)) throw new Error('Не удалось проверить процесс помощника.');
    command = r.stdout.trim();
  }
  if (command.includes(expected) && command.includes(configFile)) return true;
  // A stale file or reused PID never authorizes signalling that process.
  if (fs.existsSync(file) && readJSON(file).token === runtime.token) fs.unlinkSync(file);
  return false;
}
function installHelper(config,state=statePath(),options={}){
  assertOwned(state,true);
  if(runtimeAlive(state))throw new Error('Сначала закройте русский интерфейс через пункт 4; затем установите помощник снова.');
  const pkg=path.join(state,'packages',VERSION+'-'+crypto.randomUUID());safePath(pkg);fs.mkdirSync(pkg,{recursive:true,mode:0o700});
  for(const file of FILES)fs.copyFileSync(path.join(__dirname,file),path.join(pkg,file));
  const complete={...config,owner:OWNER,version:VERSION,package:pkg,state};
  if(options.shortcut!==false)complete.shortcut=writeShortcut(complete,state);
  atomic(path.join(state,'config.json'),JSON.stringify(complete,null,2));
  // Stable path for terminal launch; package paths used by shortcuts remain immutable.
  const stable=path.join(state,'package');safePath(stable);fs.mkdirSync(stable,{recursive:true,mode:0o700});
  for(const file of FILES)atomic(path.join(stable,file),fs.readFileSync(path.join(pkg,file)));
  return complete;
}
function removeHelper(state=statePath(),options={}){
  assertOwned(state);
  if(runtimeAlive(state))throw new Error('Русское окно ещё открыто. Сначала завершите помощник.');
  const configPath=path.join(state,'config.json');
  if(fs.existsSync(configPath)){
    const config=readJSON(configPath);
    if(config.owner!==OWNER)throw new Error('Конфигурация не принадлежит русификатору.');
    if(options.shortcut!==false && config.shortcut){
      const p=config.shortcut;safePath(p);
      if(p!==shortcutPath(config.platform))throw new Error('Путь ярлыка отличается. Файлы сохранены.');
      if(config.platform==='darwin'){
        const marker=path.join(p,'Contents','docker-russian-owner');
        if(fs.existsSync(p)){
          if(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==state)throw new Error('Ярлык изменён. Удаление отменено.');
          // Keep the bundle recoverable; no recursive deletion of application directories.
          fs.renameSync(p,p+'.removed-'+crypto.randomUUID());
        }
      }else if(fs.existsSync(p)){
        const marker=config.platform==='win32'?p+'.owner':p;
        const contents=fs.readFileSync(marker,'utf8');
        if(config.platform==='win32'?contents!==state:!contents.includes('X-Docker-Russian-State='+state+'\n'))throw new Error('Ярлык изменён. Удаление отменено.');
        fs.renameSync(p,p+'.removed-'+crypto.randomUUID());
      }
    }
    fs.unlinkSync(configPath);
  }
}
function loadConfig(state){assertOwned(state);const c=readJSON(path.join(state,'config.json'));if(c.owner!==OWNER||c.state!==state)throw new Error('Некорректная конфигурация помощника.');return c;}
async function stopHelper(state){
  assertOwned(state);const file=path.join(state,'runtime.json');if(!runtimeAlive(state))return;
  const runtime=readJSON(file);if(runtime.owner!==OWNER||typeof runtime.token!=='string')throw new Error('Некорректное состояние помощника.');
  atomic(path.join(state,'stop.json'),JSON.stringify({token:runtime.token}));
  for(let i=0;i<120;i++){if(!fs.existsSync(file))return;await sleep(250);}
  throw new Error('Помощник не завершился. Посмотрите журнал. Другие процессы не остановлены.');
}
async function launchHelper(state){
  const config=loadConfig(state);verifyVendor(config);
  const runtimeFile=path.join(state,'runtime.json');
  if(runtimeAlive(state)) {
    const r=readJSON(runtimeFile);
    if(r.status==='ready'){console.log('[ОК] Русский интерфейс уже открыт.');return;}
    throw new Error('Помощник уже запускается; дождитесь открытия окна.');
  }
  const log=fs.openSync(path.join(state,'launcher.log'),'w',0o600);
  let child;try{child=spawn(config.node,[path.join(config.package,'launcher.cjs'),path.join(state,'config.json')],{stdio:['ignore',log,log],detached:true,windowsHide:true});}finally{fs.closeSync(log);}
  let spawnError;child.on('error',e=>{spawnError=e;});child.unref();
  console.log('Открываю оригинальный Docker с русским интерфейсом…');
  for(let i=0;i<360;i++){
    await sleep(250);if(spawnError)throw spawnError;
    if(fs.existsSync(runtimeFile)){
      const r=readJSON(runtimeFile);if(r.pid===child.pid&&r.status==='ready'){console.log('[ОК] Перевод подключён. Теперь можно закрыть терминал.');return;}
    }
    try{process.kill(child.pid,0);}catch{throw new Error('Открытие не удалось. Выберите пункт 5 — журнал.');}
  }
  throw new Error('Запуск занял больше полутора минут. Проверьте пункт 3 и журнал (пункт 5).');
}
async function action(name,options){
  const state=path.resolve(options.state||statePath());
  if(name==='install'){
    const config=discover(options.app);verifyVendor(config);const installed=installHelper(config,state);
    console.log('[ОК] Помощник установлен. Файлы Docker сохранены.\nЯрлык: '+installed.shortcut+'\nТеперь выберите пункт 2 — открыть на русском.');
  }else if(name==='launch')await launchHelper(state);
  else if(name==='restore'){
    await stopHelper(state);removeHelper(state);console.log('[ОК] Перевод отключён, ярлык убран. Обычный Docker доступен как раньше.\nЖурналы и исходники помощника сохранены для восстановления.');
  }else if(name==='status'){
    console.log('Русификатор: '+VERSION+'\nСистема: '+process.platform);
    if(!fs.existsSync(path.join(state,'config.json'))){console.log('Не установлен. Выберите пункт 1.');return;}
    const c=loadConfig(state);console.log('Установленная версия помощника: '+c.version+'\nDocker: '+c.app+'\nЯрлык: '+c.shortcut+'\nФайлы Docker: помощник их не изменяет.');verifyVendor(c);
    const r=path.join(state,'runtime.json');if(fs.existsSync(r)){const d=readJSON(r);const alive=runtimeAlive(state);console.log('Русское окно: '+(alive?d.status:'помощник завершился; повторите пункт 2.'));}else console.log('Русское окно закрыто. Для открытия выберите пункт 2.');
  }else if(name==='logs'){
    const log=path.join(state,'launcher.log');if(fs.existsSync(log))console.log(fs.readFileSync(log,'utf8').slice(-12000));else console.log('Журнал появится после первого запуска.');
  }else throw new Error('Неизвестное действие.');
}
async function main(){
  if(Number(process.versions.node.split('.')[0])<18)throw new Error('Нужен Node.js 18 или новее. Установите LTS с nodejs.org.');
  if(process.getuid&&process.getuid()===0)throw new Error('Запустите без sudo: помощник устанавливается для вашего пользователя.');
  const argv=process.argv.slice(2);const name=argv.length&&!argv[0].startsWith('--')?argv.shift():'menu';const options={};
  while(argv.length){const key=argv.shift();if(!['--app','--state'].includes(key)||!argv.length)throw new Error('Параметры: --app ПУТЬ, --state ПУТЬ.');options[key.slice(2)]=argv.shift();}
  if(name!=='menu'){await action(name,options);return;}
  const readline=require('node:readline');let input=process.stdin,output=process.stdout;
  if(!process.stdin.isTTY && process.platform!=='win32') {try{const fd=fs.openSync('/dev/tty','r+');input=fs.createReadStream(null,{fd,autoClose:false});output=fs.createWriteStream(null,{fd,autoClose:false});}catch{throw new Error('Нужен интерактивный терминал. Укажите install/status/launch/restore напрямую.');}}
  const rl=readline.createInterface({input,output,terminal:true});
  const ask=q=>new Promise(r=>rl.question(q,r));
  try{while(true){
    console.log('\n==== Docker Desktop на русском — '+VERSION+' ====\n1) Установить / обновить русификатор\n2) Открыть Docker на русском\n3) Статус\n4) Удалить русификатор (обычный Docker сохранится)\n5) Показать журнал\n0) Выход');
    const answer=(await ask('Выбор: ')).trim();if(answer==='0')return;
    const selected={'1':'install','2':'launch','3':'status','4':'restore','5':'logs'}[answer];if(!selected){console.log('Введите 1, 2, 3, 4, 5 или 0.');continue;}
    try{await action(selected,options);}catch(error){console.error('[Ошибка] '+error.message);}
  }}finally{rl.close();}
}
module.exports={OWNER,VERSION,safePath,atomic,assertOwned,statePath,discover,verifyVendor,installHelper,removeHelper,loadConfig,runtimeAlive,action,main};
if(require.main===module)main().catch(error=>{console.error('[Ошибка] '+error.message);process.exitCode=1;});
