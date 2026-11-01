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

## Skins

The `skin` menu under the screen switches between the original NES picture and eight
looks drawn from the same game state (board, falling piece, statistics, NEXT, score):
NES Refined, Neon Glass, Mono Swiss, Synthwave, Phosphor CRT, Toy / Tactile,
Holo Wireframe and Dot-matrix LCD. Skins add an optional ghost piece (`ghost` button)
showing where the piece will land; the original picture has none. The game itself is
untouched: the skins read the same nametable and sprites the NES renderer draws, so
timing, line-clear animation, curtain and the Tetris flash are frame-identical. Skins
that colour blocks per piece type use a piece-type array the engine keeps alongside the
tiles (the NES only stores the tile).

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
- `src/render/view.ts`, `src/render/SkinScreen.tsx` - skin-neutral view of the state, DOM layout.
- `src/skins/` - skin definitions and one CSS file per skin.
- `src/ui/App.tsx` - loop, input, level select, options.

Sources: CelestialAmber/TetrisNESDisasm (ejona86/taus), meatfighter.com/nintendotetrisai,
tetris.wiki, nesdev.org.
