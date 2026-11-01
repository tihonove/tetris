/**
 * A small model of the 2A03 APU pulse 1 and noise channels, used to render
 * the game's sound effects from the register writes the original program
 * makes. Output is a mono Float32Array at the given sample rate.
 */

export const CPU_HZ = 1789773;
export const FRAME_HZ = 60.0988;
/** Half-frame clocks (length counter, sweep) happen twice per frame. */
const HALF_FRAME_CYCLES = 14915;

const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];

const DUTY = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];

const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];

class Pulse {
  duty = 0;
  haltLength = false;
  constantVolume = false;
  volume = 0;
  sweepEnabled = false;
  sweepPeriod = 0;
  sweepNegate = false;
  sweepShift = 0;
  sweepReload = false;
  sweepDivider = 0;
  period = 0;
  length = 0;
  sequencer = 0;
  timer = 0;

  write(reg: number, v: number): void {
    switch (reg) {
      case 0:
        this.duty = v >> 6;
        this.haltLength = (v & 0x20) !== 0;
        this.constantVolume = (v & 0x10) !== 0;
        this.volume = v & 0x0f;
        break;
      case 1:
        this.sweepEnabled = (v & 0x80) !== 0;
        this.sweepPeriod = (v >> 4) & 7;
        this.sweepNegate = (v & 0x08) !== 0;
        this.sweepShift = v & 7;
        this.sweepReload = true;
        break;
      case 2:
        this.period = (this.period & 0x700) | v;
        break;
      case 3:
        this.period = (this.period & 0xff) | ((v & 7) << 8);
        this.length = LENGTH_TABLE[v >> 3];
        this.sequencer = 0;
        break;
    }
  }

  private target(): number {
    const change = this.period >> this.sweepShift;
    // Pulse 1 uses one's complement for the negate mode.
    return this.sweepNegate ? this.period - change - 1 : this.period + change;
  }

  private muted(): boolean {
    return this.period < 8 || this.target() > 0x7ff;
  }

  halfFrame(): void {
    if (!this.haltLength && this.length > 0) this.length--;
    if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift !== 0 && !this.muted()) {
      this.period = this.target() & 0x7ff;
    }
    if (this.sweepDivider === 0 || this.sweepReload) {
      this.sweepDivider = this.sweepPeriod;
      this.sweepReload = false;
    } else {
      this.sweepDivider--;
    }
  }

  /** Advance by `cycles` CPU cycles and return the current output level (0..15). */
  run(cycles: number): number {
    const step = (this.period + 1) * 2;
    this.timer -= cycles;
    while (this.timer <= 0) {
      this.timer += step;
      this.sequencer = (this.sequencer + 1) & 7;
    }
    if (this.length === 0 || this.muted()) return 0;
    return DUTY[this.duty][this.sequencer] ? this.volume : 0;
  }
}

class Noise {
  haltLength = false;
  volume = 0;
  mode = false;
  period = NOISE_PERIODS[0];
  length = 0;
  lfsr = 1;
  timer = 0;

  write(reg: number, v: number): void {
    switch (reg) {
      case 0:
        this.haltLength = (v & 0x20) !== 0;
        this.volume = v & 0x0f;
        break;
      case 2:
        this.mode = (v & 0x80) !== 0;
        this.period = NOISE_PERIODS[v & 0x0f];
        break;
      case 3:
        this.length = LENGTH_TABLE[v >> 3];
        break;
    }
  }

  halfFrame(): void {
    if (!this.haltLength && this.length > 0) this.length--;
  }

  run(cycles: number): number {
    this.timer -= cycles;
    while (this.timer <= 0) {
      this.timer += this.period;
      const bit = this.mode ? 6 : 1;
      const feedback = (this.lfsr & 1) ^ ((this.lfsr >> bit) & 1);
      this.lfsr = (this.lfsr >> 1) | (feedback << 14);
    }
    if (this.length === 0 || (this.lfsr & 1)) return 0;
    return this.volume;
  }
}

/** One APU register write: address $4000-$400F and value. */
export type ApuWrite = readonly [addr: number, value: number];

/**
 * Render a sequence of frames of register writes to PCM. `frames[i]` holds the
 * writes performed during frame i (the game's audio update runs once per frame).
 * `tailFrames` of silence-producing time are appended so length counters can expire.
 */
export function renderApu(frames: readonly (readonly ApuWrite[])[], sampleRate: number, tailFrames = 4): Float32Array<ArrayBuffer> {
  const pulse = new Pulse();
  const noise = new Noise();
  const cyclesPerSample = CPU_HZ / sampleRate;
  const cyclesPerFrame = CPU_HZ / FRAME_HZ;
  const totalFrames = frames.length + tailFrames;
  const out = new Float32Array(Math.ceil((totalFrames * cyclesPerFrame) / cyclesPerSample));
  let cycleClock = 0; // CPU cycles elapsed
  let nextHalfFrame = HALF_FRAME_CYCLES / 2;
  let n = 0;
  for (let f = 0; f < totalFrames; f++) {
    const writes = frames[f] ?? [];
    for (const [addr, value] of writes) {
      if (addr >= 0x4000 && addr <= 0x4003) pulse.write(addr - 0x4000, value);
      else if (addr >= 0x400c && addr <= 0x400f) noise.write(addr - 0x400c, value);
    }
    const frameEnd = (f + 1) * cyclesPerFrame;
    while (cycleClock < frameEnd && n < out.length) {
      while (nextHalfFrame <= cycleClock) {
        pulse.halfFrame();
        noise.halfFrame();
        nextHalfFrame += HALF_FRAME_CYCLES;
      }
      const p = pulse.run(cyclesPerSample);
      const z = noise.run(cyclesPerSample);
      const pulseOut = p === 0 ? 0 : 95.88 / (8128 / p + 100);
      const noiseOut = z === 0 ? 0 : 159.79 / (1 / (z / 12241) + 100);
      out[n++] = pulseOut + noiseOut;
      cycleClock += cyclesPerSample;
    }
  }
  return out;
}
