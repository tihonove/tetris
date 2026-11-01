import { describe, expect, it } from 'vitest';
import { BTN_A, BTN_DOWN, BTN_LEFT, BTN_START } from '../data/tables';
import { NesTetris } from '../engine/tetris';
import { textForTile, tileCells } from './glyphs';
import { parseKeys, TerminalInput } from './input';
import { renderPlain } from './screen';

const PAL = [0x0f, 0x30, 0x21, 0x12];
const SMALL = { fullwidth: false, mode: 'small', octants: false } as const;

describe('glyphs', () => {
  it('maps font tiles to characters', () => {
    expect(textForTile(0x00, false)).toBe('0');
    expect(textForTile(0x09, false)).toBe('9');
    expect(textForTile(0x0a, false)).toBe('A');
    expect(textForTile(0x23, false)).toBe('Z');
    expect(textForTile(0x24, false)).toBe('-');
    expect(textForTile(0x0a, true)).toBe('Ａ');
    expect(textForTile(0x7b, false)).toBeNull();
  });

  it('renders block tiles with the level colours', () => {
    const [l, r] = tileCells(0x7b, PAL, SMALL);
    expect(l.fg).toBe(0x30); // white interior
    expect(l.bg).toBe(0x12); // colour-3 edge
    expect(r.ch).toBe('▌');
    const [l2] = tileCells(0x7c, PAL, SMALL);
    expect(l2.bg).toBe(0x21);
    const [, r3] = tileCells(0x7d, PAL, SMALL);
    expect(r3.fg).toBe(0x12);
  });

  it('renders borders as box drawing and blanks as spaces', () => {
    expect(tileCells(0x38, PAL, SMALL).map((c) => c.ch).join('')).toBe('╔═');
    expect(tileCells(0x3c, PAL, SMALL).map((c) => c.ch).join('')).toBe(' ║');
    expect(tileCells(0xef, PAL, SMALL).map((c) => c.ch).join('')).toBe('  ');
  });
});

describe('screen', () => {
  it('shows the Type A layout and the first piece', () => {
    const g = new NesTetris();
    g.startGame(0);
    for (let i = 0; i < 10; i++) g.frame(0);
    const lines = renderPlain(g, SMALL);
    expect(lines).toHaveLength(30);
    expect(lines.every((l) => [...l].length === 64)).toBe(true);
    expect(lines[3]).toContain('L I N E S - 0 0 0');
    expect(lines[5]).toContain('0 1 0 0 0 0');
    expect(lines[21]).toContain('0 0');
    // The spawned piece is drawn inside the playfield (columns 24..43) near the top.
    const field = lines.slice(6, 9).map((l) => l.slice(24, 44)).join('');
    expect(field.trim().length).toBeGreaterThan(0);
  });

  it('hides the background while paused and shows PAUSE', () => {
    const g = new NesTetris();
    g.startGame(0);
    g.frame(0);
    g.frame(BTN_START);
    g.frame(BTN_START);
    g.frame(0);
    expect(g.paused).toBe(true);
    const lines = renderPlain(g, SMALL);
    expect(lines[15]).toContain('P A U S E');
    expect(lines[3].trim()).toBe('');
  });
});

describe('terminal input', () => {
  it('parses escape sequences and letters', () => {
    expect(parseKeys('\x1b[D').map((k) => k.bits)).toEqual([BTN_LEFT]);
    expect(parseKeys('\x1bOB').map((k) => k.bits)).toEqual([BTN_DOWN]);
    expect(parseKeys('x').map((k) => k.bits)).toEqual([BTN_A]);
    expect(parseKeys('\r').map((k) => k.bits)).toEqual([BTN_START]);
    expect(parseKeys('q')[0].quit).toBe(true);
  });

  it('keeps a direction held briefly and Down for three frames', () => {
    const input = new TerminalInput();
    input.feed('\x1b[D', 1000);
    expect(input.poll(1000) & BTN_LEFT).toBe(BTN_LEFT);
    expect(input.poll(1050) & BTN_LEFT).toBe(BTN_LEFT);
    expect(input.poll(1200) & BTN_LEFT).toBe(0);
    input.feed('\x1b[B', 2000);
    expect(input.poll(2000) & BTN_DOWN).toBe(BTN_DOWN);
    expect(input.poll(2017) & BTN_DOWN).toBe(BTN_DOWN);
    expect(input.poll(2034) & BTN_DOWN).toBe(BTN_DOWN);
    expect(input.poll(2300) & BTN_DOWN).toBe(0);
  });

  it('turns auto-repeated rotate keys into single presses', () => {
    const input = new TerminalInput();
    input.feed('x', 0);
    expect(input.poll(0) & BTN_A).toBe(BTN_A);
    expect(input.poll(17) & BTN_A).toBe(0);
    input.feed('x', 30); // OS auto-repeat
    expect(input.poll(34) & BTN_A).toBe(0);
    input.feed('x', 400);
    expect(input.poll(400) & BTN_A).toBe(BTN_A);
  });
});

describe('big mode', () => {
  it('maps 2x4 patterns to blocks, Braille or octants', async () => {
    const { cellify, HIRES_COLS, HIRES_ROWS } = await import('./hires');
    const { WIDTH, HEIGHT } = await import('./pixels');
    const px = new Uint8Array(WIDTH * HEIGHT).fill(0x0f);
    // cell (0,0): solid colour 0x30
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) px[y * WIDTH + x] = 0x30;
    // cell (1,0): top half 0x30
    for (let y = 0; y < 2; y++) for (let x = 2; x < 4; x++) px[y * WIDTH + x] = 0x30;
    // cell (2,0): single top-left pixel 0x30
    px[4] = 0x30;
    // cell (3,0): all but the top-left pixel 0x30 (inverted Braille)
    for (let y = 0; y < 4; y++) for (let x = 6; x < 8; x++) px[y * WIDTH + x] = 0x30;
    px[6] = 0x0f;
    const rows = cellify(px, false);
    expect(rows).toHaveLength(HIRES_ROWS);
    expect(rows[0]).toHaveLength(HIRES_COLS);
    expect(rows[0][0]).toEqual({ ch: ' ', fg: 0x30, bg: 0x30 }); // solid: background colour only
    // A 4/4 split may come out as either glyph with the colours swapped; both draw the same picture.
    expect([
      JSON.stringify({ ch: '▀', fg: 0x30, bg: 0x0f }),
      JSON.stringify({ ch: '▄', fg: 0x0f, bg: 0x30 }),
    ]).toContain(JSON.stringify(rows[0][1]));
    expect(rows[0][2]).toEqual({ ch: '⠁', fg: 0x30, bg: 0x0f });
    expect(rows[0][3]).toEqual({ ch: '⠁', fg: 0x0f, bg: 0x30 });
    const oct = cellify(px, true);
    expect(oct[0][0].ch).toBe(' ');
    expect(oct[0][2].ch).toBe(String.fromCodePoint(0x1cea8)); // left half upper one quarter
  });

  it('renders the whole screen at 128x60 with the text and the piece', () => {
    const g = new NesTetris();
    g.startGame(0);
    for (let i = 0; i < 10; i++) g.frame(0);
    const lines = renderPlain(g, { fullwidth: false, mode: 'big', octants: false });
    expect(lines).toHaveLength(60);
    expect(lines.every((l) => [...l].length === 128)).toBe(true);
    // "LINES-" sits in tile row 3, columns 13..18 -> cell rows 6-7, columns 52..75
    const title = lines.slice(6, 8).map((l) => l.slice(52, 76)).join('');
    expect(title.replace(/\s/g, '').length).toBeGreaterThan(10);
  });
});
