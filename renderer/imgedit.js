'use strict';
/*
 * Image transform inside the note editor.
 * - click an image to select it: 8 handles (corners keep proportion, edges stretch freely, Shift on a corner = free)
 * - drag the image itself to place it anywhere in the note ("自由摆放", absolutely positioned)
 * - toolbar: 自由摆放 / 嵌入文字, inline alignment (左 / 中 / 右 / 文字环绕), 原始大小, 适应宽度, 置于顶层, 删除
 * - keyboard: Delete removes, arrows nudge a free image (Shift = 10px), Esc deselects
 * Layout lives in the <img> attributes (data-mode, data-align, style), so it is saved with the note.
 */
const imgLayer = document.getElementById('imgLayer');
const imgBox = document.getElementById('imgBox');
const imgBar = document.getElementById('imgBar');
const imgSize = document.getElementById('imgSize');
let selImg = null;
let imgRaf = 0;
const MIN = 24;
const PAD = 6; // layer outset so edge handles are not clipped

const isFree = (img) => img && img.dataset.mode === 'free';
const maxInlineW = () => Math.max(MIN, editor.clientWidth - 10);

function contentPos(img) {
  const er = editor.getBoundingClientRect();
  const r = img.getBoundingClientRect();
  return { x: r.left - er.left - editor.clientLeft + editor.scrollLeft, y: r.top - er.top - editor.clientTop + editor.scrollTop };
}

function selectImage(img) {
  if (selImg === img) return;
  deselectImage();
  selImg = img;
  imgLayer.style.display = 'block';
  imgBar.style.display = 'flex';
  syncBar();
  loop();
}
function deselectImage() {
  selImg = null;
  cancelAnimationFrame(imgRaf);
  imgLayer.style.display = 'none';
  imgBar.style.display = 'none';
}

function loop() {
  placeOverlay();
  if (selImg) imgRaf = requestAnimationFrame(loop);
}
function placeOverlay() {
  if (!selImg) return;
  if (!editor.contains(selImg) || state !== 'open') { deselectImage(); return; }
  const pr = panel.getBoundingClientRect();
  const er = editor.getBoundingClientRect();
  const r = selImg.getBoundingClientRect();
  const ox = pr.left + panel.clientLeft, oy = pr.top + panel.clientTop;
  imgLayer.style.left = (er.left - ox - PAD) + 'px';
  imgLayer.style.top = (er.top - oy - PAD) + 'px';
  imgLayer.style.width = (er.width + PAD * 2) + 'px';
  imgLayer.style.height = (er.height + PAD * 2) + 'px';
  imgBox.style.left = (r.left - er.left + PAD) + 'px';
  imgBox.style.top = (r.top - er.top + PAD) + 'px';
  imgBox.style.width = r.width + 'px';
  imgBox.style.height = r.height + 'px';
  imgSize.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
  // toolbar: above the image, else below, clamped inside the panel
  const visible = r.bottom > er.top && r.top < er.bottom;
  imgBar.style.visibility = visible ? 'visible' : 'hidden';
  const bw = imgBar.offsetWidth, bh = imgBar.offsetHeight;
  let top = Math.max(er.top, r.top) - oy - bh - 8;
  if (top < 4) top = Math.min(er.bottom, r.bottom) - oy + 8;
  top = Math.max(4, Math.min(panel.clientHeight - bh - 4, top));
  let left = r.left - ox + r.width / 2 - bw / 2;
  left = Math.max(4, Math.min(panel.clientWidth - bw - 4, left));
  imgBar.style.top = top + 'px';
  imgBar.style.left = left + 'px';
}

function syncBar() {
  if (!selImg) return;
  const free = isFree(selImg);
  imgBar.querySelector('[data-a=free]').classList.toggle('on', free);
  imgBar.querySelector('[data-a=inline]').classList.toggle('on', !free);
  imgBar.querySelectorAll('.inl').forEach(b => { b.style.display = free ? 'none' : ''; });
  imgBar.querySelectorAll('.frl').forEach(b => { b.style.display = free ? '' : 'none'; });
  const al = selImg.dataset.align || 'left';
  imgBar.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === al));
}

// ---------- mode changes ----------
function makeFree(img) {
  if (isFree(img)) return;
  const p = contentPos(img);
  const r = img.getBoundingClientRect();
  img.style.width = Math.round(r.width) + 'px';
  img.style.height = Math.round(r.height) + 'px';
  delete img.dataset.align;
  img.dataset.mode = 'free';
  editor.appendChild(img); // keep it out of task rows / text blocks
  img.style.left = Math.round(Math.max(0, p.x)) + 'px';
  img.style.top = Math.round(Math.max(0, p.y)) + 'px';
  bringToFront(img);
}
function makeInline(img) {
  if (!isFree(img)) return;
  const r = img.getBoundingClientRect();
  img.style.pointerEvents = 'none';
  const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(r.left + 4, r.top + 4) : null;
  img.style.pointerEvents = '';
  delete img.dataset.mode;
  img.style.left = ''; img.style.top = ''; img.style.zIndex = '';
  let block = range && range.startContainer;
  while (block && block !== editor && block.parentNode !== editor) block = block.parentNode;
  if (block && block !== editor && block !== img) editor.insertBefore(img, block);
  else editor.appendChild(img);
  const w = parseFloat(img.style.width) || r.width;
  if (w > maxInlineW()) { const k = maxInlineW() / w; img.style.width = maxInlineW() + 'px'; img.style.height = (parseFloat(img.style.height) || r.height) * k + 'px'; }
  if (!img.nextSibling) { const d = document.createElement('div'); d.appendChild(document.createElement('br')); editor.appendChild(d); }
}
function bringToFront(img) {
  const zs = [...editor.querySelectorAll('img[data-mode=free]')].map(i => Number(i.style.zIndex) || 1);
  img.style.zIndex = String(Math.max(1, ...zs) + 1);
}
function naturalSize(img) {
  let w = img.naturalWidth || 200, h = img.naturalHeight || 150;
  const max = maxInlineW();
  if (w > max) { h = h * max / w; w = max; }
  img.style.width = Math.round(w) + 'px';
  img.style.height = Math.round(h) + 'px';
  if (isFree(img)) img.style.left = Math.round(Math.max(0, Math.min(parseFloat(img.style.left) || 0, editor.clientWidth - w))) + 'px';
}
function fitWidth(img) {
  const w = maxInlineW();
  const r = img.getBoundingClientRect();
  img.style.width = w + 'px';
  img.style.height = Math.round(r.height * w / r.width) + 'px';
  if (isFree(img)) img.style.left = '0px';
}
function removeImage(img) {
  deselectImage();
  img.remove();
  scheduleSave();
}

// ---------- pointer: move & resize ----------
let op = null;
function startOp(e, kind, dir) {
  if (!selImg || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const img = selImg;
  if (kind === 'move' && !isFree(img)) { op = { kind: 'pending', x0: e.clientX, y0: e.clientY, pid: e.pointerId }; imgBox.setPointerCapture(e.pointerId); imgDragging = true; return; }
  const r = img.getBoundingClientRect();
  op = {
    kind, dir, x0: e.clientX, y0: e.clientY, pid: e.pointerId,
    w: r.width, h: r.height, ratio: r.width / r.height,
    left: parseFloat(img.style.left) || 0, top: parseFloat(img.style.top) || 0, moved: false
  };
  e.target.setPointerCapture(e.pointerId);
  imgDragging = true;
}
function onMove(e) {
  if (!op || !selImg) return;
  const img = selImg;
  const dx = e.clientX - op.x0, dy = e.clientY - op.y0;
  if (op.kind === 'pending') {
    if (Math.abs(dx) + Math.abs(dy) < 5) return;
    makeFree(img);
    syncBar();
    const r = img.getBoundingClientRect();
    op = { kind: 'move', x0: op.x0, y0: op.y0, pid: op.pid, w: r.width, h: r.height, left: parseFloat(img.style.left) || 0, top: parseFloat(img.style.top) || 0, moved: true };
    return;
  }
  op.moved = true;
  if (op.kind === 'move') {
    const maxL = Math.max(0, editor.clientWidth - op.w);
    img.style.left = Math.round(Math.max(0, Math.min(maxL, op.left + dx))) + 'px';
    img.style.top = Math.round(Math.max(0, op.top + dy)) + 'px';
    const er = editor.getBoundingClientRect();
    if (e.clientY > er.bottom - 16) editor.scrollTop += 12;
    else if (e.clientY < er.top + 16) editor.scrollTop -= 12;
    return;
  }
  // resize
  const d = op.dir;
  const free = isFree(img);
  const maxW = free ? Math.max(MIN, editor.clientWidth - (d.includes('w') ? 0 : op.left)) : maxInlineW();
  let w = op.w, h = op.h;
  const corner = d.length === 2;
  if (d.includes('e')) w = op.w + dx;
  if (d.includes('w')) w = op.w - dx;
  if (d.includes('s')) h = op.h + dy;
  if (d.includes('n')) h = op.h - dy;
  w = Math.max(MIN, Math.min(maxW, w));
  h = Math.max(MIN, h);
  if (corner && !e.shiftKey) {
    // keep proportion: follow whichever axis moved more
    if (Math.abs(dx) >= Math.abs(dy)) h = w / op.ratio; else { w = Math.min(maxW, h * op.ratio); h = w / op.ratio; }
  }
  img.style.width = Math.round(w) + 'px';
  img.style.height = Math.round(h) + 'px';
  if (free) {
    if (d.includes('w')) img.style.left = Math.round(op.left + (op.w - w)) + 'px';
    if (d.includes('n')) img.style.top = Math.round(Math.max(0, op.top + (op.h - h))) + 'px';
  }
}
function endOp() {
  if (!op) return;
  const changed = op.moved;
  op = null;
  imgDragging = false;
  if (changed) scheduleSave();
}
imgBox.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.ih');
  startOp(e, h ? 'resize' : 'move', h ? h.dataset.dir : null);
});
imgBox.addEventListener('pointermove', onMove);
imgBox.addEventListener('pointerup', endOp);
imgBox.addEventListener('pointercancel', endOp);
imgBox.addEventListener('lostpointercapture', endOp);
imgBox.addEventListener('dblclick', () => { if (selImg) window.api.openViewer(openId, selImg.dataset.img); });
imgBox.addEventListener('contextmenu', (e) => { if (selImg) { e.preventDefault(); imageMenu(selImg, e.clientX, e.clientY); } });
imgBox.addEventListener('wheel', (e) => { editor.scrollTop += e.deltaY; }, { passive: true });

// ---------- toolbar ----------
imgBar.addEventListener('mousedown', (e) => e.preventDefault());
imgBar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !selImg) return;
  const img = selImg;
  const a = b.dataset.a;
  if (a === 'free') makeFree(img);
  else if (a === 'inline') makeInline(img);
  else if (b.dataset.align) { if (b.dataset.align === 'left') delete img.dataset.align; else img.dataset.align = b.dataset.align; }
  else if (a === 'natural') naturalSize(img);
  else if (a === 'fit') fitWidth(img);
  else if (a === 'front') bringToFront(img);
  else if (a === 'view') window.api.openViewer(openId, img.dataset.img);
  else if (a === 'del') return removeImage(img);
  syncBar();
  scheduleSave();
});

function imageMenu(img, x, y) {
  const free = isFree(img);
  showMenu(`<button class="mi" data-a="view">查看大图</button><button class="mi" data-a="copy">复制图片</button><button class="mi" data-a="save">另存为…</button><div class="sep"></div>` +
    `<button class="mi" data-a="mode">${free ? '嵌入文字中' : '自由摆放'}</button><button class="mi" data-a="natural">原始大小</button><button class="mi" data-a="fit">适应宽度</button>` +
    `<div class="sep"></div><button class="mi danger" data-a="del">删除图片<span class="k">Del</span></button>`, x, y);
  menu.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    hideMenu();
    const a = b.dataset.a;
    if (a === 'view') window.api.openViewer(openId, img.dataset.img);
    else if (a === 'copy') { window.api.copyImage(img.dataset.img); flash('图片已复制'); }
    else if (a === 'save') window.api.saveImageAs(img.dataset.img);
    else if (a === 'del') removeImage(img);
    else {
      if (a === 'mode') (free ? makeInline : makeFree)(img);
      else if (a === 'natural') naturalSize(img);
      else if (a === 'fit') fitWidth(img);
      selectImage(img); syncBar(); scheduleSave();
    }
  };
}

// ---------- selection & keyboard ----------
editor.addEventListener('mousedown', (e) => {
  const img = e.target.closest && e.target.closest('img[data-img]');
  if (img) { e.preventDefault(); editor.blur(); selectImage(img); }
  else deselectImage();
}, true);
editor.addEventListener('contextmenu', (e) => {
  const img = e.target.closest('img[data-img]');
  if (!img) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  selectImage(img);
  imageMenu(img, e.clientX, e.clientY);
}, true);
document.addEventListener('mousedown', (e) => {
  if (!selImg) return;
  if (e.target.closest('#imgLayer') || e.target.closest('#imgBar') || e.target.closest('#menu') || e.target === selImg) return;
  if (e.target.closest('#editor')) return; // handled by the editor listener
  deselectImage();
}, true);
document.addEventListener('keydown', (e) => {
  if (!selImg || document.activeElement === titleEl) return;
  const img = selImg;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); deselectImage(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); removeImage(img); return; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && isFree(img)) {
    e.preventDefault(); e.stopImmediatePropagation();
    const step = e.shiftKey ? 10 : 1;
    img.style.left = Math.round((parseFloat(img.style.left) || 0) + arrows[e.key][0] * step) + 'px';
    img.style.top = Math.round(Math.max(0, (parseFloat(img.style.top) || 0) + arrows[e.key][1] * step)) + 'px';
    scheduleSave();
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey) deselectImage(); // typing goes back to text
}, true);
