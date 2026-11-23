// Turn-and-Bank: a cbBTC bot for make.fun's "Race a BTC trading bot live for 24 hours".
//
// Idea, in one paragraph: a full round trip costs roughly 26-45 bps in fees, slippage and
// price impact, so this bot trades as rarely as possible. It waits for the market to dip
// and turn (the close rises a little off its trailing trough while the recent trend is not
// in freefall), buys once with everything, and then does nothing but watch two lines: a
// hard stop a whisker under the entry (the turn failed; get out for a small, known loss)
// and a take-profit line at +4.65% (bank the move instead of giving it back). If the
// take-profit fires and the price later breaks out decisively above the peak it made
// there, it re-enters once and rides that second leg behind a trailing stop. At most two
// entries, ever. Everything is decided from the closes of the bars seen so far, in exact
// integer arithmetic on the raw prices: no clock, no network, no randomness, so two runs
// over the same bars produce byte-identical orders.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

// ---- the whole strategy is these numbers (basis points unless noted) ----
const RISE_BPS = 20; // entry: the close has risen this far off its trailing trough
const CHASE_BPS = 120; // entry: ...but no further than this above the trough (never chase a spike)
const FREEFALL_BPS = 120; // entry: blocked while the trailing 30-bar return is under -this
const TROUGH_BARS = 90; // the trough is the lowest close of the last this-many bars
const MIN_BARS = 10; // no entry before this many bars have been seen (a trough needs time to form)
const ENTRY_CUTOFF = 1200; // no first entry after this bar: too little window left to bank a move
const HARD_BPS = 50; // hard stop: sell if the close falls this far under the entry close
const TP_BPS = 465; // take-profit: sell if the close reaches this far above the entry close
const REENTRY_BPS = 30; // after a take-profit, re-enter only if a close breaks this far above that episode's peak
const RETRAIL_BPS = 120; // a re-entered position is protected by a trailing stop this far under its peak
const MAX_ENTRIES = 2; // one first entry plus at most one re-entry
const ORDER_SLIP_BPS = 500; // max_slippage_bps on orders: far above the modelled slip+impact; only freak fills are refused

const BPS = 10000n;

/** a >= b * (10000 + bps) / 10000, in exact integer arithmetic (bps may be negative). */
function atLeastBps(a: bigint, b: bigint, bps: number): boolean {
  return a * BPS >= b * (BPS + BigInt(bps));
}

// ---- run state, all derived from the bars seen so far ----
const closes: bigint[] = []; // every close of our symbol, in order
let entries = 0; // entries taken so far
let holding = false; // whether the last account we saw holds the asset
let entryClose = 0n; // the close of the bar on which the current/last entry was decided
let tpPeak = 0n; // highest close since the take-profit that ended the last position
let rePeak = 0n; // highest close since a re-entry was decided
let phase: 'seek' | 'in' | 'after_tp' | 're_in' | 'done' = 'seek';
let exitKind: 'tp' | 'stop' | null = null; // the exit order most recently sent, awaiting its fill

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const symbol = state.hello.symbols[0]!.symbol;
    const bar = batch.bars.find((b) => b.symbol === symbol);
    if (bar === undefined) return []; // a minute with no bar for our symbol: nothing to decide on
    const close = BigInt(bar.c);
    closes.push(close);

    const pos = state.positions.get(symbol);
    const held = pos !== undefined && pos.qty > 0n;

    // An exit order sent on an earlier batch has filled if the position is gone now.
    if (exitKind !== null && !held) {
      phase = exitKind === 'tp' && entries < MAX_ENTRIES ? 'after_tp' : 'done';
      exitKind = null;
    }
    if (exitKind !== null && held) exitKind = null; // it was rejected; the rules below will speak again
    holding = held;

    // An entry order that was refused (a freak fill beyond the slippage cap) leaves us flat
    // while the phase says we hold: step back and seek again instead of waiting forever.
    if (!held && exitKind === null && (phase === 'in' || phase === 're_in')) {
      entries -= 1;
      phase = phase === 'in' ? 'seek' : 'after_tp';
    }

    if (state.warmingUp) return []; // warm-up bars build the history; orders on them are refused anyway

    // ---- holding: watch the hard stop and the take-profit (and, on a re-entry, the trailing stop) ----
    if (held) {
      if (!atLeastBps(close, entryClose, -HARD_BPS)) {
        exitKind = 'stop';
        return [{ side: 'sell', symbol, qty: pos!.qty, max_slippage_bps: ORDER_SLIP_BPS }];
      }
      if (atLeastBps(close, entryClose, TP_BPS)) {
        exitKind = 'tp';
        tpPeak = close;
        return [{ side: 'sell', symbol, qty: pos!.qty, max_slippage_bps: ORDER_SLIP_BPS }];
      }
      if (phase === 're_in') {
        if (close > rePeak) rePeak = close;
        if (!atLeastBps(close, rePeak, -RETRAIL_BPS)) {
          exitKind = 'stop';
          return [{ side: 'sell', symbol, qty: pos!.qty, max_slippage_bps: ORDER_SLIP_BPS }];
        }
      }
      return [];
    }

    // ---- flat after a take-profit: re-enter only on a decisive breakout above that episode's peak ----
    if (phase === 'after_tp') {
      if (atLeastBps(close, tpPeak, REENTRY_BPS) && state.cash > 1_000_000n) {
        entries += 1;
        entryClose = close;
        rePeak = close;
        phase = 're_in';
        return [{ side: 'buy', symbol, notional_quote_units: state.cash, max_slippage_bps: ORDER_SLIP_BPS }];
      }
      if (close > tpPeak) tpPeak = close;
      return [];
    }
    if (phase !== 'seek') return [];

    // ---- flat and seeking: buy the turn off the trailing trough ----
    const n = closes.length;
    if (n < MIN_BARS || n > ENTRY_CUTOFF) return [];
    let trough = close;
    for (let k = Math.max(0, n - TROUGH_BARS); k < n; k++) if (closes[k]! < trough) trough = closes[k]!;
    if (!atLeastBps(close, trough, RISE_BPS)) return []; // the turn has not come yet
    if (atLeastBps(close, trough, CHASE_BPS)) return []; // it came and went; we do not chase
    if (n > 30 && !atLeastBps(close, closes[n - 31]!, -FREEFALL_BPS)) return []; // still falling: stand aside
    if (state.cash <= 1_000_000n) return []; // below the minimum order
    entries += 1;
    entryClose = close;
    phase = 'in';
    return [{ side: 'buy', symbol, notional_quote_units: state.cash, max_slippage_bps: ORDER_SLIP_BPS }];
  },
});
