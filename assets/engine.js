// PaisaMap engine: reads statements (PDF / CSV / Excel) and turns them into a money summary.
// Everything runs in the browser. Nothing is uploaded anywhere.

// ---------------------------------------------------------------- dates + amounts
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const DATE_RES = [
  // Nov 15, 2026 | Nov 15 2026
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i, m => [+m[3], MON[m[1].toLowerCase().slice(0, 3) === 'sep' ? 'sep' : m[1].toLowerCase().slice(0, 3)], +m[2]]],
  // 15 Nov 2026 | 15-Nov-2026 | 15 Nov, 2026 | 15-Nov-26
  [/\b(\d{1,2})[\s\-\/]+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-\/,]+(\d{2,4})\b/i, m => [y4(+m[3]), MON[m[2].toLowerCase().slice(0, 3)], +m[1]]],
  // 2026-11-15
  [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, m => [+m[1], +m[2] - 1, +m[3]]],
  // 15/11/2026 | 15-11-2026 | 15.11.26 (Indian day-first)
  [/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/, m => [y4(+m[3]), +m[2] - 1, +m[1]]],
];
function y4(y) { return y < 100 ? 2000 + y : y; }
export function findDate(s) {
  if (s instanceof Date && !isNaN(s)) return s;
  if (typeof s === 'number' && s > 20000 && s < 80000) { const d = new Date(Math.round((s - 25569) * 864e5)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }   // Excel serial
  s = String(s || '');
  for (const [re, f] of DATE_RES) { const m = s.match(re); if (m) { const [y, mo, d] = f(m); if (mo >= 0 && mo < 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100) return new Date(y, mo, d); } }
  return null;
}
const AMT_RE = /(?:₹|rs\.?|inr)?\s*(-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i;
export function toAmount(v) {
  if (typeof v === 'number') return Math.abs(v);
  const s = String(v || '').replace(/\s/g, '');
  if (!s || !/\d/.test(s)) return 0;
  const m = s.match(AMT_RE); return m ? Math.abs(parseFloat(m[1].replace(/,/g, ''))) : 0;
}
function amountsIn(s) {   // money-looking numbers: with ₹/Rs/INR, or with paise (.00), or Indian commas
  const out = []; const re = /(?:₹|\brs\.?|\binr)\s?(\d+(?:,\d{2,3})*(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{2})(?![\d,])/gi; let m;
  while ((m = re.exec(s))) out.push(parseFloat((m[1] || m[2]).replace(/,/g, '')));
  return out;
}

// ---------------------------------------------------------------- payee names
const NOISE = /^(upi|imps|neft|rtgs|pos|ach|nach|ecs|dr|cr|p2a|p2m|payment|pay|paid|to|from|by|ref|txn|transaction|id|utr|no|via|bil|onl|mb|ib|inb|ft|trf|transfer|debit|credit|card|atm|wdl|cash|withdrawal|upiint|upiout|collect|request|mandate|autopay|sent|using|bank|ltd|india|limited|pvt|private|the|and|of|for|on|at|in|yesb|icic|hdfc|sbin|utib|kkbk|punb|barb|axis|ybl|okaxis|okhdfcbank|oksbi|okicici|paytm|apl|ibl|axl|upi\d*|[a-z]{4}0[a-z0-9]{6})$/i;
export function payeeOf(desc) {
  let s = String(desc || '').replace(/\b\d{1,2}:\d{2}(?:\s?[ap]m)?\b/gi, ' ').replace(/\s+/g, ' ').trim();
  let m = s.match(/(?:paid to|sent to|payment to|money sent to|transfer to|to vpa|to:?)\s+([^|\n]+?)(?:\s+(?:upi|transaction|txn|utr|ref|paid by|debited|credited|debit|credit|inr|rs\.?|on \d)\b|\s*[·₹|]|$)/i);
  if (m) return clean(m[1]);
  m = s.match(/(?:received from|credited by|from)\s+([^|\n]+?)(?:\s+(?:upi|transaction|txn|utr|ref|paid by|credited|credit|debit|inr|rs\.?|on \d)\b|\s*[·₹|]|$)/i);
  if (m) return clean(m[1]);
  // bank narration: UPI/DR/1234/SWIGGY/YESB/swiggy@yes/Payment  |  UPI-ZOMATO-zomato@hdfc-HDFC000-123
  const parts = s.split(/[\/\-|:*]+/).map(p => p.trim()).filter(Boolean);
  const cand = parts.filter(p => /[a-z]{3,}/i.test(p) && !/@/.test(p) && !/^\d+$/.test(p) && !NOISE.test(p) && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(p));
  if (cand.length) return clean(cand.sort((a, b) => scoreName(b) - scoreName(a))[0]);
  const vpa = s.match(/([a-z0-9.\-_]+)@[a-z]+/i); if (vpa) return clean(vpa[1]);
  return clean(s.slice(0, 40));
}
function scoreName(p) { const w = p.split(' ').filter(x => /^[a-z]+$/i.test(x) && !NOISE.test(x)); return w.length * 3 + Math.min(p.length, 20) / 10; }
function clean(n) {
  n = String(n || '').split(' ').filter(w => !/^[a-z]*\d{5,}\w*$/i.test(w)).join(' ').replace(/[@#].*$/, '').replace(/\b(upi|ref|txn|utr)\b.*$/i, '').replace(/[^a-z0-9 &.'()]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return 'Unknown';
  return n.length > 32 ? n.slice(0, 32).trim() + '…' : n.split(' ').map(w => w.length > 2 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
}

// ---------------------------------------------------------------- categories
export const CATS = {
  food: { label: 'Food delivery', emoji: '🍔', color: '#ff7a1a', flex: true },
  eat: { label: 'Eating out', emoji: '🍽️', color: '#ffa94d', flex: true },
  grocery: { label: 'Groceries', emoji: '🛒', color: '#3ddc97', flex: true },
  shopping: { label: 'Shopping', emoji: '🛍️', color: '#c25aff', flex: true },
  travel: { label: 'Travel & fuel', emoji: '🛺', color: '#5ad1ff', flex: true },
  bills: { label: 'Bills & recharges', emoji: '💡', color: '#ffc53d', flex: false },
  rent: { label: 'Rent & EMI', emoji: '🏠', color: '#e0b84a', flex: false },
  subs: { label: 'Subscriptions', emoji: '🔁', color: '#ff6fa0', flex: false },
  fun: { label: 'Movies & fun', emoji: '🎬', color: '#9b8cff', flex: true },
  health: { label: 'Health', emoji: '💊', color: '#6be0c9', flex: false },
  edu: { label: 'Education', emoji: '📚', color: '#7fb2ff', flex: false },
  invest: { label: 'Savings & investing', emoji: '📈', color: '#2fd27a', flex: false },
  people: { label: 'Money to people', emoji: '👥', color: '#8fa0d8', flex: true },
  small: { label: 'Small daily spends', emoji: '🪙', color: '#f2a65a', flex: true },
  shops: { label: 'Other shops', emoji: '🏪', color: '#a7b0cf', flex: true },
};
const KW = [
  ['food', 'swiggy|zomato|eatclub|box8|faasos|rebel foods|dominos|domino|pizza hut|kfc|mcdonald|burger king|behrouz|ovenstory|eatsure|magicpin'],
  ['grocery', 'blinkit|zepto|bigbasket|big basket|instamart|dmart|d mart|jiomart|ratnadeep|more retail|spencer|reliance fresh|reliance retail|supermarket|kirana|grofers|vegetable|fruits|milk|dairy|heritage foods|country delight'],
  ['shopping', 'amazon|flipkart|myntra|ajio|meesho|nykaa|tata cliq|lenskart|decathlon|croma|reliance digital|snapdeal|firstcry|lifestyle|westside|pantaloons|max fashion|zudio|trends|h&m|ikea'],
  ['travel', 'uber|ola|rapido|irctc|redbus|makemytrip|goibibo|indigo|air india|akasa|metro|fastag|petrol|fuel|hpcl|bpcl|indian oil|iocl|shell|nayara|namma yatri|yulu|bounce|cleartrip|ixigo|tsrtc|apsrtc|ksrtc'],
  ['bills', 'airtel|jio|vodafone|\\bvi\\b|bsnl|electricity|tsspdcl|tgspdcl|apspdcl|bescom|tata power|adani|broadband|act fibernet|hathway|gas|bharatgas|indane|hp gas|water board|recharge|postpaid|prepaid|dth|tata play|d2h|insurance|lic|policybazaar|acko|digit'],
  ['rent', 'rent|nobroker|housing|emi|loan|bajaj finance|home credit|kreditbee|navi|moneyview|credit card|cred\\b|cc payment'],
  ['subs', 'netflix|spotify|prime video|amazon prime|hotstar|jiocinema|jio cinema|youtube|apple|google play|sonyliv|sony liv|zee5|aha\\b|gym|cult|cultfit|fitpass|chatgpt|openai|anthropic|claude|canva|notion|linkedin premium|audible|kindle|gaana|wynk|subscription'],
  ['fun', 'bookmyshow|pvr|inox|district|paytm insider|cinepolis|gaming|steam|playstation|dream11|mpl\\b|zupee|rummy'],
  ['health', 'apollo|pharmeasy|1mg|tata 1mg|netmeds|medplus|hospital|clinic|pharmacy|medical|diagnostic|lab|practo|dental'],
  ['edu', 'udemy|coursera|unacademy|byju|physics wallah|vedantu|upgrad|fees|college|school|university|exam|goethe|book'],
  ['invest', 'zerodha|groww|upstox|kuvera|\\bsip\\b|mutual fund|angel one|smallcase|coin by|ppf|nps|fixed deposit|\\bfd\\b|gold|digigold|jar\\b'],
  ['eat', 'restaurant|cafe|café|hotel|bakery|tiffin|tiffins|dhaba|biryani|chai|tea|juice|sweets|ice cream|canteen|mess|bar & grill|food court|starbucks|chaayos|third wave|haldiram|paradise'],
];
const KWR = KW.map(([c, k]) => [c, new RegExp('\\b(' + k + ')', 'i')]);
const SHOPWORD = /\b(store|stores|mart|traders|trading|enterprises|enterprise|foods|food|hotel|cafe|bakery|medical|medicals|pvt|ltd|llp|services|service|center|centre|shop|tiffin|tiffins|agency|agencies|general|kirana|textiles|fashion|electronics|mobiles|hardware|kitchen|restaurant|sweets|juice|chicken|mutton|fruits|vegetables|pan|xerox|salon|saloon|parlour|stationery|motors|petroleum|filling|bar|wines|dhaba)\b/i;
const MERCHANT_VPA = /(paytmqr|bharatpe|q\d{6,}|\.rzp@|razorpay|cashfree|payu|@ybl.*qr|mer\.|merchant|gpay-\d|pinelabs|ezetap|mswipe|bqr|qr\d)/i;
export function categorise(t, tags) {
  const key = t.payee.toLowerCase();
  if (tags && tags[key]) return tags[key];
  const s = (t.desc + ' ' + t.payee).toLowerCase();
  for (const [c, re] of KWR) if (re.test(s)) return c;
  const shopLike = SHOPWORD.test(t.payee) || MERCHANT_VPA.test(t.desc);
  if (t.amount <= 100) return 'small';
  if (shopLike) return 'shops';
  const words = t.payee.split(' ').filter(w => /^[a-z.]+$/i.test(w));
  if (words.length >= 1 && words.length <= 4 && words.length === t.payee.split(' ').length) return 'people';
  return 'shops';
}

// ---------------------------------------------------------------- readers
export function fromRows(rows) {   // CSV / Excel rows (arrays)
  rows = rows.map(r => (r || []).map(c => c instanceof Date ? c : (c == null ? '' : String(c).trim())));
  let h = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = rows[i].map(c => String(c).toLowerCase());
    const di = r.findIndex(c => /\bdate\b|txn date|value date|transaction date/.test(c));
    const dbi = r.findIndex(c => /withdraw|debit|\bdr\b|paid out|money out/.test(c));
    const ami = r.findIndex(c => /^amount|amount \(|amt|transaction amount/.test(c));
    if (di >= 0 && (dbi >= 0 || ami >= 0)) {
      h = i; col = { date: di, debit: dbi, amount: ami,
        credit: r.findIndex(c => /deposit|credit|\bcr\b|paid in|money in/.test(c) && !/debit/.test(c)),
        type: r.findIndex(c => /^type$|dr ?\/ ?cr|cr ?\/ ?dr|debit\/credit|transaction type/.test(c)),
        desc: r.findIndex(c => /narration|description|details|particulars|remarks|transaction details|merchant|name|paid to/.test(c)),
        bal: r.findIndex(c => /balance/.test(c)) };
      if (col.desc < 0) col.desc = r.findIndex((c, k) => k !== di && k !== dbi && k !== ami && c);
      break;
    }
  }
  if (h < 0) return [];
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const date = findDate(r[col.date]); if (!date) continue;
    let amount = 0, dir = 'out';
    if (col.debit >= 0 && col.debit !== col.amount) {
      const d = toAmount(r[col.debit]), c = col.credit >= 0 ? toAmount(r[col.credit]) : 0;
      if (d > 0) { amount = d; dir = 'out'; } else if (c > 0) { amount = c; dir = 'in'; }
    } else if (col.amount >= 0) {
      amount = toAmount(r[col.amount]); const raw = String(r[col.amount]);
      const ty = col.type >= 0 ? String(r[col.type]).toLowerCase() : '';
      dir = /cr|credit|received|in\b/.test(ty) ? 'in' : /dr|debit|paid|sent/.test(ty) ? 'out' : (/^\s*-/.test(raw) || /dr/i.test(raw) ? 'out' : /cr/i.test(raw) ? 'in' : 'out');
    }
    if (!amount) continue;
    const desc = String(r[col.desc] || '');
    out.push({ date, desc, amount, dir });
  }
  return out;
}
export function fromText(lines) {   // PDF text lines (PhonePe, Google Pay, Paytm, bank PDFs)
  const recs = []; let cur = null;
  const isStart = l => { const d = findDate(l); if (!d) return null; const idx = l.search(/\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i); return idx >= 0 && idx < 6 ? d : null; };
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, ' ').trim(); if (!l) continue;
    if (/^(date|page \d|statement|transaction details|opening balance|closing balance|total)/i.test(l) && !/paid to|received from/i.test(l)) { if (/opening|closing|total/i.test(l)) cur = null; continue; }
    const d = isStart(l);
    if (d) { cur = { date: d, text: l }; recs.push(cur); } else if (cur && cur.text.length < 600) cur.text += ' | ' + l;
  }
  const out = []; let prevBal = null;
  for (const r of recs) {
    const s = r.text.replace(/\b\d{1,2}:\d{2}(?:\s?[ap]m)?\b/gi, ' ');
    const noDate = s.replace(DATE_RES[0][0], ' ').replace(DATE_RES[1][0], ' ').replace(DATE_RES[2][0], ' ').replace(DATE_RES[3][0], ' ');
    const ams = amountsIn(noDate.replace(/(transaction id|utr no\.?|ref(?:erence)? no\.?|txn id|order id)\s*[:.]?\s*\S+/gi, ' ')).filter(a => a > 0 && a < 1e8);
    if (!ams.length) continue;
    let dir = null;
    if (/\bdebit\b|\bdr\b|paid to|sent to|withdrawal|purchase/i.test(s)) dir = 'out';
    if (/\bcredit\b|\bcr\b|received from|refund|cashback|deposit|salary/i.test(s) && !/paid to|sent to/i.test(s)) dir = dir === 'out' && /\bdebit\b/i.test(s) ? 'out' : 'in';
    let amount = ams[0];
    if (ams.length >= 2 && !/paid to|received from|sent to/i.test(s)) {   // bank PDF: amount + running balance
      const bal = ams[ams.length - 1]; amount = ams[ams.length - 2];
      if (!dir && prevBal != null) dir = bal < prevBal ? 'out' : 'in';
      prevBal = bal;
    }
    if (!dir) dir = 'out';
    out.push({ date: r.date, desc: s.replace(/\s*\|\s*/g, ' · ').slice(0, 240), amount, dir });
  }
  return out;
}

// ---------------------------------------------------------------- the summary
const SELF = /self|own account|to self|my account|wallet load|add money|sweep|transfer to fd|transfer to x{4,}\d+/i;   // PhonePe 'Transfer to XXXX1234' = moving money to your own bank account
export function analyse(txns, tags = {}) {
  const all = txns.map(t => ({ ...t, payee: t.payee || payeeOf(t.desc) })).filter(t => t.amount > 0);
  const outT = all.filter(t => t.dir === 'out' && !SELF.test(t.desc));
  outT.forEach(t => { t.cat = t.fixedCat || categorise(t, tags); });
  const inT = all.filter(t => t.dir === 'in');
  if (!outT.length) return null;
  const dates = outT.map(t => +t.date), first = new Date(Math.min(...dates)), last = new Date(Math.max(...dates));
  const months = []; for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push({ y: d.getFullYear(), m: d.getMonth(), total: 0, cats: {} });
  const mi = t => months.findIndex(x => x.y === t.date.getFullYear() && x.m === t.date.getMonth());
  const cats = {}; let spent = 0;
  for (const t of outT) { spent += t.amount; const m = months[mi(t)]; m.total += t.amount; m.cats[t.cat] = (m.cats[t.cat] || 0) + t.amount; cats[t.cat] = cats[t.cat] || { total: 0, n: 0 }; cats[t.cat].total += t.amount; cats[t.cat].n++; }
  const spanDays = Math.max(1, (last - first) / 864e5 + 1), nMonths = Math.max(1, spanDays / 30.44), perYear = x => x * 12 / nMonths;
  const payees = {}; for (const t of outT) { const k = t.payee.toLowerCase(); payees[k] = payees[k] || { name: t.payee, total: 0, n: 0, cat: t.cat }; payees[k].total += t.amount; payees[k].n++; }
  const regulars = Object.values(payees).sort((a, b) => b.n - a.n || b.total - a.total).slice(0, 8);
  const small = outT.filter(t => t.amount <= 100), smallTotal = small.reduce((a, t) => a + t.amount, 0);
  const fixed = Object.entries(cats).filter(([c]) => !CATS[c].flex).reduce((a, [, v]) => a + v.total, 0);
  const c = k => (cats[k] ? cats[k].total : 0);
  const plan = [];
  if (c('food') > 0) plan.push({ emoji: '🍔', label: 'Half the food delivery', save: perYear(c('food') / 2) });
  if (c('subs') > 0) plan.push({ emoji: '🔁', label: 'Cancel subscriptions you don\'t use (say half)', save: perYear(c('subs') / 2) });
  if (smallTotal > 0) plan.push({ emoji: '🪙', label: 'A quarter fewer small spends', save: perYear(smallTotal / 4) });
  if (c('shopping') > 0) plan.push({ emoji: '🛍️', label: 'Shop 30% less', save: perYear(c('shopping') * 0.3) });
  const saveYear = plan.reduce((a, p) => a + p.save, 0);
  const avgMonth = spent / nMonths;
  const top = Object.entries(cats).sort((a, b) => b[1].total - a[1].total);
  const late = outT.filter(t => /\b(1[0-1]|0?[0-4]):\d{2}\s?pm|\b(0?[0-4]):\d{2}\s?am/i.test(t.desc)).length;
  const recurring = findRecurring(outT);
  const roast = makeRoast({ cats, outT, spent, small, months, recurring, payees: Object.values(payees), perYear });
  return { recurring, roast, txns: outT, inTotal: inT.reduce((a, t) => a + t.amount, 0), spent, first, last, nMonths, months, cats, top, regulars, small: { n: small.length, total: smallTotal, perYear: perYear(smallTotal) }, fixed, flexible: spent - fixed, plan, saveYear, avgMonth, budget: Math.max(0, avgMonth - saveYear / 12), perYear, personality: personality(cats, spent, small.length, outT.length) };
}
function personality(cats, spent, nSmall, n) {
  const share = k => (cats[k] ? cats[k].total / spent : 0);
  const list = [
    [share('food') + share('eat'), 0.18, 'The Foodie', '🍔', 'Your money mostly goes into your stomach.'],
    [share('shopping'), 0.2, 'The Cart Hero', '🛍️', 'If there\'s a sale, you\'re there.'],
    [share('travel'), 0.18, 'The Traveller', '🛺', 'Always on the move.'],
    [nSmall / n, 0.45, 'The Chai Accountant', '☕', 'Hundreds of tiny payments. They add up.'],
    [share('people'), 0.3, 'The Generous One', '👥', 'Friends and family know who to ask.'],
    [share('invest'), 0.15, 'The Saver', '📈', 'Future you says thanks.'],
    [share('subs'), 0.08, 'The Subscriber', '🔁', 'So many apps, so little time.'],
  ].map(([v, th, ...r]) => [v / th, ...r]).sort((a, b) => b[0] - a[0]);
  const [score, name, emoji, line] = list[0];
  return score >= 1 ? { name, emoji, line } : { name: 'The Balanced One', emoji: '⚖️', line: 'No single habit eats your money.' };
}

// ---------------------------------------------------------------- demo data (for "Try with sample data")
export function sampleTxns() {
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const t = []; const start = new Date(2026, 0, 1), end = new Date(2026, 10, 15);
  const add = (d, desc, amount, dir = 'out') => t.push({ date: new Date(d), desc, amount: Math.round(amount), dir });
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDate();
    if (day === 1) { add(d, 'Received from ACME TECH PRIVATE LIMITED salary', 25000, 'in'); add(d, 'Paid to Ramana Reddy rent', 6000); }
    if (day === 5) add(d, 'Paid to Airtel Prepaid recharge', 349);
    if (day === 8) add(d, 'Paid to Netflix subscription', 199);
    if (day === 12) add(d, 'Paid to CULTFIT gym', 999);
    if (day === 18) add(d, 'Paid to Spotify India', 119);
    if (day === 20) add(d, 'Paid to TSSPDCL electricity bill', 420 + r() * 300);
    if (r() < 0.62) add(d, 'Paid to Swiggy ' + (r() < 0.3 ? '11:48 pm' : '08:10 pm'), 140 + r() * 260);
    if (r() < 0.2) add(d, 'Paid to Zomato 09:30 pm', 180 + r() * 300);
    for (let k = 0; k < 2; k++) if (r() < 0.85) add(d, 'Paid to ' + ['Sri Lakshmi Tiffins', 'RAMESH K', 'paytmqr2810050501 chai point', 'Ganesh Tea Stall', 'Annapurna Tiffin Centre'][Math.floor(r() * 5)], 10 + Math.floor(r() * 8) * 10);
    if (r() < 0.25) add(d, 'Paid to Rapido', 60 + r() * 120);
    if (r() < 0.12) add(d, 'Paid to Indian Oil petrol', 300 + r() * 300);
    if (r() < 0.1) add(d, 'Paid to Blinkit', 200 + r() * 600);
    if (r() < 0.07) add(d, 'Paid to Myntra', 600 + r() * 1400);
    if (r() < 0.05) add(d, 'Paid to Amazon', 300 + r() * 2000);
    if (r() < 0.06) add(d, 'Paid to ' + ['Sai Kiran', 'Rahul Varma', 'Amma'][Math.floor(r() * 3)], 200 + r() * 1500);
    if (r() < 0.03) add(d, 'Paid to PVR INOX', 250 + r() * 400);
    if (day === 10) add(d, 'Paid to Groww SIP', 1000);
  }
  return t;
}

// ---------------------------------------------------------------- repeats ("I'll cancel later" subscriptions, EMIs, rent)
function findRecurring(outT) {
  const by = {};
  for (const t of outT) { if (t.amount < 49) continue; const k = t.payee.toLowerCase(); (by[k] = by[k] || []).push(t); }
  const out = [];
  for (const list of Object.values(by)) {
    const months = new Map(); list.forEach(t => { const k = t.date.getFullYear() * 12 + t.date.getMonth(); if (!months.has(k)) months.set(k, []); months.get(k).push(t.amount); });
    if (months.size < 3) continue;
    const per = [...months.values()].map(a => a.reduce((x, y) => x + y, 0)), avg = per.reduce((a, b) => a + b, 0) / per.length;
    const steady = per.filter(v => Math.abs(v - avg) <= avg * 0.25).length / per.length;
    const perMonthCount = list.length / months.size;
    if (steady >= 0.7 && perMonthCount <= 2.5) out.push({ name: list[0].payee, cat: list[0].cat, avg, months: months.size, year: avg * 12, last: list[list.length - 1].date });
  }
  return out.sort((a, b) => b.year - a.year).slice(0, 12);
}

// ---------------------------------------------------------------- one payment from a pasted bank SMS / UPI notification
export function parseMessage(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim(); if (!s) return null;
  const m = s.match(/(?:₹|\brs\.?|\binr)\s?([\d,]+(?:\.\d{1,2})?)/i) || s.match(/\b(\d[\d,]*\.\d{2})\b/);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(/,/g, '')); if (!(amount > 0)) return null;
  const isIn = /credited|received|refund|cashback|deposited/i.test(s) && !/debited|paid|sent|spent|purchase|withdrawn/i.test(s);
  let payee = '';
  const STOP = "(?=\\s+(?:on|via|ref|upi|using|from|avl|bal|for|if not|not you|is|has)\\b|[.,;]|$)";
  const tries = /card|spent/i.test(s) ? ['at', 'to vpa', 'to'] : ['paid to', 'sent to', 'payment to', 'to vpa', 'trf to', 'transfer to', 'to', 'at', 'by'];
  for (const w of tries) { const pm = s.match(new RegExp('\\b' + w + '\\s+([A-Za-z0-9][A-Za-z0-9 .&\'@_\\-]{1,40}?)' + STOP, 'i')); if (pm && !/^(your|a\/c|ac|account)\b/i.test(pm[1])) { payee = pm[1]; break; } }
  if (/@/.test(payee)) payee = payee.split('@')[0];
  if (!payee) { const v = s.match(/([a-z0-9.\-_]+)@[a-z]+/i); if (v) payee = v[1]; }
  const date = findDate(s) || new Date();
  const name = payee ? payeeOf('Paid to ' + payee) : payeeOf(s);
  return { date: new Date(date.getFullYear(), date.getMonth(), date.getDate()), desc: s.slice(0, 200), payee: name, amount, dir: isIn ? 'in' : 'out', src: 'sms' };
}

// ---------------------------------------------------------------- roast lines (funny, shareable, from real numbers)
function makeRoast({ cats, outT, spent, small, months, recurring, payees, perYear }) {
  const L = [], fmt = n => '₹' + Math.round(n).toLocaleString('en-IN'), MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const c = k => cats[k] || { total: 0, n: 0 };
  if (c('food').n >= 8) L.push([c('food').total, `${c('food').n} food delivery orders. Your kitchen filed a missing person complaint.`]);
  if (small.n >= 30) L.push([small.total * 1.2, `${small.n} payments under ₹100. Death by a thousand chais.`]);
  const ppl = c('people').total / spent; if (ppl >= 0.35) L.push([c('people').total, `${Math.round(ppl * 100)}% of your money went to other people. You're basically everyone's ATM.`]);
  const top = payees.filter(p => p.cat === 'people').sort((a, b) => b.n - a.n)[0];
  if (top && top.n >= 4) L.push([top.total, `You paid ${top.name} ${top.n} times. Family, friend, or subscription?`]);
  if (c('shopping').n >= 4) L.push([c('shopping').total, `${fmt(c('shopping').total)} on shopping. The delivery guy knows your address better than your relatives.`]);
  const subs = recurring.reduce((a, r) => a + r.year, 0); if (subs >= 1200) L.push([subs, `${fmt(subs)} a year on things that charge you every month. Do you even use all of them?`]);
  const tiny = outT.filter(t => t.amount <= 10).length; if (tiny >= 4) L.push([tiny * 50, `${tiny} payments of ₹10 or less. Free trials are never free.`]);
  const hm = months.reduce((a, m) => m.total > a.total ? m : a, months[0]); if (months.length >= 3) L.push([hm.total / 3, `${MN[hm.m]} was wild: ${fmt(hm.total)} gone in one month.`]);
  if (c('travel').n >= 10) L.push([c('travel').total, `${c('travel').n} rides and fuel stops. Your bike/auto guy is doing better than you.`]);
  if (!L.length) L.push([1, `Honestly? Your spending is boring. That's a compliment.`]);
  return L.sort((a, b) => b[0] - a[0]).slice(0, 4).map(x => x[1]);
}
