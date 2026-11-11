export function parseVaultLink(value) {
  const raw=String(value||'').trim(),linkOnly=raw.startsWith('!!!');
  const body=linkOnly?raw.slice(3):raw,separator=body.indexOf('|');
  const target=(separator<0?body:body.slice(0,separator)).trim(),hash=target.indexOf('#');
  return {linkOnly,target,path:(hash<0?target:target.slice(0,hash)).trim(),fragment:hash<0?'':target.slice(hash+1).trim(),label:separator<0?'':body.slice(separator+1)};
}
export function shouldRenderFileLink(value,format,extension) {
  return !parseVaultLink(value).linkOnly && (['canvas','spreadsheet','graph','geometry','calculator3d'].includes(format)||/^(?:png|jpe?g|gif|bmp|webp|heic|icns|svg|obj|stl|step|stp|mp4|webm|ogv|mov|m4v|mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(String(extension||'').replace(/^\./,'')));
}
