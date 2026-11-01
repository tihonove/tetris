/**
 * Raw terminal keys to NES controller bits.
 *
 * Terminals report key presses only, never releases, so "held" is modelled:
 * a key stays held for a short time after its last event, and the OS key
 * repeat keeps it held. Down is held for at least three frames per event so
 * that every tap soft-drops exactly one row, as a tap does on the NES.
 */
import { BTN_A, BTN_B, BTN_DOWN, BTN_LEFT, BTN_RIGHT, BTN_SELECT, BTN_START, BTN_UP } from '../data/tables';

/** How long a direction stays held after its last key event (ms). Must exceed the OS repeat interval. */
const HOLD_MS = 90;
/** Minimum hold for Down, in frames. */
const DOWN_MIN_FRAMES = 3;
/** A/B events closer than this are OS auto-repeat and are ignored. */
const ROTATE_REPEAT_MS = 150;

export interface KeyEvent {
  bits: number;
  quit: boolean;
}

export function parseKeys(data: string): KeyEvent[] {
  const out: KeyEvent[] = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    if (c === '\x1b') {
      const rest = data.slice(i + 1, i + 3);
      const m = /^(\[|O)([ABCD])/.exec(rest);
      if (m) {
        const bits = { A: BTN_UP, B: BTN_DOWN, C: BTN_RIGHT, D: BTN_LEFT }[m[2]] ?? 0;
        out.push({ bits, quit: false });
        i += 3;
        continue;
      }
      if (data.length === 1) out.push({ bits: 0, quit: true }); // lone Escape
      i += 1;
      continue;
    }
    if (c === '\x03' || c === 'q' || c === 'Q') out.push({ bits: 0, quit: true });
    else if (c === '\r' || c === '\n') out.push({ bits: BTN_START, quit: false });
    else if (c === ' ') out.push({ bits: BTN_SELECT, quit: false });
    else if (c === 'x' || c === 'X' || c === 'k' || c === 'K') out.push({ bits: BTN_A, quit: false });
    else if (c === 'z' || c === 'Z' || c === 'j' || c === 'J') out.push({ bits: BTN_B, quit: false });
    else if (c === 'a' || c === 'A') out.push({ bits: BTN_LEFT, quit: false });
    else if (c === 'd' || c === 'D') out.push({ bits: BTN_RIGHT, quit: false });
    else if (c === 's' || c === 'S') out.push({ bits: BTN_DOWN, quit: false });
    else if (c === 'w' || c === 'W') out.push({ bits: BTN_UP, quit: false });
    i += 1;
  }
  return out;
}

export class TerminalInput {
  quit = false;
  private lastEvent = new Map<number, number>();
  private downFramesLeft = 0;
  private pulses = 0;
  private lastRotate = new Map<number, number>();

  /** Feed raw bytes from stdin. */
  feed(data: string, now: number): void {
    for (const ev of parseKeys(data)) {
      if (ev.quit) { this.quit = true; continue; }
      for (const bit of [BTN_LEFT, BTN_RIGHT, BTN_UP]) {
        if (ev.bits & bit) this.lastEvent.set(bit, now);
      }
      if (ev.bits & BTN_DOWN) {
        this.lastEvent.set(BTN_DOWN, now);
        this.downFramesLeft = Math.max(this.downFramesLeft, DOWN_MIN_FRAMES);
      }
      for (const bit of [BTN_A, BTN_B, BTN_START, BTN_SELECT]) {
        if (!(ev.bits & bit)) continue;
        const last = this.lastRotate.get(bit) ?? -Infinity;
        if (now - last >= ROTATE_REPEAT_MS) this.pulses |= bit;
        this.lastRotate.set(bit, now);
      }
    }
  }

  /** Controller byte for the frame starting at `now`. */
  poll(now: number): number {
    let bits = 0;
    for (const [bit, t] of this.lastEvent) if (now - t <= HOLD_MS) bits |= bit;
    if (this.downFramesLeft > 0) { bits |= BTN_DOWN; this.downFramesLeft--; }
    // One-frame presses for buttons that must not auto-repeat.
    bits |= this.pulses;
    this.pulses = 0;
    return bits & 0xff;
  }
}
