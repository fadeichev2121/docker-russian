// SPDX-License-Identifier: MIT
'use strict';
const {EventEmitter} = require('node:events');
class PacketDecoder {
  constructor(onPacket,limit=16*1024*1024){this.onPacket=onPacket;this.limit=limit;this.buffer=Buffer.alloc(0);}
  push(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    let end;
    while((end=this.buffer.indexOf(0))!==-1){
      if(end>this.limit) throw new Error('Превышен размер сообщения интерфейса.');
      const data=this.buffer.subarray(0,end);this.buffer=this.buffer.subarray(end+1);
      if(data.length) {let packet;try{packet=JSON.parse(data.toString('utf8'));}catch{throw new Error('Некорректный JSON в канале интерфейса.');}this.onPacket(packet);}
    }
    if(this.buffer.length>this.limit) throw new Error('Превышен размер сообщения интерфейса.');
  }
}
class PipeClient extends EventEmitter {
  constructor(child){
    super();this.child=child;this.next=0;this.pending=new Map();this.closed=false;
    const decoder=new PacketDecoder(packet=>{
      if(packet.id && this.pending.has(packet.id)){
        const p=this.pending.get(packet.id);this.pending.delete(packet.id);clearTimeout(p.timer);
        packet.error?p.reject(new Error('Команда интерфейса отклонена: '+packet.error.message)):p.resolve(packet.result||{});
      }else this.emit('event',packet);
    });
    child.stdio[4].on('data',chunk=>{try{decoder.push(chunk);}catch(error){this.fail(error);}});
    child.stdio[4].on('end',()=>this.fail(new Error('Канал интерфейса закрыт.')));
    child.stdio[4].on('error',error=>this.fail(error));
    child.stdio[3].on('error',error=>this.fail(error));
    child.on('error',error=>this.fail(error));
    child.on('exit',()=>this.fail(new Error('Окно Docker завершилось.')));
  }
  fail(error){
    if(this.closed)return;this.closed=true;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();
    this.emit('closed',error);
  }
  call(method,params={},sessionId,timeout=10000){
    if(this.closed)return Promise.reject(new Error('Канал интерфейса уже закрыт.'));
    return new Promise((resolve,reject)=>{
      const id=++this.next;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Интерфейс не ответил: '+method));},timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error)this.fail(error);});
    });
  }
  close(){this.fail(new Error('Помощник завершён.'));this.child.stdio[3].end();}
}
module.exports={PacketDecoder,PipeClient};
