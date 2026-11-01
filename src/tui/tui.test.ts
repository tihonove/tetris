import { describe, expect, it } from 'vitest';
import { BTN_A, BTN_DOWN, BTN_LEFT, BTN_START } from '../data/tables';
import { NesTetris } from '../engine/tetris';
import { textForTile, tileCells } from './glyphs';
import { parseKeys, TerminalInput } from './input';
import { renderPlain } from './screen';

const PAL = [0x0f, 0x30, 0x21, 0x12];

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
    const [l, r] = tileCells(0x7b, PAL, { fullwidth: false });
    expect(l.fg).toBe(0x30); // white interior
    expect(l.bg).toBe(0x12); // colour-3 edge
    expect(r.ch).toBe('▌');
    const [l2] = tileCells(0x7c, PAL, { fullwidth: false });
    expect(l2.bg).toBe(0x21);
    const [, r3] = tileCells(0x7d, PAL, { fullwidth: false });
    expect(r3.fg).toBe(0x12);
  });

  it('renders borders as box drawing and blanks as spaces', () => {
    expect(tileCells(0x38, PAL, { fullwidth: false }).map((c) => c.ch).join('')).toBe('╔═');
    expect(tileCells(0x3c, PAL, { fullwidth: false }).map((c) => c.ch).join('')).toBe(' ║');
    expect(tileCells(0xef, PAL, { fullwidth: false }).map((c) => c.ch).join('')).toBe('  ');
  });
});

describe('screen', () => {
  it('shows the Type A layout and the first piece', () => {
    const g = new NesTetris();
    g.startGame(0);
    for (let i = 0; i < 10; i++) g.frame(0);
    const lines = renderPlain(g, { fullwidth: false });
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
    const lines = renderPlain(g, { fullwidth: false });
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
