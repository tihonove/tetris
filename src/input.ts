/**
 * Keyboard and gamepad to NES controller bits.
 *
 * A key that is pressed and released between two polls still counts as held
 * for one poll, so quick taps are never lost.
 */
import { BTN_A, BTN_B, BTN_DOWN, BTN_LEFT, BTN_RIGHT, BTN_SELECT, BTN_START, BTN_UP } from './data/tables';

export const KEY_MAP: Readonly<Record<string, number>> = {
  ArrowLeft: BTN_LEFT,
  ArrowRight: BTN_RIGHT,
  ArrowDown: BTN_DOWN,
  ArrowUp: BTN_UP,
  KeyX: BTN_A,
  KeyZ: BTN_B,
  KeyK: BTN_A,
  KeyJ: BTN_B,
  Enter: BTN_START,
  ShiftRight: BTN_SELECT,
  ShiftLeft: BTN_SELECT,
  Space: BTN_SELECT,
};

export class Input {
  private held = 0;
  private latched = 0;
  private onGesture: (() => void) | null = null;

  constructor(onGesture?: () => void) {
    this.onGesture = onGesture ?? null;
  }

  attach(target: Window): () => void {
    const down = (e: KeyboardEvent): void => {
      const bit = KEY_MAP[e.code];
      if (bit === undefined) return;
      e.preventDefault();
      if (e.repeat) return;
      this.held |= bit;
      this.latched |= bit;
      this.onGesture?.();
    };
    const up = (e: KeyboardEvent): void => {
      const bit = KEY_MAP[e.code];
      if (bit === undefined) return;
      e.preventDefault();
      this.held &= ~bit;
    };
    const blur = (): void => { this.held = 0; };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }

  /** Forget any press latched so far (used when the game starts from the menu). */
  reset(): void {
    this.latched = 0;
  }

  /** Controller byte for this frame. */
  poll(): number {
    let b = this.held | this.latched;
    this.latched = 0;
    b |= this.pollGamepad();
    return b & 0xff;
  }

  private pollGamepad(): number {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
    let bits = 0;
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      const btn = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
      if (btn(1)) bits |= BTN_A;
      if (btn(0)) bits |= BTN_B;
      if (btn(8)) bits |= BTN_SELECT;
      if (btn(9)) bits |= BTN_START;
      if (btn(12) || pad.axes[1] < -0.5) bits |= BTN_UP;
      if (btn(13) || pad.axes[1] > 0.5) bits |= BTN_DOWN;
      if (btn(14) || pad.axes[0] < -0.5) bits |= BTN_LEFT;
      if (btn(15) || pad.axes[0] > 0.5) bits |= BTN_RIGHT;
    }
    if (bits) this.onGesture?.();
    return bits;
  }
}
