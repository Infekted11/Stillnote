const previewSizeSuffix = /#size=([1-9]\d{0,5})x([1-9]\d{0,3})$/;

export function setVaultLinkPreviewSize(value, { width, height }) {
  const separator = value.indexOf('|');
  const target = separator < 0 ? value : value.slice(0, separator);
  const label = separator < 0 ? '' : value.slice(separator);
  return target.trimEnd().replace(previewSizeSuffix, '') + `#size=${Math.round(width)}x${Math.round(height)}` + label;
}

export function parseVaultLink(value) {
  const raw=String(value||'').trim(),linkOnly=raw.startsWith('!!!');
  const body=linkOnly?raw.slice(3):raw,separator=body.indexOf('|');
  const sizedTarget=(separator<0?body:body.slice(0,separator)).trim();
  const size=sizedTarget.match(previewSizeSuffix),target=sizedTarget.replace(previewSizeSuffix,''),hash=target.indexOf('#');
  return {linkOnly,target,previewSize:size ? {width:Number(size[1]),height:Number(size[2])} : null,path:(hash<0?target:target.slice(0,hash)).trim(),fragment:hash<0?'':target.slice(hash+1).trim(),label:separator<0?'':body.slice(separator+1)};
}
export function shouldRenderFileLink(value,format,extension) {
  return !parseVaultLink(value).linkOnly && (['canvas','spreadsheet','gantt','graph','geometry','calculator3d'].includes(format)||/^(?:png|jpe?g|gif|bmp|webp|heic|icns|svg|obj|stl|step|stp|mp4|webm|ogv|mov|m4v|mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(String(extension||'').replace(/^\./,'')));
}
