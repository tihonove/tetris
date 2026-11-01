/**
 * Compose the NES picture (background tiles + sprites) into a 64x30 grid of
 * terminal cells and turn it into ANSI escape sequences, line by line.
 */
import type { NesTetris } from '../engine/tetris';
import { rgb, tileCells, type Cell, type TermStyle } from './glyphs';

export const COLS = 64;
export const ROWS = 30;

export function composeCells(game: NesTetris, style: TermStyle): Cell[][] {
  const rows: Cell[][] = [];
  const bg = game.bgPalette;
  const blank: Cell = { ch: ' ', fg: -1, bg: -1 };
  for (let ty = 0; ty < ROWS; ty++) {
    const row: Cell[] = [];
    for (let tx = 0; tx < 32; tx++) {
      if (!game.backgroundVisible) { row.push(blank, blank); continue; }
      const tile = game.nametable[ty * 32 + tx];
      const p = game.attributeFor(tx, ty) * 4;
      const cells = tileCells(tile, [bg[p], bg[p + 1], bg[p + 2], bg[p + 3]], style);
      row.push(cells[0], cells[1]);
    }
    rows.push(row);
  }
  const sp = game.spritePalette;
  for (const s of game.oam) {
    if (s.y >= 0xef || s.tile === 0xff) continue;
    const tx = Math.floor(s.x / 8), ty = Math.floor((s.y + 1) / 8);
    if (tx < 0 || tx >= 32 || ty < 0 || ty >= ROWS) continue;
    const p = (s.attr & 3) * 4;
    const cells = tileCells(s.tile, [bg[0], sp[p + 1], sp[p + 2], sp[p + 3]], style);
    rows[ty][tx * 2] = cells[0];
    rows[ty][tx * 2 + 1] = cells[1];
  }
  return rows;
}

/** One screen row as an ANSI string (no trailing newline). */
export function renderRow(row: Cell[], backdrop: number): string {
  let out = '';
  let fg = NaN, bg = NaN;
  for (const c of row) {
    if (c.ch === '') continue; // second half of a fullwidth character
    if (c.fg !== fg) { out += `\x1b[38;2;${rgb(c.fg, backdrop)}m`; fg = c.fg; }
    if (c.bg !== bg) { out += `\x1b[48;2;${rgb(c.bg, backdrop)}m`; bg = c.bg; }
    out += c.ch;
  }
  return out + '\x1b[0m';
}

/** Plain-text rendering (no colours), useful for tests and dumps. */
export function renderPlain(game: NesTetris, style: TermStyle): string[] {
  return composeCells(game, style).map((row) => row.map((c) => c.ch).join(''));
}
