import { Fake6502Computer } from "./computer.js";
import { DiskImage } from "./disk.js";
import { TerminalRenderer } from "./renderer.js";
import { loadStoredDisk, saveStoredDisk } from "./storage.js";
import { keyToCode } from "./keyboard.js";
const canvas=document.querySelector("#screen"),status=document.querySelector("#status");
let machine,renderer,savePromise=Promise.resolve();
async function fetchBytes(url){const r=await fetch(url);if(!r.ok)throw new Error(`Could not load ${url} (${r.status})`);return new Uint8Array(await r.arrayBuffer());}
async function initialDisk(){
  const [stored,bundledBytes]=await Promise.all([loadStoredDisk(),fetchBytes("./build/disk.dsk")]);
  const bundled=new DiskImage(bundledBytes);
  if(stored){
    try{
      const disk=new DiskImage(stored);
      const installed=disk.installMissingExecutables(bundled);
      if(installed.length) await saveStoredDisk(disk.bytes);
      return disk;
    }catch(error){console.warn("Stored disk could not be migrated; using bundled image",error);}
  }
  return bundled;
}
function scheduleDiskSave(d){savePromise=savePromise.then(()=>saveStoredDisk(d.bytes)).catch(e=>console.warn("Disk save failed",e));}
async function boot(){await document.fonts.ready;const [wasm,rom,disk]=await Promise.all([fetchBytes("./build/fake6502mp.wasm"),fetchBytes("./build/rom.bin"),initialDisk()]);machine=await Fake6502Computer.create({wasm,rom,disk,onDiskChanged:scheduleDiskSave,quantum:32});renderer=await TerminalRenderer.create(canvas,machine.display,machine.graphics);
window.fake6502Computer=Object.freeze({machine,renderer,get disk(){return machine.disk;},exportDisk(){return machine.exportDisk();},async importDisk(b){machine.importDisk(b);await savePromise;},type(t){machine.enqueueText(t);},reset(){machine.reset();renderer.render(true);},get texture(){return renderer.texture;},get graphics(){return machine.graphics;},get textureBackend(){return renderer.backend;},get threads(){return machine.getThreadSnapshot();},get cpuStats(){return {cycles:machine.cpu.totalCycles,instructions:machine.cpu.totalInstructions,activeThread:machine.cpu.activeThread,idle:machine.cpu.idle};},setQuantum(n){machine.cpu.setQuantum(n);},spawn(entry,sp=0xfd){return machine.cpu.spawn(entry,sp);},wake(id){return machine.cpu.wake(id);},raiseIRQ(id=0){return machine.cpu.raiseIRQ(id);},raiseNMI(id=0){return machine.cpu.raiseNMI(id);}});
canvas.addEventListener("keydown",e=>{const c=keyToCode(e);if(!c)return;e.preventDefault();machine.enqueueKey(c);});canvas.addEventListener("pointerdown",()=>canvas.focus());window.addEventListener("keydown",e=>{if(document.activeElement===canvas)return;const c=keyToCode(e);if(!c)return;e.preventDefault();canvas.focus();machine.enqueueKey(c);});canvas.focus();status.textContent="";
let previous=0;function frame(now){const elapsed=previous?Math.min(50,now-previous):16.667;previous=now;machine.runCycles(Math.max(1,Math.round(1_000_000*elapsed/1000)));renderer.render(false,now);requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
boot().catch(e=>{console.error(e);status.textContent=`Unable to start the 6502MP computer: ${e.message}`;});
