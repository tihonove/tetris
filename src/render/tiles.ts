/**
 * Tile images: each 8x8 2bpp CHR tile is turned into an SVG data URI for a
 * given set of three colours (colour 0 is transparent). Results are cached.
 */
import { NES_PALETTE, TILES } from '../data/gfx';

const cache = new Map<string, string>();
const blank = TILES.map((t) => /^0+$/.test(t));

/** Decode a packed tile into 64 pixel values 0..3. */
export function tilePixels(tile: number): Uint8Array {
  const hex = TILES[tile & 0xff];
  const out = new Uint8Array(64);
  for (let i = 0; i < 32; i++) {
    const v = parseInt(hex[i], 16);
    out[i * 2] = v >> 2;
    out[i * 2 + 1] = v & 3;
  }
  return out;
}

/** Whether a tile has no visible pixels. */
export function tileIsBlank(tile: number): boolean {
  return blank[tile & 0xff];
}

/**
 * CSS background-image value for a tile drawn with NES palette entries
 * c1..c3 (for pixel values 1..3). Returns 'none' for blank tiles.
 */
export function tileImage(tile: number, c1: number, c2: number, c3: number): string {
  if (tileIsBlank(tile)) return 'none';
  const key = `${tile}:${c1}:${c2}:${c3}`;
  let url = cache.get(key);
  if (url) return url;
  const colours = ['', NES_PALETTE[c1 & 0x3f], NES_PALETTE[c2 & 0x3f], NES_PALETTE[c3 & 0x3f]];
  const px = tilePixels(tile);
  let rects = '';
  for (let y = 0; y < 8; y++) {
    let x = 0;
    while (x < 8) {
      const v = px[y * 8 + x];
      if (v === 0) { x++; continue; }
      let w = 1;
      while (x + w < 8 && px[y * 8 + x + w] === v) w++;
      rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${colours[v]}"/>`;
      x += w;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges">${rects}</svg>`;
  url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  cache.set(key, url);
  return url;
}
