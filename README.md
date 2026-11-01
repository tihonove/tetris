# NES Tetris (clone)

Play: https://tihonove.github.io/tetris/

A frame-exact re-creation of Nintendo's NES Tetris (USA, 1989), Type A, one player,
running in the browser. TypeScript + React, no canvas: the 256x240 picture is a grid of
8x8 tiles rendered as SVG data URIs, so palettes swap per level the way the PPU does.

```
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: timing/scoring/randomizer tests
npm run build
```

## Console version

The same engine also runs in a terminal (Node 20+, a truecolor terminal, and a
font with the Unicode block elements):

```
npm run tui              # fullwidth letters, needs CJK-capable font fallback
npm run tui -- --ascii   # plain ASCII letters
npm run tui -- --level 9
```

Each NES tile is two terminal cells, so the 256x240 picture becomes 64x30
characters and blocks stay square. Tile graphics are converted to block-element
glyphs; borders use box drawing, the statistics icons are hand-drawn. Terminals
report key presses but not releases, so holding a key is approximated: a
direction stays held while the OS key repeat keeps sending events (DAS then runs
at the original 6-frame cadence), each Down event soft-drops one row, and
rotations ignore auto-repeat. Lower your OS repeat delay (for example
`xset r rate 200 30`) to get closer to the NES feel. No sound in the console.

## Controls

| NES        | Keyboard                | Gamepad (standard mapping) |
|------------|-------------------------|----------------------------|
| D-pad      | Arrow keys              | D-pad / left stick         |
| A (rotate clockwise)         | X or K  | right face button (B / Circle) |
| B (rotate counter-clockwise) | Z or J  | bottom face button (A / Cross) |
| Start      | Enter                   | Start                      |
| Select     | Space / Shift           | Select                     |

Quick start: pick a level with the arrow keys or digits, press Enter. Enter pauses.
After the game-over curtain, Enter returns to the level selector. Select toggles the
NEXT box, as on the original. There is no music; only the original sound effects.

## What is reproduced exactly

Everything below follows the disassembled program, frame for frame:

- 60.0988 Hz frame pacing (fixed-step loop on `requestAnimationFrame`).
- Gravity table, 96-frame opening delay, soft drop (3 frames, then every 2).
- DAS: 16 frames initial, 6 repeat, wall charge, `Down` blocking shifts.
- Entry delay as the original produces it: the playfield is copied to VRAM 4 rows per
  frame, and locking, row checks, statistics and spawn each wait on that copy.
  Result: 10..18 frames depending on lock height.
- Line clear animation: 5 steps on frames where `frameCounter % 4 == 0`.
- Scoring in packed BCD, including the soft-drop bug above 15 cells and the 999999 cap.
- Level transitions (`levelNumber < lines/10` check, BCD interpreted as binary).
- Randomizer: 16-bit LFSR seeded `$8988`, stepped every frame, one reroll.
- Game over: curtain one row per 4 frames starting 16 steps early.
- Palettes: `colorTable` for levels mod 10, the Tetris flash on palette 3,
  the NES 2C02G master palette from nesdev.org.
- Sound effects: register writes to a small 2A03 pulse/noise model rendered to PCM
  (shift, rotate, lock, line, tetris, level up, pause jingle, game-over noise).
- Screen layout from the game's nametable; tile graphics from CHR bank 3.

Not reproduced: title/menu screens, music, two-player mode, B-type, high score entry,
and the 300000+ ending animation.

## Layout

- `src/engine/tetris.ts` - the game as a per-frame state machine (`NesTetris.frame()`).
- `src/data/tables.ts` - orientation/rotation/spawn/speed/points/colour tables from ROM.
- `src/data/gfx.ts` - generated: tiles, nametable, attribute table, master palette.
- `src/audio/apu.ts`, `src/audio/sfx.ts` - APU model and sound effect scripts.
- `src/render/Screen.tsx`, `src/render/tiles.ts` - React picture, tile image cache.
- `src/ui/App.tsx` - loop, input, level select, options.
- `src/tui/` - console version: glyph mapping, screen composition, key handling, loop.

Sources: CelestialAmber/TetrisNESDisasm (ejona86/taus), meatfighter.com/nintendotetrisai,
tetris.wiki, nesdev.org.
