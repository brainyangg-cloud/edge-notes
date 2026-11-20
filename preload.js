'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  init: inv('init'),
  createNote: inv('note:create'),
  updateNote: inv('note:update'),
  deleteNote: inv('note:delete'),
  restoreNote: inv('note:restore'),
  reorder: inv('note:reorder'),
  openNote: inv('note:open'),
  saveImage: inv('img:save'),
  copyImage: inv('img:copy'),
  saveImageAs: inv('img:saveAs'),
  openViewer: inv('viewer:open'),
  setSettings: inv('settings:set'),
  pauseShortcuts: inv('shortcuts:pause'),
  openManager: inv('open:manager'),
  openSettings: inv('open:settings'),
  openCapture: inv('open:capture'),
  openDataDir: inv('open:dataDir'),
  exportMarkdown: inv('export:md'),
  backupNow: inv('backup:now'),
  captureSave: inv('capture:save'),
  captureHide: inv('capture:hide'),
  welcomeDone: inv('welcome:done'),
  closeWindow: inv('win:close'),
  updateStatus: inv('update:status'),
  checkUpdate: inv('update:check'),
  installUpdate: inv('update:install'),
  setIgnore: (v) => ipcRenderer.send('edge:ignore', v),
  focusEdge: () => ipcRenderer.send('edge:focus'),
  on: (ch, fn) => {
    const ok = ['notes:changed', 'settings:changed', 'theme:changed', 'edge:blur', 'edge:toggle', 'edge:open',
      'edge:remind', 'edge:flash', 'edge:hint', 'capture:reset', 'manager:tab', 'viewer:load', 'update:status'];
    if (!ok.includes(ch)) return;
    ipcRenderer.on(ch, (_e, d) => fn(d));
  }
});
