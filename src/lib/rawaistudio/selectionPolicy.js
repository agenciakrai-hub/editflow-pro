// Respect the model's comparative winner. Never split by pose or promote by scores.
export function applyBurstSelectionPolicy(keep, meta) {
 const groups = new Map();
 for (const [id,m] of meta) {
   const key=m.groupId || `single-${id}`;
   if(!groups.has(key)) groups.set(key,[]);
   groups.get(key).push([id,m]);
 }
 for (const entries of groups.values()) {
   const winners=entries.filter(([,m])=>m.status==="TOP_PICK" && m.analysisComplete===true);
   if(winners.length!==1) throw new Error("La ráfaga no contiene exactamente una ganadora IA");
   const winner=winners[0][0];
   for(const [id,m] of entries) {
     keep.delete(id); m.groupSize=entries.length; m.complementary=false;
     if(id===winner){keep.add(id);m.status="TOP_PICK";m.groupRank=1;m.rating=5;m.colorLabel="green";}
     else {m.status="REVIEW";m.groupRank=2;m.rating=3;m.colorLabel="yellow";}
   }
 }
 return {selection_coverage_fallback:false,promotions:[],exceptional_groups:[]};
}

