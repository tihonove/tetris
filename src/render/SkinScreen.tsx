/**
 * DOM rendering of a skin: a fixed 960x720 layout of HUD blocks around the
 * 10x20 board. All looks come from CSS keyed by `.skin-<id>`; this component
 * only names things.
 */
import { memo, type CSSProperties } from 'react';
import type { NesTetris } from '../engine/tetris';
import { SKIN_HEIGHT, SKIN_WIDTH, type Skin } from '../skins';
import { buildView, type PieceStat } from './view';

export interface SkinScreenProps {
  game: NesTetris;
  /** Changes every frame so the screen re-renders. */
  frame: number;
  skin: Skin;
  ghost: boolean;
}

function formatNumber(n: number, style: Skin['numbers'], digits: number): string {
  const s = String(n).padStart(digits, '0');
  if (style === 'padded') return s;
  // Drop leading zeros and group thousands with a thin space, "67 850".
  const t = String(n);
  return t.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const Mini = memo(function Mini({ piece, cls }: { piece: PieceStat; cls: string }) {
  const on = `k${piece.kind} t-${piece.letter}`;
  return (
    <div className={`${cls}-grid`}>
      {piece.shape.map((x, i) => <div key={i} className={`${cls} ${x ? on : 'e'}`} />)}
    </div>
  );
});

export function SkinScreen({ game, skin, ghost }: SkinScreenProps) {
  const v = buildView(game, ghost);
  const style = {
    width: SKIN_WIDTH,
    height: SKIN_HEIGHT,
    '--c1': v.palette[0],
    '--c2': v.palette[1],
    '--c3': v.palette[2],
  } as CSSProperties;
  const cls = ['skin', `skin-${skin.id}`, v.flash && 'flash', v.paused && 'paused'].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      <div className="shell">
        <div className="screen">
          <div className="fx fx-1" aria-hidden="true" />
          <div className="hud">
            <div className="col col-left">
              <section className="block stats">
                <h2 className="lbl">Statistics</h2>
                {v.stats.map((p) => (
                  <div key={p.letter} className="stat">
                    <Mini piece={p} cls="m" />
                    <span className="num">{String(p.count).padStart(3, '0')}</span>
                  </div>
                ))}
              </section>
            </div>
            <div className="col col-mid">
              <section className="block lines">
                <span className="lbl">Lines</span>
                <span className="val">{String(v.lines).padStart(3, '0')}</span>
              </section>
              <section className="block board">
                <div className="grid">
                  {v.cells.map((c, i) => <div key={i} className={`c ${c}`} />)}
                </div>
                {v.paused && <div className="pause">PAUSE</div>}
              </section>
            </div>
            <div className="col col-right">
              <section className="block score">
                <span className="lbl">Top</span>
                <span className="val">{formatNumber(v.top, skin.numbers, 6)}</span>
                <span className="lbl">Score</span>
                <span className="val">{formatNumber(v.score, skin.numbers, 6)}</span>
              </section>
              <section className="block next">
                <span className="lbl">Next</span>
                {v.next ? <Mini piece={v.next} cls="n" /> : <div className="n-grid n-off" />}
              </section>
              <section className="block level">
                <span className="lbl">Level</span>
                <span className="val">{String(v.level).padStart(2, '0')}</span>
                <div className="meter" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, i) => (
                    <div key={i} className={i < v.lines % 10 ? 'seg on' : 'seg'} />
                  ))}
                </div>
              </section>
            </div>
          </div>
          <div className="fx fx-2" aria-hidden="true" />
          <div className="fx fx-3" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
