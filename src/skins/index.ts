/**
 * Skins: alternative looks for the same game, drawn by `SkinScreen` from the
 * neutral view in `render/view.ts`. Each skin is a CSS file keyed by the
 * `skin-<id>` class plus the Google Fonts families it needs.
 */
import './base.css';
import './nes.css';
import './neon.css';
import './mono.css';
import './synthwave.css';
import './phosphor.css';
import './toy.css';
import './holo.css';
import './lcd.css';

export interface Skin {
  id: string;
  name: string;
  /** Google Fonts `family=` specs, loaded on first use. */
  fonts: readonly string[];
  /** How the six-digit counters are written. */
  numbers: 'padded' | 'grouped';
}

export const SKINS: readonly Skin[] = [
  { id: 'nes', name: 'NES Refined', fonts: ['Press+Start+2P'], numbers: 'padded' },
  { id: 'neon', name: 'Neon Glass', fonts: ['Chakra+Petch:wght@500;700'], numbers: 'grouped' },
  { id: 'mono', name: 'Mono Swiss', fonts: ['Inter+Tight:wght@500;800'], numbers: 'grouped' },
  { id: 'synthwave', name: 'Synthwave', fonts: ['Audiowide', 'Share+Tech+Mono'], numbers: 'padded' },
  { id: 'phosphor', name: 'Phosphor CRT', fonts: ['VT323'], numbers: 'padded' },
  { id: 'toy', name: 'Toy / Tactile', fonts: ['Nunito:wght@700;900'], numbers: 'grouped' },
  { id: 'holo', name: 'Holo Wireframe', fonts: ['IBM+Plex+Mono:wght@400;600'], numbers: 'padded' },
  { id: 'lcd', name: 'Dot-matrix LCD', fonts: ['Silkscreen:wght@400;700'], numbers: 'padded' },
];

/** The skin's design size; the stage is scaled to fit the window. */
export const SKIN_WIDTH = 960;
export const SKIN_HEIGHT = 720;

const loaded = new Set<string>();

/** Add the skin's Google Fonts stylesheet to the document once. */
export function ensureFonts(skin: Skin): void {
  if (!skin.fonts.length || loaded.has(skin.id)) return;
  loaded.add(skin.id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${skin.fonts.map((f) => `family=${f}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}
