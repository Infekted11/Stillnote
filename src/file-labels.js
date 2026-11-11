// These suffixes identify structured Markdown files in the UI only.
export const FILE_TYPE_EXTENSIONS = Object.freeze({
  graph: '.grph',
  calculator3d: '.3d',
  canvas: '.cnvs',
  geometry: '.geom',
  tasks: '.task',
  spreadsheet: '.sht',
});

export function fileDisplayParts(path, format) {
  const filename = String(path).split('/').at(-1);
  const markdown = format !== 'folder' && /\.md$/i.test(filename);
  return {
    name: markdown ? filename.slice(0, -3) : filename,
    extension: markdown && Object.hasOwn(FILE_TYPE_EXTENSIONS, format) ? FILE_TYPE_EXTENSIONS[format] : '',
  };
}

export function fileDisplayName(path, format) {
  const { name, extension } = fileDisplayParts(path, format);
  return name + extension;
}
