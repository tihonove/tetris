import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SfxPlayer } from '../audio/sfx';
import { BTN_START } from '../data/tables';
import { NesTetris, bcdToNumber, numberToBcd } from '../engine/tetris';
import { Input } from '../input';
import { Screen } from '../render/Screen';
import { SkinScreen } from '../render/SkinScreen';
import { SKINS, SKIN_HEIGHT, SKIN_WIDTH, ensureFonts } from '../skins';

/** NTSC NES frame period. */
const FRAME_MS = 1000 / 60.0988;
const MAX_LEVEL = 19;
const TOP_SCORE_KEY = 'nes-tetris.topScore';
const LEVEL_KEY = 'nes-tetris.level';
const ASPECT_KEY = 'nes-tetris.aspect';
const SKIN_KEY = 'nes-tetris.skin';
const GHOST_KEY = 'nes-tetris.ghost';
/** The original NES picture, as opposed to one of the skins. */
const ORIGINAL = 'original';
/** NTSC NES pixels are 8:7 (wider than tall) on a 4:3 CRT. */
const CRT_PIXEL_ASPECT = 8 / 7;

type Phase = 'select' | 'playing';

/** Debug counters exposed on window.__nesTetris in dev builds. */
const frameStats = { frames: 0, startedAt: 0 };

function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && localStorage.getItem(key) !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function saveNumber(key: string, value: number): void {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

function loadString(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function saveString(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

/** Zoom that fits a skin's 960x720 stage into the window, leaving room for the help line. */
function useFitScale(width: number, height: number): number {
  const compute = (): number => Math.min(window.innerWidth / width, (window.innerHeight - 48) / height);
  const [scale, setScale] = useState(compute);
  useEffect(() => {
    const onResize = (): void => setScale(compute());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);
  return scale;
}

/**
 * CSS pixels per NES pixel: an integer number of device pixels, so every tile
 * is exactly the same size and the 1px gaps between blocks stay crisp.
 */
function useScale(aspect: number): { pxx: number; pxy: number } {
  const compute = (): { pxx: number; pxy: number } => {
    const dpr = window.devicePixelRatio || 1;
    const fitY = (window.innerHeight - 48) / 240;
    const fitX = window.innerWidth / (256 * aspect);
    const device = Math.max(1, Math.floor(Math.min(fitX, fitY) * dpr));
    const pxy = device / dpr;
    const pxx = aspect === 1 ? pxy : Math.round(device * aspect) / dpr;
    return { pxx, pxy };
  };
  const [scale, setScale] = useState(compute);
  useEffect(() => {
    setScale(compute());
    const onResize = (): void => setScale(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect]);
  return scale;
}

/** Shift the stage so its top-left corner sits on a whole device pixel. */
function useDevicePixelSnap(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const snap = (): void => {
      el.style.left = '';
      el.style.top = '';
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const fx = (r.left * dpr - Math.round(r.left * dpr)) / dpr;
      const fy = (r.top * dpr - Math.round(r.top * dpr)) / dpr;
      el.style.left = `${-fx}px`;
      el.style.top = `${-fy}px`;
    };
    snap();
    window.addEventListener('resize', snap);
    return () => window.removeEventListener('resize', snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function App() {
  const gameRef = useRef<NesTetris | null>(null);
  if (!gameRef.current) {
    const g = new NesTetris();
    const top = numberToBcd(loadNumber(TOP_SCORE_KEY, 10000), 3);
    g.topScore[0] = top[0]; g.topScore[1] = top[1]; g.topScore[2] = top[2];
    g.startGame(0);
    g.playState = 0x09; // idle: show the empty board without running the game
    gameRef.current = g;
  }
  const game = gameRef.current;
  if (import.meta.env.DEV) (window as unknown as { __nesTetris: unknown }).__nesTetris = { game, stats: frameStats };
  const sfxRef = useRef(new SfxPlayer());
  const inputRef = useRef(new Input(() => sfxRef.current.ensureContext()));
  const [phase, setPhase] = useState<Phase>('select');
  const phaseRef = useRef<Phase>('select');
  const [level, setLevel] = useState(() => Math.min(MAX_LEVEL, Math.max(0, loadNumber(LEVEL_KEY, 0))));
  const levelRef = useRef(level);
  levelRef.current = level;
  const [frame, setFrame] = useState(0);
  const [muted, setMuted] = useState(false);
  const [crtAspect, setCrtAspect] = useState(() => loadNumber(ASPECT_KEY, 0) === 1);
  const [skinId, setSkinId] = useState(() => loadString(SKIN_KEY, ORIGINAL));
  const [ghost, setGhost] = useState(() => loadNumber(GHOST_KEY, 1) === 1);
  const skin = SKINS.find((s) => s.id === skinId);
  const { pxx, pxy } = useScale(crtAspect ? CRT_PIXEL_ASPECT : 1);
  const zoom = useFitScale(SKIN_WIDTH, SKIN_HEIGHT);
  const stageRef = useRef<HTMLDivElement>(null);
  useDevicePixelSnap(stageRef, [pxx, pxy, phase, skinId]);
  useEffect(() => { saveNumber(ASPECT_KEY, crtAspect ? 1 : 0); }, [crtAspect]);
  useEffect(() => { saveString(SKIN_KEY, skinId); if (skin) ensureFonts(skin); }, [skinId, skin]);
  useEffect(() => { saveNumber(GHOST_KEY, ghost ? 1 : 0); }, [ghost]);

  const start = useCallback((): void => {
    const g = gameRef.current!;
    g.startGame(levelRef.current);
    // Start is still held from the menu, so it must not register as a new press.
    g.heldButtons = BTN_START;
    inputRef.current.reset();
    phaseRef.current = 'playing';
    setPhase('playing');
    sfxRef.current.ensureContext();
  }, []);

  // Keyboard handling for the level selector.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (phaseRef.current !== 'select') return;
      if (e.code === 'ArrowLeft') setLevel((l) => Math.max(0, l - 1));
      else if (e.code === 'ArrowRight') setLevel((l) => Math.min(MAX_LEVEL, l + 1));
      else if (e.code === 'ArrowUp') setLevel((l) => Math.min(MAX_LEVEL, l + 10));
      else if (e.code === 'ArrowDown') setLevel((l) => Math.max(0, l - 10));
      else if (/^Digit\d$/.test(e.code)) setLevel(Number(e.code.slice(5)));
      else if (e.code === 'Enter' || e.code === 'Space') start();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  useEffect(() => { saveNumber(LEVEL_KEY, level); }, [level]);

  // Input and the fixed-step 60.0988 Hz loop.
  useEffect(() => {
    const input = inputRef.current;
    const detach = input.attach(window);
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const tick = (now: number): void => {
      acc += now - last;
      last = now;
      if (acc > FRAME_MS * 4) acc = FRAME_MS * 4; // tab was hidden: do not fast-forward
      let ran = false;
      while (acc >= FRAME_MS) {
        acc -= FRAME_MS;
        ran = true;
        if (frameStats.startedAt === 0) frameStats.startedAt = now;
        frameStats.frames++;
        const g = gameRef.current!;
        const buttons = input.poll();
        if (phaseRef.current === 'playing') {
          g.frame(buttons);
          const sfx = sfxRef.current;
          if (g.sfxNoise) sfx.playNoise();
          if (g.sfxPause) sfx.playPause();
          if (g.sfxSq1) sfx.playSq1(g.sfxSq1);
          if (g.finished) {
            saveNumber(TOP_SCORE_KEY, bcdToNumber(g.topScore));
            phaseRef.current = 'select';
            setPhase('select');
          }
        } else {
          g.idleFrame();
        }
      }
      if (ran) setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVisible = (): void => { last = performance.now(); acc = 0; };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelAnimationFrame(raf);
      detach();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => { sfxRef.current.setVolume(muted ? 0 : 0.5); }, [muted]);

  const menu = phase === 'select' && (
    <div className="overlay" style={{ fontSize: skin ? 24 : Math.max(8, 8 * pxy) }}>
      <div className="menu">
        <div className="menu-title">A-TYPE</div>
        <div className="menu-level">
          LEVEL <span className="menu-value">{String(level).padStart(2, '0')}</span>
        </div>
        <div className="menu-hint">
          {'← → ± 1   ↑ ↓ ± 10   0-9'}
        </div>
        <div className="menu-hint">PUSH ENTER</div>
        {game.gameOverStarted && (
          <div className="menu-hint">LAST {String(game.scoreValue).padStart(6, '0')}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="app">
      {skin ? (
        <div className="stage" style={{ width: SKIN_WIDTH * zoom, height: SKIN_HEIGHT * zoom }}>
          <div className="zoom" style={{ width: SKIN_WIDTH, height: SKIN_HEIGHT, transform: `scale(${zoom})` }}>
            <SkinScreen game={game} frame={frame} skin={skin} ghost={ghost} />
            {menu}
          </div>
        </div>
      ) : (
        <div className="stage" ref={stageRef} style={{ width: 256 * pxx, height: 240 * pxy }}>
          <Screen game={game} frame={frame} pxx={pxx} pxy={pxy} />
          {menu}
        </div>
      )}
      <div className="help">
        <span>{'← → ↓'} move</span>
        <span>X / K = A (rotate ↻)</span>
        <span>Z / J = B (rotate ↺)</span>
        <span>Enter = Start (pause)</span>
        <span>Space = Select (next piece)</span>
        <button type="button" onClick={() => setMuted((m) => !m)}>{muted ? 'sound: off' : 'sound: on'}</button>
        {skin ? (
          <button type="button" onClick={() => setGhost((g) => !g)} title="Show where the piece will land">
            {ghost ? 'ghost: on' : 'ghost: off'}
          </button>
        ) : (
          <button type="button" onClick={() => setCrtAspect((a) => !a)} title="NTSC NES pixels are 8:7 on a CRT">
            {crtAspect ? 'pixels: 8:7 (CRT)' : 'pixels: 1:1 (square)'}
          </button>
        )}
        <label>
          skin:{' '}
          <select value={skinId} onChange={(e) => setSkinId(e.target.value)}>
            <option value={ORIGINAL}>Original NES</option>
            {SKINS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
