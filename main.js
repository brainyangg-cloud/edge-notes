'use strict';
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage,
  Notification, nativeTheme, shell, clipboard, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const updater = require('./updater');

const APP_ID = 'com.edgenotes.app';
const isWin = process.platform === 'win32';

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (isWin) app.setAppUserModelId(APP_ID);

// ---------- storage ----------
if (process.env.EDGE_NOTES_DATA) app.setPath('userData', process.env.EDGE_NOTES_DATA);
const DATA = app.getPath('userData');
const IMG_DIR = path.join(DATA, 'images');
const BK_DIR = path.join(DATA, 'backups');
const NOTES_FILE = path.join(DATA, 'notes.json');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
for (const d of [DATA, IMG_DIR, BK_DIR]) fs.mkdirSync(d, { recursive: true });

const DEFAULT_SETTINGS = {
  dock: 'right', displayId: null, deckStyle: 'tabs', deckScale: 1, keepOpen: false,
  opacity: 0.82, hoverDelay: 150, leaveDelay: 600, theme: 'system', autostart: true,
  defaultRemindMode: 'notify', welcomed: false, autoUpdate: true, noteFont: '', noteFontSize: 14,
  shortcuts: { newNote: 'Ctrl+Alt+N', capture: 'Ctrl+Shift+Space', toggle: 'Ctrl+Alt+Space', all: 'Ctrl+Alt+A' }
};

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

let settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_FILE, {}));
settings.shortcuts = Object.assign({}, DEFAULT_SETTINGS.shortcuts, settings.shortcuts || {});
let notes = readJSON(NOTES_FILE, null);
const firstRun = !Array.isArray(notes);
if (firstRun) {
  const now = Date.now();
  notes = [{
    id: uid(), title: '欢迎使用边缘便签', color: 'yellow', order: 0,
    html: '<div>鼠标移到屏幕边缘，便签就会滑出来。</div><div class="task" data-done="1"><span class="cb" contenteditable="false"></span>打开这张便签</div><div class="task" data-done="0"><span class="cb" contenteditable="false"></span>按 Ctrl+V 粘贴一张截图试试</div><div class="task" data-done="0"><span class="cb" contenteditable="false"></span>点上面的闹钟，设一个提醒</div>',
    createdAt: now, updatedAt: now, remindAt: null, repeat: 'none', remindMode: 'notify',
    due: false, pinned: false, archived: false
  }];
}

let saveTimer = null;
function saveNotes() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON(NOTES_FILE, notes), 200);
}
function saveSettings() { writeJSON(SETTINGS_FILE, settings); }
function uid() { return Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }

function dailyBackup() {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const f = path.join(BK_DIR, `notes-${day}.json`);
    if (!fs.existsSync(f) && fs.existsSync(NOTES_FILE)) fs.copyFileSync(NOTES_FILE, f);
    const all = fs.readdirSync(BK_DIR).filter(n => n.startsWith('notes-')).sort();
    while (all.length > 30) fs.unlinkSync(path.join(BK_DIR, all.shift()));
  } catch (e) { console.error('backup', e); }
}

// ---------- windows ----------
let edgeWin = null, captureWin = null, managerWin = null, settingsWin = null, viewerWin = null, welcomeWin = null;
let tray = null;
const EDGE_W = 640;
const iconPath = path.join(__dirname, 'assets', 'icon.png');

function targetDisplay() {
  const all = screen.getAllDisplays();
  return all.find(d => d.id === settings.displayId) || screen.getPrimaryDisplay();
}

function placeEdge() {
  if (!edgeWin) return;
  const wa = targetDisplay().workArea;
  const x = settings.dock === 'left' ? wa.x : wa.x + wa.width - EDGE_W;
  edgeWin.setBounds({ x, y: wa.y, width: EDGE_W, height: wa.height });
}

function createEdge() {
  edgeWin = new BrowserWindow({
    width: EDGE_W, height: 800, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, focusable: true, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  edgeWin.setAlwaysOnTop(true, 'pop-up-menu');
  edgeWin.setVisibleOnAllWorkspaces(true);
  placeEdge();
  edgeWin.setIgnoreMouseEvents(true, { forward: true });
  edgeWin.loadFile(path.join(__dirname, 'renderer', 'edge.html'));
  edgeWin.once('ready-to-show', () => edgeWin.showInactive());
  edgeWin.on('blur', () => send(edgeWin, 'edge:blur'));
}

function baseWin(opts, file) {
  const w = new BrowserWindow(Object.assign({
    icon: iconPath, autoHideMenuBar: true, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  }, opts));
  w.setMenu(null);
  w.loadFile(path.join(__dirname, 'renderer', file));
  w.once('ready-to-show', () => w.show());
  return w;
}

function openCapture() {
  if (captureWin && !captureWin.isDestroyed()) { captureWin.show(); captureWin.focus(); send(captureWin, 'capture:reset'); return; }
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  captureWin = new BrowserWindow({
    width: 560, height: 170, x: Math.round(wa.x + (wa.width - 560) / 2), y: Math.round(wa.y + wa.height * 0.22),
    frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  captureWin.loadFile(path.join(__dirname, 'renderer', 'capture.html'));
  captureWin.once('ready-to-show', () => { captureWin.show(); captureWin.focus(); });
  captureWin.on('blur', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.hide(); });
}

function openManager(tab) {
  if (managerWin && !managerWin.isDestroyed()) { managerWin.show(); managerWin.focus(); send(managerWin, 'manager:tab', tab || 'notes'); return; }
  managerWin = baseWin({ width: 1080, height: 720, minWidth: 640, minHeight: 420, title: '全部便签' }, 'manager.html');
  managerWin.webContents.once('did-finish-load', () => send(managerWin, 'manager:tab', tab || 'notes'));
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = baseWin({ width: 940, height: 720, minWidth: 720, minHeight: 500, title: '边缘便签 · 设置' }, 'settings.html');
}

function openWelcome() {
  welcomeWin = baseWin({ width: 880, height: 560, resizable: false, title: '欢迎使用边缘便签' }, 'welcome.html');
}

function openViewer(noteId, img) {
  if (viewerWin && !viewerWin.isDestroyed()) viewerWin.close();
  viewerWin = baseWin({ width: 1200, height: 800, title: '查看图片', backgroundColor: '#111111' }, 'viewer.html');
  viewerWin.maximize();
  viewerWin.webContents.once('did-finish-load', () => send(viewerWin, 'viewer:load', { noteId, img }));
}

function send(win, ch, data) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
}
function broadcast(ch, data) {
  for (const w of BrowserWindow.getAllWindows()) send(w, ch, data);
}
function notesChanged() { saveNotes(); broadcast('notes:changed', notes); updateTray(); }

// ---------- tray ----------
function updateTray() {
  if (!tray) return;
  const active = notes.filter(n => !n.archived).length;
  const due = notes.filter(n => n.due && !n.archived).length;
  tray.setToolTip(`边缘便签 · ${active} 张${due ? ` · ${due} 个提醒` : ''}`);
  const sc = settings.shortcuts;
  const up = updater.getStatus();
  const upItems = up.state === 'ready'
    ? [{ label: `重启并更新到 ${up.version}`, click: () => updater.install() }, { type: 'separator' }]
    : [];
  tray.setContextMenu(Menu.buildFromTemplate([
    ...upItems,
    { label: '新建便签', accelerator: sc.newNote, click: () => newNoteAndOpen() },
    { label: '快速记录', accelerator: sc.capture, click: openCapture },
    { label: '全部便签', accelerator: sc.all, click: () => openManager('notes') },
    { label: '归档', click: () => openManager('archive') },
    { type: 'separator' },
    { label: '停靠在', submenu: [
      { label: '右侧', type: 'radio', checked: settings.dock === 'right', click: () => setSettings({ dock: 'right' }) },
      { label: '左侧', type: 'radio', checked: settings.dock === 'left', click: () => setSettings({ dock: 'left' }) }
    ] },
    { label: '标签样式', submenu: [
      { label: '带标题的标签', type: 'radio', checked: settings.deckStyle === 'tabs', click: () => setSettings({ deckStyle: 'tabs' }) },
      { label: '只显示色块', type: 'radio', checked: settings.deckStyle === 'chips', click: () => setSettings({ deckStyle: 'chips' }) }
    ] },
    { label: '保持展开', type: 'checkbox', checked: settings.keepOpen, click: (i) => setSettings({ keepOpen: i.checked }) },
    { label: '开机自动启动', type: 'checkbox', checked: settings.autostart, click: (i) => setSettings({ autostart: i.checked }) },
    { type: 'separator' },
    { label: '设置', click: openSettings },
    { label: up.state === 'downloading' ? `正在下载更新 ${up.percent}%` : '检查更新', enabled: up.state !== 'downloading' && up.state !== 'dev', click: () => { updater.check(); openSettings(); } },
    { label: '打开数据文件夹', click: () => shell.openPath(DATA) },
    { label: '退出', click: () => { app.isQuiting = true; app.quit(); } }
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.on('click', () => send(edgeWin, 'edge:toggle'));
  tray.on('double-click', () => openManager('notes'));
  updateTray();
}

// ---------- settings ----------
function applyAutostart() {
  try { app.setLoginItemSettings({ openAtLogin: !!settings.autostart, path: process.execPath }); } catch (e) { console.error(e); }
}
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const sc = settings.shortcuts;
  const map = {
    newNote: () => newNoteAndOpen(),
    capture: openCapture,
    toggle: () => send(edgeWin, 'edge:toggle'),
    all: () => openManager('notes')
  };
  const failed = [];
  for (const k of Object.keys(map)) {
    if (!sc[k]) continue;
    try { if (!globalShortcut.register(sc[k], map[k])) failed.push(sc[k]); } catch { failed.push(sc[k]); }
  }
  return failed;
}
function setSettings(patch) {
  const old = settings;
  settings = Object.assign({}, settings, patch);
  if (patch.shortcuts) settings.shortcuts = Object.assign({}, old.shortcuts, patch.shortcuts);
  saveSettings();
  if ('theme' in patch) nativeTheme.themeSource = settings.theme;
  if ('autostart' in patch) applyAutostart();
  if ('autoUpdate' in patch) updater.setEnabled(!!settings.autoUpdate);
  if ('dock' in patch || 'displayId' in patch) placeEdge();
  let failed = [];
  if (patch.shortcuts) failed = registerShortcuts();
  broadcast('settings:changed', settings);
  updateTray();
  return { settings, failed };
}

// ---------- notes ----------
function activeNotes() { return notes.filter(n => !n.archived).sort((a, b) => a.order - b.order); }
function createNote(fields) {
  const now = Date.now();
  const minOrder = notes.reduce((m, n) => Math.min(m, n.order), 0);
  const colors = ['yellow', 'green', 'blue', 'pink', 'purple'];
  const n = Object.assign({
    id: uid(), title: '', html: '', color: colors[notes.length % colors.length], order: minOrder - 1,
    createdAt: now, updatedAt: now, remindAt: null, repeat: 'none', remindMode: settings.defaultRemindMode,
    due: false, pinned: false, archived: false
  }, fields);
  notes.push(n);
  notesChanged();
  return n;
}
function newNoteAndOpen() {
  const n = createNote({ title: '新便签' });
  send(edgeWin, 'edge:open', n.id);
}
function updateNote(id, patch) {
  const n = notes.find(x => x.id === id);
  if (!n) return null;
  Object.assign(n, patch, { updatedAt: Date.now() });
  if ('remindAt' in patch && !('due' in patch)) n.due = false;
  notesChanged();
  return n;
}
function deleteNote(id) {
  const i = notes.findIndex(x => x.id === id);
  if (i < 0) return null;
  const [n] = notes.splice(i, 1);
  notesChanged();
  return n;
}
function cleanupImages() {
  try {
    const used = new Set();
    for (const n of notes) for (const m of (n.html || '').matchAll(/data-img="([^"]+)"/g)) used.add(m[1]);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const f of fs.readdirSync(IMG_DIR)) {
      const p = path.join(IMG_DIR, f);
      if (!used.has(f) && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (e) { console.error('cleanup', e); }
}

// ---------- reminders ----------
function nextOccurrence(t, repeat) {
  const d = new Date(t);
  const now = Date.now();
  do {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekdays') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else return null;
  } while (d.getTime() <= now);
  return d.getTime();
}
function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const n of notes) {
    if (n.archived) continue;
    if (n.snoozeAt && n.snoozeAt <= now) {
      n.snoozeAt = null; n.due = true; n.dueAt = now; changed = true;
      fireReminder(n);
      continue;
    }
    if (!n.remindAt || n.remindAt > now) continue;
    n.due = true;
    n.dueAt = n.remindAt;
    n.remindAt = n.repeat && n.repeat !== 'none' ? nextOccurrence(n.remindAt, n.repeat) : null;
    changed = true;
    fireReminder(n);
  }
  if (changed) notesChanged();
}
function fireReminder(n) {
  send(edgeWin, 'edge:remind', n.id);
  if (n.remindMode === 'glow' || !Notification.isSupported()) return;
  const text = htmlToText(n.html).slice(0, 120);
  const notif = new Notification({
    title: `提醒 · ${n.title || '便签'}`, body: text || '到时间了', silent: n.remindMode !== 'loud',
    icon: iconPath, timeoutType: n.remindMode === 'loud' ? 'never' : 'default'
  });
  notif.on('click', () => send(edgeWin, 'edge:open', n.id));
  notif.show();
}
function htmlToText(html) {
  return (html || '').replace(/<img[^>]*>/g, '[图片]').replace(/<\/(div|p|li)>/g, '\n').replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

// ---------- export ----------
function noteToMarkdown(n, imgPrefix) {
  let md = `# ${n.title || '便签'}\n\n`;
  const html = n.html || '';
  const blocks = html.split(/(?=<div)/);
  for (const b of blocks) {
    const done = /class="task"[^>]*data-done="1"/.test(b);
    const isTask = /class="task"/.test(b);
    let s = b.replace(/<img[^>]*data-img="([^"]+)"[^>]*>/g, (_, f) => `![](${imgPrefix}${f})`);
    s = htmlToText(s);
    if (!s && !/!\[/.test(s)) continue;
    md += (isTask ? (done ? '- [x] ' : '- [ ] ') : '') + s + '\n';
  }
  if (n.remindAt) md += `\n> 提醒：${new Date(n.remindAt).toLocaleString('zh-CN')}\n`;
  return md;
}
async function exportMarkdown(ids) {
  const r = await dialog.showOpenDialog({ title: '选择导出文件夹', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.join(r.filePaths[0], `边缘便签导出-${new Date().toISOString().slice(0, 10)}`);
  const imgOut = path.join(dir, 'images');
  fs.mkdirSync(imgOut, { recursive: true });
  const list = ids ? notes.filter(n => ids.includes(n.id)) : notes;
  const used = new Set();
  for (const n of list) {
    let name = (n.title || '便签').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '便签';
    while (used.has(name)) name += '_';
    used.add(name);
    fs.writeFileSync(path.join(dir, name + '.md'), noteToMarkdown(n, 'images/'), 'utf8');
    for (const m of (n.html || '').matchAll(/data-img="([^"]+)"/g)) {
      const src = path.join(IMG_DIR, m[1]);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(imgOut, m[1]));
    }
  }
  shell.openPath(dir);
  return dir;
}

// ---------- IPC ----------
ipcMain.handle('init', () => ({
  notes, settings, imgBase: pathToFileURL(IMG_DIR + path.sep).href, dataDir: DATA, platform: process.platform,
  displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `显示器 ${i + 1}（${d.size.width}×${d.size.height}）${d.id === screen.getPrimaryDisplay().id ? ' · 主显示器' : ''}` })),
  version: app.getVersion()
}));
ipcMain.on('edge:ignore', (_e, ignore) => {
  if (!edgeWin) return;
  if (ignore) edgeWin.setIgnoreMouseEvents(true, { forward: true });
  else edgeWin.setIgnoreMouseEvents(false);
});
ipcMain.on('edge:focus', () => { if (edgeWin) { edgeWin.focus(); } });
ipcMain.handle('note:create', (_e, f) => createNote(f || {}));
ipcMain.handle('note:update', (_e, id, patch) => updateNote(id, patch));
ipcMain.handle('note:delete', (_e, id) => deleteNote(id));
ipcMain.handle('note:restore', (_e, n) => { if (n && !notes.find(x => x.id === n.id)) { notes.push(n); notesChanged(); } return true; });
ipcMain.handle('note:reorder', (_e, ids) => {
  ids.forEach((id, i) => { const n = notes.find(x => x.id === id); if (n) n.order = i; });
  notesChanged();
});
ipcMain.handle('note:open', (_e, id) => {
  const n = notes.find(x => x.id === id);
  if (n && n.archived) updateNote(id, { archived: false });
  send(edgeWin, 'edge:open', id);
});
ipcMain.handle('img:save', (_e, buf, ext) => {
  const name = uid() + '.' + (/^(png|jpg|jpeg|gif|webp|bmp)$/i.test(ext || '') ? ext.toLowerCase() : 'png');
  fs.writeFileSync(path.join(IMG_DIR, name), Buffer.from(buf));
  return name;
});
ipcMain.handle('img:copy', (_e, name) => {
  const img = nativeImage.createFromPath(path.join(IMG_DIR, path.basename(name)));
  if (img.isEmpty()) return false;
  clipboard.writeImage(img);
  return true;
});
ipcMain.handle('img:saveAs', async (_e, name) => {
  const src = path.join(IMG_DIR, path.basename(name));
  const r = await dialog.showSaveDialog({ defaultPath: path.basename(name), filters: [{ name: '图片', extensions: [path.extname(name).slice(1) || 'png'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.copyFileSync(src, r.filePath);
  return true;
});
ipcMain.handle('viewer:open', (_e, noteId, img) => openViewer(noteId, img));
ipcMain.handle('settings:set', (_e, patch) => setSettings(patch));
ipcMain.handle('shortcuts:pause', (_e, pause) => { if (pause) globalShortcut.unregisterAll(); else registerShortcuts(); });
ipcMain.handle('open:manager', (_e, tab) => openManager(tab));
ipcMain.handle('open:settings', () => openSettings());
ipcMain.handle('open:capture', () => openCapture());
ipcMain.handle('open:dataDir', () => shell.openPath(DATA));
ipcMain.handle('export:md', (_e, ids) => exportMarkdown(ids));
ipcMain.handle('backup:now', () => {
  const f = path.join(BK_DIR, `notes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeJSON(f, notes);
  return f;
});
ipcMain.handle('capture:save', (_e, text, remindAt) => {
  const t = (text || '').trim();
  if (!t) return null;
  const lines = t.split('\n');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const n = createNote({
    title: lines[0].slice(0, 24),
    html: lines.map(l => `<div>${esc(l) || '<br>'}</div>`).join(''),
    remindAt: remindAt || null
  });
  if (captureWin && !captureWin.isDestroyed()) captureWin.hide();
  send(edgeWin, 'edge:flash', n.id);
  return n;
});
ipcMain.handle('capture:hide', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.hide(); });
ipcMain.handle('welcome:done', (_e, patch) => {
  setSettings(Object.assign({ welcomed: true }, patch || {}));
  if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.close();
  send(edgeWin, 'edge:hint');
});
ipcMain.handle('update:status', () => updater.getStatus());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('win:close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });

// ---------- lifecycle ----------
app.on('second-instance', () => openManager('notes'));
app.on('window-all-closed', (e) => { /* keep running in tray */ });

app.whenReady().then(() => {
  nativeTheme.themeSource = settings.theme;
  if (firstRun) writeJSON(NOTES_FILE, notes);
  createEdge();
  createTray();
  const failed = registerShortcuts();
  if (failed.length) console.warn('shortcut register failed', failed);
  applyAutostart();
  dailyBackup();
  cleanupImages();
  if (!settings.welcomed) openWelcome();
  updater.init({ enabled: settings.autoUpdate !== false, icon: iconPath, onStatus: (st) => { broadcast('update:status', st); updateTray(); } });
  checkReminders();
  setInterval(checkReminders, 10 * 1000);
  setInterval(dailyBackup, 3600 * 1000);
  screen.on('display-metrics-changed', placeEdge);
  screen.on('display-added', placeEdge);
  screen.on('display-removed', placeEdge);
  nativeTheme.on('updated', () => broadcast('theme:changed', nativeTheme.shouldUseDarkColors));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearTimeout(saveTimer);
  writeJSON(NOTES_FILE, notes);
});
