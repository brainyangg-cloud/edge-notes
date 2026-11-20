'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let s = {};

function msg(t) {
  const m = $('#msg');
  m.textContent = t;
  m.style.display = 'block';
  clearTimeout(m._t);
  m._t = setTimeout(() => { m.style.display = 'none'; }, 2600);
}
async function set(patch) {
  const r = await window.api.setSettings(patch);
  s = r.settings;
  fill();
  if (r.failed && r.failed.length) msg(`快捷键 ${r.failed.join('、')} 被其他程序占用，请换一个`);
  return r;
}

function fill() {
  $$('.seg[data-key]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(s[seg.dataset.key]) === b.dataset.v)));
  $$('select[data-key]').forEach(sel => { sel.value = String(s[sel.dataset.key]); });
  $$('input[type=checkbox][data-key]').forEach(c => { c.checked = !!s[c.dataset.key]; });
  $('#scale').value = Math.round((s.deckScale || 1) * 100); $('#scaleV').textContent = $('#scale').value + '%';
  $('#opacity').value = Math.round((s.opacity ?? 0.82) * 100); $('#opacityV').textContent = $('#opacity').value + '%';
  $$('input[name=drm]').forEach(r => { r.checked = r.value === s.defaultRemindMode; });
  $$('.key[data-sc]').forEach(k => { if (!k.classList.contains('rec')) k.textContent = (s.shortcuts || {})[k.dataset.sc] || '未设置'; });
  $('#display').value = String(s.displayId ?? '');
}

$$('.seg[data-key]').forEach(seg => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) set({ [seg.dataset.key]: b.dataset.v });
}));
$$('select[data-key]').forEach(sel => sel.addEventListener('change', () => set({ [sel.dataset.key]: sel.dataset.num ? Number(sel.value) : sel.value })));
$$('input[type=checkbox][data-key]').forEach(c => c.addEventListener('change', () => set({ [c.dataset.key]: c.checked })));
$('#display').addEventListener('change', (e) => set({ displayId: e.target.value ? Number(e.target.value) : null }));
$('#scale').addEventListener('input', (e) => { $('#scaleV').textContent = e.target.value + '%'; set({ deckScale: Number(e.target.value) / 100 }); });
$('#opacity').addEventListener('input', (e) => { $('#opacityV').textContent = e.target.value + '%'; set({ opacity: Number(e.target.value) / 100 }); });
$$('input[name=drm]').forEach(r => r.addEventListener('change', () => set({ defaultRemindMode: r.value })));

// shortcut recorder
let rec = null;
function accel(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (!parts.length) return '';
  let key = k.length === 1 ? k.toUpperCase() : k;
  const map = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', '+': 'Plus' };
  key = map[k] || map[key] || key;
  if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  return [...parts, key].join('+');
}
$$('.key[data-sc]').forEach(k => {
  k.addEventListener('click', async () => {
    if (rec) return;
    rec = k;
    k.classList.add('rec');
    k.textContent = '请按下组合键…';
    await window.api.pauseShortcuts(true);
  });
  k.addEventListener('keydown', async (e) => {
    if (rec !== k) return;
    e.preventDefault();
    if (e.key === 'Escape') return stop();
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey) { await stop(''); return; }
    const a = accel(e);
    if (a === null) return;
    if (a === '') { k.textContent = '需要包含 Ctrl / Alt / Shift'; return; }
    await stop(a);
  });
  k.addEventListener('blur', () => { if (rec === k) stop(); });
});
async function stop(value) {
  const k = rec;
  rec = null;
  if (!k) return;
  k.classList.remove('rec');
  if (value !== undefined) {
    await set({ shortcuts: { [k.dataset.sc]: value } });
    if (value) msg('已设为 ' + value);
  } else {
    await window.api.pauseShortcuts(false);
  }
  fill();
}

$('#openDir').onclick = () => window.api.openDataDir();
$('#backup').onclick = async () => { await window.api.backupNow(); msg('已备份到 backups 文件夹'); };
$('#export').onclick = () => window.api.exportMarkdown(null);

// nav highlight
const secs = ['general', 'look', 'remind', 'keys', 'data', 'update'];
$('main').addEventListener('scroll', () => {
  const m = $('main');
  let cur = secs[0];
  for (const id of secs) if (document.getElementById(id).offsetTop - m.scrollTop < 120) cur = id;
  $$('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur));
});

function showUpdate(st) {
  if (!st) return;
  $('#upMsg').textContent = st.message || (st.state === 'idle' ? '会在启动后自动检查' : '—');
  $('#upInstall').style.display = st.state === 'ready' ? '' : 'none';
  $('#upCheck').disabled = st.state === 'checking' || st.state === 'downloading' || st.state === 'dev';
}
$('#upCheck').onclick = async () => showUpdate(await window.api.checkUpdate());
$('#upInstall').onclick = () => window.api.installUpdate();
window.api.on('update:status', showUpdate);
window.api.on('settings:changed', (n) => { s = n; fill(); });
(async () => {
  const d = await window.api.init();
  s = d.settings;
  $('#display').innerHTML = '<option value="">主显示器</option>' + d.displays.map(x => `<option value="${x.id}">${EN.esc(x.label)}</option>`).join('');
  $('#dataDir').textContent = d.dataDir;
  $('#ver').textContent = d.version;
  showUpdate(await window.api.updateStatus());
  fill();
})();
