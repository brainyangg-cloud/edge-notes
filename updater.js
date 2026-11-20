'use strict';
/* Auto-update via GitHub Releases (electron-updater). */
const { app, Notification } = require('electron');

let autoUpdater = null;
let status = { state: 'idle', version: null, percent: 0, message: '' };
let listener = () => {};
let timer = null;
let notified = false;

function set(patch) {
  status = Object.assign({}, status, patch);
  listener(status);
}

function init({ onStatus, enabled, icon }) {
  listener = onStatus || listener;
  if (!app.isPackaged) { set({ state: 'dev', message: '开发模式下不检查更新' }); return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    set({ state: 'error', message: '更新组件加载失败' });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: '正在检查更新…' }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest', message: '已是最新版本' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0, message: `发现新版本 ${info.version}，正在下载…` }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0), message: `正在下载 ${status.version || ''}（${Math.round(p.percent || 0)}%）` }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version, percent: 100, message: `新版本 ${info.version} 已下载，重启后生效（退出时也会自动安装）` });
    if (!notified && Notification.isSupported()) {
      notified = true;
      const n = new Notification({ title: '边缘便签有新版本', body: `${info.version} 已准备好，点这里立即重启更新`, icon });
      n.on('click', install);
      n.show();
    }
  });
  autoUpdater.on('error', (err) => {
    const msg = String((err && err.message) || err || '');
    const friendly = /404|Cannot find latest|No published versions/i.test(msg) ? '还没有发布过安装包' : /net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(msg) ? '网络连接失败，稍后会再试' : '检查更新失败';
    set({ state: 'error', message: friendly });
    console.error('[updater]', msg);
  });

  setEnabled(enabled);
}

function setEnabled(enabled) {
  clearInterval(timer);
  timer = null;
  if (!autoUpdater || !enabled) return;
  setTimeout(check, 15 * 1000);
  timer = setInterval(check, 4 * 3600 * 1000);
}

async function check() {
  if (!autoUpdater) return status;
  if (status.state === 'downloading' || status.state === 'ready') return status;
  try { await autoUpdater.checkForUpdates(); } catch (e) { /* reported via 'error' */ }
  return status;
}

function install() {
  if (!autoUpdater || status.state !== 'ready') return false;
  app.isQuiting = true;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

module.exports = { init, check, install, setEnabled, getStatus: () => status };
