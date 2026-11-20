'use strict';
/* Shared helpers for all renderer pages. Exposed as window.EN. */
(function () {
  const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'];
  const COLOR_NAMES = { yellow: '黄', green: '绿', blue: '蓝', pink: '粉', purple: '紫', gray: '灰' };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const pad = (n) => String(n).padStart(2, '0');

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  function fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
    const hm = `${d.getHours()}:${pad(d.getMinutes())}`;
    if (days === 0) return `今天 ${hm}`;
    if (days === 1) return `明天 ${hm}`;
    if (days === 2) return `后天 ${hm}`;
    if (days === -1) return `昨天 ${hm}`;
    if (days > 0 && days < 7) return `${WEEK[d.getDay()]} ${hm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${WEEK[d.getDay()]} ${hm}`;
  }
  function fmtAgo(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    const d = Math.floor(s / 86400);
    if (d === 1) return '昨天';
    if (d < 7) return `${d} 天前`;
    const x = new Date(ms);
    return `${x.getMonth() + 1}/${x.getDate()}`;
  }
  function toLocalInput(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const CN_NUM = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function cnToNum(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === '十') return 10;
    if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] || 0);
    if (s.includes('十')) { const [a, b] = s.split('十'); return (CN_NUM[a] || 0) * 10 + (CN_NUM[b] || 0); }
    return CN_NUM[s] ?? NaN;
  }

  /**
   * Find a reminder time in Chinese free text.
   * Returns { at: ms, match: string } or null.
   * Handles: 10分钟后 / 2小时后 / 半小时后 / 今天|明天|后天|今晚|明早|明晚|下周一 + 上午|下午|晚上 + 3点(半|15分) | 15:30
   */
  function parseTime(text, now = new Date()) {
    const N = '(\\d{1,3}|[一二两三四五六七八九十]{1,3})';
    let m = text.match(new RegExp(`${N}\\s*分钟(?:之)?后`));
    if (m) return { at: now.getTime() + cnToNum(m[1]) * 60000, match: m[0] };
    m = text.match(/半(?:个)?小时(?:之)?后/);
    if (m) return { at: now.getTime() + 30 * 60000, match: m[0] };
    m = text.match(new RegExp(`${N}\\s*(?:个)?小时(?:之)?后`));
    if (m) return { at: now.getTime() + cnToNum(m[1]) * 3600000, match: m[0] };

    const dayRe = /(今天|今晚|今早|明天|明早|明晚|后天|下?周[一二三四五六日天])/;
    const timeRe = new RegExp(`(上午|早上|中午|下午|傍晚|晚上)?\\s*(?:(\\d{1,2})[:：](\\d{2})|${N}\\s*点\\s*(半|${N}\\s*分?)?)`);
    const dm = text.match(dayRe);
    const tm = text.match(timeRe);
    if (!dm && !tm) return null;

    const d = new Date(now);
    let defaultHour = 9;
    if (dm) {
      const w = dm[1];
      if (w.startsWith('明')) d.setDate(d.getDate() + 1);
      else if (w === '后天') d.setDate(d.getDate() + 2);
      else if (w.includes('周')) {
        const target = '日一二三四五六'.indexOf(w.slice(-1) === '天' ? '日' : w.slice(-1));
        const cur = d.getDay();
        let add;
        if (w.startsWith('下')) add = (((8 - cur) % 7) || 7) + (target + 6) % 7; // next week's Monday + offset
        else add = (target - cur + 7) % 7;
        d.setDate(d.getDate() + add);
      }
      if (/晚/.test(w)) defaultHour = 20;
    }
    let h = defaultHour, min = 0;
    if (tm) {
      if (tm[2]) { h = parseInt(tm[2], 10); min = parseInt(tm[3], 10); }
      else {
        h = cnToNum(tm[4]);
        if (tm[5] === '半') min = 30;
        else if (tm[6]) min = cnToNum(tm[6]);
      }
      const period = tm[1] || (dm && /晚/.test(dm[1]) ? '晚上' : '');
      if (/下午|傍晚|晚上/.test(period) && h < 12) h += 12;
      if (period === '中午' && h < 6) h += 12;
      if (isNaN(h) || h > 23 || isNaN(min) || min > 59) return null;
    }
    d.setHours(h, min, 0, 0);
    if (!dm && d.getTime() <= now.getTime()) {
      // bare time already passed: if it could be PM, use that, else tomorrow
      if (!tm[1] && h < 12 && h + 12 > now.getHours()) d.setHours(h + 12);
      else d.setDate(d.getDate() + 1);
    }
    if (dm && /^周/.test(dm[1]) && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 7);
    if (d.getTime() <= now.getTime()) return null;
    const match = [dm && dm[0], tm && tm[0]].filter(Boolean).join(' ');
    return { at: d.getTime(), match };
  }

  function quickPicks(now = new Date()) {
    const at = (fn) => { const d = new Date(now); fn(d); return d.getTime(); };
    const evening = at(d => { d.setHours(18, 0, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); });
    return [
      { label: '20 分钟后', at: now.getTime() + 20 * 60000 },
      { label: fmtTime(evening).replace(':00', ':00'), at: evening },
      { label: '明早 9:00', at: at(d => { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }) },
      { label: '下周一 9:00', at: at(d => { const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add); d.setHours(9, 0, 0, 0); }) }
    ];
  }

  function textOf(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    div.querySelectorAll('img').forEach(i => i.replaceWith('[图片]'));
    div.querySelectorAll('div,p,br').forEach(b => b.append('\n'));
    return div.textContent.replace(/\n{2,}/g, '\n').trim();
  }
  function stats(note) {
    const h = note.html || '';
    const imgs = (h.match(/<img/g) || []).length;
    const tasks = (h.match(/class="task"/g) || []).length;
    const done = (h.match(/class="task"[^>]*data-done="1"/g) || []).length;
    return { imgs, tasks, done };
  }
  function firstImage(note) {
    const m = (note.html || '').match(/data-img="([^"]+)"/);
    return m ? m[1] : null;
  }
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fixImages(root, imgBase) {
    root.querySelectorAll('img[data-img]').forEach(img => { img.src = imgBase + encodeURIComponent(img.dataset.img); img.draggable = false; });
  }
  function applyTheme() { /* theme is driven by nativeTheme → prefers-color-scheme */ }

  window.EN = { COLORS, COLOR_NAMES, fmtTime, fmtAgo, toLocalInput, parseTime, quickPicks, textOf, stats, firstImage, esc, fixImages, applyTheme, pad };
})();
