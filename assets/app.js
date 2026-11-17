import { fromRows, fromText, analyse, sampleTxns, CATS } from './engine.js';

const $ = s => document.querySelector(s);
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const short = n => n >= 1e5 ? '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + 'L' : n >= 1e3 ? '₹' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : inr(n);
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let TX = [], R = null, tags = store.get('pm_tags', {});

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
async function readSheet(file) {
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
    catch (e) { console.warn(e); status(`Couldn't read "${f.name}". Try the Excel/CSV version of your statement.`, true); }
  }
  const seen = new Set();
  TX = TX.concat(got).filter(t => { const k = +t.date + '|' + t.amount + '|' + t.dir + '|' + t.desc.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!TX.some(t => t.dir === 'out')) { status('No payments found in that file. Try your bank\'s Excel/CSV statement, or send us the format on Instagram @maddiee.makess.', true); return; }
  status(''); run();
}
function status(msg, bad) { const el = $('#status'); el.textContent = msg; el.className = bad ? 'status bad' : 'status'; }

// ---------------------------------------------------------------- render
function run() { R = analyse(TX, tags); if (!R) return; render(); $('#home').hidden = true; $('#result').hidden = false; window.scrollTo(0, 0); }
function bars(items, max, fmt = short) {
  return items.map(([label, v, col, sub]) => `<div class="hb"><div class="hb-l">${label}</div><div class="hb-t"><i style="width:${Math.max(2, v / max * 100)}%;background:${col}"></i></div><div class="hb-v">${fmt(v)}${sub ? `<small>${sub}</small>` : ''}</div></div>`).join('');
}
function render() {
  const r = R, period = `${MN[r.first.getMonth()]} ${r.first.getFullYear()} – ${MN[r.last.getMonth()]} ${r.last.getFullYear()}`;
  const maxM = Math.max(...r.months.map(m => m.total)), topM = r.months.reduce((a, m) => m.total > a.total ? m : a, r.months[0]);
  $('#result-body').innerHTML = `
  <section class="card hero">
    <p class="kicker">${period} · ${r.txns.length.toLocaleString('en-IN')} payments</p>
    <h2>You spent <b>${inr(r.spent)}</b></h2>
    <div class="row3"><div><span>per month</span><b>${short(r.avgMonth)}</b></div><div><span>small spends</span><b>${short(r.small.total)}</b></div><div><span>can save / yr</span><b class="g">${short(r.saveYear)}</b></div></div>
  </section>

  <section class="card"><h3>📅 Every month</h3>
    <div class="cols">${r.months.map(m => `<div class="col${m === topM ? ' hi' : ''}"><em>${short(m.total)}</em><i style="height:${Math.max(3, m.total / maxM * 100)}%"></i><span>${MN[m.m][0]}${r.months.length > 12 ? '' : ''}</span></div>`).join('')}</div>
    <p class="note">Highest: <b>${MN[topM.m]} ${topM.y}</b> (${inr(topM.total)})</p>
    ${r.months.length >= 2 ? (() => { const a = r.months[r.months.length - 2], b = r.months[r.months.length - 1], d = b.total - a.total; return `<p class="note">${MN[b.m]} vs ${MN[a.m]}: <b class="${d > 0 ? 'r' : 'g'}">${d > 0 ? '↑' : '↓'} ${inr(Math.abs(d))}</b>${r.last.getDate() < 25 ? ' (this month isn\'t over yet)' : ''}</p>`; })() : ''}
  </section>

  <section class="card"><h3>📊 Where it all went</h3>
    ${bars(r.top.map(([c, v]) => [`${CATS[c].emoji} ${CATS[c].label}`, v.total, CATS[c].color, `${Math.round(v.total / r.spent * 100)}%`]), r.top[0][1].total)}
  </section>

  <section class="card small"><h3>🪙 Small spends add up</h3>
    <p class="big">${r.small.n.toLocaleString('en-IN')} payments under ₹100</p>
    <p class="huge">${inr(r.small.total)}</p>
    <p class="note">That's about <b>${inr(r.small.perYear)}</b> a year, or <b>${inr(r.small.perYear / 365)}</b> a day. Tea, tiffin, snacks, auto… one small payment at a time.</p>
  </section>

  <section class="card"><h3>👤 Your regulars</h3>
    <p class="note">The names you pay most. Tap a label to fix it. We remember it on this phone only.</p>
    ${r.regulars.map(p => `<div class="reg"><div><b>${esc(p.name)}</b><small>${p.n}× · ${inr(p.total)}</small></div>
      <select data-name="${esc(p.name.toLowerCase())}">${Object.entries(CATS).map(([k, c]) => `<option value="${k}"${k === p.cat ? ' selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}</select></div>`).join('')}
  </section>

  <section class="card"><h3>⚖️ Fixed vs flexible</h3>
    <div class="split"><i style="width:${r.fixed / r.spent * 100}%"></i></div>
    <div class="row2"><div><span>Fixed (rent, bills, subscriptions…)</span><b>${inr(r.fixed)}</b></div><div><span>Flexible (food, shopping, travel…)</span><b>${inr(r.flexible)}</b></div></div>
    <p class="note">Flexible money is where saving is easiest.</p>
  </section>

  <section class="card plan"><h3>💰 Your plan</h3>
    ${r.plan.length ? r.plan.map(p => `<div class="pl"><span>${p.emoji} ${p.label}</span><b>${inr(p.save)}/yr</b></div>`).join('') : '<p class="note">Nothing big to cut. Nice.</p>'}
    <div class="tot"><span>You could save</span><b>${inr(r.saveYear)} a year</b></div>
    <p class="note">Suggested monthly budget: <b>${inr(Math.round(r.budget / 500) * 500)}</b> (you average ${inr(r.avgMonth)}).</p>
  </section>

  <section class="card persona"><p class="kicker">Your money personality</p><p class="emo">${r.personality.emoji}</p><h3>${r.personality.name}</h3><p class="note">${r.personality.line}</p></section>

  <section class="card"><h3>📲 Share your card</h3><p class="note">A summary card for your story. Only totals, no names.</p>
    <canvas id="share" width="1080" height="1920"></canvas>
    <div class="btns"><button id="dl">Download</button><button id="sh" class="alt">Share</button></div></section>

  <details class="card"><summary>All payments (${r.txns.length})</summary>
    <div class="list">${r.txns.slice().sort((a, b) => b.date - a.date).slice(0, 400).map(t => `<div class="tx"><span>${t.date.getDate()} ${MN[t.date.getMonth()]}</span><span>${CATS[t.cat].emoji} ${esc(t.payee)}</span><b>${inr(t.amount)}</b></div>`).join('')}</div></details>
  <p class="foot">Read on your phone only. Nothing was uploaded. Categories are a best guess from payment names. Not financial advice.</p>`;
  document.querySelectorAll('.reg select').forEach(s => s.onchange = () => { tags[s.dataset.name] = s.value; store.set('pm_tags', tags); run(); });
  drawCard(); $('#dl').onclick = download; $('#sh').onclick = share;
}

// ---------------------------------------------------------------- share card
function drawCard() {
  const c = $('#share'), x = c.getContext('2d'), r = R;
  const g = x.createLinearGradient(0, 0, 1080, 1920); g.addColorStop(0, '#1b1f5e'); g.addColorStop(0.55, '#3a1d6e'); g.addColorStop(1, '#ff7a1a'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
  const t = (s, X, Y, size, col = '#fff', w = 800, al = 'center') => { x.font = `${w} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`; x.fillStyle = col; x.textAlign = al; x.textBaseline = 'middle'; x.fillText(s, X, Y); };
  t('🧾 Wrapped', 540, 170, 64); t(`my ${r.last.getFullYear()} money`, 540, 250, 40, 'rgba(255,255,255,0.8)', 600);
  x.fillStyle = 'rgba(8,10,35,0.55)'; x.beginPath(); x.roundRect(90, 330, 900, 1150, 50); x.fill();
  t('I spent', 540, 430, 44, 'rgba(255,255,255,0.75)', 600); t(inr(r.spent), 540, 530, 120, '#ffc53d', 900);
  const rows = [['per month', short(r.avgMonth)], ['small spends', short(r.small.total)], ['top category', `${CATS[r.top[0][0]].emoji} ${CATS[r.top[0][0]].label}`], ['can save', short(r.saveYear) + ' / yr']];
  rows.forEach(([a, b], i) => { const Y = 700 + i * 150; t(a, 160, Y, 40, 'rgba(255,255,255,0.7)', 600, 'left'); t(b, 920, Y, 52, i === 3 ? '#3ddc97' : '#fff', 800, 'right'); x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(160, Y + 60, 760, 2); });
  t(r.personality.emoji, 540, 1340, 90); t(r.personality.name, 540, 1430, 56, '#fff', 900);
  t('find yours at paisamap.online', 540, 1620, 44, '#fff', 800); t('@maddiee.makess', 540, 1700, 36, 'rgba(255,255,255,0.8)', 600);
}
function cardBlob() { return new Promise(ok => $('#share').toBlob(ok, 'image/png')); }
async function download() { const b = await cardBlob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'my-wrapped.png'; a.click(); }
async function share() {
  const b = await cardBlob(), f = new File([b], 'my-wrapped.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], text: 'My money, wrapped 🧾 paisamap.online' }); } catch {} } else download();
}

// ---------------------------------------------------------------- wiring
$('#file').onchange = e => { if (e.target.files.length) handleFiles([...e.target.files]); e.target.value = ''; };
$('#demo').onclick = () => { TX = sampleTxns(); run(); };
$('#again').onclick = () => { TX = []; R = null; $('#result').hidden = true; $('#home').hidden = false; window.scrollTo(0, 0); };
const drop = $('#drop'); ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); });
