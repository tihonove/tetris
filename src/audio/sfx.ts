/**
 * The game's sound effect routines, reproduced as per-frame APU register
 * writes, and a WebAudio player for them.
 */
import { renderApu, type ApuWrite } from './apu';
import {
  NOISE_SFX_GAME_OVER, SFX_LEVEL_UP, SFX_LINE_CLEARING, SFX_LINE_COMPLETED, SFX_LOCK, SFX_ROTATE, SFX_SHIFT, SFX_TETRIS,
} from '../data/tables';

const SQ1 = 0x4000;
const NOISE = 0x400c;

// Init data: (VOL, SWEEP, LO, HI) for the pulse 1 channel.
const ROTATE_INIT = [0x9e, 0x7f, 0xc0, 0x28];
const ROTATE_STAGE3 = [0xb2, 0x7f, 0xc0, 0x08];
const LEVEL_UP_INIT = [0xde, 0x7f, 0xa8, 0x18];
const LOCK_INIT = [0x9f, 0x84, 0xff, 0x0b];
const TETRIS_INIT = [0x9e, 0x9d, 0xc0, 0x08];
const LINE_COMPLETED_INIT = [0x9c, 0x9a, 0xa0, 0x09];
const LINE_CLEARING_INIT = [0x9e, 0x7f, 0x69, 0x08];
const SHIFT_INIT = [0x98, 0x7f, 0x80, 0x38];
const PAUSE_EVEN = [0x9d, 0x7f, 0x7a, 0x28];
const PAUSE_ODD = [0x9d, 0x7f, 0x40, 0x28];
const GAME_OVER_INIT = [0x1f, 0x7f, 0x0f, 0xc0];

const LINE_CLEARING_VOL = [0x9e, 0x9b, 0x99, 0x96, 0x94, 0x93, 0x92, 0x91, 0x00];
const LINE_CLEARING_LO = [
  0x46, 0x37, 0x46, 0x37, 0x46, 0x37, 0x46, 0x37,
  0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0,
  0xc0, 0x89, 0xb8, 0x68, 0xa0, 0x50, 0x90, 0x40,
];
const LEVEL_UP_LO = [0x69, 0xa8, 0x69, 0xa8, 0x8d, 0x53, 0x8d, 0x53, 0x8d, 0x00];

const NOISE_LO_TABLE = [
  0x7a, 0xde, 0xff, 0xef, 0xfd, 0xdf, 0xfe, 0xef, 0xef, 0xfd, 0xef, 0xfe, 0xdf, 0xff, 0xee, 0xee,
  0xff, 0xef, 0xff, 0xff, 0xff, 0xef, 0xef, 0xff, 0xfd, 0xdf, 0xdf, 0xef, 0xfe, 0xdf, 0xef, 0xff,
];
const NOISE_VOL_TABLE = [
  0xbf, 0xff, 0xee, 0xef, 0xef, 0xef, 0xdf, 0xfb, 0xbb, 0xaa, 0xaa, 0x99, 0x98, 0x87, 0x76, 0x66,
  0x55, 0x44, 0x44, 0x44, 0x44, 0x43, 0x33, 0x33, 0x22, 0x22, 0x22, 0x22, 0x21, 0x11, 0x11, 0x11,
];

function nibble(table: readonly number[], index: number): number {
  const b = table[index >> 1];
  return index & 1 ? b & 0x0f : b >> 4;
}

/** State of one sound effect slot, mirroring the game's RAM. */
class Slot {
  playing = 0;
  frameCount = 0;
  frameCounter = 0;
  secondary = 0;
  tertiary = 0;
  writes: ApuWrite[] = [];

  init(id: number, frameCount: number, base: number, data: readonly number[]): void {
    this.frameCount = frameCount;
    for (let i = 0; i < 4; i++) this.writes.push([base + i, data[i]]);
    this.playing = id;
    this.frameCounter = 0;
    this.secondary = 0;
    this.tertiary = 0;
  }

  /** advanceAudioSlotFrame: true when the stage length has elapsed. */
  advance(): boolean {
    this.frameCounter++;
    if (this.frameCounter !== this.frameCount) return false;
    this.frameCounter = 0;
    return true;
  }

  copy(base: number, data: readonly number[]): void {
    for (let i = 0; i < 4; i++) this.writes.push([base + i, data[i]]);
  }
}

/** Run the pulse 1 slot for one frame, returning the register writes. */
function sq1Frame(slot: Slot, initId: number): ApuWrite[] {
  slot.writes = [];
  const stop = (): void => {
    slot.writes.push([SQ1, 0x10]);
    slot.playing = 0;
  };

  if (initId !== 0) {
    const blocked = [SFX_TETRIS, SFX_LEVEL_UP, SFX_LINE_CLEARING, SFX_LINE_COMPLETED].includes(slot.playing);
    switch (initId) {
      case SFX_SHIFT: if (!blocked) slot.init(initId, 2, SQ1, SHIFT_INIT); break;
      case SFX_ROTATE: if (!blocked) slot.init(initId, 4, SQ1, ROTATE_INIT); break;
      case SFX_LOCK: if (!blocked) slot.init(initId, 0x0f, SQ1, LOCK_INIT); break;
      case SFX_TETRIS: slot.init(initId, 5, SQ1, TETRIS_INIT); slot.tertiary = 0x10; break;
      case SFX_LINE_COMPLETED: slot.init(initId, 5, SQ1, LINE_COMPLETED_INIT); slot.tertiary = 8; break;
      case SFX_LINE_CLEARING: slot.init(initId, 4, SQ1, LINE_CLEARING_INIT); break;
      case SFX_LEVEL_UP: slot.init(initId, 6, SQ1, LEVEL_UP_INIT); break;
    }
    return slot.writes;
  }

  switch (slot.playing) {
    case 0:
      break;
    case SFX_SHIFT:
    case SFX_LOCK:
      if (slot.advance()) stop();
      break;
    case SFX_ROTATE:
      if (slot.advance()) {
        const stage = slot.secondary++;
        if (stage === 1) slot.copy(SQ1, ROTATE_INIT);
        else if (stage === 2) slot.copy(SQ1, ROTATE_STAGE3);
        else if (stage === 3) stop();
      }
      break;
    case SFX_TETRIS:
    case SFX_LINE_COMPLETED:
    case SFX_LINE_CLEARING:
      if (slot.advance()) {
        const data = slot.playing === SFX_TETRIS ? TETRIS_INIT
          : slot.playing === SFX_LINE_COMPLETED ? LINE_COMPLETED_INIT : LINE_CLEARING_INIT;
        slot.copy(SQ1, data);
        slot.writes.push([SQ1 + 2, LINE_CLEARING_LO[(slot.tertiary + slot.secondary) & 0xff] ?? 0]);
        const vol = LINE_CLEARING_VOL[slot.secondary] ?? 0;
        slot.writes.push([SQ1, vol]);
        if (vol === 0) {
          if (slot.playing === SFX_TETRIS) slot.init(SFX_LINE_CLEARING, 4, SQ1, LINE_CLEARING_INIT);
          else stop();
        } else {
          slot.secondary++;
        }
      }
      break;
    case SFX_LEVEL_UP:
      if (slot.advance()) {
        const lo = LEVEL_UP_LO[slot.secondary++] ?? 0;
        if (lo === 0) stop();
        else {
          slot.writes.push([SQ1 + 2, lo]);
          slot.writes.push([SQ1 + 3, 0x28]);
        }
      }
      break;
  }
  return slot.writes;
}

/** Full register script for a pulse 1 sound effect started from silence. */
export function sq1Script(id: number): ApuWrite[][] {
  const slot = new Slot();
  const frames: ApuWrite[][] = [sq1Frame(slot, id)];
  while (slot.playing !== 0 && frames.length < 600) frames.push(sq1Frame(slot, 0));
  return frames;
}

/** Register script for the game-over curtain noise. */
export function noiseScript(): ApuWrite[][] {
  const slot = new Slot();
  slot.init(NOISE_SFX_GAME_OVER, 0x40, NOISE, GAME_OVER_INIT);
  const frames: ApuWrite[][] = [slot.writes];
  while (slot.playing !== 0) {
    slot.writes = [];
    if (slot.advance()) {
      slot.writes.push([NOISE, 0x10]);
      slot.playing = 0;
    } else {
      slot.writes.push([NOISE + 2, nibble(NOISE_LO_TABLE, slot.secondary)]);
      slot.writes.push([NOISE, nibble(NOISE_VOL_TABLE, slot.secondary) | 0x10]);
      slot.secondary++;
    }
    frames.push(slot.writes);
  }
  return frames;
}

/** Register script for the pause jingle (updateAudio_pause). */
export function pauseScript(): ApuWrite[][] {
  const frames: ApuWrite[][] = [];
  let counter = 0;
  for (let lengthCounter = 0; lengthCounter < 0x12; lengthCounter++) {
    const writes: ApuWrite[] = [];
    if ((lengthCounter & 3) === 3) {
      counter++;
      const data = counter & 1 ? PAUSE_ODD : PAUSE_EVEN;
      for (let i = 0; i < 4; i++) writes.push([SQ1 + i, data[i]]);
    }
    frames.push(writes);
  }
  return frames;
}

export type SfxName = 'shift' | 'rotate' | 'lock' | 'tetris' | 'lineCompleted' | 'lineClearing' | 'levelUp' | 'gameOver' | 'pause';

const SQ1_BY_ID: Record<number, SfxName> = {
  [SFX_SHIFT]: 'shift',
  [SFX_ROTATE]: 'rotate',
  [SFX_LOCK]: 'lock',
  [SFX_TETRIS]: 'tetris',
  [SFX_LINE_COMPLETED]: 'lineCompleted',
  [SFX_LINE_CLEARING]: 'lineClearing',
  [SFX_LEVEL_UP]: 'levelUp',
};

const BLOCKING: readonly SfxName[] = ['tetris', 'levelUp', 'lineClearing', 'lineCompleted'];

/**
 * Plays the pre-rendered effects. Pulse 1 effects replace each other the way
 * the single hardware channel does; the noise channel plays independently.
 */
export class SfxPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private sq1Source: AudioBufferSourceNode | null = null;
  private sq1Name: SfxName | null = null;
  private sq1EndsAt = 0;
  volume = 0.5;

  /** Must be called from a user gesture. */
  ensureContext(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(ctx.destination);
    const make = (name: SfxName, frames: ApuWrite[][]): void => {
      const pcm = renderApu(frames, ctx.sampleRate);
      const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
      buffer.copyToChannel(pcm, 0);
      this.buffers.set(name, buffer);
    };
    for (const [id, name] of Object.entries(SQ1_BY_ID)) make(name, sq1Script(Number(id)));
    make('gameOver', noiseScript());
    make('pause', pauseScript());
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  /** Request from the game: pulse-1 slot init id for this frame. */
  playSq1(id: number): void {
    const name = SQ1_BY_ID[id];
    if (!name || !this.ctx || !this.gain) return;
    // LE33B: shift/rotate/lock do not interrupt the longer effects.
    if ((name === 'shift' || name === 'rotate' || name === 'lock') && this.sq1Name && BLOCKING.includes(this.sq1Name)
      && this.ctx.currentTime < this.sq1EndsAt) return;
    this.sq1Source?.stop();
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.start();
    this.sq1Source = src;
    this.sq1Name = name;
    this.sq1EndsAt = this.ctx.currentTime + buffer.duration;
  }

  playNoise(): void {
    this.playIndependent('gameOver');
  }

  playPause(): void {
    this.sq1Source?.stop();
    this.sq1Name = null;
    this.playIndependent('pause');
  }

  private playIndependent(name: SfxName): void {
    if (!this.ctx || !this.gain) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    src.start();
  }
}
