'use strict';
/* Text formatting toolbar for the note editor (font, size, B/I/U/S, colors, lists, clear). */
const fmtBar = document.getElementById('fmtBar');
const bFmt = document.getElementById('bFmt');
const fFont = document.getElementById('fFont');
const fSize = document.getElementById('fSize');

const TEXT_COLORS = ['#1f1f1f', '#7a7a7a', '#d13438', '#ca5010', '#c19c00', '#107c10', '#0063b1', '#5c2d91', '#e3008c', '#ffffff'];
const HL_COLORS = ['transparent', '#fff100', '#ffb900', '#ff8c8c', '#9ff5a5', '#9fd8ff', '#d8b4fe', '#e0e0e0'];

document.execCommand('styleWithCSS', false, true);

function fmtOpen(on) {
  fmtBar.classList.toggle('show', on);
  bFmt.classList.toggle('on', on);
  try { localStorage.setItem('fmtBar', on ? '1' : '0'); } catch (e) { /* ignore */ }
}
try { if (localStorage.getItem('fmtBar') === '1') fmtOpen(true); } catch (e) { /* ignore */ }
bFmt.addEventListener('click', () => fmtOpen(!fmtBar.classList.contains('show')));

// buttons never take focus away from the text
fmtBar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

function exec(cmd, val) {
  restoreRange();
  document.execCommand(cmd, false, val);
  scheduleSave();
  syncFmt();
}

function applyFontSize(px) {
  restoreRange();
  const s = getSelection();
  if (!s.rangeCount) return;
  if (s.isCollapsed) {
    // caret only: start a sized span so the next typed text uses it
    const sp = document.createElement('span');
    sp.style.fontSize = px + 'px';
    sp.textContent = '​';
    const r = s.getRangeAt(0);
    r.insertNode(sp);
    const nr = document.createRange();
    nr.setStart(sp.firstChild, 1); nr.collapse(true);
    s.removeAllRanges(); s.addRange(nr);
  } else {
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach(f => {
      const sp = document.createElement('span');
      sp.style.fontSize = px + 'px';
      while (f.firstChild) sp.appendChild(f.firstChild);
      f.replaceWith(sp);
    });
    editor.querySelectorAll('span[style*="font-size"]').forEach(sp => {
      if (sp.style.fontSize === 'xxx-large' || sp.style.fontSize === '-webkit-xxx-large') sp.style.fontSize = px + 'px';
    });
  }
  scheduleSave();
  syncFmt();
}

fmtBar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.cmd) exec(b.dataset.cmd);
  else if (b.dataset.pick) {
    const r = b.getBoundingClientRect();
    const isHl = b.dataset.pick === 'hl';
    const list = isHl ? HL_COLORS : TEXT_COLORS;
    showMenu(`<div class="swatches" style="flex-wrap:wrap;width:208px">${list.map(c =>
      `<button class="sw" data-c="${c}" title="${c === 'transparent' ? '无' : c}" aria-label="${c === 'transparent' ? '无高亮' : c}" style="background:${c === 'transparent' ? 'linear-gradient(135deg,#fff 45%,#d13438 47%,#d13438 53%,#fff 55%)' : c};border:1px solid rgba(0,0,0,.15)"></button>`).join('')}</div>`,
    settings.dock === 'left' ? r.left : r.right, r.bottom + 4);
    menu.onmousedown = (ev) => ev.preventDefault();
    menu.onclick = (ev) => {
      const sw = ev.target.closest('[data-c]');
      if (!sw) return;
      hideMenu();
      menu.onmousedown = null;
      if (isHl) exec('hiliteColor', sw.dataset.c);
      else { exec('foreColor', sw.dataset.c); b.querySelector('i').style.background = sw.dataset.c; }
    };
  }
});
fFont.addEventListener('change', () => { exec('fontName', fFont.value || (settings.noteFont || 'inherit')); });
fSize.addEventListener('change', () => { if (fSize.value) applyFontSize(Number(fSize.value)); });

// reflect the formatting under the caret
function syncFmt() {
  if (!fmtBar.classList.contains('show')) return;
  ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach(c => {
    const b = fmtBar.querySelector(`[data-cmd="${c}"]`);
    if (b) { let on = false; try { on = document.queryCommandState(c); } catch (e) { /* ignore */ } b.classList.toggle('on', on); }
  });
  const s = getSelection();
  if (!s.rangeCount) return;
  let el = s.anchorNode;
  if (el && el.nodeType === 3) el = el.parentElement;
  if (!el || !editor.contains(el)) return;
  const cs = getComputedStyle(el);
  const px = Math.round(parseFloat(cs.fontSize));
  fSize.value = [...fSize.options].some(o => o.value === String(px)) ? String(px) : '';
  const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  const opt = [...fFont.options].find(o => o.value && o.value.split(',')[0].replace(/["']/g, '').trim() === fam);
  fFont.value = opt ? opt.value : '';
}

// Ctrl+B / I / U work natively; add Ctrl+Shift+X for strikethrough
editor.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); exec('strikeThrough'); }
});

// default note font from settings
function applyNoteFont() {
  editor.style.fontFamily = settings.noteFont || '';
  editor.style.fontSize = (Number(settings.noteFontSize) || 14) + 'px';
}
window.api.on('settings:changed', applyNoteFont);
setTimeout(applyNoteFont, 0);
