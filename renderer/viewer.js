'use strict';
const $ = (s) => document.querySelector(s);
let imgBase = '', list = [], idx = 0, scale = 1, tx = 0, ty = 0, note = null;
const img = $('#img'), stage = $('#stage');

function apply() { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; $('#zv').textContent = Math.round(scale * 100) + '%'; }
function fit() {
  const W = stage.clientWidth, H = stage.clientHeight - 140;
  const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
  scale = Math.min(1, (W - 160) / w, H / h);
  tx = (W - w * scale) / 2; ty = 60 + (H - h * scale) / 2;
  apply();
}
function zoomAt(f, cx, cy) {
  const ns = Math.max(0.05, Math.min(16, scale * f));
  tx = cx - (cx - tx) * (ns / scale); ty = cy - (cy - ty) * (ns / scale); scale = ns; apply();
}
function show(i) {
  if (!list.length) return;
  idx = (i + list.length) % list.length;
  img.onload = () => { fit(); $('#info').textContent = `${idx + 1} / ${list.length} · ${img.naturalWidth}×${img.naturalHeight}`; };
  img.src = imgBase + encodeURIComponent(list[idx]);
  $('#strip').innerHTML = list.length > 1 ? list.map((n, j) => `<img src="${imgBase + encodeURIComponent(n)}" data-i="${j}" class="${j === idx ? 'on' : ''}" alt="第 ${j + 1} 张">`).join('') : '';
  $('#prev').style.display = $('#next').style.display = list.length > 1 ? '' : 'none';
}
function msg(t) { const m = $('#msg'); m.textContent = t; m.style.display = 'block'; clearTimeout(m._t); m._t = setTimeout(() => { m.style.display = 'none'; }, 1800); }

stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
let d = null;
stage.addEventListener('mousedown', (e) => { d = { x: e.clientX - tx, y: e.clientY - ty }; stage.classList.add('drag'); });
window.addEventListener('mousemove', (e) => { if (d) { tx = e.clientX - d.x; ty = e.clientY - d.y; apply(); } });
window.addEventListener('mouseup', () => { d = null; stage.classList.remove('drag'); });
stage.addEventListener('dblclick', fit);
$('#zin').onclick = () => zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2);
$('#zout').onclick = () => zoomAt(0.8, stage.clientWidth / 2, stage.clientHeight / 2);
$('#fit').onclick = fit;
$('#one').onclick = () => { scale = 1; tx = (stage.clientWidth - img.naturalWidth) / 2; ty = (stage.clientHeight - img.naturalHeight) / 2; apply(); };
$('#copy').onclick = async () => { if (await window.api.copyImage(list[idx])) msg('已复制到剪贴板'); };
$('#save').onclick = () => window.api.saveImageAs(list[idx]);
$('#close').onclick = () => window.api.closeWindow();
$('#prev').onclick = () => show(idx - 1);
$('#next').onclick = () => show(idx + 1);
$('#strip').onclick = (e) => { const t = e.target.closest('img'); if (t) show(Number(t.dataset.i)); };
window.addEventListener('resize', fit);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeWindow();
  else if (e.key === 'ArrowLeft') show(idx - 1);
  else if (e.key === 'ArrowRight') show(idx + 1);
  else if (e.ctrlKey && e.key === 'c') $('#copy').click();
  else if (e.key === '0') fit();
});
window.api.on('viewer:load', async ({ noteId, img: name }) => {
  const dd = await window.api.init();
  imgBase = dd.imgBase;
  note = dd.notes.find(n => n.id === noteId);
  list = note ? [...(note.html || '').matchAll(/data-img="([^"]+)"/g)].map(m => m[1]) : [];
  if (!list.includes(name)) list.unshift(name);
  $('#title').textContent = note ? (note.title || '便签') : '图片';
  document.title = $('#title').textContent + ' · 查看图片';
  show(list.indexOf(name));
});
