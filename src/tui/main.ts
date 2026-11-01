/**
 * Console NES Tetris: the same engine, rendered with block glyphs.
 *
 *   npm run tui                big picture (128x60 cells) when the terminal is large enough
 *   npm run tui -- --small     one tile per two cells (64x30), fullwidth text
 *   npm run tui -- --big       force the big picture
 *   npm run tui -- --octants   big picture with Unicode 16 octant characters (needs a recent font)
 *   npm run tui -- --ascii     small mode with plain ASCII letters
 *   npm run tui -- --dump N    headless: run N frames and print the screen (for tests)
 */
import { NesTetris, bcdToNumber, numberToBcd } from '../engine/tetris';
import { BTN_START } from '../data/tables';
import { TerminalInput } from './input';
import { composeCells, renderPlain, renderRow, screenSize } from './screen';
import { HIRES_COLS, HIRES_ROWS } from './hires';
import type { TermStyle } from './glyphs';

const FRAME_MS = 1000 / 60.0988;
const MAX_LEVEL = 19;

const args = process.argv.slice(2);
const fitsBig = (process.stdout.columns ?? 0) >= HIRES_COLS && (process.stdout.rows ?? 0) >= HIRES_ROWS + 1;
const wantSmall = args.includes('--small') || args.includes('--ascii');
const wantBig = args.includes('--big') || args.includes('--octants');
const style: TermStyle = {
  fullwidth: !args.includes('--ascii'),
  mode: wantBig || (!wantSmall && fitsBig) ? 'big' : 'small',
  octants: args.includes('--octants'),
};
const { rows: ROWS } = screenSize(style);
const dumpIndex = args.indexOf('--dump');

function dump(frames: number): void {
  const g = new NesTetris();
  g.startGame(Number(args[args.indexOf('--level') + 1]) || 0);
  for (let i = 0; i < frames; i++) g.frame(0);
  process.stdout.write(renderPlain(g, style).join('\n') + '\n');
}

if (dumpIndex >= 0) {
  dump(Number(args[dumpIndex + 1]) || 0);
} else {
  run();
}

function run(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('The console version needs an interactive terminal.\n');
    process.exit(1);
  }
  const out = process.stdout;
  const game = new NesTetris();
  const input = new TerminalInput();
  let level = Math.min(MAX_LEVEL, Math.max(0, Number(args[args.indexOf('--level') + 1]) || 0));
  let topScore = 10000;
  let phase: 'select' | 'playing' = 'select';
  let prevLines: string[] = [];
  let prevStatus = '';

  const setTop = (): void => {
    const t = numberToBcd(topScore, 3);
    game.topScore[0] = t[0]; game.topScore[1] = t[1]; game.topScore[2] = t[2];
  };
  setTop();
  game.startGame(level);
  game.playState = 0x09; // idle board for the selector
  game.currentPiece = 0x13;
  game.frame(0); // one NMI so the counters are drawn
  game.oam = [];

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  out.write('\x1b[?1049h\x1b[?25l\x1b[2J'); // alternate screen, hide cursor, clear

  const cleanup = (): void => {
    out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
    process.stdin.setRawMode(false);
    process.stdin.pause();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(0));

  process.stdin.on('data', (data: string) => {
    const now = performance.now();
    if (phase === 'select') {
      for (const ch of data) {
        if (ch === '\x1b' && data.length > 2) break;
        if (ch === 'q' || ch === 'Q' || ch === '\x03') process.exit(0);
        if (ch === '\r' || ch === '\n' || ch === ' ') {
          game.startGame(level);
          game.heldButtons = BTN_START;
          phase = 'playing';
          prevLines = [];
          return;
        }
        if (/\d/.test(ch)) level = Number(ch);
      }
      if (data.includes('[D') || data.includes('OD')) level = Math.max(0, level - 1);
      if (data.includes('[C') || data.includes('OC')) level = Math.min(MAX_LEVEL, level + 1);
      if (data.includes('[A') || data.includes('OA')) level = Math.min(MAX_LEVEL, level + 10);
      if (data.includes('[B') || data.includes('OB')) level = Math.max(0, level - 10);
      return;
    }
    input.feed(data, now);
    if (input.quit) process.exit(0);
  });

  const draw = (): void => {
    const cells = composeCells(game, style);
    const backdrop = game.bgPalette[0];
    let buf = '';
    for (let y = 0; y < ROWS; y++) {
      const line = renderRow(cells[y], backdrop);
      if (prevLines[y] !== line) {
        buf += `\x1b[${y + 1};1H${line}\x1b[K`;
        prevLines[y] = line;
      }
    }
    const status = phase === 'select'
      ? ` LEVEL ${String(level).padStart(2, '0')}   ← → ±1  ↑ ↓ ±10  0-9   ENTER start   Q quit`
      : ` ← → ↓ move   X/K rotate ↻   Z/J rotate ↺   ENTER pause   SPACE next   Q quit`;
    if (status !== prevStatus) {
      buf += `\x1b[${ROWS + 1};1H\x1b[0;2m${status}\x1b[0m\x1b[K`;
      prevStatus = status;
    }
    if (buf) out.write(buf);
  };

  let acc = 0;
  let last = performance.now();
  const tick = (): void => {
    const now = performance.now();
    acc += now - last;
    last = now;
    if (acc > FRAME_MS * 4) acc = FRAME_MS * 4;
    while (acc >= FRAME_MS) {
      acc -= FRAME_MS;
      if (phase === 'playing') {
        game.frame(input.poll(now));
        if (game.finished) {
          topScore = Math.max(topScore, bcdToNumber(game.topScore));
          setTop();
          phase = 'select';
          prevLines = [];
        }
      } else {
        game.idleFrame();
      }
    }
    draw();
    const wait = Math.max(0, FRAME_MS - acc);
    setTimeout(tick, Math.floor(wait));
  };
  tick();
}
