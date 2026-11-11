const {watch}=require('node:fs');
function watchVaultChanges(root,onChange,{watchImpl=watch,delay=200}={}){
  let timer,closed=false;const paths=new Set();
  const flush=()=>{if(closed)return;const changed=[...paths];paths.clear();onChange({vault:root,paths:changed});};
  const watcher=watchImpl(root,{recursive:true},(_event,filename)=>{
    if(closed)return;
    const name=filename==null?'':String(filename).replace(/\\/g,'/');
    if(name.split('/').some(part=>part.startsWith('.')))return;
    paths.add(name);clearTimeout(timer);timer=setTimeout(flush,delay);
  });
  watcher.on('error',()=>{if(!closed){paths.add('');clearTimeout(timer);timer=setTimeout(flush,delay);}});
  return ()=>{closed=true;clearTimeout(timer);paths.clear();watcher.close();};
}
module.exports={watchVaultChanges};
