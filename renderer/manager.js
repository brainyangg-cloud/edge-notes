'use strict';
const $ = (s) => document.querySelector(s);
const { esc, fmtTime, fmtAgo, stats, textOf, firstImage, COLORS, COLOR_NAMES } = EN;
let notes = [], imgBase = '', tab = 'notes', filter = 'all', color = null;

function setTab(t) {
  tab = t;
  $('#tNotes').classList.toggle('on', t === 'notes');
  $('#tArchive').classList.toggle('on', t === 'archive');
  document.title = t === 'notes' ? '全部便签' : '归档';
  render();
}
$('#tNotes').onclick = () => setTab('notes');
$('#tArchive').onclick = () => setTab('archive');
$('#q').oninput = render;
$('#sort').onchange = render;
$('#newNote').onclick = async () => { const n = await window.api.createNote({ title: '新便签' }); window.api.openNote(n.id); };
$('#exportAll').onclick = () => window.api.exportMarkdown(tab === 'archive' ? notes.filter(n => n.archived).map(n => n.id) : null);

function highlight(text, q) {
  const e = esc(text);
  if (!q) return e;
  const qe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return e.replace(new RegExp(qe, 'gi'), (m) => `<mark>${m}</mark>`);
}

function renderChips(base) {
  const c = (f) => base.filter(f).length;
  const defs = [
    ['all', '全部', base.length], ['remind', '有提醒', c(n => n.remindAt || n.due)], ['img', '含图片', c(n => stats(n).imgs)],
    ['task', '清单', c(n => stats(n).tasks)], ['pinned', '已钉住', c(n => n.pinned)]
  ];
  $('#chips').innerHTML = defs.map(([k, l, num]) => `<button class="chipb${filter === k ? ' on' : ''}" data-f="${k}">${l} ${num}</button>`).join('') +
    '<span style="width:1px;height:20px;background:var(--input-border);margin:0 4px"></span>' +
    COLORS.map(cl => `<button class="cdot${color === cl ? ' on' : ''}" data-c="${cl}" style="background:rgb(var(--c-${cl}))" aria-label="只看${COLOR_NAMES[cl]}色" title="${COLOR_NAMES[cl]}"></button>`).join('');
}
$('#chips').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.f) filter = b.dataset.f;
  if (b.dataset.c) color = color === b.dataset.c ? null : b.dataset.c;
  render();
};

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const base = notes.filter(n => (tab === 'archive') === !!n.archived);
  renderChips(base);
  let list = base.filter(n => {
    if (q && !((n.title || '').toLowerCase().includes(q) || textOf(n.html).toLowerCase().includes(q))) return false;
    if (color && n.color !== color) return false;
    const st = stats(n);
    if (filter === 'remind' && !(n.remindAt || n.due)) return false;
    if (filter === 'img' && !st.imgs) return false;
    if (filter === 'task' && !st.tasks) return false;
    if (filter === 'pinned' && !n.pinned) return false;
    return true;
  });
  const s = $('#sort').value;
  list.sort((a, b) => s === 'updated' ? b.updatedAt - a.updatedAt : s === 'created' ? b.createdAt - a.createdAt
    : s === 'remind' ? (a.remindAt || 9e15) - (b.remindAt || 9e15) : a.order - b.order);

  if (!list.length) {
    $('#list').innerHTML = `<div class="empty">${base.length ? '没有符合条件的便签' : (tab === 'archive' ? '归档是空的。做完但想留着的便签，右键标签选“归档”。' : '还没有便签，点右上角“新建”。')}</div>`;
    return;
  }
  if (tab === 'archive') {
    $('#list').innerHTML = list.map(n => {
      const st = stats(n);
      const extra = [st.imgs ? `${st.imgs} 张图片` : '', st.tasks ? `清单 ${st.done}/${st.tasks}` : ''].filter(Boolean).join(' · ');
      return `<div class="row"><span class="sw" style="background:rgb(var(--c-${n.color}))"></span><div class="grow"><div class="t">${highlight(n.title || '无标题', q)}</div><div class="s">修改于 ${esc(fmtAgo(n.updatedAt))}${extra ? ' · ' + extra : ''}</div></div>` +
        `<button class="btn" data-restore="${n.id}">恢复到边缘</button><button class="btn danger" data-del="${n.id}">彻底删除</button></div>`;
    }).join('');
    return;
  }
  $('#list').innerHTML = '<div class="grid">' + list.map(n => {
    const st = stats(n);
    const img = firstImage(n);
    const meta = [];
    if (n.due) meta.push('<span class="al">提醒到了</span>');
    else if (n.remindAt) meta.push(`<span class="al">${esc(fmtTime(n.remindAt))}</span>`);
    if (st.tasks) meta.push(`${st.done}/${st.tasks} 完成`);
    if (st.imgs) meta.push(`${st.imgs} 张图片`);
    if (n.pinned) meta.push('已钉住');
    meta.push(esc(fmtAgo(n.updatedAt)));
    return `<button class="card" data-id="${n.id}" style="--tc:var(--c-${n.color});--nc:var(--n-${n.color})" title="双击在边缘打开">` +
      `<b>${highlight(n.title || '无标题', q)}</b>` +
      (img ? `<img src="${imgBase + encodeURIComponent(img)}" alt="">` : '') +
      `<p>${highlight(textOf(n.html).slice(0, 160), q)}</p><div class="meta">${meta.join('<span>·</span>')}</div></button>`;
  }).join('') + '</div>';
}

$('#list').addEventListener('dblclick', (e) => { const c = e.target.closest('.card'); if (c) window.api.openNote(c.dataset.id); });
$('#list').addEventListener('keydown', (e) => { const c = e.target.closest('.card'); if (c && e.key === 'Enter') window.api.openNote(c.dataset.id); });
$('#list').addEventListener('click', async (e) => {
  const r = e.target.closest('[data-restore]');
  const d = e.target.closest('[data-del]');
  if (r) await window.api.updateNote(r.dataset.restore, { archived: false });
  if (d) {
    const n = notes.find(x => x.id === d.dataset.del);
    if (confirm(`彻底删除“${n ? n.title || '便签' : ''}”？此操作不能撤销。`)) await window.api.deleteNote(d.dataset.del);
  }
});

window.api.on('notes:changed', (l) => { notes = l; render(); });
window.api.on('manager:tab', (t) => setTab(t || 'notes'));
document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'f') { e.preventDefault(); $('#q').focus(); } if (e.key === 'Escape') window.api.closeWindow(); });
(async () => { const d = await window.api.init(); notes = d.notes; imgBase = d.imgBase; render(); })();
