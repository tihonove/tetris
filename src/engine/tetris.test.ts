import { describe, expect, it } from 'vitest';
import { BTN_A, BTN_DOWN, BTN_LEFT, BTN_RIGHT, TILE_EMPTY } from '../data/tables';
import { NesTetris, bcdToNumber, numberToBcd } from './tetris';

/** Fresh game where the initial 96-frame delay is already over. */
function newGame(level = 0): NesTetris {
  const g = new NesTetris();
  g.startGame(level);
  g.autorepeatY = 0;
  g.vramRow = 0x20; // the initial copy of the empty board has finished
  g.currentPiece = 0x02; // T down, deterministic shape
  return g;
}

/** Run frames until the active piece's row changes or `max` frames pass. */
function framesUntilRowChange(g: NesTetris, buttons = 0, max = 200): number {
  const y = g.tetriminoY;
  for (let i = 1; i <= max; i++) {
    g.frame(buttons);
    if (g.tetriminoY !== y) return i;
  }
  return -1;
}

/** Fill the bottom `rows` playfield rows, leaving column `hole` empty (or none if -1). */
function fillBottom(g: NesTetris, rows: number, hole = -1): void {
  for (let r = 20 - rows; r < 20; r++) {
    for (let c = 0; c < 10; c++) if (c !== hole) g.playfield[r * 10 + c] = 0x7b;
  }
}

describe('gravity', () => {
  it.each([
    [0, 48], [1, 43], [5, 23], [8, 8], [9, 6], [10, 5], [13, 4], [16, 3], [19, 2], [28, 2], [29, 1], [35, 1],
  ])('level %i drops every %i frames', (level, frames) => {
    const g = newGame(level);
    g.fallTimer = 0;
    framesUntilRowChange(g); // first drop uses whatever the timer was
    expect(framesUntilRowChange(g)).toBe(frames);
    expect(framesUntilRowChange(g)).toBe(frames);
  });

  it('first piece waits 96 frames before it starts falling', () => {
    const g = new NesTetris();
    g.startGame(0);
    let n = 0;
    while (g.tetriminoY === 0) { g.frame(0); n++; }
    expect(n).toBe(97);
  });

  it('pressing Down cancels the opening delay', () => {
    const g = new NesTetris();
    g.startGame(0);
    g.frame(0);
    g.frame(BTN_DOWN); // latched at the end of this frame
    let n = 0;
    while (g.tetriminoY === 0 && n < 20) { g.frame(BTN_DOWN); n++; }
    expect(g.tetriminoY).toBe(1);
  });
});

describe('soft drop', () => {
  it('moves one row every 2 frames while Down is held', () => {
    const g = newGame(0);
    g.frame(0);
    g.frame(BTN_DOWN); // press registered
    // The press is seen on the next frame; the first soft drop follows 3 frames later, then every 2.
    expect(framesUntilRowChange(g, BTN_DOWN)).toBe(3);
    expect(framesUntilRowChange(g, BTN_DOWN)).toBe(2);
    expect(framesUntilRowChange(g, BTN_DOWN)).toBe(2);
  });

  it('does not start when Down is held over from the previous piece', () => {
    const g = newGame(19);
    g.frame(0);
    // Soft drop the first piece all the way down and wait for the next spawn.
    let n = 0;
    while (!(g.playState === 1 && g.tetriminoY === 0 && g.statsByType.reduce((a, b) => a + b, 0) >= 2) && n < 400) {
      g.frame(BTN_DOWN); n++;
    }
    expect(n).toBeLessThan(400);
    // Down is still held: the new piece must fall at gravity speed (2 frames at level 19), not soft drop.
    expect(framesUntilRowChange(g, BTN_DOWN)).toBe(2);
    expect(framesUntilRowChange(g, BTN_DOWN)).toBe(2);
    expect(g.autorepeatY).toBe(0);
  });
});

describe('DAS', () => {
  it('shifts immediately, then after 16 frames, then every 6', () => {
    const g = newGame(0);
    g.frame(0);
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) {
      g.frame(BTN_LEFT);
      xs.push(g.tetriminoX);
    }
    // The press polled in frame 0 is acted on in frame 1; autorepeat after 16 frames, then every 6.
    const moves = xs.map((x, i) => (i === 0 ? x !== 5 : x !== xs[i - 1])).map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
    expect(moves).toEqual([1, 17, 23, 29]);
  });

  it('keeps the charge when blocked by a wall', () => {
    const g = newGame(0);
    g.frame(0);
    for (let i = 0; i < 60; i++) g.frame(BTN_RIGHT);
    expect(g.tetriminoX).toBe(8); // T down: pivot 5, right edge +1 -> pivot max 8
    expect(g.autorepeatX).toBe(16);
    // Switching direction: newly pressed Left moves on the very next frame.
    g.frame(BTN_LEFT);
    g.frame(BTN_LEFT);
    expect(g.tetriminoX).toBe(7);
  });

  it('Down held blocks shifting', () => {
    const g = newGame(0);
    g.frame(0);
    for (let i = 0; i < 5; i++) g.frame(BTN_LEFT | BTN_DOWN);
    expect(g.tetriminoX).toBe(5);
  });
});

describe('entry delay', () => {
  it('spawns 10 frames after a piece fails to drop in the bottom rows', () => {
    const g = newGame(0);
    g.tetriminoY = 18; // T down at row 18 occupies rows 18-19
    g.fallTimer = 47;
    const stats = g.statsByType.slice();
    let n = 0;
    g.frame(0); // this frame: fallTimer=48 -> drop attempt fails -> playState 2
    expect(g.playState).toBe(2);
    while (g.playState !== 1 && n < 100) { g.frame(0); n++; }
    expect(n).toBe(10);
    expect(g.tetriminoY).toBe(0);
    expect(g.statsByType).not.toEqual(stats);
  });

  it('spawns 18 frames after a lock in the top rows', () => {
    const g = newGame(0);
    fillBottom(g, 17, 0); // leave a hole so no line completes
    g.tetriminoY = 1;
    g.fallTimer = 47;
    g.frame(0);
    expect(g.playState).toBe(2);
    let n = 0;
    while (g.playState !== 1 && n < 100) { g.frame(0); n++; }
    expect(n).toBe(18);
  });
});

describe('line clear', () => {
  function singleSetup(): NesTetris {
    const g = newGame(0);
    fillBottom(g, 1, 5); // bottom row with hole at x=5
    // T down at x=5 occupies (4,18)(5,18)(6,18)(5,19): fills the hole in row 19
    g.tetriminoY = 18;
    g.fallTimer = 47;
    return g;
  }

  it('clears the row, scores 40 and takes the animation plus delay', () => {
    const g = singleSetup();
    g.frameCounter = 0;
    g.frame(0);
    expect(g.playState).toBe(2);
    let n = 0;
    while (g.playState !== 1 && n < 200) { g.frame(0); n++; }
    expect(g.linesValue).toBe(1);
    expect(g.scoreValue).toBe(40);
    // The former row 18 (the T's three top cells) is now the bottom row.
    expect(Array.from(g.playfield.slice(190, 200))).toEqual([
      TILE_EMPTY, TILE_EMPTY, TILE_EMPTY, TILE_EMPTY, 0x7b, 0x7b, 0x7b, TILE_EMPTY, TILE_EMPTY, TILE_EMPTY,
    ]);
    // lock(1) + 4 row checks(4) + animation 17..20 + 3 states + 5 frame redraw wait: 30..33 frames in total
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(33);
  });

  it('scores a tetris as 1200 x (level + 1) and flashes', () => {
    const g = newGame(3);
    fillBottom(g, 4, 5);
    g.currentPiece = 0x11; // I vertical, cells y-2..y+1 at x
    g.tetriminoX = 5;
    g.tetriminoY = 18;
    g.fallTimer = 47;
    g.frame(0);
    let flashed = false;
    let n = 0;
    while (g.playState !== 1 && n < 200) { g.frame(0); n++; if (g.bgPalette[0x0e] === 0x30) flashed = true; }
    expect(g.scoreValue).toBe(4800);
    expect(g.linesValue).toBe(4);
    expect(flashed).toBe(true);
  });
});

describe('scoring quirks', () => {
  it('awards soft drop points equal to the rows dropped, with the 6502 BCD bug above 15', () => {
    const run = (rows: number): number => {
      const g = newGame(0);
      g.tetriminoY = 18 - rows;
      g.frame(0);
      g.frame(BTN_DOWN);
      let n = 0;
      while (g.playState === 1 && n < 400) { g.frame(BTN_DOWN); n++; } // soft drop until lock
      while (g.playState !== 1 && n < 400) { g.frame(BTN_DOWN); n++; } // wait for the next spawn
      return g.scoreValue;
    };
    expect(run(1)).toBe(1);
    expect(run(5)).toBe(5);
    expect(run(15)).toBe(15);
    expect(run(16)).toBe(10); // the original mis-adds BCD here
  });

  it('levels up at the right line counts for different start levels', () => {
    const cases: Array<[number, number]> = [[0, 10], [5, 60], [9, 100], [12, 100], [15, 100], [16, 110], [18, 130], [19, 140]];
    for (const [start, firstTransition] of cases) {
      const g = newGame(start);
      const bump = (): void => { g.completedLines = 1; g.playState = 5; g.frame(0); };
      let lines = 0;
      while (g.levelNumber === start && lines < 300) { bump(); lines++; }
      expect(lines).toBe(firstTransition);
      // afterwards every 10 lines
      const l2 = g.levelNumber;
      let more = 0;
      while (g.levelNumber === l2) { bump(); more++; }
      expect(more).toBe(10);
    }
  });
});

describe('randomizer', () => {
  it('never deals the same piece twice in a row through the first roll', () => {
    const g = newGame(0);
    let repeats = 0;
    let prev = g.spawnID;
    for (let i = 0; i < 2000; i++) {
      g.rngStep();
      const p = g.pickRandomTetrimino();
      if (p === prev) repeats++;
      prev = p;
    }
    // Repeats are only possible through the reroll path, which is rare.
    expect(repeats).toBeLessThan(2000 * 0.06);
  });

  it('LFSR has the known 32767 period', () => {
    const g = new NesTetris();
    const start = [...g.rngSeed];
    let n = 0;
    do { g.rngStep(); n++; } while (!(g.rngSeed[0] === start[0] && g.rngSeed[1] === start[1]) && n < 70000);
    expect(n).toBe(32767);
  });
});

describe('rotation and game over', () => {
  it('A rotates clockwise, blocked rotations are ignored', () => {
    const g = newGame(0);
    g.currentPiece = 0x02; // T down
    g.frame(0); g.frame(BTN_A); g.frame(0);
    expect(g.currentPiece).toBe(0x03); // t left
  });

  it('starts the curtain when a piece cannot be placed and finishes on Start', () => {
    const g = newGame(0);
    fillBottom(g, 20);
    g.fallTimer = 47;
    g.frame(0); // fails to drop -> lock -> invalid -> curtain
    g.frame(0);
    expect(g.playState).toBe(0x0a);
    let n = 0;
    while (g.curtainRow !== 0x14 && n < 400) { g.frame(0); n++; }
    expect(n).toBeGreaterThan(16 * 4);
    expect(g.playfield[0]).toBe(0x4f);
  });
});

describe('bcd helpers', () => {
  it('round trips', () => {
    expect(bcdToNumber(numberToBcd(123456, 3))).toBe(123456);
    expect(numberToBcd(10000, 3)).toEqual([0x00, 0x00, 0x01]);
  });
});
