/**
 * Terminal glyphs for NES tiles. A tile (8x8 pixels) becomes two terminal
 * cells side by side, which is roughly square in most monospace fonts. Each
 * half tile (4x8 pixels) is matched against block-element glyph masks; text
 * tiles map to characters; the block tiles get hand-picked glyphs.
 */
import { NES_PALETTE } from '../data/gfx';
import { tilePixels } from '../render/tiles';

export interface Cell {
  ch: string;
  /** NES palette index or -1 for the backdrop. */
  fg: number;
  bg: number;
}

export interface TermStyle {
  /** Use fullwidth Unicode letters for the game's text tiles (small mode). */
  fullwidth: boolean;
  /** 'big': 128x60 cells, 2x4 pixels per cell; 'small': 64x30 cells, one tile per two cells. */
  mode: 'small' | 'big';
  /** Big mode: draw every pattern with Unicode 16 octants instead of blocks + Braille. */
  octants: boolean;
}

type Mask = number; // 32 bits: bit (y*4 + x) for a 4x8 half tile

function maskOf(pred: (x: number, y: number) => boolean): Mask {
  let m = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) if (pred(x, y)) m |= 1 << (y * 4 + x);
  return m >>> 0;
}

const GLYPHS: ReadonlyArray<[string, Mask]> = [
  [' ', 0],
  ['█', maskOf(() => true)], // █
  ['▌', maskOf((x) => x < 2)], // ▌
  ['▐', maskOf((x) => x >= 2)], // ▐
  ['▀', maskOf((_x, y) => y < 4)], // ▀
  ['▄', maskOf((_x, y) => y >= 4)], // ▄
  ['▘', maskOf((x, y) => x < 2 && y < 4)], // ▘
  ['▝', maskOf((x, y) => x >= 2 && y < 4)], // ▝
  ['▖', maskOf((x, y) => x < 2 && y >= 4)], // ▖
  ['▗', maskOf((x, y) => x >= 2 && y >= 4)], // ▗
  ['▛', maskOf((x, y) => !(x >= 2 && y >= 4))], // ▛
  ['▜', maskOf((x, y) => !(x < 2 && y >= 4))], // ▜
  ['▙', maskOf((x, y) => !(x >= 2 && y < 4))], // ▙
  ['▟', maskOf((x, y) => !(x < 2 && y < 4))], // ▟
  ['▚', maskOf((x, y) => (x < 2) === (y < 4))], // ▚
  ['▞', maskOf((x, y) => (x < 2) !== (y < 4))], // ▞
  ['▎', maskOf((x) => x < 1)], // ▎
  ['▊', maskOf((x) => x < 3)], // ▊
  ['▕', maskOf((x) => x >= 3)], // ▕
  ['▔', maskOf((_x, y) => y < 1)], // ▔
  ['▁', maskOf((_x, y) => y >= 7)], // ▁
  ['▂', maskOf((_x, y) => y >= 6)], // ▂
  ['▃', maskOf((_x, y) => y >= 5)], // ▃
  ['▅', maskOf((_x, y) => y >= 3)], // ▅
  ['▆', maskOf((_x, y) => y >= 2)], // ▆
  ['▇', maskOf((_x, y) => y >= 1)], // ▇
];

const DENSITY = [' ', '░', '▒', '▓', '█']; // ░ ▒ ▓

function popcount(v: number): number {
  let c = 0;
  v = v >>> 0;
  while (v) { v &= v - 1; c++; }
  return c;
}

/** Dominant pixel value among the pixels selected by `select` (0 if none). */
function dominant(px: Uint8Array, half: number, select: (set: boolean) => boolean, mask: Mask): number {
  const counts = [0, 0, 0, 0];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      const set = (mask & (1 << (y * 4 + x))) !== 0;
      if (!select(set)) continue;
      counts[px[y * 8 + half * 4 + x]]++;
    }
  }
  let best = 0;
  for (let v = 1; v < 4; v++) if (counts[v] > counts[best]) best = v;
  return counts[best] === 0 ? 0 : best;
}

/** Best glyph for one half (0 = left, 1 = right) of a tile; colours are pixel values 0..3. */
function matchHalf(px: Uint8Array, half: number): { ch: string; fgValue: number; bgValue: number } {
  const bits = maskOf((x, y) => px[y * 8 + half * 4 + x] !== 0);
  let best = GLYPHS[0];
  let bestDist = 33;
  for (const g of GLYPHS) {
    const d = popcount(bits ^ g[1]);
    if (d < bestDist) { bestDist = d; best = g; }
  }
  const set = popcount(bits);
  let ch = best[0];
  let mask = best[1];
  if (bestDist > 6) {
    // Scattered pattern: fall back to a density glyph.
    ch = DENSITY[Math.min(4, Math.round((set / 32) * 4))];
    mask = bits;
  }
  const fgValue = dominant(px, half, (s) => s, mask) || dominant(px, half, () => true, mask);
  const bgValue = dominant(px, half, (s) => !s, mask);
  return { ch, fgValue, bgValue };
}

const FULLWIDTH_BASE = 0xff10; // '０'
const FULLWIDTH_A = 0xff21; // 'Ａ'

/** Character for a font tile ($00-$09 digits, $0A-$23 letters, $24 '-'), or null. */
export function textForTile(tile: number, fullwidth: boolean): string | null {
  if (tile <= 0x09) return fullwidth ? String.fromCharCode(FULLWIDTH_BASE + tile) : String(tile);
  if (tile >= 0x0a && tile <= 0x23) return fullwidth ? String.fromCharCode(FULLWIDTH_A + tile - 0x0a) : String.fromCharCode(65 + tile - 0x0a);
  if (tile === 0x24) return fullwidth ? '－' : '-';
  return null;
}

/** Box borders ($30-$3F): double-line box drawing, coloured with the inner (colour 1) line. */
const BOX: Readonly<Record<number, string>> = {
  0x30: '\u2554\u2550', 0x31: '\u2550\u2550', 0x32: '\u2550\u2557', 0x33: '\u2551 ', 0x34: ' \u2551',
  0x35: '\u255a\u2550', 0x36: '\u2550\u2550', 0x37: '\u2550\u255d',
  0x38: '\u2554\u2550', 0x39: '\u2550\u2550', 0x3a: '\u2550\u2557', 0x3b: '\u2551 ', 0x3c: ' \u2551',
  0x3d: '\u255a\u2550', 0x3e: '\u2550\u2550', 0x3f: '\u2550\u255d',
};

/**
 * Statistics icons ($40-$66): small tetrominoes drawn across 3x2 tiles. Each
 * entry lists the tile ids of the two rows and a 6-character picture per row;
 * `fill` is the pixel value that gives the piece its colour.
 */
interface StatIcon { rows: [number[], number[]]; art: [string, string]; fill: number }
const STAT_ICONS: readonly StatIcon[] = [
  { rows: [[0x40, 0x41, 0x42], [0x50, 0x51, 0x52]], art: ['\u2584\u2584\u2584\u2584\u2584 ', '  \u2580\u2580  '], fill: 1 }, // T
  { rows: [[0x49, 0x4a, 0x4b], [0x59, 0x5a, 0x5b]], art: ['\u2584\u2584\u2584\u2584\u2584 ', '    \u2580\u2580'], fill: 3 }, // J
  { rows: [[0x46, 0x47, 0xff], [0x56, 0x57, 0x58]], art: ['\u2584\u2584\u2584\u2584  ', '  \u2580\u2580\u2580\u2580'], fill: 2 }, // Z
  { rows: [[0x60, 0x61, 0xff], [0x62, 0x63, 0xff]], art: ['\u2584\u2584\u2584\u2584  ', '\u2580\u2580\u2580\u2580  '], fill: 1 }, // O
  { rows: [[0x43, 0x44, 0x45], [0x53, 0x54, 0x55]], art: ['  \u2584\u2584\u2584\u2584', '\u2580\u2580\u2580\u2580  '], fill: 3 }, // S
  { rows: [[0x4c, 0x4d, 0x4e], [0x5c, 0x5d, 0x5e]], art: ['\u2584\u2584\u2584\u2584\u2584 ', '\u2580\u2580    '], fill: 2 }, // L
  { rows: [[0x64, 0x65, 0x66], [0xff, 0xff, 0xff]], art: ['\u2584\u2584\u2584\u2584\u2584\u2584', '      '], fill: 1 }, // I
];
const STAT_TILE = new Map<number, { art: string; fill: number }>();
for (const icon of STAT_ICONS) {
  icon.rows.forEach((tiles, r) => tiles.forEach((t, i) => {
    if (t !== 0xff) STAT_TILE.set(t, { art: icon.art[r].slice(i * 2, i * 2 + 2), fill: icon.fill });
  }));
}

/** The condensed "STATISTICS" title ($69-$6F, $5F): ten letters over eight tiles. */
const STATISTICS_TILES = [0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x5f];
const STATISTICS_TEXT = '  STATISTICS    ';

const cache = new Map<string, [Cell, Cell]>();

/**
 * Two terminal cells for a tile drawn with palette entries pal[0..3]
 * (pal[0] is the backdrop). Colours are NES palette indices.
 */
export function tileCells(tile: number, pal: readonly number[], style: TermStyle): [Cell, Cell] {
  const key = `${tile}:${pal.join(',')}:${style.fullwidth ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const backdrop = -1;
  const colour = (v: number): number => (v === 0 ? backdrop : pal[v]);
  let cells: [Cell, Cell];
  const text = textForTile(tile, style.fullwidth);
  if (tile === 0xef || tile === 0xff) {
    cells = [{ ch: ' ', fg: backdrop, bg: backdrop }, { ch: ' ', fg: backdrop, bg: backdrop }];
  } else if (text !== null) {
    const px = tilePixels(tile);
    const fgValue = dominant(px, 0, () => true, maskOf(() => true)) || 3;
    if (style.fullwidth) {
      cells = [{ ch: text, fg: colour(fgValue), bg: backdrop }, { ch: '', fg: backdrop, bg: backdrop }];
    } else {
      cells = [{ ch: text, fg: colour(fgValue), bg: backdrop }, { ch: ' ', fg: backdrop, bg: backdrop }];
    }
  } else if (STATISTICS_TILES.includes(tile)) {
    const k = STATISTICS_TILES.indexOf(tile) * 2;
    cells = [
      { ch: STATISTICS_TEXT[k], fg: colour(3), bg: backdrop },
      { ch: STATISTICS_TEXT[k + 1], fg: colour(3), bg: backdrop },
    ];
  } else if (BOX[tile] !== undefined) {
    const box = BOX[tile];
    cells = [{ ch: box[0], fg: colour(1), bg: backdrop }, { ch: box[1], fg: colour(1), bg: backdrop }];
  } else if (STAT_TILE.has(tile)) {
    const { art, fill } = STAT_TILE.get(tile)!;
    cells = [{ ch: art[0], fg: colour(fill), bg: backdrop }, { ch: art[1], fg: colour(fill), bg: backdrop }];
  } else if (tile === 0x7b) {
    // Colour-3 outline with a white (colour 1) interior: white centre, coloured edges.
    cells = [{ ch: '▐', fg: colour(1), bg: colour(3) }, { ch: '▌', fg: colour(1), bg: colour(3) }];
  } else if (tile === 0x7c || tile === 0x7d) {
    const v = tile === 0x7c ? 2 : 3;
    // Solid block with a white highlight in the top-left corner.
    cells = [{ ch: '▘', fg: colour(1), bg: colour(v) }, { ch: '█', fg: colour(v), bg: colour(v) }];
  } else {
    const px = tilePixels(tile);
    const halves = [matchHalf(px, 0), matchHalf(px, 1)];
    cells = [
      { ch: halves[0].ch, fg: colour(halves[0].fgValue), bg: colour(halves[0].bgValue) },
      { ch: halves[1].ch, fg: colour(halves[1].fgValue), bg: colour(halves[1].bgValue) },
    ];
  }
  cache.set(key, cells);
  return cells;
}

export function rgb(index: number, backdropIndex: number): string {
  const hex = NES_PALETTE[(index < 0 ? backdropIndex : index) & 0x3f];
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `${r};${g};${b}`;
}
