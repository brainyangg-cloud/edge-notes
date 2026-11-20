'use strict';
let dock = 'right';
document.getElementById('dock').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  dock = b.dataset.v;
  document.querySelectorAll('#dock button').forEach(x => x.classList.toggle('on', x === b));
});
document.getElementById('go').addEventListener('click', () => {
  window.api.welcomeDone({ autostart: document.getElementById('auto').checked, dock });
});
