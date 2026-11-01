import { describe, expect, it } from 'vitest';
import { renderApu } from './apu';
import { noiseScript, pauseScript, sq1Script } from './sfx';
import { SFX_LEVEL_UP, SFX_LINE_CLEARING, SFX_LINE_COMPLETED, SFX_LOCK, SFX_ROTATE, SFX_SHIFT, SFX_TETRIS } from '../data/tables';

function stats(pcm: Float32Array): { peak: number; nonZero: number } {
  let peak = 0, nonZero = 0;
  for (const v of pcm) { if (v !== 0) nonZero++; if (Math.abs(v) > peak) peak = Math.abs(v); }
  return { peak, nonZero };
}

describe('sound effect scripts', () => {
  it.each([
    ['shift', SFX_SHIFT, 3],
    ['rotate', SFX_ROTATE, 17],
    ['lock', SFX_LOCK, 16],
    ['levelUp', SFX_LEVEL_UP, 61],
    ['lineCompleted', SFX_LINE_COMPLETED, 46],
    ['lineClearing', SFX_LINE_CLEARING, 37],
    ['tetris', SFX_TETRIS, 46 + 36],
  ])('%s lasts the expected number of frames', (_name, id, frames) => {
    expect(sq1Script(id).length).toBe(frames);
  });

  it('game over noise runs for 65 frames', () => {
    expect(noiseScript().length).toBe(65);
  });

  it('renders audible, finite PCM for every effect', () => {
    for (const id of [SFX_SHIFT, SFX_ROTATE, SFX_LOCK, SFX_LEVEL_UP, SFX_LINE_COMPLETED, SFX_LINE_CLEARING, SFX_TETRIS]) {
      const pcm = renderApu(sq1Script(id), 44100);
      const s = stats(pcm);
      expect(Number.isFinite(s.peak)).toBe(true);
      expect(s.peak).toBeGreaterThan(0.05);
      expect(s.nonZero).toBeGreaterThan(100);
    }
    const noise = stats(renderApu(noiseScript(), 44100));
    expect(noise.peak).toBeGreaterThan(0.05);
    const pause = stats(renderApu(pauseScript(), 44100));
    expect(pause.peak).toBeGreaterThan(0.05);
  });

  it('shift is a short blip: about two frames of sound', () => {
    const pcm = renderApu(sq1Script(SFX_SHIFT), 44100);
    let lastNonZero = 0;
    for (let i = 0; i < pcm.length; i++) if (pcm[i] !== 0) lastNonZero = i;
    const seconds = lastNonZero / 44100;
    expect(seconds).toBeGreaterThan(0.025);
    expect(seconds).toBeLessThan(0.06);
  });
});
