import { fromRows, fromText, analyse, sampleTxns, parseMessage, CATS } from './engine.js?v=12';

const $ = s => document.querySelector(s);
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const short = n => n >= 1e5 ? '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + 'L' : n >= 1e3 ? '₹' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : inr(n);
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let TX = [], R = null, DEMO = false, tags = store.get('pm_tags', {}), limits = store.get('pm_limits', { total: 0, cats: {} });
// Statements and payments are NEVER saved: they live only in this page and vanish when it closes.
try { localStorage.removeItem('pm_tx'); } catch {}
const saveTx = () => {};
const loadTx = () => [];
const keyOf = t => +t.date + '|' + t.amount + '|' + t.dir + '|' + String(t.desc).slice(0, 40);
function addTx(list) { const seen = new Set(TX.map(keyOf)); for (const t of list) { const k = keyOf(t); if (!seen.has(k)) { seen.add(k); TX.push(t); } } saveTx(); }

// ---------------------------------------------------------------- reading files (all in the browser)
async function readPdf(file) {
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  task.onPassword = (cb, reason) => { const p = window.prompt(reason === 2 ? 'Wrong password. Try again:' : `"${file.name}" is locked. Enter its password (often in the email or SMS you got with it):`); if (p === null) task.destroy(); else cb(p); };
  const doc = await task.promise, lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), tc = await page.getTextContent(), rows = new Map();
    for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5] / 3) * 3; if (!rows.has(y)) rows.set(y, []); rows.get(y).push({ x: it.transform[4], s: it.str }); }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, it]) => lines.push(it.sort((a, b) => a.x - b.x).map(i => i.s).join('  ')));
  }
  return fromText(lines);
}
let xlsxReady = null;
function loadXlsx() { return xlsxReady ||= new Promise((ok, bad) => { if (window.XLSX) return ok(); const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
async function readSheet(file) {
  await loadXlsx();
  const isCsv = /\.(csv|txt)$/i.test(file.name);
  const wb = isCsv ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  let out = [];
  for (const n of wb.SheetNames) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); out = out.concat(fromRows(rows)); }
  return out;
}
async function handleFiles(files) {
  status('Reading on your phone… 🔒');
  let got = [];
  for (const f of files) {
    try { got = got.concat(/\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? await readPdf(f) : await readSheet(f)); }
    catch (e) { console.warn(e); if (/password/i.test(String(e && e.name) + e)) { status('That PDF needs its password to open. Try again and enter it.', true); return; } }
  }
  if (DEMO) { TX = []; DEMO = false; }
  addTx(got);
  if (!TX.some(t => t.dir === 'out')) { status("We couldn't find payments in that file.", true); helpBox(files, got.length); count('read-fail'); return; }
  status(''); count('read-ok'); run();
}
function helpBox(files, n) {
  const f = files[0] || { name: '', size: 0 }, kind = (f.name.split('.').pop() || '').toUpperCase();
  const box = $('#help'); box.hidden = false;
  box.innerHTML = `<h3>Didn't read your file?</h3>
    <p>Every bank lays out its statement differently. Tell us which one you used and we'll add it, usually within a day. <b>Don't send the file</b>, only these details.</p>
    <label>Statement from <select id="hb-bank"><option>PhonePe</option><option>SBI</option><option>HDFC</option><option>ICICI</option><option>Axis</option><option>Kotak</option><option>Union Bank</option><option>Canara</option><option>Bank of Baroda</option><option>PNB</option><option>Paytm</option><option>Other</option></select></label>
    <div class="btns"><button id="hb-copy">Copy details</button><a class="alt btnlike" href="https://ig.me/m/maddiee.makess" target="_blank" rel="noopener">Open Instagram DM</a></div>
    <p class="note" id="hb-msg">Tip: most banks also give an <b>Excel/CSV</b> statement. That one almost always works.</p>`;
  $('#hb-copy').onclick = async () => { const t = `PaisaMap couldn't read my statement. Bank/app: ${$('#hb-bank').value}. File type: ${kind}. Size: ${Math.round(f.size / 1024)} KB. Rows found: ${n}.`;
    try { await navigator.clipboard.writeText(t); $('#hb-msg').textContent = 'Copied. Paste it in our Instagram DM.'; } catch { $('#hb-msg').textContent = t; } };
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function count(name) { try { window.goatcounter && window.goatcounter.count && window.goatcounter.count({ path: 'event/' + name, title: name, event: true }); } catch {} }
function status(msg, bad) { const el = $('#status'); el.textContent = msg; el.className = bad ? 'status bad' : 'status'; $('#drop').classList.toggle('busy', !!msg && !bad); }

// ---------------------------------------------------------------- render
function run() { R = analyse(TX, tags); if (!R) { $('#home').hidden = false; $('#result').hidden = true; return; } render(); $('#home').hidden = true; $('#result').hidden = false; window.scrollTo(0, 0); }
function bars(items, max, fmt = short) {
  return items.map(([label, v, col, sub]) => `<div class="hb"><div class="hb-l">${label}</div><div class="hb-t"><i style="width:${Math.max(2, v / max * 100)}%;background:${col}"></i></div><div class="hb-v">${fmt(v)}${sub ? `<small>${sub}</small>` : ''}</div></div>`).join('');
}
function render() {
  const r = R, one = r.first.getMonth() === r.last.getMonth() && r.first.getFullYear() === r.last.getFullYear(), period = one ? `${MN[r.first.getMonth()]} ${r.first.getFullYear()}` : `${MN[r.first.getMonth()]} ${r.first.getFullYear()} – ${MN[r.last.getMonth()]} ${r.last.getFullYear()}`;
  const maxM = Math.max(...r.months.map(m => m.total)), topM = r.months.reduce((a, m) => m.total > a.total ? m : a, r.months[0]);
  $('#result-body').innerHTML = `
  ${DEMO ? '<p class="demo-note">👀 This is sample data. Upload your statement to see yours.</p>' : ''}
  ${tracker()}
  <section class="card hero">
    <p class="kicker">${period}, ${r.txns.length.toLocaleString('en-IN')} payments</p>
    <h2>You spent <b data-n="${Math.round(r.spent)}">${inr(r.spent)}</b></h2>
    <div class="row3"><div><span>per month</span><b>${short(r.avgMonth)}</b></div><div><span>small spends</span><b>${short(r.small.total)}</b></div><div><span>can save / yr</span><b class="g">${short(r.saveYear)}</b></div></div>
  </section>

  <section class="card"><h3>📈 Every month</h3>
    <div class="months">${r.months.map(m => `<div class="mrow${m === topM ? ' hi' : ''}"><span class="mn">${MN[m.m]}${r.months.length > 12 || m.y !== r.last.getFullYear() ? ' ' + String(m.y).slice(2) : ''}</span><div class="mt"><i style="width:${Math.max(2, m.total / maxM * 100)}%"></i></div><b>${inr(m.total)}${m === topM ? ' 👑' : ''}</b></div>`).join('')}</div>
    <p class="note">👑 Highest: <b>${MN[topM.m]} ${topM.y}</b> (${inr(topM.total)})</p>
    ${r.months.length >= 2 ? (() => { const a = r.months[r.months.length - 2], b = r.months[r.months.length - 1], d = b.total - a.total; return `<p class="note">${MN[b.m]} vs ${MN[a.m]}: <b class="${d > 0 ? 'r' : 'g'}">${d > 0 ? '↑' : '↓'} ${inr(Math.abs(d))}</b>${r.last.getDate() < 25 ? ' (this month isn\'t over yet)' : ''}</p>`; })() : ''}
  </section>

  <section class="card"><h3>📊 Where it all went</h3>
    ${bars(r.top.map(([c, v]) => [`${CATS[c].emoji} ${CATS[c].label}`, v.total, CATS[c].color, `${Math.round(v.total / r.spent * 100)}%`]), r.top[0][1].total)}
  </section>

  <section class="card small"><h3>🪙 Small spends add up</h3>
    <p class="big">${r.small.n.toLocaleString('en-IN')} payments under ₹100</p>
    <p class="huge" data-n="${Math.round(r.small.total)}">${inr(r.small.total)}</p>
    <p class="note">That's about <b>${inr(r.small.perYear)}</b> a year, or <b>${inr(r.small.perYear / 365)}</b> a day. Tea, tiffin, snacks, auto… one small payment at a time.</p>
  </section>

  <section class="card"><h3>👤 Your regulars</h3>
    <p class="note">The names you pay most. Tap a label to fix it. We remember it on this phone only.</p>
    ${r.regulars.map(p => `<div class="reg"><div><b>${esc(p.name)}</b><small>${p.n}× · ${inr(p.total)}</small></div>
      <select data-name="${esc(p.name.toLowerCase())}">${Object.entries(CATS).map(([k, c]) => `<option value="${k}"${k === p.cat ? ' selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}</select></div>`).join('')}
  </section>

  ${R.recurring.length ? `<section class="card"><h3>🔁 Repeats & subscriptions</h3>
    <p class="note">Payments that come back every month. Cancel what you don't use.</p>
    ${R.recurring.map(x => `<div class="pl"><span>${CATS[x.cat].emoji} ${esc(x.name)}<small> · ${x.months} months · ~${inr(x.avg)}/mo</small></span><b class="y">${inr(x.year)}/yr</b></div>`).join('')}
  </section>` : ''}

  <section class="card"><h3>⚖️ Fixed vs flexible</h3>
    <div class="split"><i style="width:${r.fixed / r.spent * 100}%"></i></div>
    <div class="row2"><div><span>Fixed (rent, bills, subscriptions…)</span><b>${inr(r.fixed)}</b></div><div><span>Flexible (food, shopping, travel…)</span><b>${inr(r.flexible)}</b></div></div>
    <p class="note">Flexible money is where saving is easiest.</p>
  </section>

  <section class="card plan"><h3>💰 Your plan</h3>
    ${r.plan.length ? r.plan.map(p => `<div class="pl"><span>${p.emoji} ${p.label}</span><b>${inr(p.save)}/yr</b></div>`).join('') : '<p class="note">Nothing big to cut. Nice.</p>'}
    <div class="tot"><span>You could save</span><b data-n="${Math.round(r.saveYear)}" data-tpl="₹# a year">${inr(r.saveYear)} a year</b></div>
    <p class="note">Suggested monthly budget: <b>${inr(Math.round(r.budget / 500) * 500)}</b> (you average ${inr(r.avgMonth)}).</p>
  </section>

  <section class="card roast"><h3>🔥 Roast my spending</h3>
    ${R.roast.map((l, i) => `<p class="rl" style="--i:${i}">${esc(l)}</p>`).join('')}
  </section>

  <section class="card persona"><p class="kicker">Your money personality</p><p class="emo">${r.personality.emoji}</p><h3>${r.personality.name}</h3><p class="note">${r.personality.line}</p></section>

  <section class="card"><h3>📲 Share your card</h3><p class="note">For your story. No names and no account details.</p>
    <div class="seg" role="tablist">${[['sum', 'Summary'], ['roast', 'Roast'], ['me', 'Personality']].map(([k, l]) => `<button role="tab" data-d="${k}" class="${k === design ? 'on' : ''}">${l}</button>`).join('')}</div>
    <canvas id="share" width="1080" height="1920"></canvas>
    <div class="btns"><button id="dl">Download</button><button id="sh" class="alt">Share</button></div></section>

  <details class="card"><summary>All payments (${r.txns.length})</summary>
    <div class="list">${r.txns.slice().sort((a, b) => b.date - a.date).slice(0, 400).map(t => `<div class="tx"><span>${t.date.getDate()} ${MN[t.date.getMonth()]}</span><span>${CATS[t.cat].emoji} ${esc(t.payee)}</span><b>${inr(t.amount)}</b></div>`).join('')}</div></details>
  ${reviewBox()}
  <p class="foot"><button id="wipe" class="link">Reset my limits & labels</button></p>
  <p class="foot">Read on your phone only. Nothing was uploaded. Categories are a best guess from payment names. Not financial advice.</p>`;
  document.querySelectorAll('.reg select').forEach(s => s.onchange = () => { tags[s.dataset.name] = s.value; store.set('pm_tags', tags); run(); });
  drawCard(); $('#dl').onclick = download; $('#sh').onclick = share; wireTracker(); wireReview();
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { design = b.dataset.d; document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b)); drawCard(); });
  $('#wipe').onclick = () => { if (!confirm('Reset your monthly limits and shop labels on this phone?')) return; ['pm_tags', 'pm_limits'].forEach(k => localStorage.removeItem(k)); TX = []; tags = {}; limits = { total: 0, cats: {} }; R = null; $('#result').hidden = true; $('#home').hidden = false; };
}

// ---------------------------------------------------------------- review box (answers go to Maddyy's private Google Form; nothing else is attached)
const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSdRw7Pp0E6KZqeBJelWcVUF5xPHLQGTbdFiT1EQYhIY9Cjj_A/formResponse';
const F_STARS = 'entry.690049317', F_TEXT = 'entry.2040580522', F_FROM = 'entry.770362848';
let reviewSent = false;
function reviewBox() {
  if (reviewSent) return `<section class="card review done"><h3>💛 Thanks for the review!</h3><p class="note">We read every one. Your ideas decide what PaisaMap adds next.</p></section>`;
  return `<section class="card review" id="review"><h3>⭐ Rate PaisaMap</h3>
    <p class="note">Tell us what to add or fix. We build what you ask for.</p>
    <div class="stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? 's' : ''}" data-s="${n}">★</button>`).join('')}</div>
    <p class="rv-word" id="rv-word">&nbsp;</p>
    <textarea id="rv-text" rows="3" maxlength="1000" placeholder="Anything we should add or fix? (optional)"></textarea>
    <p class="rv-q">Your statement was from <span>(optional)</span></p>
    <div class="chips">${['PhonePe', 'Google Pay', 'Paytm', 'Bank', 'Other'].map(c => `<button type="button" data-c="${c}">${c}</button>`).join('')}</div>
    <button id="rv-send" class="rv-send" disabled>Send review</button>
    <p class="rv-safe">🔒 Only what you choose here is sent. Your statement stays on your phone.</p></section>`;
}
function wireReview() {
  const box = $('#review'); if (!box) return;
  let stars = 0, from = '';
  const words = ['', 'Not great 😕', 'Okay 😐', 'Good 🙂', 'Really good 😄', 'Loved it 😍'];
  const stBtns = box.querySelectorAll('.stars button');
  const paint = n => stBtns.forEach((b, i) => { b.classList.toggle('lit', i < n); b.setAttribute('aria-checked', String(i + 1 === stars)); });
  stBtns.forEach(b => {
    b.onclick = () => { stars = +b.dataset.s; paint(stars); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); $('#rv-word').textContent = words[stars]; $('#rv-send').disabled = false; };
    b.onmouseenter = () => paint(+b.dataset.s); b.onmouseleave = () => paint(stars);
  });
  box.querySelectorAll('.chips button').forEach(c => c.onclick = () => { from = from === c.dataset.c ? '' : c.dataset.c; box.querySelectorAll('.chips button').forEach(x => x.classList.toggle('on', x.dataset.c === from)); });
  $('#rv-send').onclick = async () => {
    const btn = $('#rv-send'); btn.disabled = true; btn.textContent = 'Sending…';
    const body = new URLSearchParams({ [F_STARS]: String(stars), [F_TEXT]: $('#rv-text').value.trim(), [F_FROM]: from });
    try { await fetch(FORM, { method: 'POST', mode: 'no-cors', body }); reviewSent = true; count('review-' + stars);
      box.classList.add('done'); box.innerHTML = `<h3>💛 Thanks for the review!</h3><p class="note">We read every one. Your ideas decide what PaisaMap adds next.</p>`;
    } catch { btn.disabled = false; btn.textContent = 'Send review'; status("Couldn't send. Check your internet and try again.", true); }
  };
}

// ---------------------------------------------------------------- share card
let design = 'sum';
function wrapText(x, text, maxW) { const words = text.split(' '), out = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }
function drawCard() {
  const c = $('#share'), x = c.getContext('2d'), r = R, F = '"Bricolage", system-ui, sans-serif';
  const t = (s, X, Y, size, col = '#10261d', w = 800, al = 'center') => { x.font = `${w} ${size}px ${F}`; x.fillStyle = col; x.textAlign = al; x.textBaseline = 'middle'; x.fillText(s, X, Y); };
  const bg = (a, b) => { const g = x.createLinearGradient(0, 0, 1080, 1920); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
    x.strokeStyle = 'rgba(16,38,29,0.06)'; x.lineWidth = 2; for (let i = 0; i <= 1080; i += 72) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1920); x.stroke(); } for (let j = 0; j <= 1920; j += 72) { x.beginPath(); x.moveTo(0, j); x.lineTo(1080, j); x.stroke(); }
    x.setLineDash([8, 30]); x.lineCap = 'round'; x.strokeStyle = 'rgba(11,143,104,0.45)'; x.lineWidth = 10; x.beginPath(); x.moveTo(-40, 1560); x.bezierCurveTo(260, 1380, 420, 1720, 640, 1560); x.bezierCurveTo(820, 1430, 900, 1600, 1120, 1480); x.stroke(); x.setLineDash([]); };
  const head = sub => { t('📍 PaisaMap', 540, 150, 60); t(sub, 540, 225, 38, 'rgba(16,38,29,0.6)', 600); };
  const foot = () => { t('find yours at paisamap.online', 540, 1760, 44, '#0b8f68', 800); t('@maddiee.makess', 540, 1830, 34, 'rgba(16,38,29,0.6)', 600); };
  if (design === 'sum') {
    bg('#f2f7f3', '#c9ecd9'); head(`my money, ${r.first.getMonth() === r.last.getMonth() ? '' : MN[r.first.getMonth()] + '–'}${MN[r.last.getMonth()]} ${r.last.getFullYear()}`);
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.beginPath(); x.roundRect(90, 310, 900, 1100, 50); x.fill();
    t('I spent', 540, 410, 44, 'rgba(16,38,29,0.6)', 600); t(inr(r.spent), 540, 515, 124, '#0b8f68', 900);
    [['per month', short(r.avgMonth)], ['small spends', short(r.small.total)], ['top category', `${CATS[r.top[0][0]].emoji} ${CATS[r.top[0][0]].label}`], ['can save', short(r.saveYear) + ' / yr']]
      .forEach(([a, b], i) => { const Y = 690 + i * 150; t(a, 160, Y, 40, 'rgba(16,38,29,0.6)', 600, 'left'); t(b, 920, Y, 52, i === 3 ? '#0b8f68' : '#10261d', 800, 'right'); x.fillStyle = 'rgba(16,38,29,0.08)'; x.fillRect(160, Y + 60, 760, 2); });
    t(`${r.personality.emoji} ${r.personality.name}`, 540, 1320, 54, '#10261d', 900);
  } else if (design === 'roast') {
    bg('#fff1f1', '#e3f3ea'); head('roasted my own spending');
    t('🔥', 540, 400, 150); let Y = 560;
    r.roast.filter(l => !/^You paid /.test(l)).slice(0, 3).forEach(line => { x.font = `700 50px ${F}`; const ls = wrapText(x, line, 820); x.fillStyle = 'rgba(229,72,77,0.10)'; x.beginPath(); x.roundRect(110, Y - 50, 860, ls.length * 66 + 50, 34); x.fill();
      ls.forEach((l, k) => t(l, 540, Y + 6 + k * 66, 50, '#10261d', 700)); Y += ls.length * 66 + 90; });
  } else {
    bg('#e6f6ee', '#bfe6d2'); head('my money personality');
    t(r.personality.emoji, 540, 640, 300); t(r.personality.name, 540, 960, 96, '#0b8f68', 900);
    x.font = `600 46px ${F}`; wrapText(x, r.personality.line, 820).forEach((l, k) => t(l, 540, 1070 + k * 60, 46, 'rgba(16,38,29,0.75)', 600));
    t(`top spend: ${CATS[r.top[0][0]].emoji} ${CATS[r.top[0][0]].label}`, 540, 1300, 44, '#10261d', 700);
  }
  foot();
}
function cardBlob() { return new Promise(ok => $('#share').toBlob(ok, 'image/png')); }
async function download() { if (/Instagram|FBAN|FBAV/i.test(navigator.userAgent)) { alert('Instagram\'s browser can\'t save images. Tap ⋯ (top right) → Open in browser, then download your card.'); return; } const b = await cardBlob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'my-paisamap.png'; a.click(); count('card-download-' + design); }
async function share() {
  const b = await cardBlob(), f = new File([b], 'my-paisamap.png', { type: 'image/png' }); count('card-share-' + design);
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], text: 'Where my money went 📍 paisamap.online' }); } catch {} } else download();
}

// ---------------------------------------------------------------- wiring
$('#file').onchange = e => { if (e.target.files.length) handleFiles([...e.target.files]); e.target.value = ''; };
$('#demo').onclick = () => { count('demo'); DEMO = true; TX = sampleTxns(); run(); };
$('#again').onclick = () => { TX = []; DEMO = false; R = null; $('#result').hidden = true; $('#home').hidden = false; window.scrollTo(0, 0); };
const drop = $('#drop'); ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); });

// ---------------------------------------------------------------- tracker: this month, limits, quick add, paste a payment
function monthNow() {
  const now = R && !DEMO ? new Date() : (R ? R.last : new Date());
  const y = now.getFullYear(), m = now.getMonth(), list = R.txns.filter(t => t.date.getFullYear() === y && t.date.getMonth() === m);
  const cats = {}; let total = 0; list.forEach(t => { total += t.amount; cats[t.cat] = (cats[t.cat] || 0) + t.amount; });
  const days = new Date(y, m + 1, 0).getDate(), day = DEMO ? days : Math.min(days, now.getDate());
  return { y, m, list, cats, total, days, day };
}
function meter(label, used, lim, key) {
  const p = lim ? used / lim : 0, cls = !lim ? '' : p >= 1 ? 'over' : p >= 0.8 ? 'warn' : 'ok';
  return `<div class="lim ${cls}"><div class="lim-h"><span>${label}</span><span><b>${inr(used)}</b>${lim ? ` / ${inr(lim)}` : ''}</span></div>
    <div class="lim-t"><i style="width:${Math.min(100, p * 100)}%"></i></div>
    <div class="lim-f">${lim ? (p >= 1 ? `⛔ Over by ${inr(used - lim)}` : p >= 0.8 ? `⚠️ ${Math.round(p * 100)}% used, ${inr(lim - used)} left` : `${inr(lim - used)} left`) : ''}
    <button class="link setlim" data-k="${key}">${lim ? 'change limit' : 'set a limit'}</button></div></div>`;
}
function tracker() {
  const M = monthNow(), L = limits, catKeys = Object.keys(L.cats).filter(k => L.cats[k] > 0);
  const top = Object.entries(M.cats).sort((a, b) => b[1] - a[1]).map(([k]) => k).filter(k => !catKeys.includes(k)).slice(0, 3);
  const pace = M.day ? M.total / M.day * M.days : 0;
  const alerts = [];
  if (L.total && M.total >= L.total) alerts.push(`⛔ You've crossed your ${MN[M.m]} limit by ${inr(M.total - L.total)}.`);
  else if (L.total && M.total >= L.total * 0.8) alerts.push(`⚠️ ${Math.round(M.total / L.total * 100)}% of your ${MN[M.m]} limit is used. ${inr(L.total - M.total)} left for ${M.days - M.day} days.`);
  else if (L.total && pace > L.total && M.day < M.days) alerts.push(`📈 At this speed you'll spend about ${inr(pace)} this month, more than your ${inr(L.total)} limit.`);
  catKeys.forEach(k => { const u = M.cats[k] || 0; if (u >= L.cats[k]) alerts.push(`⛔ ${CATS[k].emoji} ${CATS[k].label}: over limit by ${inr(u - L.cats[k])}.`); else if (u >= L.cats[k] * 0.8) alerts.push(`⚠️ ${CATS[k].emoji} ${CATS[k].label}: ${Math.round(u / L.cats[k] * 100)}% used.`); });
  return `<section class="card track"><h3>📌 ${MN[M.m]} ${M.y} so far</h3>
    ${alerts.length ? `<div class="alerts">${alerts.map(a => `<p>${a}</p>`).join('')}</div>` : ''}
    ${meter('Total this month', M.total, L.total, 'total')}
    ${catKeys.map(k => meter(`${CATS[k].emoji} ${CATS[k].label}`, M.cats[k] || 0, L.cats[k], k)).join('')}
    ${top.length ? `<p class="note">Set a limit for: ${top.map(k => `<button class="chipb setlim" data-k="${k}">${CATS[k].emoji} ${CATS[k].label}</button>`).join(' ')}</p>` : ''}
    <div class="add">
      <h4>➕ Add a payment</h4>
      <div class="add-row"><input id="qa-amt" type="number" inputmode="decimal" placeholder="₹ amount" min="1"><input id="qa-what" placeholder="what / who (optional)"></div>
      <div class="add-row"><select id="qa-cat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.emoji} ${c.label}</option>`).join('')}</select><button id="qa-go">Add</button></div>
      <details><summary>📋 Paste a payment SMS or UPI notification</summary>
        <textarea id="qa-sms" rows="3" placeholder="e.g. Rs.250.00 debited from A/c XX1234 to VPA swiggy@icici…"></textarea><button id="qa-sms-go">Add from message</button>
        <p class="note">On Android, install this app (browser menu → Add to Home screen), then use <b>Share → PaisaMap</b> on any bank SMS.</p></details>
      <p id="qa-msg" class="note"></p>
    </div></section>`;
}
function wireTracker() {
  document.querySelectorAll('.setlim').forEach(b => b.onclick = () => {
    const k = b.dataset.k, cur = k === 'total' ? limits.total : limits.cats[k] || 0, name = k === 'total' ? 'the whole month' : CATS[k].label;
    const avg = k === 'total' ? R.avgMonth : (R.cats[k] ? R.cats[k].total / R.nMonths : 0);
    const v = prompt(`Monthly limit for ${name} (₹). You usually spend about ${inr(avg)}. Enter 0 to remove.`, cur || Math.round(avg * 0.9 / 100) * 100);
    if (v === null) return; const n = Math.max(0, Math.round(+String(v).replace(/[^\d.]/g, '') || 0));
    if (k === 'total') limits.total = n; else limits.cats[k] = n; store.set('pm_limits', limits); render();
  });
  const msg = t => { $('#qa-msg').textContent = t; };
  $('#qa-go').onclick = () => {
    const a = +$('#qa-amt').value; if (!(a > 0)) return msg('Enter an amount.');
    const what = $('#qa-what').value.trim() || CATS[$('#qa-cat').value].label, d = new Date();
    if (DEMO) { TX = []; DEMO = false; }
    addTx([{ date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), desc: 'Added: ' + what + ' #' + Date.now(), payee: what, fixedCat: $('#qa-cat').value, amount: a, dir: 'out', src: 'manual' }]); run();
  };
  $('#qa-sms-go').onclick = () => { addFromMessage($('#qa-sms').value); };
}
function addFromMessage(text) {
  const t = parseMessage(text);
  if (!t) { const el = $('#qa-msg'); if (el) el.textContent = "Couldn't find an amount in that message."; else status("Couldn't find an amount in that message.", true); return; }
  if (DEMO) { TX = []; DEMO = false; }
  addTx([t]); run();
  setTimeout(() => { const el = $('#qa-msg'); if (el) el.textContent = `Added ${inr(t.amount)} ${t.dir === 'in' ? 'received from' : 'to'} ${t.payee} ✓`; }, 0);
}

// ---------------------------------------------------------------- start: saved data, share-target, installable app
const shared = new URLSearchParams(location.search).get('text');
if (shared) { history.replaceState(null, '', location.pathname); addFromMessage(shared); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
