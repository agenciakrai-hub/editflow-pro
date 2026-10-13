import assert from 'node:assert/strict';import {build} from 'esbuild';
const mocks={
 '@/modules/album/export/spreadRenderer':`export const getBestPreviewUrl=async()=>null;export function renderSpreadToCanvas(){globalThis.albumExport.rendered++;return{canvas:{toBlob:cb=>cb(globalThis.albumExport.blob)},missingCount:0}}`,
 '@/modules/album/lib/originalSource':`export const findOriginalFile=async()=>({});export const renderScaledFromOriginal=async(file,edge)=>{if(globalThis.albumExport.decodeFail)throw Error('bad');globalThis.albumExport.edge=edge(3000,2000);return{url:'blob:test',width:3000,height:2000}};export const loadUrlImage=async()=>({})`
};
const b=await build({entryPoints:['src/modules/album/export/exportSpreads.js'],bundle:true,platform:'node',format:'esm',write:false,alias:{'@':process.cwd()+'/src'},plugins:[{name:'mock-files-only',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
const {exportSpreads}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
let written=0;const folderHandle={getFileHandle:async()=>({createWritable:async()=>({write:async()=>written++,close:async()=>{}})})};
const args={album:{id:'a',name:'test'},spreads:[{slots:[{photo_id:'p',w_mm:100,h_mm:100,fit_mode:'fill',transform:{scale:4}}]}],photosById:new Map([['p',{filename:'photo.jpg'}]]),options:{folderHandle,pxPerMm:10,requireOriginals:true,checkResolution:true}};
globalThis.albumExport={decodeFail:true,rendered:0,blob:{}};await assert.rejects(()=>exportSpreads(args),/No se pudo cargar/);assert.equal(written,0);assert.equal(globalThis.albumExport.rendered,0);
globalThis.albumExport={decodeFail:false,rendered:0,blob:null};await assert.rejects(()=>exportSpreads(args),/generar/);assert.equal(written,0);
globalThis.albumExport={decodeFail:false,rendered:0,blob:{}};const result=await exportSpreads(args);assert.equal(result.count,1);assert.equal(written,1);assert.equal(globalThis.albumExport.edge,6000);assert.equal(result.lowRes.length,1);
await assert.rejects(()=>exportSpreads({...args,options:{...args.options,pxPerMm:0}}),/resolución/);
delete globalThis.albumExport;console.log('PASS: unreadable print original never writes blank spread, null image export rejected, zoom resolution and DPI, invalid resolution');
