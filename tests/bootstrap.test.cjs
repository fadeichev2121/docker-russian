'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const installer=path.resolve(__dirname,'../install.sh');
function fixture(badChecksum=false){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'docker-ru-bootstrap-'));
  const bin=path.join(root,'bin'),home=path.join(root,'home'),repo=path.join(root,'repo');
  for(const p of [bin,home,repo+'/core'])fs.mkdirSync(p,{recursive:true});
  fs.copyFileSync(installer,repo+'/install.sh');fs.writeFileSync(repo+'/core/control.cjs','// fixture controller');
  for(const name of ['awk','cat','chmod','cp','cut','dirname','grep','gzip','id','mkdir','mktemp','mv','rm','sed','sh','stat','tar','tr','wc','shasum','sha256sum']){
    const result=spawnSync('/bin/bash',['-c','command -v '+name],{encoding:'utf8'});
    if(result.status===0)fs.symlinkSync(result.stdout.trim(),path.join(bin,name));
  }
  const script=(name,code)=>{fs.writeFileSync(bin+'/'+name,'#!/bin/bash\n'+code,{mode:0o755});};
  script('uname','if [ "$1" = "-s" ]; then echo Darwin; else echo arm64; fi\n');
  const name='node-v24.21.0-darwin-arm64';
  fs.mkdirSync(root+'/'+name+'/bin',{recursive:true});
  fs.writeFileSync(root+'/'+name+'/bin/node','#!/bin/bash\nif [ "$1" = "-e" ]; then exit 0; fi\nprintf "%s\\n" "$0" > "$HOME/controller-node.txt"\n',{mode:0o755});
  fs.writeFileSync(root+'/'+name+'/LICENSE','fixture license');
  assert.equal(spawnSync('/usr/bin/tar',['-czf',root+'/archive.tar.gz','-C',root,name]).status,0);
  const sha=crypto.createHash('sha256').update(fs.readFileSync(root+'/archive.tar.gz')).digest('hex');
  fs.writeFileSync(root+'/SHASUMS256.txt',(badChecksum?'0'.repeat(64):sha)+'  '+name+'.tar.gz\n');
  script('curl','url=""; out=""; while [ "$#" -gt 0 ]; do case "$1" in -o|--output) out="$2"; shift 2;; https:*) url="$1"; shift;; *) shift;; esac; done\nprintf "%s\\n" "$url" >> "$HOME/downloads.txt"\ncase "$url" in https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt) cp "$FIXTURE_ROOT/SHASUMS256.txt" "$out";; https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz) cp "$FIXTURE_ROOT/archive.tar.gz" "$out";; *) exit 99;; esac\n');
  const env={...process.env,HOME:home,PATH:bin,FIXTURE_ROOT:root};
  return {root,home,bin,repo,env,run:()=>spawnSync('/bin/bash',[repo+'/install.sh','status'],{env,encoding:'utf8',timeout:10000}),remove:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('installer without Node downloads a private verified runtime and reuses it offline',()=>{
  const f=fixture();try{
    let result=f.run();assert.equal(result.status,0,result.stdout+result.stderr);
    const executable=fs.readFileSync(f.home+'/controller-node.txt','utf8').trim();
    assert.ok(executable.startsWith(f.home+'/Library/Application Support/docker-russian-runtime/'));
    assert.equal(fs.readFileSync(f.home+'/downloads.txt','utf8').trim().split('\n').length,2);
    fs.unlinkSync(f.bin+'/curl');result=f.run();assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(fs.readFileSync(f.home+'/controller-node.txt','utf8').trim(),executable);
  }finally{f.remove();}
});
test('wrong runtime checksum prevents execution',()=>{
  const f=fixture(true);try{const r=f.run();assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/SHA-256|контрольн/i);assert.equal(fs.existsSync(f.home+'/controller-node.txt'),false);}finally{f.remove();}
});
test('foreign runtime folder is preserved and rejected',()=>{
  const f=fixture();try{
    const folder=f.home+'/Library/Application Support/docker-russian-runtime';fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(folder+'/keep.txt','keep');
    const r=f.run();assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/каталог|папк/i);assert.equal(fs.readFileSync(folder+'/keep.txt','utf8'),'keep');
  }finally{f.remove();}
});
test('modified cached runtime is not executed',()=>{
  const f=fixture();try{
    assert.equal(f.run().status,0);const exe=fs.readFileSync(f.home+'/controller-node.txt','utf8').trim();
    fs.appendFileSync(exe,'# modified\n');fs.unlinkSync(f.home+'/controller-node.txt');
    const r=f.run();assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/SHA-256/);assert.equal(fs.existsSync(f.home+'/controller-node.txt'),false);
  }finally{f.remove();}
});
test('symbolic runtime folder is not followed',()=>{
  const f=fixture();try{
    const parent=f.home+'/Library/Application Support';fs.mkdirSync(parent,{recursive:true});
    fs.symlinkSync(f.root,path.join(parent,'docker-russian-runtime'));
    const r=f.run();assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/ссылк/);assert.equal(fs.existsSync(f.root+'/owner'),false);
  }finally{f.remove();}
});
test('existing compatible Node is used without a download',()=>{
  const f=fixture();try{
    fs.copyFileSync(f.root+'/node-v24.21.0-darwin-arm64/bin/node',f.bin+'/node');
    const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);
    assert.equal(fs.existsSync(f.home+'/downloads.txt'),false);
    assert.equal(fs.existsSync(f.home+'/Library/Application Support/docker-russian-runtime'),false);
  }finally{f.remove();}
});
