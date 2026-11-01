import { describe, expect, it } from 'vitest';
import { NES_PALETTE } from '../data/gfx';
import { BTN_DOWN } from '../data/tables';
import { NesTetris } from '../engine/tetris';
import { buildView, ghostCells } from './view';

function freshGame(): NesTetris {
  const g = new NesTetris();
  g.startGame(0);
  return g;
}

/** Run frames until the active piece shows up in OAM. */
function untilPieceShown(g: NesTetris): void {
  for (let i = 0; i < 200; i++) {
    g.frame(0);
    if (g.oam.some((s) => s.tile !== 0xff && (s.attr & 3) === 2 && s.x < 0xc0)) return;
  }
  throw new Error('piece never shown');
}

describe('buildView', () => {
  it('starts with an empty board and the right HUD numbers', () => {
    const g = freshGame();
    const v = buildView(g, true);
    expect(v.cells.filter((c) => c !== 'e' && !c.includes('act') && !c.includes('ghost'))).toHaveLength(0);
    expect(v.lines).toBe(0);
    expect(v.score).toBe(0);
    expect(v.level).toBe(0);
    expect(v.top).toBe(10000);
    expect(v.stats).toHaveLength(7);
    expect(v.stats.reduce((n, p) => n + p.count, 0)).toBe(1); // the first piece is counted
    expect(v.palette[1]).toBe(NES_PALETTE[0x21]); // level 0: light blue
  });

  it('marks the active piece and its ghost on the floor', () => {
    const g = freshGame();
    untilPieceShown(g);
    const v = buildView(g, true);
    const act = v.cells.map((c, i) => (c.includes('act') ? i : -1)).filter((i) => i >= 0);
    const ghost = v.cells.map((c, i) => (c.includes('ghost') ? i : -1)).filter((i) => i >= 0);
    expect(act).toHaveLength(4);
    expect(ghost).toHaveLength(4);
    expect(Math.max(...ghost)).toBeGreaterThanOrEqual(190); // bottom row
    expect(buildView(g, false).cells.some((c) => c.includes('ghost'))).toBe(false);
    for (const i of act) expect(v.cells[i]).toMatch(/^k[123] t-[TJZOSLI] act$/);
  });

  it('keeps the piece type of locked blocks', () => {
    const g = freshGame();
    untilPieceShown(g);
    const letter = buildView(g, false).cells.find((c) => c.includes('act'))!.split(' ')[1];
    for (let i = 0; i < 400 && g.oam.some((s) => s.x < 0xc0 && s.tile !== 0xff); i++) g.frame(BTN_DOWN);
    for (let i = 0; i < 20; i++) g.frame(0); // let the VRAM copy finish
    const v = buildView(g, false);
    const locked = v.cells.filter((c) => c.split(' ')[1] === letter && !c.includes('act'));
    expect(locked).toHaveLength(4);
  });

  it('ghost is empty while no piece is active', () => {
    const g = freshGame();
    g.currentPiece = 0x13;
    expect(ghostCells(g)).toEqual([]);
  });
});
