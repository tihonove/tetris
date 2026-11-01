/**
 * High resolution terminal picture: every cell shows a 2x4 pixel block of the
 * 256x240 picture, so a NES tile is 4 cells wide and 2 cells tall and the
 * whole screen is 128x60 cells.
 *
 * Each cell has at most two colours (foreground for the "set" pixels,
 * background for the rest). Patterns that match a Block Elements glyph are
 * drawn solid; everything else uses Braille dots. With `octants` every
 * pattern is drawn solid using the Unicode 16 octant characters.
 */
import type { Cell } from './glyphs';
import { OCTANT_CODEPOINTS } from './octants';
import { HEIGHT, WIDTH } from './pixels';

export const HIRES_COLS = WIDTH / 2;
export const HIRES_ROWS = HEIGHT / 4;

/** Block Elements for the 2x4 patterns they represent exactly (bit i = octant i+1). */
const BLOCKS = new Map<number, string>([
  [0x00, ' '], [0xff, '█'],
  [0x0f, '▀'], [0xf0, '▄'], [0x55, '▌'], [0xaa, '▐'],
  [0x05, '▘'], [0x0a, '▝'], [0x50, '▖'], [0xa0, '▗'],
  [0x5f, '▛'], [0xaf, '▜'], [0xf5, '▙'], [0xfa, '▟'],
  [0xa5, '▚'], [0x5a, '▞'],
  [0xc0, '▂'], [0xfc, '▆'],
]);

/** Braille dot bits for pixel (x, y) in a 2x4 cell. */
const BRAILLE_BIT = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80];

function brailleFor(mask: number): string {
  let dots = 0;
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) dots |= BRAILLE_BIT[i];
  return String.fromCharCode(0x2800 + dots);
}

function popcount(v: number): number {
  let c = 0;
  while (v) { v &= v - 1; c++; }
  return c;
}

/** Glyph for a pattern, and whether the pattern was inverted (fg/bg swapped). */
function glyphFor(mask: number, octants: boolean): { ch: string; inverted: boolean } {
  if (octants) return { ch: String.fromCodePoint(OCTANT_CODEPOINTS[mask]), inverted: false };
  const block = BLOCKS.get(mask);
  if (block !== undefined) return { ch: block, inverted: false };
  const inverse = BLOCKS.get(mask ^ 0xff);
  if (inverse !== undefined) return { ch: inverse, inverted: true };
  // Braille: draw the minority colour as dots.
  if (popcount(mask) > 4) return { ch: brailleFor(mask ^ 0xff), inverted: true };
  return { ch: brailleFor(mask), inverted: false };
}

const glyphCache: ({ ch: string; inverted: boolean } | undefined)[] = new Array(512);

/** Convert a pixel buffer to HIRES_ROWS rows of HIRES_COLS cells. */
export function cellify(pixels: Uint8Array, octants: boolean, rows?: Cell[][]): Cell[][] {
  const out = rows ?? [];
  const counts = new Map<number, number>();
  for (let cy = 0; cy < HIRES_ROWS; cy++) {
    const row = out[cy] ?? (out[cy] = new Array(HIRES_COLS));
    for (let cx = 0; cx < HIRES_COLS; cx++) {
      // Gather the 8 pixels and count colours.
      counts.clear();
      const px: number[] = [];
      for (let y = 0; y < 4; y++) {
        const base = (cy * 4 + y) * WIDTH + cx * 2;
        for (let x = 0; x < 2; x++) {
          const v = pixels[base + x];
          px.push(v);
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      let bgColour = -1, bgCount = -1, fgColour = -1, fgCount = -1;
      for (const [v, n] of counts) {
        if (n > bgCount) { fgColour = bgColour; fgCount = bgCount; bgColour = v; bgCount = n; }
        else if (n > fgCount) { fgColour = v; fgCount = n; }
      }
      if (fgColour === -1) {
        row[cx] = { ch: ' ', fg: bgColour, bg: bgColour };
        continue;
      }
      // Pixels of the foreground colour are "set"; other minority colours join the background.
      let mask = 0;
      for (let i = 0; i < 8; i++) if (px[i] === fgColour) mask |= 1 << i;
      const key = mask + (octants ? 256 : 0);
      let g = glyphCache[key];
      if (!g) { g = glyphFor(mask, octants); glyphCache[key] = g; }
      row[cx] = g.inverted
        ? { ch: g.ch, fg: bgColour, bg: fgColour }
        : { ch: g.ch, fg: fgColour, bg: bgColour };
    }
  }
  return out;
}
