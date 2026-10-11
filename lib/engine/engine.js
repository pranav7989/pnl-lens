/**
 * @file  lib/engine/engine.js
 * @area  Engine
 * @what  Analysis engine: column detection (incl. automatic inference), trade rebuilding, clusters, leaks, rules, progress. Runs in the browser.
 */
import { buildBehaviour } from './behaviour.js';
// @ts-nocheck
/* PnL Lens engine — broker-agnostic parsing + insight generation.
 * Pure functions, no DOM. Runs in the browser (Web Worker), node, and tests.
 * The XLSX library is injected by the caller (parseWorkbook(XLSX, wb, name)) so the engine
 * has no bundler-specific imports.
 */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const num = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/[,₹\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/(cr|dr)$/i.test(s)) { if (/dr$/i.test(s)) neg = true; s = s.replace(/(cr|dr)$/i, ''); }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
};
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); };
const pick = (arr, seed) => arr[hash(seed) % arr.length];

/* ---------- currency ---------- */
const CURSYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', HKD: 'HK$', CHF: 'CHF ', AED: 'AED ', BRL: 'R$', ZAR: 'R', USDT: '$' };
const SYM2CUR = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
let CUR = 'INR';
function setCurrency(c) { CUR = CURSYM[c] ? c : 'USD'; }
function money(v) {
  const sign = v < 0 ? '−' : '', a = Math.abs(v), sym = CURSYM[CUR] || (CUR + ' ');
  if (CUR === 'INR') return sign + sym + (a >= 1e7 ? (a / 1e7).toFixed(2) + 'Cr' : a >= 1e5 ? (a / 1e5).toFixed(2) + 'L' : Math.round(a).toLocaleString('en-IN'));
  if (a >= 1e9) return sign + sym + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + sym + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return sign + sym + (a / 1e3).toFixed(1) + 'K';
  return sign + sym + (Math.round(a * 100) / 100).toLocaleString('en-US');
}

/* ---------- dates ---------- */
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const iso = d => d.toISOString().slice(0, 10);
function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'number') { if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)); return null; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})/);
  if (m) { const MO = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }; const mo = MO[m[2].toLowerCase()]; if (mo != null) { let y = +m[3]; if (y < 100) y += 2000; return new Date(Date.UTC(y, mo, +m[1])); } }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 0) { const frac = v - Math.floor(v); if (!frac) return null; const mins = Math.round(frac * 1440); return { h: Math.floor(mins / 60), m: mins % 60 }; }
  if (v instanceof Date && !isNaN(v)) return { h: v.getUTCHours(), m: v.getUTCMinutes() };
  const m = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = +m[1]; const mm = +m[2];
  if (m[4] && /pm/i.test(m[4]) && h < 12) h += 12;
  if (m[4] && /am/i.test(m[4]) && h === 12) h = 0;
  return { h, m: mm };
}

/* ---------- instrument classification ---------- */
const INDICES = ['NIFTYNXT50', 'MIDCPNIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX50', 'NIFTY', 'SENSEX', 'BANKEX'];
const BSE_IDX = ['SENSEX', 'SENSEX50', 'BANKEX'];
const COMMODS = ['CRUDEOILM', 'CRUDEOIL', 'NATGASMINI', 'NATURALGAS', 'GOLDPETAL', 'GOLDGUINEA', 'GOLDTEN', 'GOLDM', 'GOLD', 'SILVERMIC', 'SILVERM', 'SILVER', 'COPPER', 'ZINCMINI', 'ZINC', 'LEADMINI', 'LEAD', 'ALUMINI', 'ALUMINIUM', 'NICKEL', 'MENTHAOIL', 'COTTONCNDY', 'COTTON'];
const CURRS = ['USDINR', 'EURINR', 'GBPINR', 'JPYINR'];
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const WMON = { O: 10, N: 11, D: 12 };
function lastWeekday(y, m, wd) { const d = new Date(Date.UTC(y, m, 0)); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1); return d; }
function monthlyExpiry(y, m, und, family) {
  if (family === 'Commodity' || family === 'Currency') return null;
  const ym = y * 100 + m;
  const wd = BSE_IDX.includes(und) ? (ym < 202501 ? 5 : ym < 202509 ? 2 : 4) : (ym < 202509 ? 4 : 2);
  return lastWeekday(y, m, wd);
}
const US_INDEX = ['SPX', 'SPXW', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX'];
const CME = { ES: 'S&P 500', NQ: 'Nasdaq', YM: 'Dow', RTY: 'Russell', CL: 'Crude', NG: 'Nat gas', GC: 'Gold', SI: 'Silver', HG: 'Copper', ZC: 'Corn', ZS: 'Soybeans', ZW: 'Wheat', ZB: 'T-bond', ZN: '10Y note', '6E': 'Euro FX', '6J': 'Yen', MES: 'Micro S&P', MNQ: 'Micro Nasdaq', MGC: 'Micro gold' };
const FUTMON = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 };
const FIAT = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'INR', 'SGD', 'HKD', 'CNH', 'ZAR', 'MXN', 'SEK', 'NOK', 'TRY', 'BRL'];
const CRYPTO = ['BTC', 'XBT', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT', 'LINK', 'LTC', 'TRX', 'SHIB', 'ARB', 'OP', 'SUI', 'TON'];
const STABLE = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD'];

function classifyIndia(s) {
  let und = null, rest = null;
  for (const p of [...INDICES, ...COMMODS, ...CURRS]) if (s.startsWith(p) && /^\d{2}/.test(s.slice(p.length))) { und = p; rest = s.slice(p.length); break; }
  if (!und) { const g = s.match(/^([A-Z&\-]+?)(\d{2}(?:[A-Z]{3}|[1-9OND]\d{2}).*(?:CE|PE|FUT))$/); if (g) { und = g[1]; rest = g[2]; } }
  if (!und) return null;
  const family = INDICES.includes(und) ? 'Index' : COMMODS.includes(und) ? 'Commodity' : CURRS.includes(und) ? 'Currency' : 'Stock';
  let m, y, mo, dd = null, kind, strike = null, type = 'Monthly';
  if ((m = rest.match(/^(\d{2})([A-Z]{3})FUT$/)) && MON[m[2]]) { y = 2000 + +m[1]; mo = MON[m[2]]; kind = 'FUT'; }
  else if ((m = rest.match(/^(\d{2})([A-Z]{3})(\d+(?:\.\d+)?)(CE|PE)$/)) && MON[m[2]]) { y = 2000 + +m[1]; mo = MON[m[2]]; strike = +m[3]; kind = m[4]; }
  else if ((m = rest.match(/^(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/))) { y = 2000 + +m[1]; mo = WMON[m[2]] || +m[2]; dd = +m[3]; strike = +m[4]; kind = m[5]; type = 'Weekly'; }
  else return null;
  const exp = dd ? new Date(Date.UTC(y, mo - 1, dd)) : monthlyExpiry(y, mo, und, family);
  const isOpt = kind !== 'FUT';
  return { market: 'India', kind, underlying: und, family, strike, mult: 1, group: `${family} ${isOpt ? 'options' : 'futures'}`, expiry: exp ? iso(exp) : null, expiryType: isOpt ? type : 'Futures', weekday: exp ? DOW[exp.getUTCDay()] : null, year: y };
}

function usOption(und, y, mo, dd, cp, strike) {
  const exp = new Date(Date.UTC(y, mo - 1, dd));
  const third = (() => { const d = new Date(Date.UTC(y, mo - 1, 1)); let f = 0; while (true) { if (d.getUTCDay() === 5) { f++; if (f === 3) break; } d.setUTCDate(d.getUTCDate() + 1); } return d.getUTCDate(); })();
  const family = US_INDEX.includes(und.replace(/W$/, '')) ? 'Index' : 'Stock';
  return { market: 'US', kind: cp === 'C' ? 'CE' : 'PE', underlying: und, family, strike, mult: 100, group: `${family} options`, expiry: iso(exp), expiryType: dd === third ? 'Monthly' : 'Weekly', weekday: DOW[exp.getUTCDay()], year: y };
}

function classifyUS(s) {
  let m = s.match(/^([A-Z.]{1,6})[\s\-_]?(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);            // OCC: AAPL240119C00150000
  if (m) return usOption(m[1], 2000 + +m[2], +m[3], +m[4], m[5], +m[6] / 1000);
  m = s.match(/^([A-Z.]{1,6})\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+([\d.]+)\s*([CP])/);      // AAPL 01/19/2024 150 C
  if (m) return usOption(m[1], +m[4] < 100 ? 2000 + +m[4] : +m[4], +m[2], +m[3], m[6], +m[5]);
  m = s.match(/^([A-Z.]{1,6})\s+(\d{2})([A-Z]{3})(\d{2})\s+([\d.]+)\s*([CP])/);             // AAPL 19JAN24 150 C
  if (m && MON[m[3]]) return usOption(m[1], 2000 + +m[4], MON[m[3]], +m[2], m[6], +m[5]);
  m = s.match(/^\/?([A-Z]{1,3})([FGHJKMNQUVXZ])(\d{1,2})$/);                                 // CME: ESZ4 / CLF25
  if (m && CME[m[1]]) { const y = +m[3] < 10 ? 2020 + +m[3] : 2000 + +m[3]; return { market: 'US', kind: 'FUT', underlying: m[1], family: /ES|NQ|YM|RTY|MES|MNQ/.test(m[1]) ? 'Index' : 'Commodity', strike: null, mult: 1, group: (/ES|NQ|YM|RTY|MES|MNQ/.test(m[1]) ? 'Index' : 'Commodity') + ' futures', expiry: null, expiryType: 'Futures', weekday: null, year: y }; }
  return null;
}

function classifyCrypto(s) {
  const m = s.match(/^([A-Z0-9]{2,10})[-\/_]?(USDT|USDC|BUSD|USD|EUR|INR|BTC|ETH)(\s?PERP|PERP|-PERP|SWAP)?$/);
  if (!m) return null;
  const base = m[1];
  if (FIAT.includes(base)) return null;
  if (!CRYPTO.includes(base) && !/^[A-Z0-9]{2,6}$/.test(base)) return null;
  if (!CRYPTO.includes(base) && !STABLE.includes(m[2]) && !/USD/.test(m[2])) return null;
  const perp = !!m[3];
  return { market: 'Crypto', kind: perp ? 'FUT' : 'EQ', underlying: base, family: 'Crypto', strike: null, mult: 1, group: perp ? 'Crypto perpetuals' : 'Crypto spot', expiry: null, expiryType: perp ? 'Futures' : null, weekday: null, year: null };
}

function classifyFX(s) {
  const m = s.match(/^([A-Z]{3})[-\/_]?([A-Z]{3})$/);
  if (!m || !FIAT.includes(m[1]) || !FIAT.includes(m[2])) return null;
  return { market: 'FX', kind: 'EQ', underlying: m[1] + m[2], family: 'FX', strike: null, mult: 1, group: 'FX pairs', expiry: null, expiryType: null, weekday: null, year: null };
}

function classify(sym) {
  const s = String(sym).toUpperCase().replace(/\s+/g, ' ').trim().replace(/^(NSE|BSE|MCX|NFO|BFO|CDS|NASDAQ|NYSE|ARCA|BATS|SMART|BINANCE|COINBASE)[:\-_]/, '');
  const flat = s.replace(/\s+/g, '');
  return classifyIndia(flat) || classifyUS(s) || classifyUS(flat) || classifyFX(flat) || classifyCrypto(flat) ||
    { market: null, kind: 'EQ', underlying: flat, family: 'Equity', group: 'Equity / cash', mult: 1, expiry: null, expiryType: null, weekday: null, year: null, strike: null };
}

/* ---------- generic column detection ---------- */
const SYN = {
  symbol: ['tradingsymbol', 'symbol', 'scripname', 'scrip', 'scripsymbol', 'scriptname', 'stocksymbol', 'instrumentsymbol', 'instrument', 'instrumentname', 'contract', 'contractname', 'contractdescription', 'securityname', 'security', 'securitydescription', 'stockname', 'symbolname', 'tradingsymbolname', 'ticker', 'pair', 'scripcode', 'companyname', 'sharename', 'assetname', 'underlying', 'coin', 'asset', 'market', 'product', 'description', 'stock', 'share', 'script', 'scrips', 'name', 'particulars'],
  qty: ['quantity', 'qty', 'qtysold', 'soldqty', 'sellqty', 'closedqty', 'closedquantity', 'noofunits', 'lots', 'lotqty', 'volume', 'executedqty', 'filledquantity', 'fillqty', 'shares', 'contracts', 'size', 'units', 'amountcoin', 'tradedqty', 'tradedquantity', 'netqty', 'totalqty', 'filledqty', 'execqty', 'executedquantity', 'noofshares', 'shares'],
  buy: ['buyvalue', 'buyamount', 'purchaseamount', 'purchaseamt', 'totalpurchase', 'costvalue', 'costbasis', 'totalcost', 'cost', 'costofacquisition', 'acquisitioncost', 'investedvalue', 'investedamount', 'investment', 'boughtvalue', 'entryvalue', 'buytotal', 'buyamountrs', 'buyvaluers', 'buyamt', 'totalbuyvalue', 'purchasevalue', 'buyturnover', 'grossbuyvalue', 'buyval', 'totalbuyamount', 'buyconsideration'],
  sell: ['sellvalue', 'sellamount', 'saleamount', 'salesvalue', 'salevaluers', 'sellingvalue', 'sellingprice', 'proceeds', 'saleproceeds', 'totalproceeds', 'fullvalueofconsideration', 'realisedvalue', 'realizedvalue', 'redemptionvalue', 'soldvalue', 'exitvalue', 'selltotal', 'sellamountrs', 'sellvaluers', 'sellamt', 'totalsellvalue', 'salevalue', 'sellturnover', 'grosssellvalue', 'sellval', 'totalsellamount', 'sellconsideration', 'saleconsideration'],
  buyPrice: ['buyprice', 'avgbuyprice', 'buyavgrate', 'avgcost', 'averagecost', 'costprice', 'buyrateavg', 'buyavgprice', 'averagebuyprice', 'buyrate', 'entryprice', 'buyavg', 'purchaseprice'],
  sellPrice: ['sellprice', 'avgsellprice', 'sellavgrate', 'avgsaleprice', 'averagesaleprice', 'sellavgprice', 'averagesellprice', 'sellrate', 'exitprice', 'sellavg', 'saleprice'],
  pnl: ['realizedpl', 'realisedpl', 'gainloss', 'realisedgainloss', 'realizedgainloss', 'netgainloss', 'totalgainloss', 'pandl', 'netrealisedpl', 'netrealizedpl', 'grossrealisedpl', 'realisedprofitloss', 'realizedprofitloss', 'realisedpnlrs', 'realizedplrs', 'netresult', 'result', 'tradingprofit', 'shorttermgain', 'stcg', 'intradayprofit', 'speculativeprofit', 'gain', 'realizedpnl', 'realisedpnl', 'realizedprofit', 'pnl', 'pl', 'netpnl', 'netpl', 'profitloss', 'plrealized', 'profit', 'netprofit', 'grosspl', 'grossprofit', 'totalpnl', 'bookedpnl', 'bookedprofit'],
  pct: ['realizedplpct', 'realizedplpercent', 'realisedplpct', 'plpct', 'pnlpct', 'returnpct', 'plpercentage', 'changepct'],
  openQty: ['openquantity', 'openqty', 'closingqty', 'balancequantity'],
  openValue: ['openvalue'],
  unreal: ['unrealizedpl', 'unrealisedpl', 'unrealizedpnl', 'mtm', 'notionalpl'],
  side: ['tradetype', 'buysell', 'side', 'transactiontype', 'trnstype', 'transtype', 'bs', 'buyorsell'],
  price: ['price', 'tradeprice', 'tprice', 'fillprice', 'executedprice', 'avgfillprice', 'limitprice', 'rate', 'executionprice', 'avgprice', 'averageprice', 'tradedprice', 'fillprice'],
  tradeDate: ['datetime', 'dateutc', 'dateandtime', 'tradedatetime', 'tradedate', 'date', 'activitydate', 'transactiontime', 'createdtime', 'closedtime', 'orderdate', 'transactiondate', 'trddate', 'tradedatetime', 'orderexecutiontime', 'executiontime', 'timestamp', 'exchangetimestamp'],
  time: ['datetime', 'dateutc', 'dateandtime', 'ordertime', 'time', 'orderexecutiontime', 'executiontime', 'tradetime', 'tradedatetime'],
  entryDate: ['entrydate', 'buydate', 'purchasedate', 'opendate'],
  exitDate: ['exitdate', 'selldate', 'saledate', 'closedate'],
  fees: ['charges', 'totalcharges', 'brokerage', 'fees', 'fee', 'commission', 'commfee', 'taxes', 'totaltaxesandcharges'],
  exchange: ['exchange', 'exch', 'segment', 'series']
};
function matchHeader(cells) {
  const normed = cells.map(norm);
  const map = {}, used = new Set();
  const take = (key, idx) => { if (idx >= 0 && !used.has(idx)) { map[key] = idx; used.add(idx); return true; } return false; };
  for (const key in SYN) {
    let done = false;
    for (const syn of SYN[key]) { const idx = normed.indexOf(syn); if (idx >= 0 && take(key, idx)) { done = true; break; } }
    if (done) continue;
    for (const syn of SYN[key]) {
      if (syn.length <= 4) continue;
      const idx = normed.findIndex((n, j) => n && n.length > 3 && !used.has(j) && n.includes(syn));
      if (take(key, idx)) break;
    }
  }
  return map;
}
function tableKind(map) {
  if (map.symbol == null) return null;
  if (map.side != null && map.qty != null && (map.price != null || map.buy != null)) return 'fills';
  if (map.pnl != null || (map.buy != null && map.sell != null) || (map.buyPrice != null && map.sellPrice != null && map.qty != null)) return 'aggregate';
  return null;
}

/* ---------- sheet parsing ---------- */
const SUMMARY_KEYS = { charges: 'charges', othercreditdebit: 'other', realizedpl: 'realized', unrealizedpl: 'unrealized' };
function parseSheet(rows, sheetName, fileName, override) {
  const out = { sheet: sheetName, file: fileName, summary: {}, heads: [], symbols: [], fills: [], debits: [], clientId: null, from: null, to: null, segment: sheetName, mapped: null };
  let mode = null, map = null;
  if (override && Object.keys(override).length) { map = { ...override }; mode = tableKind(map) || 'aggregate'; out.mapped = { kind: mode, sheet: sheetName, manual: true, cols: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, 'col ' + (v + 1)])) }; }
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map(c => (c == null ? null : c));
    const nonNull = cells.filter(c => c !== null && c !== '');
    if (!nonNull.length) { if (mode === 'heads' || mode === 'debits') mode = null; continue; }
    const first = nonNull[0], firstNorm = norm(first);
    if (firstNorm === 'clientid' && nonNull[1] != null) { out.clientId = String(nonNull[1]); continue; }
    const title = typeof first === 'string' ? first : '';
    const pm = title.match(/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
    if (pm) {
      out.from = pm[1]; out.to = pm[2];
      const sm = title.match(/(?:P&L Statement|Statement)\s+for\s+(.+?)\s+from/i);
      if (sm && !/debits/i.test(title)) out.segment = sm[1].trim();
      continue;
    }
    const normed = cells.map(norm);
    if (normed.includes('accounthead')) { mode = 'heads'; continue; }
    if (normed.includes('particulars') && normed.includes('debit')) { map = { part: normed.indexOf('particulars'), date: normed.indexOf('postingdate'), debit: normed.indexOf('debit'), credit: normed.indexOf('credit') }; mode = 'debits'; continue; }
    let cand = override ? {} : matchHeader(cells), kind = override ? null : tableKind(cand), labels = null;
    const textCells = nonNull.filter(c => typeof c === 'string' && num(c) == null).length;
    if (!override && !kind && i > 0 && mode !== 'aggregate' && mode !== 'fills' && textCells >= 3 && textCells >= nonNull.length - 1) {
      const above = (rows[i - 1] || []).map(c => (c == null ? '' : String(c)));
      if (above.filter(Boolean).length >= 1) {
        let carry = ''; const merged = cells.map((c, j) => { if (above[j]) carry = above[j]; return `${carry} ${c == null ? '' : c}`.trim(); });
        const c2 = matchHeader(merged), k2 = tableKind(c2);
        if (k2) { cand = c2; kind = k2; }
      }
    }
    if (kind && !override && i + 1 < rows.length) {
      // header followed by a sub-header row (e.g. Buy → Qty / Rate / Value): merge the two
      const next = (rows[i + 1] || []).map(c => (c == null ? null : c));
      const nextNN = next.filter(c => c !== null && c !== '');
      const nextText = nextNN.filter(c => typeof c === 'string' && num(c) == null).length;
      if (nextText >= 3 && nextText === nextNN.length) {
        let carry = ''; const merged = next.map((c, j) => { if (cells[j] != null && cells[j] !== '') carry = String(cells[j]); return `${carry} ${c == null ? '' : c}`.trim(); });
        const c2 = matchHeader(merged), k2 = tableKind(c2);
        if (k2) { cand = c2; kind = k2; i++; labels = merged; }
      }
    }
    if (kind && nonNull.length >= 3) { map = cand; mode = kind; out.mapped = { kind, sheet: sheetName, cols: Object.fromEntries(Object.entries(cand).map(([k, v]) => [k, String((labels || cells)[v])])) }; continue; }

    if (mode === 'aggregate' || mode === 'fills') {
      let sym = cells[map.symbol];
      if (typeof sym === 'number' && Number.isInteger(sym) && sym >= 100000) sym = String(sym); // BSE scrip codes
      if (sym == null || sym === '' || typeof sym === 'number') { if (!override) mode = null; continue; }
      if (override && SYN.symbol.includes(norm(sym))) continue;
      if (/^(grand\s*)?(sub\s*)?total\b|^net\b|^summary\b/i.test(String(sym).trim())) continue;
      const g = k => (map[k] != null ? cells[map[k]] : null);
      const qty = Math.abs(num(g('qty')) || 0);
      if (mode === 'fills') {
        const sideRaw = String(g('side') || '').toLowerCase();
        const side = /sell|sale|^s$|sld/.test(sideRaw) ? 'S' : /buy|^b$|bot/.test(sideRaw) ? 'B' : null;
        const price = num(g('price'));
        if (!side || !qty || price == null) continue;
        const d = parseDate(g('tradeDate')), tm = parseTime(g('time')) || parseTime(g('tradeDate'));
        out.fills.push({ symbol: String(sym).trim(), side, qty, price, date: d ? iso(d) : null, dow: d ? DOW[d.getUTCDay()] : null, hour: tm ? tm.h : null, minute: tm ? tm.m : null, fees: Math.abs(num(g('fees')) || 0), sheet: sheetName });
        continue;
      }
      let buy = num(g('buy')), sell = num(g('sell'));
      if (buy == null && g('buyPrice') != null) buy = (num(g('buyPrice')) || 0) * qty;
      if (sell == null && g('sellPrice') != null) sell = (num(g('sellPrice')) || 0) * qty;
      buy = Math.abs(buy || 0); sell = Math.abs(sell || 0);
      let pnl = num(g('pnl'));
      if (pnl == null) { if (!buy && !sell) continue; pnl = sell - buy; }
      if (!buy && !sell && !pnl) continue;
      let pct = map.pct != null ? num(g('pct')) : null;
      if (pct == null) pct = buy ? (pnl / buy) * 100 : 0;
      const entry = parseDate(g('entryDate')), exitd = parseDate(g('exitDate')) || parseDate(g('tradeDate'));
      out.symbols.push({
        symbol: String(sym).trim(), segment: out.segment, sheet: sheetName, ...classify(sym),
        qty, buy, sell, pnl, pct,
        entryDate: entry ? iso(entry) : null, exitDate: exitd ? iso(exitd) : null,
        entryDow: entry ? DOW[entry.getUTCDay()] : null, entryHour: null,
        holdDays: entry && exitd ? Math.round((exitd - entry) / 86400000) : null,
        openQty: Math.abs(num(g('openQty')) || 0), openValue: Math.abs(num(g('openValue')) || 0), unreal: num(g('unreal')) || 0,
        fees: Math.abs(num(g('fees')) || 0), source: 'statement'
      });
      continue;
    }
    if (mode === 'heads') { const amt = num(nonNull[1]); if (typeof first === 'string' && amt != null) out.heads.push({ head: first.replace(/\s*-\s*Z\s*$/, '').trim(), amount: amt }); continue; }
    if (mode === 'debits') { const part = cells[map.part]; if (part == null || part === '') continue; out.debits.push({ text: String(part), date: map.date >= 0 ? String(cells[map.date] || '') : '', debit: num(cells[map.debit]) || 0, credit: num(cells[map.credit]) || 0 }); continue; }
    const key = SUMMARY_KEYS[firstNorm];
    if (key && nonNull.length >= 2 && num(nonNull[1]) != null && out.summary[key] == null) out.summary[key] = num(nonNull[1]);
  }
  return out;
}
/* ---------- automatic column inference (when header names don't match) ----------
 * Looks at the data itself: which column holds symbol-like text, which holds signed P&L,
 * which are buy/sell values, quantities, prices, sides and dates. Header words still count as hints.
 */
const HINT = {
  symbol: /symbol|scrip|script|stock|share|instrument|contract|security|ticker|asset|coin|pair|company|underlying|name|particular|description/,
  pnl: /p&?l|pnl|profit|loss|gain|result|realis|realiz|net/,
  pct: /%|pct|percent|return/,
  buy: /buy|purchase|cost|invest|entry|bought|acqui/,
  sell: /sell|sale|sold|proceed|exit|redemp|realisedvalue|realizedvalue/,
  value: /value|amount|amt|total|consideration|turnover|basis|proceed|cost/,
  priceW: /price|rate|avg|average/,
  qty: /qty|quantity|units|shares|lots|contracts|volume|size|nos/,
  side: /side|type|buy\/?sell|b\/s|action|transaction/,
  date: /date|time|day/,
};
function profileColumn(vals) {
  const nn = vals.filter(v => v != null && v !== '');
  const n = nn.length || 1;
  let numN = 0, neg = 0, pos = 0, sym = 0, side = 0, ints = 0, serial = 0, dateStr = 0, sum = 0, textLen = 0;
  const distinct = new Set();
  for (const v of nn) {
    const s = String(v).trim(); distinct.add(s);
    const x = typeof v === 'number' ? v : num(v);
    const looksDate = typeof v === 'string' && /^\d{1,4}[-/.][a-z0-9]{1,3}[-/.]\d{2,4}/i.test(s);
    if (looksDate) dateStr++;
    if (x != null && !looksDate) { numN++; if (x < 0) neg++; else if (x > 0) pos++; sum += Math.abs(x); if (Number.isInteger(x)) { ints++; if (x > 30000 && x < 60000) serial++; } }
    else { textLen += s.length; if (/^(buy|sell|b|s|bot|sld|sale|purchase|bought|sold)$/i.test(s)) side++; if (/[a-z]/i.test(s) && /^[a-z0-9&\-._ /:()]{2,48}$/i.test(s)) sym++; }
  }
  const textN = nn.length - numN - dateStr;
  return { n: nn.length, fill: nn.length / Math.max(1, vals.length), numShare: numN / n, textShare: textN / n, negShare: neg / n, posShare: pos / n, symShare: sym / n, sideShare: side / n, intShare: numN ? ints / numN : 0, serialShare: numN ? serial / numN : 0, dateShare: dateStr / n, mean: numN ? sum / numN : 0, distinct: distinct.size / n, avgText: textN ? textLen / textN : 0 };
}
function inferTable(rows) {
  const limit = Math.min(rows.length, 120);
  const isBlank = (r) => !(r || []).some(c => c != null && c !== '');
  let best = null;
  for (let h = -1; h < limit; h++) {
    const header = h >= 0 ? (rows[h] || []) : [];
    if (h >= 0 && header.filter(c => typeof c === 'string' && c.trim() && num(c) == null).length < 2) continue;
    // data block: rows after the header until two blank rows in a row
    const start = h + 1; let end = start, blanks = 0;
    for (let i = start; i < rows.length && i < start + 5000; i++) { if (isBlank(rows[i])) { if (++blanks >= 2) break; } else { blanks = 0; end = i + 1; } }
    const data = rows.slice(start, end).filter(r => !isBlank(r));
    if (data.length < 2) continue;
    const width = Math.max(...data.map(r => (r || []).length), header.length);
    const above = h > 0 ? (rows[h - 1] || []) : [];
    let carry = '';
    const heads = [];
    for (let c = 0; c < width; c++) { if (above[c]) carry = String(above[c]); heads.push(norm(`${carry} ${header[c] == null ? '' : header[c]}`)); }
    const rawHeads = heads.map((x, c) => `${above[c] || ''} ${header[c] || ''}`.toLowerCase());
    const prof = []; for (let c = 0; c < width; c++) prof.push(profileColumn(data.map(r => (r || [])[c])));
    const hint = (c, re) => re.test(rawHeads[c]);
    const used = new Set();
    const pickBest = (scoreFn, minScore) => { let bi = -1, bs = minScore; for (let c = 0; c < width; c++) { if (used.has(c)) continue; const sc = scoreFn(prof[c], c); if (sc > bs) { bs = sc; bi = c; } } if (bi >= 0) used.add(bi); return bi; };
    const map = {};
    // symbol: mostly symbol-like text, many distinct values
    map.symbol = pickBest((p, c) => p.fill < 0.6 ? -1 : p.symShare * 3 + p.textShare + (hint(c, HINT.symbol) ? 2 : 0) + Math.min(1, p.distinct * 2) - (p.sideShare > 0.6 ? 5 : 0) - (p.avgText > 40 ? 2 : 0), 2.2);
    if (map.symbol < 0) continue;
    const side = pickBest((p, c) => p.sideShare > 0.8 ? 5 + (hint(c, HINT.side) ? 1 : 0) : -1, 1);
    const date = pickBest((p, c) => (hint(c, HINT.date) ? 2 : 0) + p.dateShare * 3 + (p.serialShare > 0.9 && hint(c, HINT.date) ? 2 : 0), 2.5);
    const numeric = (p) => p.numShare > 0.7;
    if (side >= 0) {
      map.side = side; if (date >= 0) map.tradeDate = date;
      map.qty = pickBest((p, c) => numeric(p) ? (hint(c, HINT.qty) ? 3 : 0) + p.intShare + (p.negShare < 0.05 ? 0.5 : -2) : -1, 0.9);
      map.price = pickBest((p, c) => numeric(p) ? (hint(c, HINT.priceW) ? 3 : 0) + (p.intShare < 0.5 ? 1 : 0) + (p.negShare < 0.05 ? 0.5 : -2) : -1, 0.9);
      if (map.qty >= 0 && map.price >= 0) { const r = { start, end, map, score: data.length * 2 + 3 }; if (!best || r.score > best.score) best = r; }
      continue;
    }
    map.pnl = pickBest((p, c) => numeric(p) && !hint(c, HINT.pct) ? (hint(c, HINT.pnl) ? 3 : 0) + (p.negShare > 0.05 && p.posShare > 0.05 ? 2 : 0) - (hint(c, HINT.buy) || hint(c, HINT.sell) ? 2 : 0) : -1, 1.9);
    const buyV = pickBest((p, c) => numeric(p) && hint(c, HINT.buy) && !hint(c, HINT.qty) ? 2 + (hint(c, HINT.value) ? 2 : 0) - (hint(c, HINT.priceW) && !hint(c, HINT.value) ? 3 : 0) : -1, 2.9);
    const sellV = pickBest((p, c) => numeric(p) && hint(c, HINT.sell) && !hint(c, HINT.qty) ? 2 + (hint(c, HINT.value) ? 2 : 0) - (hint(c, HINT.priceW) && !hint(c, HINT.value) ? 3 : 0) : -1, 2.9);
    if (buyV >= 0) map.buy = buyV; if (sellV >= 0) map.sell = sellV;
    if (map.buy == null || map.sell == null) {
      const bp = pickBest((p, c) => numeric(p) && hint(c, HINT.buy) && hint(c, HINT.priceW) ? 3 : -1, 2); const sp = pickBest((p, c) => numeric(p) && hint(c, HINT.sell) && hint(c, HINT.priceW) ? 3 : -1, 2);
      if (bp >= 0) map.buyPrice = bp; if (sp >= 0) map.sellPrice = sp;
    }
    const q = pickBest((p, c) => numeric(p) && hint(c, HINT.qty) ? 3 : -1, 2); if (q >= 0) map.qty = q;
    if (date >= 0) map.exitDate = date;
    if (map.pnl < 0) delete map.pnl;
    const ok = map.pnl != null || (map.buy != null && map.sell != null) || (map.buyPrice != null && map.sellPrice != null && map.qty != null);
    if (!ok) continue;
    const score = data.length * 2 + (map.pnl != null ? 2 : 0) + (map.buy != null ? 1 : 0) + (h >= 0 ? 1 : 0);
    if (!best || score > best.score) best = { start, end, map, score };
  }
  return best;
}
/** parseSheet, then — if no trade table was recognised — infer the columns from the data itself. */
function parseSheetAuto(rows, sheetName, fileName) {
  const base = parseSheet(rows, sheetName, fileName);
  if (base.symbols.length || base.fills.length) return base;
  const guess = inferTable(rows);
  if (!guess) return base;
  const part = parseSheet(rows.slice(guess.start, guess.end), sheetName, fileName, guess.map);
  if (!part.symbols.length && !part.fills.length) return base;
  return { ...base, symbols: part.symbols, fills: part.fills, mapped: { ...part.mapped, auto: true } };
}

function parseWorkbook(XLSX, wb, fileName, override) {
  return wb.SheetNames.map(name => { const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true }); return override ? parseSheet(rows, name, fileName, override) : parseSheetAuto(rows, name, fileName); });
}

/* ---------- tradebook fills → round trips (flat to flat) ---------- */
function buildRoundTrips(fills) {
  const bySym = {};
  for (const f of fills) (bySym[f.symbol] = bySym[f.symbol] || []).push(f);
  const trades = [], open = [];
  for (const sym in bySym) {
    const list = bySym[sym].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || ((a.hour || 0) * 60 + (a.minute || 0)) - ((b.hour || 0) * 60 + (b.minute || 0)));
    const meta = classify(sym), mult = meta.mult || 1;
    let pos = 0, buy = 0, sell = 0, peak = 0, fees = 0, legs = 0, first = null;
    for (const f of list) {
      if (!first) first = f;
      legs++; fees += f.fees || 0;
      if (f.side === 'B') { buy += f.qty * f.price * mult; pos += f.qty; } else { sell += f.qty * f.price * mult; pos -= f.qty; }
      peak = Math.max(peak, Math.abs(pos));
      if (pos === 0) {
        const pnl = sell - buy;
        trades.push({
          symbol: sym, segment: first.sheet, sheet: first.sheet, ...meta,
          qty: peak, buy, sell, pnl, pct: buy ? pnl / buy * 100 : 0,
          entryDate: first.date, exitDate: f.date, entryDow: first.dow, exitDow: f.dow,
          entryHour: first.hour, exitHour: f.hour, nLegs: legs,
          holdDays: first.date && f.date ? Math.round((new Date(f.date) - new Date(first.date)) / 86400000) : null,
          direction: first.side === 'B' ? 'Long' : 'Short',
          openQty: 0, openValue: 0, unreal: 0, fees, sellDays: 0, source: 'tradebook'
        });
        buy = sell = peak = fees = 0; legs = 0; first = null;
      }
    }
    if (pos !== 0) open.push({ symbol: sym, qty: Math.abs(pos), side: pos > 0 ? 'Long' : 'Short' });
  }
  return { trades, open };
}

/* ---------- helpers ---------- */
const inr = v => money(v);
const pct = (v, d = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
const wrs = x => Math.round(x.winRate * 100) + '%';
function bucketize(trades, keyFn, order) {
  const map = new Map();
  for (const t of trades) { const k = keyFn(t); if (k == null) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
  let keys = [...map.keys()];
  if (order) keys = order.filter(k => map.has(k)).concat(keys.filter(k => !order.includes(k)));
  return keys.map(k => { const a = map.get(k), w = a.filter(t => t.pnl > 0);
    return { key: k, n: a.length, wins: w.length, winRate: a.length ? w.length / a.length : 0, pnl: sum(a, t => t.pnl), turnover: sum(a, t => t.buy + t.sell), avgPct: a.length ? sum(a, t => t.pct) / a.length : 0, trades: a }; });
}
function classifyDebit(d) {
  const t = d.text;
  const m = t.match(/DP Charges for Sale of\s+(\S+)\s+on\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return { type: 'dp', symbol: m[1].toUpperCase(), date: `${m[4]}-${m[3]}-${m[2]}` };
  if (/auto\s*square\s*off|call and trade/i.test(t)) return { type: 'autosq' };
  if (/collateral|margin shortfall|shortfall|interest|delayed payment|penalty/i.test(t)) return { type: 'margin' };
  if (/\bAMC\b|account maintenance/i.test(t)) return { type: 'amc' };
  return { type: 'other' };
}
function dedupe(items) {
  const out = [];
  for (const it of items) {
    const keys = it.keys || [];
    const dup = out.find(o => { const ok = o.keys || []; if (!keys.length || !ok.length) return false; const inter = keys.filter(k => ok.includes(k)).length; return inter / Math.min(keys.length, ok.length) >= 0.75; });
    if (!dup) out.push(it);
    else if ((it.impact || 0) > (dup.impact || 0) * 1.5) out[out.indexOf(dup)] = it;
  }
  return out;
}

/* ---------- analyze ---------- */
function detectCurrency(sheets, trades, forced) {
  if (forced) return forced;
  for (const sh of sheets) { // explicit currency symbols seen in header names
    const cols = sh.mapped ? Object.values(sh.mapped.cols).join(' ') : '';
    const code = (cols.match(/\b(INR|USD|EUR|GBP|JPY|AUD|CAD|SGD|HKD|CHF|AED|USDT)\b/) || [])[1];
    if (code) return code;
    const sym = (cols.match(/[₹$€£¥]/) || [])[0];
    if (sym && SYM2CUR[sym]) return SYM2CUR[sym];
  }
  const counts = {};
  for (const t of trades) if (t.market) counts[t.market] = (counts[t.market] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return 'INR';
  return { India: 'INR', US: 'USD', Crypto: 'USD', FX: 'USD' }[top[0]] || 'USD';
}

function analyze(sheets, cfg) {
  cfg = cfg || {};
  const allFills = [].concat(...sheets.map(s => s.fills));
  const aggRows = [].concat(...sheets.map(s => s.symbols));
  const rt = allFills.length ? buildRoundTrips(allFills) : { trades: [], open: [] };
  const useTradebook = rt.trades.length > 0;
  // A statement whose symbols are mostly (75%+) in the tradebook is the same account (used for charges only);
  // a statement with different symbols is another account/broker, so its positions are added.
  let extraRows = [];
  if (useTradebook) {
    const tbSyms = new Set(rt.trades.map(t => t.symbol.toUpperCase()));
    for (const sh of sheets) {
      if (!sh.symbols.length || sh.fills.length) continue;
      const syms = new Set(sh.symbols.map(t => t.symbol.toUpperCase()));
      const overlap = [...syms].filter(x => tbSyms.has(x)).length / Math.max(1, syms.size);
      if (overlap < 0.75) extraRows = extraRows.concat(sh.symbols);
    }
  }
  const trades = (useTradebook ? rt.trades.concat(extraRows) : aggRows).filter(t => (t.buy > 0 && t.sell > 0) || t.pnl !== 0);

  const debits = [];
  for (const s of sheets) for (const d of s.debits) debits.push({ ...d, ...classifyDebit(d) });
  const heads = {};
  for (const s of sheets) for (const h of s.heads) heads[h.head] = (heads[h.head] || 0) + h.amount;

  let charges = 0, other = 0, unrealized = 0, hasSummary = false;
  for (const s of sheets) {
    if (s.summary.charges != null) { charges += s.summary.charges; hasSummary = true; }
    if (s.summary.other != null) other += s.summary.other;
    if (s.summary.unrealized != null) unrealized += s.summary.unrealized;
  }
  if (!hasSummary) charges = sum(Object.values(heads)) || sum(trades, t => t.fees || 0);
  if (!unrealized) unrealized = sum(aggRows, t => t.unreal || 0);
  if (!sheets.some(s => s.summary.other != null) && debits.length) other = -sum(debits, d => d.debit - d.credit);

  const mkCounts = {};
  for (const t of trades) { const k = t.market || 'Unclassified equities'; mkCounts[k] = (mkCounts[k] || 0) + 1; }
  const known = Object.entries(mkCounts).filter(([k]) => k !== 'Unclassified equities').sort((a, b) => b[1] - a[1]);
  const market = known.length ? known[0][0] : null;
  const markets = Object.entries(mkCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ market: k, n: v }));
  setCurrency(detectCurrency(sheets, trades, cfg.currency));

  const dpBySym = {};
  for (const d of debits.filter(d => d.type === 'dp')) (dpBySym[d.symbol] = dpBySym[d.symbol] || []).push(d.date);
  const turnover = sum(trades, t => t.buy + t.sell);
  for (const t of trades) {
    t.turnover = t.buy + t.sell;
    t.isOpt = t.kind === 'CE' || t.kind === 'PE';
    t.sellDays = dpBySym[t.symbol.toUpperCase()] ? dpBySym[t.symbol.toUpperCase()].length : (t.sellDays || 0);
    t.style = t.kind !== 'EQ' ? 'F&O' : (t.holdDays != null ? (t.holdDays === 0 ? 'Intraday' : 'Delivery') : (t.sellDays > 0 ? 'Delivery' : 'Intraday / BTST'));
    t.estCharges = turnover ? charges * t.turnover / turnover : 0;
    t.netEst = t.pnl - t.estCharges;
    t.avgBuy = t.qty ? t.buy / t.qty : 0;
    t.wentToZero = t.isOpt && t.pnl < 0 && t.sell < 0.1 * t.buy;
    t.decayedWin = t.isOpt && t.pnl > 0 && t.buy < 0.1 * t.sell;
  }
  trades.sort((a, b) => String(a.exitDate || '').localeCompare(String(b.exitDate || '')));

  const dates = trades.map(t => t.exitDate || t.entryDate).filter(Boolean).sort();
  const from = sheets.map(s => s.from).filter(Boolean).sort()[0] || dates[0] || null;
  const to = sheets.map(s => s.to).filter(Boolean).sort().slice(-1)[0] || dates[dates.length - 1] || null;
  const clientId = (sheets.find(s => s.clientId) || {}).clientId || null;

  const winners = trades.filter(t => t.pnl > 0), losers = trades.filter(t => t.pnl < 0);
  const realizedSum = sum(trades, t => t.pnl);
  const grossProfit = sum(winners, t => t.pnl), grossLoss = -sum(losers, t => t.pnl);
  const avgWin = winners.length ? grossProfit / winners.length : 0, avgLoss = losers.length ? grossLoss / losers.length : 0;
  const net = realizedSum - charges + other;

  let eq = 0, peak = 0, maxDD = 0; const curve = [];
  for (const t of trades) { eq += t.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); curve.push({ date: t.exitDate, eq }); }

  const m = {
    from, to, clientId, source: useTradebook ? 'tradebook' : 'statement', hasDates: dates.length > 0,
    market, markets, currency: CUR,
    n: trades.length, wins: winners.length, losses: losers.length,
    winRate: trades.length ? winners.length / trades.length : 0,
    grossProfit, grossLoss, profitFactor: grossLoss ? grossProfit / grossLoss : Infinity,
    avgWin, avgLoss, payoff: avgLoss ? avgWin / avgLoss : Infinity,
    avgWinPct: winners.length ? sum(winners, t => t.pct) / winners.length : 0,
    avgLossPct: losers.length ? -sum(losers, t => t.pct) / losers.length : 0,
    medWinPct: median(winners.map(t => t.pct)),
    expectancy: trades.length ? realizedSum / trades.length : 0,
    realized: realizedSum, charges, other, net, unrealized, turnover,
    costPct: turnover ? (charges / (turnover / 2)) * 100 : 0,
    largestWin: winners.length ? Math.max(...winners.map(t => t.pnl)) : 0,
    largestLoss: losers.length ? Math.min(...losers.map(t => t.pnl)) : 0,
    maxDD, optShare: trades.length ? trades.filter(t => t.isOpt).length / trades.length : 0,
    openPositions: rt.open
  };

  const opts = trades.filter(t => t.isOpt), lin = trades.filter(t => !t.isOpt);
      const pc = CUR === 'INR' ? [5, 20, 50, 150] : [0.5, 2, 5, 15];
  const premOrder = [`Under ${money(pc[0])}`, `${money(pc[0])}–${money(pc[1])}`, `${money(pc[1])}–${money(pc[2])}`, `${money(pc[2])}–${money(pc[3])}`, `${money(pc[3])}+`];
  const premKey = t => { const p = t.avgBuy / (t.mult || 1); return p < pc[0] ? premOrder[0] : p < pc[1] ? premOrder[1] : p < pc[2] ? premOrder[2] : p < pc[3] ? premOrder[3] : premOrder[4]; };
      const sc = CUR === 'INR' ? [1e4, 5e4, 2e5] : [250, 2500, 25000];
  const sizeOrder = [`Under ${money(sc[0])}`, `${money(sc[0])}–${money(sc[1])}`, `${money(sc[1])}–${money(sc[2])}`, `${money(sc[2])}+`];
  const sizeKey = t => t.buy < sc[0] ? sizeOrder[0] : t.buy < sc[1] ? sizeOrder[1] : t.buy < sc[2] ? sizeOrder[2] : sizeOrder[3];
  const lossOrder = ['0–1%', '1–3%', '3–5%', '5–10%', '10–25%', '25–50%', '50–90%', '90%+ (near zero)'];
  const lossKey = t => { const p = -t.pct; return p < 1 ? lossOrder[0] : p < 3 ? lossOrder[1] : p < 5 ? lossOrder[2] : p < 10 ? lossOrder[3] : p < 25 ? lossOrder[4] : p < 50 ? lossOrder[5] : p < 90 ? lossOrder[6] : lossOrder[7]; };
  const groupOrder = ['Index options', 'Stock options', 'Index futures', 'Stock futures', 'Commodity options', 'Commodity futures', 'Currency options', 'Currency futures', 'Crypto perpetuals', 'Crypto spot', 'FX pairs', 'Equity / cash'];
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const holdOrder = ['Same day', '1–5 days', '1–4 weeks', 'Over a month'];
  const holdKey = t => t.holdDays == null ? null : t.holdDays === 0 ? holdOrder[0] : t.holdDays <= 5 ? holdOrder[1] : t.holdDays <= 28 ? holdOrder[2] : holdOrder[3];
  const hrs = trades.map(t => t.entryHour).filter(h => h != null).sort((a, b) => a - b);
  const hLo = hrs.length ? hrs[Math.floor(hrs.length * 0.02)] : 9, hHi = hrs.length ? hrs[Math.floor(hrs.length * 0.98)] : 15;
  const span24 = (hHi - hLo) >= 12;
  const lab = h => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
  const cuts = span24 ? [6, 12, 18] : [hLo + Math.max(1, Math.round((hHi - hLo) / 4)), hLo + Math.round((hHi - hLo) / 2), hLo + Math.round(3 * (hHi - hLo) / 4)];
  const hourOrder = span24
    ? ['Overnight (to 6am)', 'Morning (6am–12pm)', 'Afternoon (12–6pm)', 'Evening (6pm on)']
    : [`Open to ${lab(cuts[0])}`, `${lab(cuts[0])}–${lab(cuts[1])}`, `${lab(cuts[1])}–${lab(cuts[2])}`, `${lab(cuts[2])} to close`];
  const hourKey = t => t.entryHour == null ? null : t.entryHour < cuts[0] ? hourOrder[0] : t.entryHour < cuts[1] ? hourOrder[1] : t.entryHour < cuts[2] ? hourOrder[2] : hourOrder[3];
  const byDay = {};
  for (const t of trades) if (t.entryDate) (byDay[t.entryDate] = byDay[t.entryDate] || []).push(t);
  const dayCounts = Object.entries(byDay).map(([d, a]) => ({ date: d, n: a.length, pnl: sum(a, t => t.pnl) }));
  const busyOrder = ['1 trade that day', '2–3 trades', '4–6 trades', '7+ trades'];
  const busyKey = t => { if (!t.entryDate || !useTradebook) return null; const n = byDay[t.entryDate].length; return n === 1 ? busyOrder[0] : n <= 3 ? busyOrder[1] : n <= 6 ? busyOrder[2] : busyOrder[3]; };

  const b = {
    group: bucketize(trades, t => t.group, groupOrder),
    weekday: bucketize(opts, t => t.weekday, dayOrder),
    premium: bucketize(opts, premKey, premOrder),
    expiryType: bucketize(opts, t => t.expiryType, ['Weekly', 'Monthly']),
    callPut: bucketize(opts, t => t.kind === 'CE' ? 'Calls (CE)' : 'Puts (PE)', ['Calls (CE)', 'Puts (PE)']),
    year: bucketize(trades.filter(t => t.year), t => String(t.year)).sort((x, y) => x.key.localeCompare(y.key)),
    size: bucketize(trades, sizeKey, sizeOrder),
    style: bucketize(trades.filter(t => t.kind === 'EQ'), t => t.style, ['Intraday', 'Intraday / BTST', 'Delivery']),
    lossDepth: bucketize(losers, lossKey, lossOrder),
    underlying: bucketize(trades, t => t.underlying).sort((x, y) => x.pnl - y.pnl),
    entryDow: bucketize(trades, t => t.entryDow, dayOrder),
    hold: bucketize(trades, holdKey, holdOrder),
    entryHour: bucketize(trades, hourKey, hourOrder),
    busyDay: bucketize(trades, busyKey, busyOrder),
    month: bucketize(trades.filter(t => t.exitDate), t => t.exitDate.slice(0, 7)).sort((x, y) => x.key.localeCompare(y.key)),
    direction: bucketize(trades.filter(t => t.direction), t => t.direction, ['Long', 'Short'])
  };

  let seq = null;
  if (m.hasDates && trades.length >= 10) {
    const afterLoss = [], afterWin = [];
    for (let i = 1; i < trades.length; i++) (trades[i - 1].pnl < 0 ? afterLoss : afterWin).push(trades[i]);
    const stat = a => ({ n: a.length, pnl: sum(a, t => t.pnl), winRate: a.length ? a.filter(t => t.pnl > 0).length / a.length : 0, avgSize: a.length ? sum(a, t => t.buy) / a.length : 0, avg: a.length ? sum(a, t => t.pnl) / a.length : 0 });
    let streak = 0, worstStreak = 0, curLoss = 0, streakLoss = 0;
    for (const t of trades) { if (t.pnl < 0) { streak++; curLoss += t.pnl; if (streak > worstStreak) { worstStreak = streak; streakLoss = curLoss; } } else { streak = 0; curLoss = 0; } }
    seq = { afterLoss: stat(afterLoss), afterWin: stat(afterWin), worstStreak, streakLoss, tradingDays: dayCounts.length, busiestDay: [...dayCounts].sort((a, c) => c.n - a.n)[0], worstDay: [...dayCounts].sort((a, c) => a.pnl - c.pnl)[0] };
  }

  const stopTable = (set, levels) => levels.map(s => { let saved = 0, hit = 0; for (const t of set) if (t.pnl < 0) { const cap = -s / 100 * t.buy; if (t.pnl < cap) { saved += cap - t.pnl; hit++; } } return { stop: s, hit, saved, net: net + saved }; });
  const linWins = lin.filter(t => t.pnl > 0);
  const linAvgWinPct = linWins.length ? sum(linWins, t => t.pct) / linWins.length : 0;
  const stops = {
    opt: opts.some(t => t.pnl < 0) ? { rows: stopTable(opts, [20, 30, 40, 50, 70]), rec: 30, label: 'Options (stop as % of premium paid)' } : null,
    lin: lin.some(t => t.pnl < 0) ? (() => { const rows = stopTable(lin, [1, 2, 3, 5, 8]); const floor = Math.max(2, 2 * linAvgWinPct); return { rows, rec: (rows.find(r => r.stop >= floor) || rows[rows.length - 1]).stop, label: 'Futures & stocks (stop as % of position value)' }; })() : null
  };
  const sortedLosers = [...losers].sort((x, y) => x.pnl - y.pnl);
  const dropWorst = [1, 3, 5].filter(k => k <= sortedLosers.length).map(k => ({ k, net: net - sum(sortedLosers.slice(0, k), t => t.pnl) }));
  const debitSummary = {};
  for (const d of debits) { const k = d.type; debitSummary[k] = debitSummary[k] || { n: 0, amount: 0, dates: [] }; debitSummary[k].n++; debitSummary[k].amount += d.debit - d.credit; if (d.date) debitSummary[k].dates.push(d.date); }

  const ctx = { m, trades, winners, losers, opts, lin, b, stops, sortedLosers, debitSummary, heads, seq };
  const patterns = dedupe(buildPatterns(ctx));
  const leaks = dedupe(buildLeaks(ctx));
  const strengths = buildStrengths(ctx);
  const rules = buildRules({ ...ctx, leaks });
  const behaviour = buildBehaviour(ctx, inr);
  const progress = buildProgress(trades);
  return { m, trades, winners, losers, b, stops, dropWorst, heads, debits, debitSummary, patterns, leaks, strengths, rules, seq, curve, dayCounts, behaviour, progress, diagnosis: buildDiagnosis(m), sheets, mapping: sheets.map(s => s.mapped).filter(Boolean) };
}

/* ---------- generated text ---------- */
/* ---------- progress over time ----------
 * Splits dated trades by month and scores six habits per month (0–100), so the Progress tab can show
 * what improved, what got worse and which mistakes stopped repeating. Also scores the whole file, which
 * is what gets saved as a "check-up" for history across sessions.
 */
const DIM_LABELS = { rr: 'Risk : reward', loss: 'Loss control', consistency: 'Consistency', emotion: 'Emotional control', activity: 'Trade selection', costs: 'Cost efficiency' };
const DIM_W = { rr: 0.25, loss: 0.2, consistency: 0.15, emotion: 0.2, activity: 0.1, costs: 0.1 };
const clamp100 = (x) => Math.max(0, Math.min(100, Math.round(x)));
function periodMetrics(list) {
  const timed = list.some(x => x.nLegs); // tradebook rows = real trade sequence; statements are per-symbol
  const t = [...list].sort((a, b) => String(a.exitDate || a.entryDate || '').localeCompare(String(b.exitDate || b.entryDate || '')) || ((a.entryHour || 0) - (b.entryHour || 0)));
  const W = t.filter(x => x.pnl > 0), L = t.filter(x => x.pnl < 0);
  const gp = sum(W, x => x.pnl), gl = -sum(L, x => x.pnl);
  const avgWin = W.length ? gp / W.length : 0, avgLoss = L.length ? gl / L.length : 0;
  let revenge = 0, streak = 0, maxStreak = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i].pnl < 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
    if (i && t[i - 1].pnl < 0 && t[i].entryDate && t[i].entryDate === (t[i - 1].exitDate || t[i - 1].entryDate)) revenge++;
  }
  const days = new Set(t.map(x => x.entryDate).filter(Boolean)).size;
  const charges = sum(t, x => x.estCharges || 0);
  // what each habit cost in this period (losses only, so improvements read as money kept)
  let costRevenge = 0; for (let i = 1; i < t.length; i++) if (timed && t[i - 1].pnl < 0 && t[i].entryDate && t[i].entryDate === (t[i - 1].exitDate || t[i - 1].entryDate) && t[i].pnl < 0) costRevenge += -t[i].pnl;
  const perDay = {}; for (const x of t) if (x.entryDate) (perDay[x.entryDate] = perDay[x.entryDate] || []).push(x);
  const costBusy = timed ? -sum(Object.values(perDay).filter(d => d.length > 4).flat().filter(x => x.pnl < 0), x => x.pnl) : 0;
  const costDeep = -sum(L.filter(x => x.pct <= -10), x => x.pnl);
  const costZero = -sum(t.filter(x => x.wentToZero), x => x.pnl);
  const m = {
    n: t.length, pnl: sum(t, x => x.pnl), winRate: t.length ? W.length / t.length : 0,
    payoff: avgLoss ? avgWin / avgLoss : (avgWin ? 3 : 0), pf: gl ? gp / gl : (gp ? 3 : 0),
    avgWin, avgLoss, expectancy: t.length ? sum(t, x => x.pnl) / t.length : 0,
    avgLossPct: L.length ? -sum(L, x => x.pct) / L.length : 0,
    deepShare: L.length ? L.filter(x => x.pct <= -10).length / L.length : 0,
    bigLossX: avgWin && L.length ? Math.abs(Math.min(...L.map(x => x.pnl))) / avgWin : 0,
    revengeRate: timed && t.length > 1 ? revenge / (t.length - 1) : 0, maxStreak: timed ? maxStreak : 0,
    tradesPerDay: timed && days ? t.length / days : 0, costRatio: gp ? charges / gp : 0,
    zeroOptions: t.filter(x => x.wentToZero).length,
    habitCost: { revenge: costRevenge, busy: costBusy, deep: costDeep, zero: costZero, charges }, timed,
  };
  const d = {
    rr: clamp100((m.payoff / 2) * 100),
    loss: clamp100(100 - m.deepShare * 120 - Math.max(0, m.bigLossX - 2) * 8),
    consistency: clamp100(0.5 * Math.min(100, m.winRate * 160) + 0.5 * Math.min(100, (m.pf / 2) * 100)),
    emotion: timed ? clamp100(100 - m.revengeRate * 220 - Math.max(0, m.maxStreak - 3) * 8) : 70,
    activity: m.tradesPerDay ? clamp100(100 - Math.max(0, m.tradesPerDay - 2) * 14) : 70,
    costs: clamp100(100 - m.costRatio * 160),
  };
  const score = clamp100(Object.keys(DIM_W).reduce((s2, k) => s2 + d[k] * DIM_W[k], 0));
  return { m, d, score };
}
const MISTAKES = [
  { id: 'payoff', label: 'Losers bigger than winners', on: (m) => m.payoff > 0 && m.payoff < 1, val: (m) => `R:R ${m.payoff.toFixed(2)}`, better: (a, b) => a.payoff > b.payoff },
  { id: 'deep', label: 'Losses running past −10%', on: (m) => m.deepShare > 0.25, val: (m) => `${Math.round(m.deepShare * 100)}% of losers`, better: (a, b) => a.deepShare < b.deepShare },
  { id: 'revenge', label: 'Revenge trades after a loss', on: (m) => m.revengeRate > 0.1, val: (m) => `${Math.round(m.revengeRate * 100)}% of trades`, better: (a, b) => a.revengeRate < b.revengeRate },
  { id: 'streak', label: 'Losing streaks of 4+', on: (m) => m.maxStreak >= 4, val: (m) => `${m.maxStreak} in a row`, better: (a, b) => a.maxStreak < b.maxStreak },
  { id: 'over', label: 'Overtrading (4+ trades a day)', on: (m) => m.tradesPerDay > 4, val: (m) => `${m.tradesPerDay.toFixed(1)} a day`, better: (a, b) => a.tradesPerDay < b.tradesPerDay },
  { id: 'big', label: 'One loss wiping out 3+ wins', on: (m) => m.bigLossX > 3, val: (m) => `${m.bigLossX.toFixed(1)}× avg win`, better: (a, b) => a.bigLossX < b.bigLossX },
  { id: 'zero', label: 'Options held to zero', on: (m) => m.zeroOptions > 0, val: (m) => `${m.zeroOptions} trade${m.zeroOptions === 1 ? '' : 's'}`, better: (a, b) => a.zeroOptions < b.zeroOptions },
  { id: 'costs', label: 'Costs eating the wins', on: (m) => m.costRatio > 0.3, val: (m) => `${Math.round(m.costRatio * 100)}% of profit`, better: (a, b) => a.costRatio < b.costRatio },
];
const P_DELTA = (d) => (d > 0 ? `, up ${d} points` : d < 0 ? `, down ${-d} points` : ', unchanged');
function buildProgress(trades) {
  const overall = periodMetrics(trades);
  const byMonth = {};
  for (const t of trades) { const d = t.exitDate || t.entryDate; if (d) (byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || []).push(t); }
  const months = Object.keys(byMonth).sort().filter(k => byMonth[k].length >= 3).map(k => ({ key: k, ...periodMetrics(byMonth[k]) }));
  const cur = months[months.length - 1] || null, prev = months[months.length - 2] || null;
  const tracker = MISTAKES.map((x) => {
    const series = months.map(mo => ({ key: mo.key, on: x.on(mo.m), val: x.val(mo.m) }));
    let status = 'clean';
    if (cur && prev) {
      const a = x.on(cur.m), b = x.on(prev.m);
      status = a && !b ? 'new' : !a && b ? 'fixed' : a && b ? (x.better(cur.m, prev.m) ? 'improving' : x.better(prev.m, cur.m) ? 'worse' : 'same') : 'clean';
    } else status = x.on(overall.m) ? 'present' : 'clean';
    return { id: x.id, label: x.label, status, now: cur ? x.val(cur.m) : x.val(overall.m), series };
  }).filter(r => r.status !== 'clean' || r.series.some(p => p.on));
  let streak = 0; for (let i = months.length - 1; i > 0 && months[i].score > months[i - 1].score; i--) streak++;
  const LEVELS = [[0, 'Building'], [40, 'Developing'], [55, 'Steady'], [70, 'Disciplined'], [85, 'Elite']];
  const headScore = cur ? cur.score : overall.score;
  let li = 0; for (let i = 0; i < LEVELS.length; i++) if (headScore >= LEVELS[i][0]) li = i;
  const level = { name: LEVELS[li][1], index: li, next: LEVELS[li + 1] ? { name: LEVELS[li + 1][1], at: LEVELS[li + 1][0], gap: LEVELS[li + 1][0] - headScore } : null, from: LEVELS[li][0] };
  // goals: the two weakest habits, each with a concrete target for next month
  const base = cur ? cur : overall;
  const GOAL = {
    rr: (m) => ({ text: 'Raise risk : reward', now: +m.payoff.toFixed(2), target: Math.max(1.2, +(m.payoff + 0.3).toFixed(2)), fmt: 'x', better: 'up' }),
    loss: (m) => ({ text: 'Fewer losses past −10%', now: Math.round(m.deepShare * 100), target: Math.max(10, Math.round(m.deepShare * 100) - 15), fmt: '%', better: 'down' }),
    consistency: (m) => ({ text: 'Lift your win rate', now: Math.round(m.winRate * 100), target: Math.min(70, Math.round(m.winRate * 100) + 5), fmt: '%', better: 'up' }),
    emotion: (m) => ({ text: 'Fewer trades straight after a loss', now: Math.round(m.revengeRate * 100), target: Math.max(0, Math.round(m.revengeRate * 100) - 5), fmt: '%', better: 'down' }),
    activity: (m) => ({ text: 'Fewer trades per day', now: +m.tradesPerDay.toFixed(1), target: Math.max(2, +(m.tradesPerDay - 1).toFixed(1)), fmt: '', better: 'down' }),
    costs: (m) => ({ text: 'Keep more of each gain', now: Math.round(m.costRatio * 100), target: Math.max(10, Math.round(m.costRatio * 100) - 8), fmt: '%', better: 'down' }),
  };
  const goals = Object.entries(base.d)
    .filter(([k]) => base.m.timed || (k !== 'emotion' && k !== 'activity'))   // statements can't measure sequence habits
    .sort((a, b) => a[1] - b[1]).map(([k, v]) => ({ dim: k, label: DIM_LABELS[k], score: v, ...GOAL[k](base.m) }))
    .filter((g) => g.now !== g.target).slice(0, 3);
  // money kept by improving: first month's habit costs vs latest month's
  let saved = null;
  if (months.length >= 2) {
    const a = months[0].m.habitCost, b = cur.m.habitCost, keys = ['revenge', 'busy', 'deep', 'zero'];
    const items = keys.map(k => ({ k, first: a[k], now: b[k], diff: a[k] - b[k] })).filter(x => x.first || x.now);
    saved = { total: items.reduce((s2, x) => s2 + x.diff, 0), items, from: months[0].key, to: cur.key };
  }
  // badges
  const badges = [];
  if (streak >= 2) badges.push({ id: 'streak', name: `${streak}-month climb`, desc: 'Score improved month after month' });
  if (cur && cur.m.revengeRate === 0 && cur.m.n >= 5 && cur.m.tradesPerDay) badges.push({ id: 'calm', name: 'Calm after losses', desc: 'No same-day trades straight after a loss this month' });
  if (cur && cur.m.payoff >= 1.5) badges.push({ id: 'rr', name: 'Healthy R:R', desc: 'Average gain at least 1.5× the average loss' });
  if (cur && cur.m.deepShare === 0 && cur.m.n >= 5) badges.push({ id: 'stops', name: 'Losses contained', desc: 'No loss went past −10% this month' });
  if (months.length && cur && cur.score === Math.max(...months.map(m2 => m2.score)) && months.length >= 2) badges.push({ id: 'best', name: 'Best month yet', desc: 'Highest score so far' });
  if (headScore >= 70) badges.push({ id: 'disc', name: 'Disciplined', desc: 'Score of 70 or more' });
  if (tracker.some(t2 => t2.status === 'fixed')) badges.push({ id: 'fixed', name: 'Habit resolved', desc: 'A repeated pattern stopped this month' });
  // a short written summary
  const best = Object.entries(base.d).sort((a, b) => b[1] - a[1])[0], weak = goals[0];
  const fixedN = tracker.filter(t2 => t2.status === 'fixed').length, worseN = tracker.filter(t2 => t2.status === 'worse' || t2.status === 'new').length;
  const summary = (cur && prev
    ? `Your score moved from ${prev.score} to ${cur.score}${P_DELTA(cur.score - prev.score)}. `
    : `This is your baseline score of ${headScore}. `)
    + `${DIM_LABELS[best[0]]} is your strongest habit (${best[1]}/100). `
    + (fixedN ? `${fixedN} repeated pattern${fixedN === 1 ? '' : 's'} stopped this month${worseN ? `, while ${worseN} need${worseN === 1 ? 's' : ''} attention` : ''}. ` : worseN ? `${worseN} pattern${worseN === 1 ? '' : 's'} need${worseN === 1 ? 's' : ''} attention. ` : '')
    + (weak ? `The biggest opportunity next month: ${weak.text.toLowerCase()}.` : 'Keep the same process next month.');
  return {
    level, goals, saved, badges, summary,
    labels: DIM_LABELS, overall: { score: overall.score, d: overall.d, m: overall.m },
    months: months.map(mo => ({ key: mo.key, score: mo.score, d: mo.d, m: mo.m })),
    current: cur ? cur.key : null, previous: prev ? prev.key : null,
    delta: cur && prev ? cur.score - prev.score : null, improvingStreak: streak, tracker,
  };
}

function buildDiagnosis(m) {
  const w = Math.round(m.winRate * 100), seed = m.n + ':' + Math.round(m.net);
  if (!m.n) return 'No closed trades found in this file.';
  if (!m.wins) return `Not one position in this file closed green. Before sizing or stops, the setup itself needs to change — paper-trade the next twenty and see what the win rate actually is.`;
  if (m.payoff < 1 && m.winRate >= 0.5) return pick([
    `You pick direction well — ${w}% of positions close green — but a single loss erases ${(1 / m.payoff).toFixed(1)} wins. This is an exit problem, not an entry problem.`,
    `${w}% of your trades work out. The damage sits entirely in size and exits: the average loss is ${(1 / m.payoff).toFixed(1)}× the average win.`,
    `Your hit rate of ${w}% is not the issue. Letting losers grow to ${(1 / m.payoff).toFixed(1)}× the size of your winners is.`
  ], seed);
  if (m.payoff < 1) return pick([
    `Only ${w}% of trades win, and the losers are bigger than the winners. Both halves of the equation are working against you.`,
    `A ${w}% hit rate with losses larger than gains means the setup itself needs work, not just the sizing.`,
    `${w}% win rate and a payoff under 1: entry, size and exit are all negative expectancy in this sample.`
  ], seed);
  if (m.winRate < 0.35 && m.realized < 0) return pick([
    `You are running a low-hit-rate, big-winner style (${w}% win, ${m.payoff.toFixed(1)}× payoff). It simply isn't landing often enough to cover the misses.`,
    `Winners are ${m.payoff.toFixed(1)}× losers, but at a ${w}% hit rate you need either fewer trades or longer runners.`
  ], seed);
  if (m.realized > 0 && m.net < 0) return pick([
    `Your trading is profitable before costs. Brokerage, STT and fees are what turn it negative — frequency is the enemy here.`,
    `Gross P&L is positive, net P&L is not. Costs are the entire gap: trade less, hold for bigger moves.`
  ], seed);
  if (m.net > 0) return pick([
    `Net profitable with a ${m.payoff.toFixed(1)}:1 payoff. The job now is protecting it from the occasional oversized loss.`,
    `You are green after every cost. Keep the hit rate, cap the tail — one bad trade can undo a month here.`
  ], seed);
  return `Win rate ${w}%, payoff ${m.payoff.toFixed(2)}. A handful of large losses is doing most of the damage.`;
}

function buildPatterns({ m, opts, b, seq }) {
  const P = [];
  const dims = [['group', 'Instrument'], ['weekday', 'Expiry day'], ['premium', 'Entry premium'], ['expiryType', 'Expiry type'], ['callPut', 'Option type'], ['entryDow', 'Entry weekday'], ['entryHour', 'Entry time'], ['hold', 'Holding period'], ['busyDay', 'Trades per day'], ['direction', 'Direction'], ['size', 'Position size'], ['year', 'Year']];
  for (const [k, label] of dims) {
    const rows = (b[k] || []).filter(r => r.n >= 3);
    if (rows.length < 2) continue;
    const worst = [...rows].sort((x, y) => x.pnl - y.pnl)[0], best = [...rows].sort((x, y) => y.pnl - x.pnl)[0];
    if (worst.pnl >= 0 || worst === best) continue;
    const tail = best.pnl > 0 ? pick([
      `The mirror image is ${best.key}: ${inr(best.pnl)} over ${best.n} trades at ${wrs(best)} wins.`,
      `${best.key} does the opposite — ${inr(best.pnl)} across ${best.n} trades.`,
      `Where it works is ${best.key}, worth ${inr(best.pnl)} at a ${wrs(best)} hit rate.`
    ], label + best.key) : pick([
      `Nothing in this split is net positive, so the choice of bucket isn't the problem.`,
      `Every bucket here loses money — your edge is not hiding in this dimension.`
    ], label);
    P.push({ dim: label, impact: -worst.pnl, keys: worst.trades.map(t => t.symbol + t.pnl), text: pick([
      `${label} — ${worst.key} is the worst of the set: ${worst.n} trades, ${wrs(worst)} wins, ${inr(worst.pnl)}. ${tail}`,
      `${label} — most of the bleeding is in ${worst.key} (${inr(worst.pnl)} over ${worst.n} trades, ${wrs(worst)} hit rate). ${tail}`,
      `${label} — ${worst.key} drains ${inr(Math.abs(worst.pnl))} across ${worst.n} trades. ${tail}`
    ], label + worst.key + worst.n) });
  }
  const zero = opts.filter(t => t.wentToZero);
  if (zero.length >= 2) P.push({ dim: 'Decay', impact: -sum(zero, t => t.pnl), keys: zero.map(t => t.symbol + t.pnl), text: `${zero.length} bought options were closed at under a tenth of what you paid, ${inr(sum(zero, t => t.pnl))} in all. These were not stopped out — they were held until theta finished them.` });
  const dec = opts.filter(t => t.decayedWin);
  if (dec.length >= 2) P.push({ dim: 'Decay', impact: 0, keys: dec.map(t => t.symbol + t.pnl), text: `On the other side, ${dec.length} short-premium positions were bought back for almost nothing (${inr(sum(dec, t => t.pnl))}). Letting decay work for you is clearly the better side of this trade.` });
  if (seq) {
    const al = seq.afterLoss, aw = seq.afterWin;
    if (al.n >= 5 && aw.n >= 5) {
      if (al.avg < aw.avg && al.avg < 0) P.push({ dim: 'Behaviour', impact: -al.pnl, keys: ['seq:afterloss'], text: `The trade taken straight after a loss averages ${inr(al.avg)} at a ${Math.round(al.winRate * 100)}% hit rate, against ${inr(aw.avg)} after a win. The get-even trade is the expensive one.` });
      if (al.avgSize > aw.avgSize * 1.25) P.push({ dim: 'Behaviour', impact: 0, keys: ['seq:size'], text: `Position size climbs after losses: ${inr(al.avgSize)} on average versus ${inr(aw.avgSize)} after a win — ${Math.round((al.avgSize / aw.avgSize - 1) * 100)}% more risk at the worst possible moment.` });
    }
    if (seq.worstStreak >= 4) P.push({ dim: 'Behaviour', impact: -seq.streakLoss, keys: ['seq:streak'], text: `Your longest run of red was ${seq.worstStreak} trades in a row, costing ${inr(seq.streakLoss)}. Nothing in your process stopped it.` });
    if (seq.worstDay && seq.worstDay.pnl < -Math.abs(m.avgWin * 3)) P.push({ dim: 'Behaviour', impact: -seq.worstDay.pnl, keys: ['seq:worstday'], text: `${seq.worstDay.date} alone cost ${inr(seq.worstDay.pnl)} across ${seq.worstDay.n} trade${seq.worstDay.n === 1 ? '' : 's'} — more than most whole months contribute.` });
  }
  const worstU = b.underlying.filter(u => u.pnl < 0).slice(0, 3);
  if (worstU.length && m.grossLoss) {
    const share = -sum(worstU, u => u.pnl) / m.grossLoss;
    if (share > 0.4) P.push({ dim: 'Underlying', impact: -sum(worstU, u => u.pnl), keys: ['und'], text: `${worstU.map(u => u.key).join(', ')} are behind ${Math.round(share * 100)}% of everything you lost (${inr(sum(worstU, u => u.pnl))}). A ban list of three names changes the whole picture.` });
  }
  return P.sort((a, c) => c.impact - a.impact);
}

function buildLeaks({ m, trades, losers, opts, b, stops, sortedLosers, debitSummary, heads, seq }) {
  const L = [];
  if (losers.length && m.payoff < 1.2) {
    const parts = []; let saved = 0;
    if (stops.opt) { const r = stops.opt.rows.find(x => x.stop === stops.opt.rec); saved += r.saved; parts.push(`−${stops.opt.rec}% of premium on options`); }
    if (stops.lin) { const r = stops.lin.rows.find(x => x.stop === stops.lin.rec); saved += r.saved; parts.push(`−${stops.lin.rec}% of position value on futures and stocks`); }
    L.push({ level: m.payoff < 0.7 ? 'High' : 'Medium', title: 'Losers run, winners get cut short', impact: saved, keys: ['stop'],
      evidence: `An average winner books ${inr(m.avgWin)} (${pct(m.avgWinPct)}) while an average loser gives back ${inr(m.avgLoss)} (${pct(-m.avgLossPct)}). ${losers.length} of ${m.n} positions ended red.`,
      fix: `Decide the exit before the entry: ${parts.join(' and ')}. Applied across this period that holds back roughly ${inr(saved)}.` });
  }
  if (sortedLosers.length >= 3 && m.grossLoss) {
    const top = sortedLosers.slice(0, 3), share = -sum(top, t => t.pnl) / m.grossLoss;
    if (share >= 0.3) L.push({ level: share >= 0.5 ? 'High' : 'Medium', title: `Three positions carry ${Math.round(share * 100)}% of all losses`, impact: -sum(top, t => t.pnl), keys: top.map(t => t.symbol + t.pnl),
      evidence: top.map(t => `${t.symbol} ${inr(t.pnl)} (${pct(t.pct)})`).join(' · ') + '.',
      fix: `Set a hard cash ceiling per position — ${inr(Math.max(m.avgWin, 500))}, the size of one average win — and work quantity backwards from it so no single idea can do this again.` });
  }
  const zero = opts.filter(t => t.wentToZero);
  if (zero.length >= 2) L.push({ level: zero.length / Math.max(1, opts.filter(t => t.pnl < 0).length) > 0.3 ? 'High' : 'Medium', title: 'Bought options held until the premium was gone', impact: -sum(zero, t => t.pnl), keys: zero.map(t => t.symbol + t.pnl),
    evidence: `${zero.length} option buys exited below a tenth of cost: ` + zero.sort((a, c) => a.pnl - c.pnl).slice(0, 4).map(t => `${t.symbol} ${inr(t.pnl)}`).join(' · ') + '.',
    fix: 'Treat premium as a stop that decays on its own: cut at 30–40% down and never carry a long option through the last two sessions hoping for a move.' });
  const fut = trades.filter(t => t.kind === 'FUT' && t.pnl < 0 && t.pct <= -5);
  if (fut.length) L.push({ level: 'High', title: 'Leveraged positions left without a stop', impact: -sum(fut, t => t.pnl), keys: fut.map(t => t.symbol + t.pnl),
    evidence: fut.slice(0, 4).map(t => `${t.symbol} ${inr(t.pnl)} (${pct(t.pct)} of notional)`).join(' · ') + '.',
    fix: 'On futures, 2% of notional is already a full-size loss. Fix the stop as a cash amount first, then choose lots — not the other way round.' });
  if (m.charges > 0 && m.grossProfit) {
    const ratio = m.charges / m.grossProfit;
    if (ratio > 0.25) L.push({ level: ratio > 0.5 ? 'High' : 'Medium', title: 'Costs take a large bite out of the wins', impact: m.charges, keys: ['costs'],
      evidence: `${inr(m.charges)} in charges equals ${Math.round(ratio * 100)}% of everything the winning trades made` + (heads['Securities Transaction Tax'] ? `, STT alone ${inr(heads['Securities Transaction Tax'])}` : '') + `. Each round trip costs about ${pct(m.costPct, 2)} of the position.`,
      fix: `Lift the minimum target to ${pct(Math.max(m.costPct * 5, 1), 1)} and drop the trades taken out of boredom — costs are charged on conviction and noise alike.` });
  }
  if (seq) {
    const al = seq.afterLoss, aw = seq.afterWin;
    if (al.n >= 5 && al.pnl < 0 && al.avg < aw.avg) L.push({ level: -al.pnl > m.avgWin * 3 ? 'High' : 'Medium', title: 'Revenge trading after a loss', impact: -al.pnl, keys: ['seq:afterloss'],
      evidence: `${al.n} trades placed right after a losing trade produced ${inr(al.pnl)} at a ${Math.round(al.winRate * 100)}% hit rate, against ${inr(aw.avg)} per trade after a win.`,
      fix: 'Two losses in a row ends the session. Make it a rule with a clock attached, not a feeling — most of this money goes in the twenty minutes after a red trade.' });
    if (seq.worstStreak >= 4) L.push({ level: 'Medium', title: `A ${seq.worstStreak}-trade losing streak with no circuit breaker`, impact: -seq.streakLoss, keys: ['seq:streak'],
      evidence: `The run cost ${inr(seq.streakLoss)} before it ended on its own.`,
      fix: `Cap the day at ${inr(Math.max(m.avgWin * 2, 1000))} of loss. Hitting it means the market isn't paying today and the terminal gets closed.` });
    const busy = b.busyDay.filter(r => r.n >= 3 && r.pnl < 0 && /4–6|7\+/.test(r.key)).sort((a, c) => a.pnl - c.pnl)[0];
    if (busy) L.push({ level: 'Medium', title: 'Overtrading on busy days', impact: -busy.pnl, keys: ['busy'],
      evidence: `Days with ${busy.key.replace(' that day', '')} account for ${inr(busy.pnl)} across ${busy.n} trades at ${wrs(busy)} wins.`,
      fix: 'Give yourself a hard count of three trades a day. Scarcity forces you to wait for the setup instead of inventing one.' });
  }
  const nameOf = { group: k => k.toLowerCase(), premium: k => `options bought at ${k} premium`, weekday: k => `contracts expiring on ${k}`, entryHour: k => `entries in the ${k} window`, hold: k => `trades held "${k.toLowerCase()}"`, entryDow: k => `${k} entries` };
  for (const dk of ['group', 'premium', 'weekday', 'entryHour', 'hold', 'entryDow']) {
    const bad = (b[dk] || []).filter(r => r.n >= 3 && r.pnl < 0 && r.winRate < 0.45).sort((x, y) => x.pnl - y.pnl)[0];
    if (bad && -bad.pnl > m.avgWin * 2) { const nm = nameOf[dk](bad.key);
      L.push({ level: 'Medium', title: `A losing pocket: ${nm}`, impact: -bad.pnl, keys: bad.trades.map(t => t.symbol + t.pnl), cluster: nm,
        evidence: `${bad.n} trades here, ${wrs(bad)} of them profitable, ${inr(bad.pnl)} net.`,
        fix: pick([`Put ${nm} on pause until you can write the setup in one sentence and show it works on paper.`, `Quarter your size in ${nm} for the next twenty trades and check the numbers before committing capital again.`], nm) });
    }
  }
  const smallCut = CUR === 'INR' ? 1e4 : 250;
  const eq = trades.filter(t => t.kind === 'EQ'), small = eq.filter(t => t.buy < smallCut);
  if (small.length >= 3 && sum(small, t => t.pnl) < 0) L.push({ level: 'Low', title: 'Small positions get no supervision', impact: -sum(small, t => t.pnl), keys: small.map(t => t.symbol + t.pnl),
    evidence: `${small.length} positions under ${money(smallCut)}, net ${inr(sum(small, t => t.pnl))}, average return ${pct(sum(small, t => t.pct) / small.length)}.`,
    fix: 'Either trade them at a size you will actually watch, or skip them. A small bet still takes attention and still loses real money.' });
  const dragged = losers.filter(t => t.sellDays >= 2 || (t.nLegs >= 4 && t.holdDays > 1));
  if (dragged.length) L.push({ level: -sum(dragged, t => t.pnl) > m.avgWin * 3 ? 'High' : 'Medium', title: 'Losers exited in instalments', impact: -sum(dragged, t => t.pnl), keys: dragged.map(t => t.symbol + t.pnl),
    evidence: dragged.slice(0, 4).map(t => `${t.symbol}: ${t.sellDays || t.nLegs} separate exits, ${inr(t.pnl)}`).join(' · ') + '.',
    fix: 'One decision, one order. Selling a loser in pieces is a way of not deciding, and the piece left behind is always the one that falls further.' });
  const del = b.style.find(s => /Delivery/.test(s.key));
  if (del && del.pnl < 0 && del.n >= 3 && b.style.length > 1) L.push({ level: 'Medium', title: 'Short-term trades quietly becoming investments', impact: -del.pnl, keys: del.trades.map(t => t.symbol + t.pnl),
    evidence: `${del.n} positions carried beyond the day, ${wrs(del)} profitable, ${inr(del.pnl)} net.`,
    fix: 'Name the holding period at entry and write it down. A trade that becomes a long-term hold after it moves against you is just an unexecuted stop.' });
  const aq = debitSummary.autosq;
  if (aq && aq.n) L.push({ level: 'Low', title: `Squared off by the broker ${aq.n} time${aq.n > 1 ? 's' : ''}`, impact: aq.amount, keys: ['autosq'],
    evidence: `Charged on ${aq.dates.join(', ')}.`, fix: 'Set an alarm 20 minutes before the close and flatten intraday positions yourself. A broker-forced exit takes whatever price the market offers.' });
  const mg = debitSummary.margin;
  if (mg && mg.amount > 0) L.push({ level: 'Low', title: 'Penalties for running too close to the margin', impact: mg.amount, keys: ['margin'],
    evidence: `${mg.n} charge${mg.n > 1 ? 's' : ''} totalling ${inr(mg.amount)}.`, fix: 'Keep 20% headroom over required margin. Shortfall penalties are money lost without any market risk taken.' });
  const order = { High: 0, Medium: 1, Low: 2 };
  return L.sort((a, c) => order[a.level] - order[c.level] || c.impact - a.impact);
}

function buildStrengths({ m, winners, b, seq }) {
  const S = [];
  if (m.winRate >= 0.5) S.push(`${Math.round(m.winRate * 100)}% of positions close green — the entries are finding something real.`);
  if (m.payoff >= 1.5) S.push(`Winners run ${m.payoff.toFixed(1)}× the size of losers, which is the hard half of trading to get right.`);
  for (const [k, label] of [['group', 'instrument'], ['premium', 'premium range'], ['weekday', 'expiry day'], ['entryHour', 'time of day'], ['hold', 'holding period'], ['size', 'position size']]) {
    const best = (b[k] || []).filter(r => r.n >= 3 && r.pnl > 0).sort((x, y) => y.pnl - x.pnl)[0];
    if (best) S.push(`Best ${label}: ${best.key} — ${inr(best.pnl)} across ${best.n} trades at ${wrs(best)} wins.`);
    if (S.length >= 6) break;
  }
  if (seq && seq.afterWin.n >= 5 && seq.afterWin.avg > 0) S.push(`Trades placed after a winner average ${inr(seq.afterWin.avg)} — you handle being in profit well.`);
  const topW = [...winners].sort((x, y) => y.pnl - x.pnl).slice(0, 3);
  if (topW.length) S.push('Biggest wins: ' + topW.map(t => `${t.symbol} ${inr(t.pnl)}`).join(', ') + '.');
  return S;
}

function buildRules({ m, leaks, stops, debitSummary, seq }) {
  const R = [], seen = new Set();
  const push = (rule, why) => { const k = norm(rule); if (!seen.has(k)) { seen.add(k); R.push({ rule, why }); } };
  if (stops.opt) { const r = stops.opt.rows.find(x => x.stop === stops.opt.rec); push(`Cut any bought option at −${stops.opt.rec}% of premium`, `Worth about ${inr(r.saved)} over the trades in this file.`); }
  if (stops.lin) { const r = stops.lin.rows.find(x => x.stop === stops.lin.rec); push(`Stop futures and stock positions at −${stops.lin.rec}% of position value`, `Worth roughly ${inr(r.saved)} on the same trades.`); }
  push(`Cap any single loss at ${inr(Math.max(Math.round(m.avgWin / 100) * 100, 500))}`, 'One average win. Work the quantity backwards from this number, not from available margin.');
  if (seq && seq.afterLoss.n >= 5 && seq.afterLoss.pnl < 0) push('Two losses in a row ends the session', 'Trades taken right after a loss are your weakest set.');
  if (seq && seq.worstStreak >= 4) push(`Daily loss limit of ${inr(Math.max(m.avgWin * 2, 1000))}`, `Your worst streak ran ${seq.worstStreak} trades before stopping by itself.`);
  for (const l of leaks.filter(l => l.cluster).slice(0, 2)) push(`Pause ${l.cluster}`, l.evidence);
  if (leaks.some(l => /instalments/.test(l.title))) push('Exit a loser in one order', 'Partial exits on losing positions consistently cost more than the first exit would have.');
  if (debitSummary.autosq) push('Flat or converted 20 minutes before the close', 'Removes auto square-off fees and the exit price that comes with them.');
  if (m.costPct >= 0.01) push(`Skip any setup with a target under ${pct(Math.max(m.costPct * 5, 1), 1)}`, `Round-trip costs run about ${pct(m.costPct, 2)}; anything thinner works for the broker, not you.`);
  push('Write entry, stop and target before the order goes in', 'Every leak above traces back to an exit that was never decided in advance.');
  return R;
}


export { parseWorkbook, parseSheet, parseSheetAuto, inferTable, analyze, classify, buildRoundTrips, matchHeader, setCurrency, money, SYN, CURSYM, inr, pct };
