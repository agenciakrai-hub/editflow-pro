import assert from 'node:assert/strict';
import {build} from 'esbuild';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
const mocks={
 '@/modules/album/hooks/useAlbumProject':`export const createSpread=(p)=>globalThis.albumApi.create(p),updateSpread=(id,p)=>globalThis.albumApi.update(id,p),deleteSpread=async()=>{},updateAlbum=async()=>{};`,
 '@/modules/album/layout/visualAi':`export async function analyzePhotosForLayout(){return new Map()}`,
 '@/modules/album/editor/smartFill':`export const ensureFaces=()=>globalThis.albumFaces || Promise.resolve(null);export const smartFillSlot=()=>({fit_mode:'fill',transform:{scale:1}});export const applySmartFillToSpread=async s=>s;export const retunePhotoSlots=s=>s;`,
 '@/modules/album/lib/previewStore':`export const getFolderHandle=async()=>globalThis.albumFolder;`
};
const b=await build({stdin:{contents:`export {useAlbumStore} from './src/modules/album/manager/albumStore.js';export {findOriginalFile} from './src/modules/album/lib/originalSource.js';export {slotEffDpi} from './src/modules/album/editor/slotPhotoView.js';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',external:['react'],write:false,alias:{'@':process.cwd()+'/src'},plugins:[{name:'album-mocks',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
const {writeFile}=await import('node:fs/promises');const path=process.cwd()+'/.album-test-bundle.mjs';await writeFile(path,b.outputFiles[0].text);const api=await import(path+'?test');
let store,renderer,release;const writes=[];
globalThis.albumApi={update:async(id,p)=>{writes.push(p);if(writes.length===1)await new Promise(r=>release=r);},create:async p=>({id:'real',...p})};
const initial=[{id:'s',order_index:0,mode:'spread',locked:false,fill_canvas:true,slots:[{slot_id:'a',x_mm:0,w_mm:100,h_mm:100,transform:{scale:1}}]}];
function Harness(){store=api.useAlbumStore({id:'album',status:'designing',width_mm:300,height_mm:200},initial,new Map([['p',{id:'p',width_px:3000,height_px:2000}]]));return null;}
await act(async()=>{renderer=TestRenderer.create(React.createElement(Harness))});
await act(async()=>store.updateSlot('s','a',{x_mm:1}));let pending;
await act(async()=>{pending=store.flush();await Promise.resolve()});
await act(async()=>store.updateSlot('s','a',{x_mm:2}));await act(async()=>{release();await pending});await act(async()=>store.flush());
assert.equal(writes.length,2);assert.equal(writes[0].slots[0].x_mm,1);assert.equal(writes[1].slots[0].x_mm,2);
await act(async()=>store.applyAutoLayout('s','T01',['p']));assert.equal(store.spreads[0].slots[0].photo_id,'p');
await act(async()=>store.setSpreadFill('s',false));await act(async()=>store.applyAutoLayout('s','T01',['p']));assert.equal(store.spreads[0].slots[0].fit_mode,'fit');
await act(async()=>store.setLocked('s',true));const locked=JSON.stringify(store.spreads[0].slots);await act(async()=>store.updateSlot('s','s1',{x_mm:99}));assert.equal(JSON.stringify(store.spreads[0].slots),locked);
await act(async()=>store.setLocked('s',false));let releaseFaces;globalThis.albumFaces=new Promise(r=>releaseFaces=r);
await act(async()=>store.updateSlot('s','s1',{fit_mode:'fill'}));await act(async()=>store.updateSlot('s','s1',{transform:{scale:2}}));await act(async()=>{releaseFaces(null);await Promise.resolve()});assert.equal(store.spreads[0].slots[0].transform.scale,2);delete globalThis.albumFaces;
await act(async()=>renderer.unmount());
globalThis.albumFolder=null;assert.equal(await api.findOriginalFile('a',{filename:'photo.jpg'}),null);
const file={name:'photo.jpg'};globalThis.albumFolder={name:'photos',getDirectoryHandle:async name=>{assert.equal(name,'day');return{getFileHandle:async name=>{assert.equal(name,'photo.jpg');return{getFile:async()=>file}}}}};
assert.equal(await api.findOriginalFile('a',{relative_path:'photos/day/photo.jpg'}),file);
assert.equal(await api.findOriginalFile('a',{relative_path:'../outside.jpg'}),null);
const slot={w_mm:100,h_mm:100,fit_mode:'fill',transform:{scale:1}};const photo={width_px:3000,height_px:2000};
const normal=api.slotEffDpi(slot,photo),zoom=api.slotEffDpi({...slot,transform:{scale:2}},photo);assert.equal(zoom,normal/2);
delete globalThis.albumApi;delete globalThis.albumFolder;
console.log('PASS: async save retains latest change, relinking after missing folder, nested paths, path boundary, zoom-aware DPI, full-canvas auto layout, locked spread, async crop preserves manual zoom');

await (await import('node:fs/promises')).unlink(path);
