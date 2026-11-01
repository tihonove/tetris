/**
 * A skin-neutral view of the game state for the DOM skins: which block sits in
 * which playfield cell, the active and ghost pieces, the numbers on the HUD.
 * Everything is read from the "PPU" side (nametable, OAM) so the skins show
 * exactly what the NES picture shows at the same frame, plus the piece types the
 * engine tracks alongside the tiles.
 */
import { NES_PALETTE } from '../data/gfx';
import {
  LEVEL_DISPLAY_TABLE, ORIENTATION_TABLE, ORI_HIDDEN, TILE1, TILE2, TILE3, TILE_CURTAIN, TILE_EMPTY,
  TILE_HIDDEN, TYPE_FROM_ORIENTATION,
} from '../data/tables';
import { bcdToNumber, playfieldRowVram, type NesTetris } from '../engine/tetris';

/** Piece type letters in the engine's order (statistics order on the NES screen). */
export const PIECE_LETTERS = ['T', 'J', 'Z', 'O', 'S', 'L', 'I'] as const;
export type PieceLetter = (typeof PIECE_LETTERS)[number];

/** 4x2 silhouettes as drawn in the statistics and NEXT boxes, per piece type. */
export const PIECE_SHAPES: Readonly<Record<PieceLetter, string>> = {
  T: 'XXX..X..',
  J: 'XXX...X.',
  Z: 'XX...XX.',
  O: 'XX..XX..',
  S: '.XX.XX..',
  L: 'XXX.X...',
  I: 'XXXX....',
};

/**
 * Tile "kind" 1..3 per piece type: the NES draws T/O/I with tile $7B, Z/L with
 * $7C and J/S with $7D, each taking its colour from the level palette.
 */
export const KIND_BY_TYPE: readonly number[] = [1, 3, 2, 1, 3, 2, 1];

export interface PieceStat {
  letter: PieceLetter;
  kind: number;
  /** 8 booleans, row-major 4x2. */
  shape: boolean[];
  count: number;
}

export interface SkinView {
  /** 200 class strings, row-major 10x20: "e" for empty, else "k1 t-T", plus "act"/"ghost"/"curtain". */
  cells: string[];
  stats: PieceStat[];
  /** null while the NEXT box is switched off (Select). */
  next: PieceStat | null;
  lines: number;
  score: number;
  top: number;
  level: number;
  paused: boolean;
  /** The white Tetris flash frame. */
  flash: boolean;
  /** Level palette colours 1..3 as CSS hex. */
  palette: [string, string, string];
}

function kindOfTile(tile: number): number {
  if (tile === TILE1) return 1;
  if (tile === TILE2) return 2;
  if (tile === TILE3) return 3;
  return 0;
}

function shapeOf(letter: PieceLetter): boolean[] {
  return PIECE_SHAPES[letter].split('').map((ch) => ch === 'X');
}

/** isPositionValid of the engine for an arbitrary row of the active piece. */
function fits(game: NesTetris, y: number): boolean {
  const o = game.currentPiece * 12;
  for (let i = 0; i < 4; i++) {
    const row = ORIENTATION_TABLE[o + i * 3] + y;
    const col = ORIENTATION_TABLE[o + i * 3 + 2] + game.tetriminoX;
    if (row >= 20 || col < 0 || col >= 10) return false;
    if (row >= 0 && game.playfield[row * 10 + col] < TILE_EMPTY) return false;
  }
  return true;
}

/** Cells (row*10+col) of the active piece as the OAM shows it this frame. */
function activeCells(game: NesTetris): number[] {
  const out: number[] = [];
  for (const s of game.oam) {
    if (s.tile === TILE_HIDDEN || (s.attr & 3) !== 2) continue;
    const col = (s.x - 0x60) / 8;
    const row = (s.y - 0x2f) / 8;
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col >= 10 || row < 0 || row >= 20) continue;
    out.push(row * 10 + col);
  }
  return out;
}

/** Where the active piece would land: the lowest row at which it still fits. */
export function ghostCells(game: NesTetris): number[] {
  if (game.currentPiece === ORI_HIDDEN || !fits(game, game.tetriminoY)) return [];
  let y = game.tetriminoY;
  while (fits(game, y + 1)) y++;
  const o = game.currentPiece * 12;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const row = ORIENTATION_TABLE[o + i * 3] + y;
    const col = ORIENTATION_TABLE[o + i * 3 + 2] + game.tetriminoX;
    if (row >= 0) out.push(row * 10 + col);
  }
  return out;
}

export function buildView(game: NesTetris, showGhost: boolean): SkinView {
  const cells = new Array<string>(200);
  for (let row = 0; row < 20; row++) {
    const base = playfieldRowVram(row);
    for (let col = 0; col < 10; col++) {
      const tile = game.nametable[base + col];
      const i = row * 10 + col;
      if (tile === TILE_CURTAIN) { cells[i] = 'curtain'; continue; }
      const kind = kindOfTile(tile);
      if (kind === 0) { cells[i] = 'e'; continue; }
      const type = game.shownTypes[i];
      cells[i] = type < 7 ? `k${kind} t-${PIECE_LETTERS[type]}` : `k${kind}`;
    }
  }
  const active = activeCells(game);
  if (active.length) {
    const type = TYPE_FROM_ORIENTATION[game.currentPiece] ?? 0;
    const cls = `k${KIND_BY_TYPE[type]} t-${PIECE_LETTERS[type]}`;
    if (showGhost) {
      for (const i of ghostCells(game)) if (cells[i] === 'e') cells[i] = `${cls} ghost`;
    }
    for (const i of active) cells[i] = `${cls} act`;
  }

  const stats = PIECE_LETTERS.map((letter, t) => ({
    letter,
    kind: KIND_BY_TYPE[t],
    shape: shapeOf(letter),
    count: bcdToNumber([game.statsByType[t * 2], game.statsByType[t * 2 + 1]]),
  }));
  let next: PieceStat | null = null;
  if (game.displayNextPiece === 0) {
    const t = TYPE_FROM_ORIENTATION[game.nextPiece];
    if (t !== undefined) next = { letter: PIECE_LETTERS[t], kind: KIND_BY_TYPE[t], shape: shapeOf(PIECE_LETTERS[t]), count: 0 };
  }
  const levelBcd = LEVEL_DISPLAY_TABLE[game.levelNumber] ?? 0;
  const bg = game.bgPalette;
  return {
    cells,
    stats,
    next,
    lines: game.linesValue,
    score: game.scoreValue,
    top: bcdToNumber(game.topScore),
    level: (levelBcd >> 4) * 10 + (levelBcd & 0x0f),
    paused: game.paused,
    flash: bg[0x0e] === 0x30,
    palette: [NES_PALETTE[bg[9] & 0x3f], NES_PALETTE[bg[10] & 0x3f], NES_PALETTE[bg[11] & 0x3f]],
  };
}
