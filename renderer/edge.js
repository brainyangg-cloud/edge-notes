'use strict';
/* Edge window: strip → fanned deck → open note. */
const $ = (s, r = document) => r.querySelector(s);
const { esc, fmtTime, stats, textOf, firstImage, fixImages, quickPicks, toLocalInput, COLORS } = EN;

let notes = [];
let settings = {};
let imgBase = '';
let state = 'rest';          // rest | fan | open
let openId = null;
let overHit = false;
let sticky = false;          // opened by keyboard/tray: don't collapse on mouse-out until blur
let hoverTimer = 0, leaveTimer = 0, previewTimer = 0, saveTimer = 0, titleTimer = 0, cardTimer = 0, toastTimer = 0;
let pendingSave = false;
let drag = null;
let tabTops = {};            // id -> top px (for panel placement)
let lastDeleted = null;
const MAX_TABS = 5;

const body = document.body;
const strip = $('#strip'), deck = $('#deck'), addBtn = $('#addBtn'), preview = $('#preview');
const panel = $('#panel'), gutter = $('#gutter'), titleEl = $('#title'), editor = $('#editor');
const menu = $('#menu'), alarmPop = $('#alarmPop');

const active = () => notes.filter(n => !n.archived).sort((a, b) => a.order - b.order);
const byId = (id) => notes.find(n => n.id === id);
const H = () => window.innerHeight;
const anchorY = () => Math.round(H() * 0.38);
const S = () => Number(settings.deckScale) || 1;

// ---------------- hit testing / mouse pass-through ----------------
function setOver(v) {
  if (v === overHit) return;
  overHit = v;
  window.api.setIgnore(!v);
  if (v) {
    clearTimeout(leaveTimer);
  } else {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(onLeave, Number(settings.leaveDelay) || 600);
  }
}
document.addEventListener('mousemove', (e) => {
  if (drag) return;
  const hit = !!e.target.closest('.hit');
  setOver(hit);
  if (hit && state === 'rest' && e.target.closest('#strip')) {
    if (!hoverTimer) hoverTimer = setTimeout(() => { hoverTimer = 0; if (overHit) setState('fan'); }, Number(settings.hoverDelay) || 150);
  }
});
document.addEventListener('mouseleave', () => { if (!drag) setOver(false); });

function onLeave() {
  if (overHit || sticky || drag) return;
  hidePreview();
  if (menu.style.display !== 'none') return;
  if (state === 'fan') setState('rest');
  else if (state === 'open' && !document.hasFocus() && !(byId(openId) || {}).pinned) setState('rest');
}

window.api.on('edge:blur', () => {
  sticky = false;
  hideMenu();
  if (state === 'open' && (byId(openId) || {}).pinned) return;
  if (state !== 'rest') { flushSave(); setState('rest'); }
});

// ---------------- state ----------------
function setState(s) {
  if (s === 'rest' && settings.keepOpen) s = 'fan';
  if (s !== 'open' && state === 'open') { flushSave(); closePops(); openId = null; }
  state = s;
  body.classList.remove('st-rest', 'st-fan', 'st-open');
  body.classList.add('st-' + s);
  if (s !== 'fan') hidePreview();
  if (s === 'open') requestAnimationFrame(() => panel.classList.add('in'));
  else panel.classList.remove('in');
  if (s !== 'rest') hideHint();
  renderDeck();
}

// ---------------- render ----------------
function render() {
  body.classList.toggle('left', settings.dock === 'left');
  body.classList.toggle('chips', settings.deckStyle === 'chips');
  body.style.setProperty('--alpha', String(settings.opacity ?? 0.82));
  body.style.setProperty('--s', String(S()));
  renderStrip();
  renderDeck();
  if (state === 'open') {
    const n = byId(openId);
    if (!n || n.archived) setState(overHit ? 'fan' : 'rest');
    else renderPanelChrome(n);
  }
}

function renderStrip() {
  const list = active();
  const shown = list.slice(0, 8);
  const h = Math.max(60, Math.min(200, shown.length * 23 + 18));
  strip.style.height = h + 'px';
  strip.style.top = (anchorY() - h / 2) + 'px';
  strip.innerHTML = shown.map(n => `<i style="background:rgb(var(--c-${n.color}))"></i>`).join('') || '<i style="background:rgba(255,255,255,.6)"></i>';
  strip.classList.toggle('glow', list.some(n => n.due));
  strip.setAttribute('aria-label', `${list.length} 张便签，鼠标移入展开`);
}

// stacked vertical label (works with any font, CJK stays upright)
function vlabel(text, tabH) {
  const chars = [...(text || '无标题')];
  const max = Math.max(2, Math.floor((tabH - 34 * S()) / (13 * S() * 1.18)));
  const shown = chars.length > max ? chars.slice(0, max - 1).concat('⋮') : chars;
  return shown.map(c => `<i>${c === ' ' ? '&nbsp;' : esc(c)}</i>`).join('');
}
function deckMetrics(n, hasMore) {
  const s = S();
  if (settings.deckStyle === 'chips') return { lap: 32 * s, tabH: 26 * s, moreH: 26 * s, tabW: 30 * s };
  const list = active().slice(0, MAX_TABS);
  const longest = Math.max(2, ...list.map(x => [...(x.title || '无标题')].length));
  let lap = Math.min(150, Math.max(64, Math.min(longest, 9) * 15.5 + 26)) * s;
  const tabH = 190 * s;
  const slots = (n - 1) + (hasMore ? 1 : 0);
  const room = H() - 140 - tabH;
  if (slots > 0 && lap * slots > room) lap = Math.max(36 * s, room / slots);
  return { lap, tabH, moreH: 52 * s, tabW: 56 * s };
}

function renderDeck() {
  if (drag) return;
  const list = active();
  const vis = list.slice(0, MAX_TABS);
  const hasMore = list.length > MAX_TABS;
  const m = deckMetrics(vis.length, hasMore);
  const total = (vis.length ? (vis.length - 1) * m.lap + m.tabH : 0) + (hasMore ? m.moreH : 0);
  const top0 = Math.max(12, Math.min(H() - total - 70, anchorY() - Math.min(total, 260) / 2));
  tabTops = {};
  let html = '';
  vis.forEach((n, i) => {
    const top = top0 + i * m.lap;
    tabTops[n.id] = top;
    html += `<button class="tab hit${n.due ? ' due' : ''}${n.id === openId && state === 'open' ? ' active' : ''}" data-id="${n.id}" style="--tc:var(--c-${n.color});top:${top}px;z-index:${i + 1};transition-delay:${i * 40}ms" title="${esc(n.title || '无标题')}" aria-label="${esc(n.title || '无标题')}">` +
      `${n.due ? '<span class="dot"></span>' : ''}<span class="lbl">${vlabel(n.title, m.tabH)}</span>` +
      `${n.pinned ? '<svg class="pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 6 4 3H6l4-3z"/><path d="M12 13v7"/></svg>' : ''}</button>`;
  });
  let bottom = vis.length ? top0 + (vis.length - 1) * m.lap + m.tabH : top0;
  if (hasMore) {
    const top = vis.length ? top0 + vis.length * m.lap : top0;
    html += `<button class="tab more hit" data-more="1" style="top:${top}px;z-index:${vis.length + 1};transition-delay:${vis.length * 40}ms" title="全部便签" aria-label="还有 ${list.length - vis.length} 张，打开全部便签">+${list.length - vis.length}</button>`;
    bottom = Math.max(bottom, top + m.moreH);
  }
  deck.innerHTML = html;
  addBtn.style.top = Math.min(H() - 56, bottom + 12) + 'px';
}

// ---------------- tabs: hover preview, click, drag, context menu ----------------
deck.addEventListener('mouseover', (e) => {
  const t = e.target.closest('.tab[data-id]');
  if (!t || state !== 'fan' || drag) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => showPreview(t.dataset.id), 320);
});
deck.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.tab')) { clearTimeout(previewTimer); hidePreview(); }
});

function showPreview(id) {
  const n = byId(id);
  if (!n || state !== 'fan') return;
  const st = stats(n);
  const img = firstImage(n);
  const meta = [];
  if (n.remindAt) meta.push('提醒 ' + fmtTime(n.remindAt));
  if (st.tasks) meta.push(`清单 ${st.done}/${st.tasks}`);
  if (st.imgs) meta.push(`${st.imgs} 张图片`);
  preview.innerHTML = `<b>${esc(n.title || '无标题')}</b>` +
    (img ? `<img src="${imgBase + encodeURIComponent(img)}" alt="">` : '') +
    `<div class="pv-text">${esc(textOf(n.html).slice(0, 140)) || '（空白）'}</div>` +
    (meta.length ? `<div class="pv-meta">${esc(meta.join(' · '))}</div>` : '');
  const tabW = settings.deckStyle === 'chips' ? 30 * S() : 56 * S();
  const top = Math.max(10, Math.min(H() - 220, tabTops[id] || anchorY()));
  preview.style.top = top + 'px';
  if (settings.dock === 'left') { preview.style.left = (tabW + 12) + 'px'; preview.style.right = 'auto'; }
  else { preview.style.right = (tabW + 12) + 'px'; preview.style.left = 'auto'; }
  preview.classList.add('show');
}
function hidePreview() { clearTimeout(previewTimer); preview.classList.remove('show'); }

deck.addEventListener('mousedown', (e) => {
  const t = e.target.closest('.tab');
  if (!t || e.button !== 0) return;
  if (t.dataset.more) return;
  e.preventDefault();
  drag = { id: t.dataset.id, el: t, y0: e.clientY, top0: parseFloat(t.style.top), moved: false };
});
document.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dy) < 6) return;
  if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); hidePreview(); }
  drag.el.style.top = (drag.top0 + dy) + 'px';
});
document.addEventListener('mouseup', async (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) { openNote(d.id); return; }
  d.el.classList.remove('dragging');
  const list = active();
  const vis = list.slice(0, MAX_TABS);
  const m = deckMetrics(vis.length, list.length > MAX_TABS);
  const tops = vis.map(n => tabTops[n.id]);
  const y = parseFloat(d.el.style.top);
  let idx = tops.findIndex(t => y < t + m.lap / 2);
  if (idx < 0) idx = vis.length - 1;
  const ids = list.map(n => n.id).filter(id => id !== d.id);
  ids.splice(idx, 0, d.id);
  await window.api.reorder(ids);
  setOver(!!(e.target.closest && e.target.closest('.hit')));
});
deck.addEventListener('click', (e) => {
  const t = e.target.closest('.tab[data-more]');
  if (t) window.api.openManager('notes');
});
deck.addEventListener('keydown', (e) => {
  const t = e.target.closest('.tab[data-id]');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openNote(t.dataset.id, { focus: true }); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const tabs = [...deck.querySelectorAll('.tab')];
    const i = tabs.indexOf(document.activeElement);
    const next = tabs[(i + (e.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length];
    if (next) { e.preventDefault(); next.focus(); }
  }
});
deck.addEventListener('contextmenu', (e) => {
  const t = e.target.closest('.tab[data-id]');
  if (!t) return;
  e.preventDefault();
  showNoteMenu(t.dataset.id, e.clientX, e.clientY, true);
});
addBtn.addEventListener('click', async () => {
  const n = await window.api.createNote({ title: '新便签' });
  notes.push(n);
  openNote(n.id, { focus: true, selectTitle: true });
});

// ---------------- menus ----------------
function showMenu(html, x, y) {
  menu.innerHTML = html;
  menu.style.display = 'flex';
  const r = menu.getBoundingClientRect();
  let left = settings.dock === 'left' ? x + 4 : x - r.width - 4;
  left = Math.max(6, Math.min(window.innerWidth - r.width - 6, left));
  const top = Math.max(6, Math.min(H() - r.height - 6, y - 10));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}
function hideMenu() { menu.style.display = 'none'; menu.innerHTML = ''; }
document.addEventListener('mousedown', (e) => {
  if (menu.style.display !== 'none' && !e.target.closest('#menu')) hideMenu();
  if (alarmPop.classList.contains('show') && !e.target.closest('#alarmPop') && !e.target.closest('#bAlarm') && !e.target.closest('.chip.alarm')) closePops();
}, true);

function showNoteMenu(id, x, y, fromTab) {
  const n = byId(id);
  if (!n) return;
  const sw = COLORS.map(c => `<button class="sw${n.color === c ? ' on' : ''}" data-color="${c}" style="background:rgb(var(--c-${c}))" aria-label="${EN.COLOR_NAMES[c]}"></button>`).join('');
  showMenu(`<div class="swatches">${sw}</div><div class="sep"></div>` +
    (fromTab ? `<button class="mi" data-act="open">打开</button><button class="mi" data-act="rename">重命名<span class="k">F2</span></button>` : '') +
    `<button class="mi" data-act="pin">${n.pinned ? '取消钉住' : '钉住（不自动收起）'}<span class="k">Ctrl+P</span></button>` +
    `<button class="mi" data-act="top">移到最上面</button>` +
    `<button class="mi" data-act="alarm">设置提醒…</button>` +
    `<button class="mi" data-act="export">导出为 Markdown</button>` +
    `<div class="sep"></div>` +
    `<button class="mi" data-act="archive">归档<span class="k">Ctrl+Shift+A</span></button>` +
    `<button class="mi danger" data-act="delete">删除<span class="k">Ctrl+Del</span></button>` +
    (fromTab ? '' : `<div class="sep"></div><button class="mi" data-act="all">全部便签</button><button class="mi" data-act="settings">设置</button>`), x, y);
  menu.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    hideMenu();
    if (b.dataset.color) return updateNote(id, { color: b.dataset.color });
    const act = b.dataset.act;
    if (act === 'open') openNote(id, { focus: true });
    else if (act === 'rename') openNote(id, { selectTitle: true });
    else if (act === 'pin') updateNote(id, { pinned: !n.pinned });
    else if (act === 'top') { const ids = active().map(x => x.id).filter(x => x !== id); ids.unshift(id); window.api.reorder(ids); }
    else if (act === 'alarm') { openNote(id); setTimeout(openAlarm, 60); }
    else if (act === 'export') window.api.exportMarkdown([id]);
    else if (act === 'archive') archiveNote(id);
    else if (act === 'delete') deleteNote(id);
    else if (act === 'all') window.api.openManager('notes');
    else if (act === 'settings') window.api.openSettings();
  };
}

// ---------------- note actions ----------------
async function updateNote(id, patch) {
  const n = byId(id);
  if (n) Object.assign(n, patch);
  render();
  await window.api.updateNote(id, patch);
}
async function archiveNote(id) {
  if (openId === id) setState(overHit ? 'fan' : 'rest');
  await updateNote(id, { archived: true, due: false });
  showToast(`已归档“${(byId(id) || {}).title || '便签'}”`, async () => { await updateNote(id, { archived: false }); });
}
async function deleteNote(id) {
  if (openId === id) { clearTimeout(saveTimer); pendingSave = false; setState(overHit ? 'fan' : 'rest'); }
  const n = await window.api.deleteNote(id);
  if (!n) return;
  lastDeleted = n;
  notes = notes.filter(x => x.id !== id);
  render();
  showToast(`已删除“${n.title || '便签'}”`, async () => { if (lastDeleted) { await window.api.restoreNote(lastDeleted); lastDeleted = null; } });
}
function showToast(text, undo) {
  const t = $('#toast');
  t.querySelector('span').textContent = text;
  const btn = t.querySelector('button');
  let left = 10;
  btn.textContent = `撤销 (${left})`;
  btn.onclick = () => { undo(); t.classList.remove('show'); clearInterval(toastTimer); };
  t.classList.add('show');
  clearInterval(toastTimer);
  toastTimer = setInterval(() => {
    left -= 1;
    btn.textContent = `撤销 (${left})`;
    if (left <= 0) { clearInterval(toastTimer); t.classList.remove('show'); }
  }, 1000);
}

// ---------------- open note ----------------
function openNote(id, opts = {}) {
  const n = byId(id);
  if (!n) return;
  if (state === 'open' && openId !== id) flushSave();
  hidePreview();
  hideMenu();
  closePops();
  openId = id;
  setState('open');
  const h = Math.min(580, H() - 40);
  const top = Math.max(16, Math.min(H() - h - 16, (tabTops[id] ?? anchorY() - 120) - 24));
  panel.style.height = h + 'px';
  panel.style.top = top + 'px';
  titleEl.value = n.title || '';
  editor.innerHTML = n.html || '';
  fixImages(editor, imgBase);
  renderPanelChrome(n);
  $('#saved').textContent = '';
  if (opts.external) { window.api.focusEdge(); sticky = true; }
  if (opts.selectTitle) setTimeout(() => { titleEl.focus(); titleEl.select(); }, 30);
  else if (opts.focus) setTimeout(() => focusEditorEnd(), 30);
}
function renderPanelChrome(n) {
  panel.style.setProperty('--tc', `var(--c-${n.color})`);
  panel.style.setProperty('--nc', `var(--n-${n.color})`);
  gutter.querySelector('.lbl').textContent = n.title || '无标题';
  if (document.activeElement !== titleEl && titleEl.value !== (n.title || '')) titleEl.value = n.title || '';
  $('#bPin').classList.toggle('on', !!n.pinned);
  $('#bAlarm').classList.toggle('alarm-on', !!n.remindAt);
  const chips = [];
  const alarmIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2"/></svg>';
  const rep = { daily: '每天', weekdays: '工作日', weekly: '每周', monthly: '每月' }[n.repeat];
  if (n.snoozeAt) chips.push(`<button class="chip alarm">${alarmIcon}稍后 ${esc(fmtTime(n.snoozeAt))}</button>`);
  if (n.remindAt) chips.push(`<button class="chip alarm">${alarmIcon}${esc(fmtTime(n.remindAt))}${rep ? ' · ' + rep : ''}</button>`);
  if (n.pinned) chips.push('<span class="chip soft">已钉住</span>');
  $('#chipRow').innerHTML = chips.join('');
  const due = $('#dueBar');
  due.classList.toggle('show', !!n.due);
  if (n.due) due.querySelector('.grow').textContent = `提醒到了 · ${fmtTime(n.dueAt || Date.now())}`;
  // reload content if changed elsewhere and user isn't typing
  if (!pendingSave && document.activeElement !== editor && editorHtml() !== (n.html || '')) {
    editor.innerHTML = n.html || '';
    fixImages(editor, imgBase);
  }
}
$('#chipRow').addEventListener('click', (e) => { if (e.target.closest('.chip.alarm')) openAlarm(); });
gutter.addEventListener('click', () => setState(overHit ? 'fan' : 'rest'));
function focusEditorEnd() {
  editor.focus();
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

// ---------------- saving ----------------
function editorHtml() {
  const c = editor.cloneNode(true);
  c.querySelectorAll('img[data-img]').forEach(i => { i.removeAttribute('src'); i.classList.remove('sel'); i.removeAttribute('class'); i.removeAttribute('draggable'); });
  return c.innerHTML.replace(/ draggable="false"/g, '');
}
function scheduleSave() {
  pendingSave = true;
  $('#saved').textContent = '';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}
function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingSave || !openId) { pendingSave = false; return; }
  pendingSave = false;
  const html = editorHtml();
  const n = byId(openId);
  if (n) n.html = html;
  window.api.updateNote(openId, { html });
  $('#saved').textContent = '已保存';
}
editor.addEventListener('input', scheduleSave);
titleEl.addEventListener('input', () => {
  const id = openId;
  const v = titleEl.value;
  gutter.querySelector('.lbl').textContent = v || '无标题';
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => updateNote(id, { title: v.trim() }), 400);
});
titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusEditorEnd(); } });

// ---------------- editor: blocks, tasks ----------------
document.execCommand('defaultParagraphSeparator', false, 'div');
function currentBlock() {
  const s = getSelection();
  if (!s.rangeCount) return null;
  let node = s.anchorNode;
  if (!node || !editor.contains(node)) return null;
  if (node === editor) {
    node = editor.childNodes[s.anchorOffset] || editor.lastChild;
    if (!node) return null;
  }
  while (node && node.parentNode !== editor) node = node.parentNode;
  if (node && node.nodeType === 3) {
    const div = document.createElement('div');
    node.replaceWith(div);
    div.appendChild(node);
    const r = document.createRange(); r.setStart(node, Math.min(s.anchorOffset, node.length)); r.collapse(true);
    s.removeAllRanges(); s.addRange(r);
    node = div;
  }
  return node;
}
function makeCb() { const cb = document.createElement('span'); cb.className = 'cb'; cb.contentEditable = 'false'; return cb; }
function caretAfterCb(block) {
  const r = document.createRange();
  const idx = [...block.childNodes].indexOf(block.querySelector('.cb')) + 1;
  r.setStart(block, idx); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function toggleTask() {
  if (document.activeElement !== editor) focusEditorEnd();
  let b = currentBlock();
  if (!b) {
    b = document.createElement('div');
    b.appendChild(document.createElement('br'));
    editor.appendChild(b);
  }
  if (b.tagName === 'IMG') { const d = document.createElement('div'); d.appendChild(document.createElement('br')); b.after(d); b = d; }
  if (b.classList && b.classList.contains('task')) {
    b.classList.remove('task'); b.removeAttribute('data-done'); b.removeAttribute('class');
    b.querySelectorAll('.cb').forEach(x => x.remove());
    if (!b.textContent && !b.querySelector('br,img')) b.appendChild(document.createElement('br'));
  } else {
    b.classList.add('task'); b.dataset.done = '0';
    b.prepend(makeCb());
    caretAfterCb(b);
  }
  scheduleSave();
}
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    const b = currentBlock();
    if (b && b.classList && b.classList.contains('task')) {
      e.preventDefault();
      const textOnly = b.textContent.trim();
      if (!textOnly) { toggleTask(); return; }
      const s = getSelection(); const r = s.getRangeAt(0); r.deleteContents();
      const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(b, b.childNodes.length);
      const frag = tail.extractContents();
      const nb = document.createElement('div'); nb.className = 'task'; nb.dataset.done = '0';
      nb.appendChild(makeCb()); nb.appendChild(frag);
      nb.querySelectorAll('.cb').forEach((x, i) => { if (i > 0) x.remove(); });
      if (!nb.textContent) nb.appendChild(document.createElement('br'));
      if (!b.textContent.trim() && !b.querySelector('br')) b.appendChild(document.createElement('br'));
      b.after(nb);
      caretAfterCb(nb);
      scheduleSave();
    }
  } else if (e.key === 'Backspace') {
    const b = currentBlock();
    const s = getSelection();
    if (b && b.classList && b.classList.contains('task') && s.isCollapsed) {
      const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
      if (!r.toString().length) { e.preventDefault(); toggleTask(); }
    }
  }
});
editor.addEventListener('mousedown', (e) => {
  if (e.target.classList && e.target.classList.contains('cb')) {
    e.preventDefault();
    const t = e.target.parentElement;
    t.dataset.done = t.dataset.done === '1' ? '0' : '1';
    scheduleSave();
  }
  editor.querySelectorAll('img.sel').forEach(i => i.classList.remove('sel'));
  if (e.target.tagName === 'IMG') e.target.classList.add('sel');
});

// ---------------- images ----------------
async function insertImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = await window.api.saveImage(buf, (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'));
  insertImage(name);
}
function insertImage(name) {
  if (document.activeElement !== editor) focusEditorEnd();
  const html = `<img data-img="${esc(name)}" src="${imgBase + encodeURIComponent(name)}" alt="图片"><div><br></div>`;
  document.execCommand('insertHTML', false, html);
  fixImages(editor, imgBase);
  scheduleSave();
}
editor.addEventListener('paste', async (e) => {
  const items = [...(e.clipboardData ? e.clipboardData.items : [])];
  const imgs = items.filter(i => i.kind === 'file' && i.type.startsWith('image/'));
  e.preventDefault();
  if (imgs.length) { for (const it of imgs) await insertImageFile(it.getAsFile()); return; }
  const text = e.clipboardData.getData('text/plain');
  if (text) document.execCommand('insertText', false, text);
});
editor.addEventListener('dragover', (e) => e.preventDefault());
editor.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) await insertImageFile(f);
});
$('#bImg').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  for (const f of e.target.files) await insertImageFile(f);
  e.target.value = '';
});
editor.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'IMG' && e.target.dataset.img) window.api.openViewer(openId, e.target.dataset.img);
});
editor.addEventListener('contextmenu', (e) => {
  const img = e.target.closest('img[data-img]');
  if (!img) return;
  e.preventDefault();
  showMenu(`<button class="mi" data-a="view">查看大图</button><button class="mi" data-a="copy">复制图片</button><button class="mi" data-a="save">另存为…</button><div class="sep"></div><button class="mi danger" data-a="del">删除图片</button>`, e.clientX, e.clientY);
  menu.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    hideMenu();
    const a = b.dataset.a;
    if (a === 'view') window.api.openViewer(openId, img.dataset.img);
    else if (a === 'copy') { window.api.copyImage(img.dataset.img); flash('图片已复制'); }
    else if (a === 'save') window.api.saveImageAs(img.dataset.img);
    else if (a === 'del') { img.remove(); scheduleSave(); }
  };
});

// ---------------- header buttons & shortcuts ----------------
$('#bTask').addEventListener('click', toggleTask);
$('#bPin').addEventListener('click', () => { const n = byId(openId); if (n) updateNote(n.id, { pinned: !n.pinned }); });
$('#bMore').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); showNoteMenu(openId, settings.dock === 'left' ? r.left : r.right, r.bottom + 4, false); });
$('#bAlarm').addEventListener('click', () => (alarmPop.classList.contains('show') ? closePops() : openAlarm()));
$('#dueSnooze').addEventListener('click', () => snooze(openId));
$('#dueDone').addEventListener('click', () => doneRemind(openId));

document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'Escape') {
    if (menu.style.display !== 'none') return hideMenu();
    if (alarmPop.classList.contains('show')) return closePops();
    if (state === 'open') { flushSave(); setState(overHit ? 'fan' : (sticky ? 'fan' : 'rest')); if (sticky) focusFirstTab(); return; }
    sticky = false;
    if (state === 'fan') setState('rest');
    return;
  }
  if (state !== 'open') return;
  if (e.ctrlKey && !e.shiftKey && (k === 't' || k === 'T')) { e.preventDefault(); toggleTask(); }
  else if (e.ctrlKey && k === '.') { e.preventDefault(); const n = byId(openId); const c = COLORS[(COLORS.indexOf(n.color) + 1) % COLORS.length]; updateNote(n.id, { color: c }); }
  else if (e.ctrlKey && !e.shiftKey && (k === 'p' || k === 'P')) { e.preventDefault(); const n = byId(openId); updateNote(n.id, { pinned: !n.pinned }); }
  else if (e.ctrlKey && k === 'Delete') { e.preventDefault(); deleteNote(openId); }
  else if (e.ctrlKey && e.shiftKey && (k === 'a' || k === 'A')) { e.preventDefault(); archiveNote(openId); }
  else if (k === 'F2') { e.preventDefault(); titleEl.focus(); titleEl.select(); }
});
function focusFirstTab() { const t = deck.querySelector('.tab'); if (t) t.focus(); }

// ---------------- reminder popover ----------------
let popRepeat = 'none';
function openAlarm() {
  const n = byId(openId);
  if (!n) return;
  hideMenu();
  const base = n.remindAt || (() => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return d.getTime(); })();
  $('#dt').value = toLocalInput(base);
  $('#dt').min = toLocalInput(Date.now());
  popRepeat = n.repeat || 'none';
  $('#picks').innerHTML = quickPicks().map(p => `<button class="q" data-at="${p.at}">${esc(p.label)}</button>`).join('');
  markPick();
  alarmPop.querySelectorAll('#repeat button').forEach(b => b.classList.toggle('on', b.dataset.v === popRepeat));
  const mode = n.remindMode || settings.defaultRemindMode || 'notify';
  alarmPop.querySelectorAll('input[name=mode]').forEach(r => { r.checked = r.value === mode; });
  $('#alarmRemove').style.display = n.remindAt ? '' : 'none';
  const pr = panel.getBoundingClientRect();
  alarmPop.style.top = '52px';
  if (settings.dock === 'left') { alarmPop.style.left = '70px'; alarmPop.style.right = 'auto'; }
  else { alarmPop.style.right = '20px'; alarmPop.style.left = 'auto'; }
  alarmPop.style.maxHeight = (pr.height - 60) + 'px';
  alarmPop.classList.add('show');
}
function markPick() {
  const v = new Date($('#dt').value).getTime();
  $('#picks').querySelectorAll('.q').forEach(b => b.classList.toggle('on', Math.abs(Number(b.dataset.at) - v) < 60000));
}
$('#picks').addEventListener('click', (e) => {
  const b = e.target.closest('.q');
  if (!b) return;
  $('#dt').value = toLocalInput(Number(b.dataset.at));
  markPick();
});
$('#dt').addEventListener('input', markPick);
$('#repeat').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  popRepeat = b.dataset.v;
  $('#repeat').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
});
$('#alarmCancel').addEventListener('click', closePops);
$('#alarmRemove').addEventListener('click', () => { updateNote(openId, { remindAt: null, repeat: 'none', due: false, snoozeAt: null }); closePops(); });
$('#alarmSave').addEventListener('click', () => {
  const at = new Date($('#dt').value).getTime();
  if (!at || at <= Date.now()) { $('#dt').focus(); $('#dt').style.borderBottomColor = '#c42b1c'; return; }
  $('#dt').style.borderBottomColor = '';
  const mode = (alarmPop.querySelector('input[name=mode]:checked') || {}).value || 'notify';
  updateNote(openId, { remindAt: at, repeat: popRepeat, remindMode: mode, due: false, snoozeAt: null });
  closePops();
  flash('提醒已设好：' + fmtTime(at));
});
function closePops() { alarmPop.classList.remove('show'); }

// ---------------- reminders fired ----------------
function snooze(id) {
  updateNote(id, { due: false, snoozeAt: Date.now() + 10 * 60000 });
  hideCard();
}
function doneRemind(id) {
  updateNote(id, { due: false, snoozeAt: null });
  hideCard();
}
let cardId = null;
function showCard(id) {
  const n = byId(id);
  if (!n) return;
  if (state === 'open' && openId === id) return; // the due bar shows it
  cardId = id;
  const c = $('#remindCard');
  c.querySelector('.rc-time').textContent = '提醒 · ' + fmtTime(n.dueAt || Date.now()).replace(/^今天 /, '');
  c.querySelector('.rc-t').textContent = n.title || '便签';
  c.querySelector('.rc-b').textContent = textOf(n.html).slice(0, 120);
  c.style.top = Math.max(12, anchorY() - 70) + 'px';
  c.classList.add('show');
  clearTimeout(cardTimer);
  if (n.remindMode !== 'loud') cardTimer = setTimeout(hideCard, 15000);
}
function hideCard() { $('#remindCard').classList.remove('show'); cardId = null; }
$('#rcClose').addEventListener('click', hideCard);
$('#rcSnooze').addEventListener('click', () => cardId && snooze(cardId));
$('#rcDone').addEventListener('click', () => cardId && doneRemind(cardId));
$('#rcOpen').addEventListener('click', () => { const id = cardId; hideCard(); if (id) openNote(id, { focus: true }); });

// ---------------- misc ----------------
function flash(text) {
  const f = $('#flash');
  f.textContent = text;
  f.style.top = (anchorY() + 110) + 'px';
  f.classList.add('show');
  clearTimeout(f._t);
  f._t = setTimeout(() => f.classList.remove('show'), 2200);
}
function showHint() {
  const h = $('#hint');
  h.style.top = (anchorY() - 30) + 'px';
  h.classList.add('show');
  clearTimeout(h._t);
  h._t = setTimeout(hideHint, 9000);
}
function hideHint() { $('#hint').classList.remove('show'); }
$('#hint').addEventListener('click', () => { hideHint(); setState('fan'); });

// ---------------- IPC from main ----------------
window.api.on('notes:changed', (list) => { notes = list; render(); });
window.api.on('settings:changed', (s) => { settings = s; render(); });
window.api.on('edge:toggle', () => {
  if (state === 'rest' || (settings.keepOpen && state === 'fan' && !sticky)) {
    sticky = true; setState('fan'); window.api.focusEdge(); setTimeout(focusFirstTab, 50);
  } else { sticky = false; setState('rest'); }
});
window.api.on('edge:open', (id) => { openNote(id, { focus: true, external: true, selectTitle: (byId(id) || {}).title === '新便签' }); });
window.api.on('edge:remind', (id) => { showCard(id); });
window.api.on('edge:flash', () => { flash('已记到便签里'); strip.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.15)' }, { transform: 'scaleY(1)' }], { duration: 400 }); });
window.api.on('edge:hint', showHint);
window.addEventListener('resize', render);

(async function init() {
  const d = await window.api.init();
  notes = d.notes; settings = d.settings; imgBase = d.imgBase;
  setState('rest');
  render();
  if (!settings.welcomed) setTimeout(showHint, 800);
})();
