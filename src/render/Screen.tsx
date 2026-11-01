/**
 * React rendering of the 256x240 NES picture: background tiles and 8x8
 * sprites as absolutely positioned elements with SVG data-URI backgrounds.
 * Every element is positioned on its own (no grid), so rounding never
 * accumulates across a row and neighbouring tiles always share an edge.
 */
import { memo, type CSSProperties } from 'react';
import { NES_PALETTE } from '../data/gfx';
import type { NesTetris } from '../engine/tetris';
import { tileImage, tileIsBlank } from './tiles';

interface CellProps {
  left: number;
  top: number;
  width: number;
  height: number;
  image: string;
}

const Cell = memo(function Cell({ left, top, width, height, image }: CellProps) {
  const style: CSSProperties = { left, top, width, height, backgroundImage: image };
  return <div className="cell" style={style} />;
});

export interface ScreenProps {
  game: NesTetris;
  /** Changes every frame so the screen re-renders. */
  frame: number;
  /** CSS pixels per NES pixel, horizontally and vertically. */
  pxx: number;
  pxy: number;
}

export function Screen({ game, pxx, pxy }: ScreenProps) {
  const bg = game.bgPalette;
  const backdrop = NES_PALETTE[bg[0] & 0x3f];
  const w = 8 * pxx, h = 8 * pxy;
  const cells: React.JSX.Element[] = [];
  if (game.backgroundVisible) {
    for (let ty = 0; ty < 30; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const tile = game.nametable[ty * 32 + tx];
        if (tileIsBlank(tile)) continue;
        const pal = game.attributeFor(tx, ty) * 4;
        cells.push(
          <Cell
            key={ty * 32 + tx}
            left={tx * w}
            top={ty * h}
            width={w}
            height={h}
            image={tileImage(tile, bg[pal + 1], bg[pal + 2], bg[pal + 3])}
          />,
        );
      }
    }
  }
  const sprites: React.JSX.Element[] = [];
  const sp = game.spritePalette;
  game.oam.forEach((s, i) => {
    if (s.y >= 0xef || tileIsBlank(s.tile)) return; // off screen or hidden
    const pal = (s.attr & 3) * 4;
    sprites.push(
      <Cell
        key={i}
        left={s.x * pxx}
        top={(s.y + 1) * pxy}
        width={w}
        height={h}
        image={tileImage(s.tile, sp[pal + 1], sp[pal + 2], sp[pal + 3])}
      />,
    );
  });
  return (
    <div className="screen" style={{ width: 256 * pxx, height: 240 * pxy, backgroundColor: backdrop }}>
      {cells}
      {sprites}
    </div>
  );
}
