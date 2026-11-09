const { contextBridge, ipcRenderer } = require('electron');
const queuedDeepLinks = [];
const deepLinkListeners = new Set();
ipcRenderer.on('stillnote:deep-link', (_event, link) => {
  if (!deepLinkListeners.size) queuedDeepLinks.push(link);
  else for (const listener of deepLinkListeners) listener(link);
});

contextBridge.exposeInMainWorld('stillnote', {
  platform: process.platform,
  googleTasksStatus: () => ipcRenderer.invoke('google-tasks:status'),
  saveGoogleTasksCredentials: (clientId, clientSecret) => ipcRenderer.invoke('google-tasks:save-client-credentials', clientId, clientSecret),
  connectGoogleTasks: () => ipcRenderer.invoke('google-tasks:connect'),
  disconnectGoogleTasks: () => ipcRenderer.invoke('google-tasks:disconnect'),
  listGoogleTaskLists: () => ipcRenderer.invoke('google-tasks:lists'),
  createGoogleTaskList: (title) => ipcRenderer.invoke('google-tasks:list-create', title),
  renameGoogleTaskList: (id, title) => ipcRenderer.invoke('google-tasks:list-rename', id, title),
  listGoogleTasks: (listId) => ipcRenderer.invoke('google-tasks:tasks', listId),
  createGoogleTask: (listId, title, parentTaskId) => ipcRenderer.invoke('google-tasks:task-create', listId, title, parentTaskId),
  updateGoogleTask: (listId, taskId, changes) => ipcRenderer.invoke('google-tasks:task-update', listId, taskId, changes),
  deleteGoogleTask: (listId, taskId) => ipcRenderer.invoke('google-tasks:task-delete', listId, taskId),
  createMeetingTranscript: () => ipcRenderer.invoke('meeting:temp-create'),
  writeMeetingTranscript: (id, contents) => ipcRenderer.invoke('meeting:temp-write', id, contents),
  readMeetingTranscript: (id) => ipcRenderer.invoke('meeting:temp-read', id),
  clearMeetingTranscript: (id) => ipcRenderer.invoke('meeting:temp-clear', id),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  listNotes: () => ipcRenderer.invoke('vault:list'),
  findRelevantNotes: (query) => ipcRenderer.invoke('vault:relevant', query),
  getVaultTree: () => ipcRenderer.invoke('vault:tree'),
  createFolder: (parentPath, name) => ipcRenderer.invoke('vault:mkdir', parentPath, name),
  renameEntry: (path, name) => ipcRenderer.invoke('vault:rename', path, name),
  deleteEntry: (path) => ipcRenderer.invoke('vault:delete', path),
  moveEntry: (path, destinationFolderPath) => ipcRenderer.invoke('vault:move', path, destinationFolderPath),
  getBacklinks: (path) => ipcRenderer.invoke('vault:backlinks', path),
  copyFileLink: (path) => ipcRenderer.invoke('vault:copy-link', path),
  resetUnreadableCredentials: () => ipcRenderer.invoke('credentials:reset-unreadable'),
  onStorageRecovered: (listener) => {
    const handler = (_event, kind) => listener(kind);
    ipcRenderer.on('storage:recovered', handler);
    return () => ipcRenderer.removeListener('storage:recovered', handler);
  },
  onDeepLink: (listener) => {
    deepLinkListeners.add(listener);
    while (queuedDeepLinks.length) listener(queuedDeepLinks.shift());
    return () => deepLinkListeners.delete(listener);
  },
  restoreSession: () => ipcRenderer.invoke('session:restore'),
  rememberNote: (path) => ipcRenderer.invoke('session:remember-note', path),
  aiKeyStatus: () => ipcRenderer.invoke('ai:key-status'),
  saveAiKey: (key) => ipcRenderer.invoke('ai:key-save', key),
  clearAiKey: () => ipcRenderer.invoke('ai:key-clear'),
  desmosKeyStatus: () => ipcRenderer.invoke('desmos:key-status'),
  getDesmosKey: () => ipcRenderer.invoke('desmos:key-get'),
  saveDesmosKey: (key) => ipcRenderer.invoke('desmos:key-save', key),
  clearDesmosKey: () => ipcRenderer.invoke('desmos:key-clear'),
  listAiModels: () => ipcRenderer.invoke('ai:models'),
  askAi: (request) => ipcRenderer.invoke('ai:chat', request),
  loadSpellcheckDictionary: () => ipcRenderer.invoke('spellcheck:dictionary'),
  loadCustomDictionary: () => ipcRenderer.invoke('spellcheck:custom-load'),
  saveCustomDictionary: (words) => ipcRenderer.invoke('spellcheck:custom-save', words),
  readNote: (path) => ipcRenderer.invoke('note:read', path),
  writeNote: (path, contents) => ipcRenderer.invoke('note:write', path, contents),
  readAsset: (path) => ipcRenderer.invoke('asset:read', path),
  loadOcctWasm: () => ipcRenderer.invoke('asset:occt-wasm'),
  uploadAssets: (destination, uploads) => ipcRenderer.invoke('asset:upload', destination, uploads),
  exportPdf: (path, html) => ipcRenderer.invoke('note:export-pdf', path, html),
  createNote: (title, parentPath) => ipcRenderer.invoke('note:create', title, parentPath),
  createCodeFile: (name, parentPath) => ipcRenderer.invoke('file:create-code', name, parentPath),
});
