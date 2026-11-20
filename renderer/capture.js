'use strict';
const t = document.getElementById('t');
const hint = document.getElementById('hint');
const DEF = hint.innerHTML;
let parsed = null;
function update() {
  parsed = EN.parseTime(t.value);
  hint.innerHTML = parsed ? `将在 <b>${EN.esc(EN.fmtTime(parsed.at))}</b> 提醒你` : DEF;
}
t.addEventListener('input', update);
t.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { window.api.captureHide(); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!t.value.trim()) return;
    await window.api.captureSave(t.value, parsed ? parsed.at : null);
    t.value = ''; update();
  }
});
window.api.on('capture:reset', () => { t.value = ''; update(); t.focus(); });
window.addEventListener('focus', () => t.focus());
