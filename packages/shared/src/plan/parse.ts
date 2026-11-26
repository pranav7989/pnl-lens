/**
 * @file  packages/shared/src/plan/parse.ts
 * @area  Desk
 * @what  Trade Check plan-line parser (architecture doc §8): a strict grammar for Indian F&O and equity lines ("NIFTY 24300 CE buy 120, SL 90, target 170, 1 lot"): underlying, strike, CE / PE / FUT, buy / sell, entry, stop-loss, target, lots or quantity, optional time; anything unclear is returned as a field error to fix, never guessed.
 */
export type LineKind = 'CE' | 'PE' | 'FUT' | 'EQ';
export type LineField = 'underlying' | 'strike' | 'side' | 'entry' | 'sl' | 'target' | 'size' | 'time' | 'text';
export interface ParsedLine {
  underlying: string | null;
  kind: LineKind;
  strike: number | null;
  side: 'buy' | 'sell' | null;
  entry: number | null;
  sl: number | null;
  target: number | null;
  lots: number | null;
  qty: number | null;
  time: string | null;          // HH:MM IST, when the trader writes one
  errors: { field: LineField; message: string }[];
  ok: boolean;
}

const SIDE: Record<string, 'buy' | 'sell'> = { buy: 'buy', b: 'buy', long: 'buy', sell: 'sell', s: 'sell', short: 'sell', write: 'sell' };
const KIND: Record<string, LineKind> = { ce: 'CE', call: 'CE', pe: 'PE', put: 'PE', fut: 'FUT', future: 'FUT', futures: 'FUT' };
const SL_WORDS = new Set(['sl', 'stop', 'stoploss', 'stop-loss']);
const TARGET_WORDS = new Set(['target', 'tgt', 'tp', 't']);
const QTY_WORDS = new Set(['qty', 'quantity', 'shares', 'units', 'x']);
const LOT_WORDS = new Set(['lot', 'lots']);
const FILLER = new Set(['at', '@', 'entry', 'price', 'of', 'for', 'and', 'with', 'on']);
const isNum = (t: string | undefined) => !!t && /^\d+(\.\d+)?$/.test(t);
const isTime = (t: string | undefined) => !!t && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t);

/** Splits "24300CE", "120," and "sl:90" into clean tokens. */
function tokens(text: string): string[] {
  return text.toLowerCase()
    .replace(/[,;]+/g, ' ')
    .replace(/(\d)(ce|pe|fut)\b/g, '$1 $2')
    .replace(/\b(sl|tgt|target|qty|stop)[:=]/g, '$1 ')
    .replace(/(?<![\d:])(\d+(?:\.\d+)?)(lots?|x)\b/g, '$1 $2')
    .replace(/₹/g, '')
    .split(/\s+/).filter(Boolean);
}

export function parseLine(text: string): ParsedLine {
  const t = tokens(String(text ?? '').slice(0, 300));
  const out: ParsedLine = { underlying: null, kind: 'EQ', strike: null, side: null, entry: null, sl: null, target: null, lots: null, qty: null, time: null, errors: [], ok: false };
  const err = (field: LineField, message: string) => { if (!out.errors.some((e) => e.field === field)) out.errors.push({ field, message }); };
  const used = new Array(t.length).fill(false);
  const take = (i: number) => { used[i] = true; return t[i]; };

  for (let i = 0; i < t.length; i++) {
    const w = t[i];
    if (used[i]) continue;
    if (isTime(w)) { out.time = take(i).padStart(5, '0'); continue; }
    if (SIDE[w] && !(w === 's' && isNum(t[i - 1]))) {
      if (out.side && out.side !== SIDE[w]) err('side', 'Both buy and sell are written: keep one.');
      out.side = SIDE[take(i)];
      if (isNum(t[i + 1]) && !LOT_WORDS.has(t[i + 2]) && !QTY_WORDS.has(t[i + 2])) out.entry = Number(take(i + 1));   // "buy 1 lot" is a size, not a price
      continue;
    }
    if (KIND[w]) {
      if (out.kind !== 'EQ' && out.kind !== KIND[w]) err('strike', 'Write one of CE, PE or FUT.');
      out.kind = KIND[take(i)];
      if (out.kind !== 'FUT' && isNum(t[i - 1]) && !used[i - 1]) out.strike = Number(take(i - 1));
      continue;
    }
    if (SL_WORDS.has(w)) {
      take(i);
      if (isNum(t[i + 1])) out.sl = Number(take(i + 1)); else err('sl', 'Write the stop-loss price after "SL".');
      continue;
    }
    if (TARGET_WORDS.has(w)) {
      take(i);
      if (isNum(t[i + 1])) out.target = Number(take(i + 1)); else err('target', 'Write the target price after "target".');
      continue;
    }
    if (LOT_WORDS.has(w)) {
      take(i);
      if (isNum(t[i - 1]) && used[i - 1] === false) out.lots = Number(take(i - 1)); else err('size', 'Write the number of lots before "lot".');
      continue;
    }
    if (QTY_WORDS.has(w)) {
      take(i);
      if (isNum(t[i + 1])) out.qty = Number(take(i + 1));
      else if (isNum(t[i - 1]) && !used[i - 1]) out.qty = Number(take(i - 1));
      else err('size', 'Write the quantity next to "qty".');
      continue;
    }
    if ((w === 'at' || w === '@') && isNum(t[i + 1]) && out.entry == null) { take(i); out.entry = Number(take(i + 1)); continue; }
  }
  // the underlying: the first word that is a symbol (letters, may contain digits or & -), before anything else is read
  for (let i = 0; i < t.length; i++) {
    if (used[i] || FILLER.has(t[i]) || isNum(t[i])) continue;
    if (/^[a-z][a-z0-9&-]{0,19}$/.test(t[i]) && !out.underlying) { out.underlying = take(i).toUpperCase(); continue; }
  }
  // what is left: an entry written after the instrument, filler words, or something we can't read (never guessed)
  const left = t.map((w, i) => (!used[i] ? i : -1)).filter((i) => i >= 0);
  for (const i of left) {
    if (FILLER.has(t[i])) { used[i] = true; continue; }
    if (isNum(t[i]) && out.entry == null && out.side != null) { out.entry = Number(take(i)); continue; }      // "sell NIFTY 24300 CE 120"
    if (isNum(t[i]) && out.entry == null && out.side == null) { err('side', 'Write buy or sell before the price.'); used[i] = true; continue; }
    err('text', `Couldn't read "${t[i]}".`);
  }

  if (!out.underlying) err('underlying', 'Write the instrument first, e.g. NIFTY.');
  if ((out.kind === 'CE' || out.kind === 'PE') && out.strike == null) err('strike', 'Write the strike before CE or PE, e.g. 24300 CE.');
  if (!out.side) err('side', 'Write buy or sell.');
  if (out.entry == null) err('entry', 'Write the entry price after buy or sell.');
  if (out.lots == null && out.qty == null) err('size', out.kind === 'EQ' ? 'Write the quantity, e.g. qty 10.' : 'Write the lots, e.g. 1 lot.');
  if (out.lots != null && (!Number.isInteger(out.lots) || out.lots <= 0)) err('size', 'Lots must be a whole number.');
  if (out.qty != null && out.qty <= 0) err('size', 'Quantity must be more than 0.');
  if (out.entry != null && out.sl != null && out.side) {
    if (out.side === 'buy' && out.sl >= out.entry) err('sl', 'For a buy, the stop-loss is below the entry.');
    if (out.side === 'sell' && out.sl <= out.entry) err('sl', 'For a sell, the stop-loss is above the entry.');
  }
  if (out.entry != null && out.target != null && out.side) {
    if (out.side === 'buy' && out.target <= out.entry) err('target', 'For a buy, the target is above the entry.');
    if (out.side === 'sell' && out.target >= out.entry) err('target', 'For a sell, the target is below the entry.');
  }
  out.ok = out.errors.length === 0;
  return out;
}

/** The line written back in a standard form (shown under the input while typing). */
export function formatLine(p: ParsedLine): string {
  const inst = p.kind === 'EQ' ? p.underlying : p.kind === 'FUT' ? `${p.underlying} FUT` : `${p.underlying} ${p.strike} ${p.kind}`;
  const size = p.lots != null ? `${p.lots} lot${p.lots === 1 ? '' : 's'}` : p.qty != null ? `qty ${p.qty}` : '';
  return [inst, p.side, p.entry, p.sl != null ? `SL ${p.sl}` : '', p.target != null ? `target ${p.target}` : '', size, p.time ? `at ${p.time}` : ''].filter((x) => x !== '' && x != null).join(' · ');
}
