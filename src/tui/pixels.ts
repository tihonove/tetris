/**
 * A tiny software PPU: background tiles plus sprites to a 256x240 buffer of
 * NES palette indices.
 */
import type { NesTetris } from '../engine/tetris';
import { tilePixels } from '../render/tiles';

export const WIDTH = 256;
export const HEIGHT = 240;

const decoded: (Uint8Array | null)[] = new Array(256).fill(null);
function pixelsOf(tile: number): Uint8Array {
  let p = decoded[tile & 0xff];
  if (!p) { p = tilePixels(tile); decoded[tile & 0xff] = p; }
  return p;
}

/** Fill `out` (WIDTH*HEIGHT) with palette indices for the current picture. */
export function renderPixels(game: NesTetris, out: Uint8Array): void {
  const bg = game.bgPalette;
  const backdrop = bg[0];
  out.fill(backdrop);
  if (game.backgroundVisible) {
    for (let ty = 0; ty < 30; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const tile = game.nametable[ty * 32 + tx];
        if (tile === 0xef || tile === 0xff) continue;
        const px = pixelsOf(tile);
        const pal = game.attributeFor(tx, ty) * 4;
        const base = ty * 8 * WIDTH + tx * 8;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const v = px[y * 8 + x];
            if (v !== 0) out[base + y * WIDTH + x] = bg[pal + v];
          }
        }
      }
    }
  }
  const sp = game.spritePalette;
  // Later OAM entries are drawn first so that earlier ones win overlaps, like the PPU.
  for (let i = game.oam.length - 1; i >= 0; i--) {
    const s = game.oam[i];
    if (s.y >= 0xef || s.tile === 0xff) continue;
    const px = pixelsOf(s.tile);
    const pal = (s.attr & 3) * 4;
    const top = s.y + 1;
    for (let y = 0; y < 8; y++) {
      const sy = top + y;
      if (sy < 0 || sy >= HEIGHT) continue;
      for (let x = 0; x < 8; x++) {
        const sx = s.x + x;
        if (sx >= WIDTH) continue;
        const v = px[y * 8 + x];
        if (v !== 0) out[sy * WIDTH + sx] = sp[pal + v];
      }
    }
  }
}
