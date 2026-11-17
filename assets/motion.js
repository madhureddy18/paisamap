// PaisaMap motion: the coin's route on the home map, the cursor, tap ripples, count-ups and bars on results.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- hero: a ₹ coin travels the month's route, pins light up as it passes
const trail = document.getElementById('trail'), coin = document.getElementById('coin');
if (trail && coin) {
  const L = trail.getTotalLength(), pins = [...document.querySelectorAll('#route .pin')].map(p => ({ el: p, at: +p.dataset.at }));
  const place = k => { const pt = trail.getPointAtLength(L * k); coin.setAttribute('transform', `translate(${pt.x} ${pt.y})`); pins.forEach(p => p.el.classList.toggle('hit', k >= p.at - 0.01)); };
  if (reduce) place(1);
  else {
    const DUR = 5200, HOLD = 1600; let t0 = null;
    const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    const tick = now => { if (t0 == null) t0 = now; const e = (now - t0) % (DUR + HOLD), k = Math.min(1, e / DUR); place(ease(k)); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
}

// ---------- cursor (mouse only): a ring that trails the pointer and grows on things you can press
const cur = document.querySelector('.cursor');
if (cur && matchMedia('(hover: hover) and (pointer: fine)').matches && !reduce) {
  let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;
  addEventListener('mousemove', e => { x = e.clientX; y = e.clientY; cur.classList.add('on'); }, { passive: true });
  addEventListener('mouseleave', () => cur.classList.remove('on'));
  addEventListener('mousedown', () => cur.classList.add('press')); addEventListener('mouseup', () => cur.classList.remove('press'));
  addEventListener('mouseover', e => cur.classList.toggle('big', !!e.target.closest('button, a, label, select, summary, .pin')));
  const loop = () => { cx += (x - cx) * 0.2; cy += (y - cy) * 0.2; cur.style.transform = `translate(${cx}px, ${cy}px)`; requestAnimationFrame(loop); };
  loop();
}

// ---------- tap ripple on buttons
addEventListener('pointerdown', e => {
  const b = e.target.closest('.upload, .btns button, .add button, .small-btn'); if (!b || reduce) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2, d = document.createElement('span');
  d.className = 'ripple'; d.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative'; b.style.overflow = 'hidden';
  b.appendChild(d); setTimeout(() => d.remove(), 650);
}, { passive: true });

// ---------- results: count numbers up and grow bars once, right after a statement is read
const body = document.getElementById('result-body');
const fmt = (n, tpl) => tpl.replace('#', Math.round(n).toLocaleString('en-IN'));
function countUp(root) {
  root.querySelectorAll('[data-n]').forEach(el => {
    const to = +el.dataset.n, tpl = el.dataset.tpl || '₹#';
    if (reduce || !to) { el.textContent = fmt(to, tpl); return; }
    const t0 = performance.now(), D = 1100;
    const step = now => { const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e, tpl); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
if (body) new MutationObserver(() => {
  if (!body.firstElementChild || body.dataset.done === body.innerHTML.length + '') return;
  body.dataset.done = body.innerHTML.length + '';
  const fresh = !body.classList.contains('go');
  body.classList.remove('go'); void body.offsetWidth; requestAnimationFrame(() => body.classList.add('go'));
  if (fresh) countUp(body); else body.querySelectorAll('[data-n]').forEach(el => { el.textContent = fmt(+el.dataset.n, el.dataset.tpl || '₹#'); });
}).observe(body, { childList: true });
const hide = new MutationObserver(() => { if (document.getElementById('result').hidden) body.classList.remove('go'); });
hide.observe(document.getElementById('result'), { attributes: true, attributeFilter: ['hidden'] });
