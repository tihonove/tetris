/**
 * Frame-exact model of NES Tetris (USA), Type A, one player.
 *
 * The structure follows the original program: one call to `frame()` is one
 * NES frame. The main-loop game states run first, then the NMI work (VRAM
 * updates, frame counter, RNG step, controller poll). All arithmetic that the
 * 6502 does in 8 bits is done in 8 bits here, including BCD quirks.
 */
import { GAME_ATTR, GAME_NAMETABLE } from '../data/gfx';
import {
  BTN_A, BTN_B, BTN_DOWN, BTN_DPAD, BTN_LEFT, BTN_RIGHT, BTN_SELECT, BTN_START,
  COLOR_TABLE, DAS_DELAY, DAS_RESET, FRAMES_PER_DROP, GAME_PALETTE, INITIAL_AUTOREPEAT_Y,
  LEFT_COLUMNS, LEVEL_DISPLAY_TABLE, NEXT_SPRITE_BY_ORIENTATION, NOISE_SFX_GAME_OVER, ORIENTATION_TABLE,
  ORI_HIDDEN, PIECE_STAT_VRAM, POINTS_TABLE, RIGHT_COLUMNS, ROTATION_TABLE, SFX_LEVEL_UP, SFX_LINE_CLEARING,
  SFX_LINE_COMPLETED, SFX_LOCK, SFX_ROTATE, SFX_SHIFT, SFX_TETRIS, SPAWN_ORIENTATION_FROM_ORIENTATION,
  SPAWN_TABLE, SPRITE_PAUSE, TILE_CURTAIN, TILE_EMPTY, TILE_HIDDEN, TYPE_FROM_ORIENTATION,
  type SpriteDef,
} from '../data/tables';

export interface Sprite {
  /** OAM y: the sprite is drawn one scanline lower, like the NES PPU does. */
  y: number;
  tile: number;
  attr: number;
  x: number;
}

const RENDER_STATS = 0x40;
const RENDER_SCORE = 0x04;
const RENDER_LEVEL = 0x02;
const RENDER_LINES = 0x01;

const RENDER_MODE_BLANK = 0;
const RENDER_MODE_PLAY = 3;

/** Nametable index of the first tile of playfield row `row` (single player layout). */
export function playfieldRowVram(row: number): number {
  // vramPlayfieldRows[row] = $20C6 + $20*row, plus 6 for one player.
  return 0xcc + row * 0x20;
}

export class NesTetris {
  // ---- Game RAM -------------------------------------------------------
  /** $0400 page plus the $0500 page: a completed top row shifts bytes into the second page. */
  readonly playfield = new Uint8Array(512);
  tetriminoX = 5;
  tetriminoY = 0;
  currentPiece = ORI_HIDDEN;
  levelNumber = 0;
  fallTimer = 0;
  autorepeatX = 0;
  startLevel = 0;
  playState = 1;
  vramRow = 0;
  readonly completedRow = [0, 0, 0, 0];
  autorepeatY = 0;
  holdDownPoints = 0;
  /** Two BCD bytes, little endian. */
  readonly lines = [0, 0];
  rowY = 0;
  /** Three BCD bytes, little endian. */
  readonly score = [0, 0, 0];
  completedLines = 0;
  lineIndex = 0;
  curtainRow = 0;
  spawnID = 0;
  spawnCount = 0;
  nextPiece = 0;
  readonly rngSeed = [0x89, 0x88];
  frameCounter = 0;
  /** 7 pieces x 2 BCD bytes. */
  readonly statsByType = new Uint8Array(14);
  readonly lineClearStatsByType = [0, 0, 0, 0];
  heldButtons = 0;
  newlyPressedButtons = 0;
  outOfDateRenderFlags = 0;
  displayNextPiece = 0;
  /** Three BCD bytes, little endian: the TOP score shown on screen. */
  readonly topScore = [0, 0, 1];

  // ---- "PPU" state -------------------------------------------------------
  readonly nametable = new Uint8Array(1024);
  readonly bgPalette = new Uint8Array(16);
  readonly spritePalette = new Uint8Array(16);
  /** Sprites shown this frame, in OAM order. */
  oam: Sprite[] = [];
  /** PPUMASK background bit: cleared while paused. */
  backgroundVisible = true;
  private renderMode = RENDER_MODE_PLAY;

  // ---- Flow -----------------------------------------------------------------
  paused = false;
  /** Set once the game-over curtain has finished and Start was pressed. */
  finished = false;
  /** Set when a game-over curtain has started (score is final). */
  gameOverStarted = false;
  private oamStaging: Sprite[] = [];
  /** Sound effect requests from this frame: SQ1 slot id, noise slot id, pause jingle. */
  sfxSq1 = 0;
  sfxNoise = 0;
  sfxPause = false;

  constructor() {
    this.initBackground();
  }

  // =====================================================================
  // Setup (gameModeState_initGameBackground / initGameState)
  // =====================================================================

  private initBackground(): void {
    for (let i = 0; i < 960; i++) this.nametable[i] = GAME_NAMETABLE[i];
    for (let i = 0; i < 64; i++) this.nametable[960 + i] = GAME_ATTR[i];
    for (let i = 0; i < 16; i++) {
      this.bgPalette[i] = GAME_PALETTE[i];
      this.spritePalette[i] = GAME_PALETTE[16 + i];
    }
    this.nametable[0x83] = 0x0a; // game type "A"
    this.writeTwoDigits(0xb8, this.topScore[2]);
    this.writeTwoDigits(0xba, this.topScore[1]);
    this.writeTwoDigits(0xbc, this.topScore[0]);
    this.backgroundVisible = true;
    this.renderMode = RENDER_MODE_PLAY;
  }

  /** Advance the frame counter and LFSR once, as the NMI does on every frame outside the game. */
  idleFrame(): void {
    this.frameCounter = (this.frameCounter + 1) & 0xffff;
    this.rngStep();
  }

  /** Begin a new Type A game at `startLevel`. */
  startGame(startLevel: number): void {
    this.initBackground();
    this.startLevel = startLevel & 0xff;
    this.playState = 1;
    this.levelNumber = this.startLevel;
    this.updatePaletteForLevel();

    this.playfield.fill(TILE_EMPTY);
    this.statsByType.fill(0);
    this.tetriminoX = 5;
    this.tetriminoY = 0;
    this.vramRow = 0;
    this.fallTimer = 0;
    this.score[0] = this.score[1] = this.score[2] = 0;
    this.lines[0] = this.lines[1] = 0;
    this.lineClearStatsByType.fill(0);
    this.spawnID = 0;
    this.autorepeatX = 0;
    this.autorepeatY = INITIAL_AUTOREPEAT_Y;
    this.holdDownPoints = 0;
    this.completedLines = 0;
    this.lineIndex = 0;
    this.curtainRow = 0;
    this.completedRow.fill(0);
    this.paused = false;
    this.finished = false;
    this.gameOverStarted = false;
    this.renderMode = RENDER_MODE_PLAY;
    this.backgroundVisible = true;
    this.oam = [];
    this.oamStaging = [];

    this.currentPiece = this.pickRandomTetrimino();
    this.incrementPieceStat(this.currentPiece);
    this.rngStep();
    this.nextPiece = this.pickRandomTetrimino();
    this.outOfDateRenderFlags = RENDER_STATS | RENDER_SCORE | RENDER_LEVEL | RENDER_LINES;
  }

  // =====================================================================
  // One frame
  // =====================================================================

  /**
   * Run one NES frame. `buttons` is the controller state that the NMI at the
   * end of this frame latches (the game reacts to it from the next frame on).
   */
  frame(buttons: number): void {
    this.sfxSq1 = 0;
    this.sfxNoise = 0;
    this.sfxPause = false;
    this.oamStaging = [];

    if (this.paused) {
      this.pauseLoopIteration();
    } else {
      this.mainLoopStates();
    }

    // ---- NMI ----
    this.oam = this.oamStaging;
    if (this.renderMode === RENDER_MODE_PLAY) this.renderPlay();
    this.frameCounter = (this.frameCounter + 1) & 0xffff;
    this.rngStep();
    this.pollController(buttons);
  }

  private mainLoopStates(): void {
    // gameModeState_updateCountersAndNonPlayerState
    this.fallTimer = (this.fallTimer + 1) & 0xff;
    if (this.newlyPressedButtons & BTN_SELECT) this.displayNextPiece ^= 1;

    // gameModeState_handleGameOver
    if (this.playState === 0) {
      this.finished = true;
      this.updateTopScore();
      return;
    }

    // gameModeState_updatePlayer1
    this.branchOnPlayState();
    this.stageSpriteForCurrentPiece();
    this.stageSpriteForNextPiece();

    // gameModeState_startButtonHandling
    if ((this.newlyPressedButtons & BTN_START) && this.playState !== 0x0a) {
      this.paused = true;
      this.sfxPause = true;
      this.renderMode = RENDER_MODE_BLANK;
    }
  }

  private pauseLoopIteration(): void {
    // After the first NMI inside the pause routine the background is turned off
    // and OAM is filled with $FF; every iteration stages the PAUSE sprite.
    this.backgroundVisible = false;
    this.loadSprite(SPRITE_PAUSE, 0x70, 0x77);
    if (this.newlyPressedButtons === BTN_START) {
      this.backgroundVisible = true;
      this.vramRow = 0;
      this.renderMode = RENDER_MODE_PLAY;
      this.paused = false;
    }
  }

  private updateTopScore(): void {
    const s = this.score, t = this.topScore;
    const cur = s[2] * 65536 + s[1] * 256 + s[0];
    const top = t[2] * 65536 + t[1] * 256 + t[0];
    if (cur > top) { t[0] = s[0]; t[1] = s[1]; t[2] = s[2]; }
  }

  // =====================================================================
  // Play states
  // =====================================================================

  private branchOnPlayState(): void {
    switch (this.playState) {
      case 0x00: this.currentPiece = ORI_HIDDEN; break;
      case 0x01: this.shiftTetrimino(); this.rotateTetrimino(); this.dropTetrimino(); break;
      case 0x02: this.lockTetrimino(); break;
      case 0x03: this.checkForCompletedRows(); break;
      case 0x04: break; // line clearing animation runs in the NMI
      case 0x05: this.updateLinesAndStatistics(); break;
      case 0x06: this.playState++; break; // B-type goal check
      case 0x07: this.playState++; break; // receive garbage (2 player only)
      case 0x08: this.spawnNextTetrimino(); break;
      case 0x09: break;
      case 0x0a: this.updateGameOverCurtain(); break;
      case 0x0b: this.playState++; break;
      default: break;
    }
  }

  private shiftTetrimino(): void {
    const held = this.heldButtons, pressed = this.newlyPressedButtons;
    if (held & BTN_DOWN) return;
    if (pressed & (BTN_LEFT | BTN_RIGHT)) {
      this.autorepeatX = 0;
    } else {
      if (!(held & (BTN_LEFT | BTN_RIGHT))) return;
      this.autorepeatX = (this.autorepeatX + 1) & 0xff;
      if (((this.autorepeatX - DAS_RESET) & 0xff) & 0x80) return; // bmi
      this.autorepeatX = DAS_DELAY;
    }
    const originalX = this.tetriminoX;
    if (held & BTN_RIGHT) {
      this.tetriminoX = (this.tetriminoX + 1) & 0xff;
    } else if (held & BTN_LEFT) {
      this.tetriminoX = (this.tetriminoX - 1) & 0xff;
    } else {
      return;
    }
    if (this.isPositionValid()) {
      this.sfxSq1 = SFX_SHIFT;
    } else {
      this.tetriminoX = originalX;
      this.autorepeatX = DAS_RESET;
    }
  }

  private rotateTetrimino(): void {
    const pressed = this.newlyPressedButtons;
    const original = this.currentPiece;
    if (pressed & BTN_A) {
      this.currentPiece = ROTATION_TABLE[original * 2 + 1];
    } else if (pressed & BTN_B) {
      this.currentPiece = ROTATION_TABLE[original * 2];
    } else {
      return;
    }
    if (this.isPositionValid()) {
      this.sfxSq1 = SFX_ROTATE;
    } else {
      this.currentPiece = original;
    }
  }

  private dropTetrimino(): void {
    const held = this.heldButtons, pressed = this.newlyPressedButtons;
    let autorepeating: boolean;
    if (this.autorepeatY & 0x80) {
      // Beginning of game: wait out the initial delay unless Down is pressed.
      if (!(pressed & BTN_DOWN)) {
        this.autorepeatY = (this.autorepeatY + 1) & 0xff;
        return;
      }
      this.autorepeatY = 0;
      autorepeating = false;
    } else {
      autorepeating = this.autorepeatY !== 0;
    }

    if (autorepeating) {
      if ((held & BTN_DPAD) === BTN_DOWN) {
        this.autorepeatY = (this.autorepeatY + 1) & 0xff;
        if (this.autorepeatY >= 3) {
          this.autorepeatY = 1;
          this.holdDownPoints = (this.holdDownPoints + 1) & 0xff;
          this.drop();
          return;
        }
      } else {
        this.autorepeatY = 0;
        this.holdDownPoints = 0;
      }
    } else if (!(held & (BTN_LEFT | BTN_RIGHT)) && (pressed & BTN_DPAD) === BTN_DOWN) {
      this.autorepeatY = 1;
    }

    // @lookupDropSpeed
    const dropSpeed = this.levelNumber >= 0x1d ? 1 : FRAMES_PER_DROP[this.levelNumber];
    if (!(((this.fallTimer - dropSpeed) & 0xff) & 0x80)) this.drop(); // bpl
  }

  private drop(): void {
    this.fallTimer = 0;
    const originalY = this.tetriminoY;
    this.tetriminoY = (this.tetriminoY + 1) & 0xff;
    if (this.isPositionValid()) return;
    this.tetriminoY = originalY;
    this.playState = 2;
    this.updatePlayfield();
  }

  private lockTetrimino(): void {
    if (!this.isPositionValid()) {
      this.sfxNoise = NOISE_SFX_GAME_OVER;
      this.playState = 0x0a;
      this.curtainRow = 0xf0;
      this.gameOverStarted = true;
      return;
    }
    if (((this.vramRow - 0x20) & 0xff) & 0x80) return; // bmi: wait for the VRAM copy
    const base = (this.tetriminoY * 10 + this.tetriminoX) & 0xff;
    const o = this.currentPiece * 12;
    for (let i = 0; i < 4; i++) {
      const yOff = ORIENTATION_TABLE[o + i * 3];
      const tile = ORIENTATION_TABLE[o + i * 3 + 1];
      const xOff = ORIENTATION_TABLE[o + i * 3 + 2];
      const idx = ((yOff * 10) + base + xOff) & 0xff;
      this.playfield[idx] = tile;
    }
    this.lineIndex = 0;
    this.updatePlayfield();
    this.playState++;
  }

  private checkForCompletedRows(): void {
    if (((this.vramRow - 0x20) & 0xff) & 0x80) return; // wait for the VRAM copy
    let startRow = (this.tetriminoY - 2) & 0xff;
    if (startRow & 0x80) startRow = 0;
    const row = (startRow + this.lineIndex) & 0xff;
    const base = (row * 10) & 0xff;
    let complete = true;
    for (let i = 0; i < 10; i++) {
      if (this.playfield[(base + i) & 0xff] === TILE_EMPTY) { complete = false; break; }
    }
    if (complete) {
      this.sfxSq1 = SFX_LINE_COMPLETED;
      this.completedLines = (this.completedLines + 1) & 0xff;
      this.completedRow[this.lineIndex] = row;
      // Move everything above the row down by one. With base = 0 the 6502 loop
      // wraps and copies the whole page into the next one; the 512-byte buffer absorbs that.
      for (let y = (base - 1) & 0xff; ; y = (y - 1) & 0xff) {
        this.playfield[y + 10] = this.playfield[y];
        if (y === 0) break;
      }
      for (let i = 0; i < 10; i++) this.playfield[i] = TILE_EMPTY;
      this.currentPiece = ORI_HIDDEN;
    } else {
      this.completedRow[this.lineIndex] = 0;
    }
    this.lineIndex++;
    if (this.lineIndex < 4) return;

    this.vramRow = 0;
    this.rowY = 0;
    if (this.completedLines === 4) this.sfxSq1 = SFX_TETRIS;
    this.playState++;
    if (this.completedLines === 0) {
      this.playState++;
      this.sfxSq1 = SFX_LOCK;
    }
  }

  private updateLinesAndStatistics(): void {
    if (this.completedLines !== 0) {
      const k = this.completedLines - 1;
      let v = (this.lineClearStatsByType[k] + 1) & 0xff;
      if ((v & 0x0f) >= 0x0a) v = (v + 6) & 0xff;
      this.lineClearStatsByType[k] = v;
      this.outOfDateRenderFlags |= RENDER_LINES;
      // Type A: increment lines one at a time, checking for a level up after each.
      for (let x = this.completedLines; x !== 0; x = (x - 1) & 0xff) this.incrementLines();
    }
    this.addHoldDownPoints();
    this.addLineClearPoints();
  }

  private incrementLines(): void {
    const lines = this.lines;
    lines[0] = (lines[0] + 1) & 0xff;
    if ((lines[0] & 0x0f) >= 0x0a) {
      lines[0] = (lines[0] + 6) & 0xff;
      if ((lines[0] & 0xf0) >= 0xa0) {
        lines[0] &= 0x0f;
        lines[1] = (lines[1] + 1) & 0xff;
      }
    }
    if ((lines[0] & 0x0f) !== 0) return;
    // generalCounter = (lines+1 : lines) >> 4, low byte
    const target = (((lines[1] & 0x0f) << 4) | (lines[0] >> 4)) & 0xff;
    if (!(((this.levelNumber - target) & 0xff) & 0x80)) return; // bpl: level >= target
    this.levelNumber = (this.levelNumber + 1) & 0xff;
    this.sfxSq1 = SFX_LEVEL_UP;
    this.outOfDateRenderFlags |= RENDER_LEVEL;
  }

  private addHoldDownPoints(): void {
    const hdp = this.holdDownPoints;
    if (((hdp - 2) & 0xff) & 0x80) return; // bmi: holdDownPoints < 2
    const s = this.score;
    s[0] = (s[0] - 1) & 0xff;
    s[0] = (s[0] + hdp) & 0xff;
    if ((s[0] & 0x0f) >= 0x0a) s[0] = (s[0] + 6) & 0xff;
    if ((s[0] & 0xf0) >= 0xa0) {
      s[0] = (s[0] + 0x60) & 0xff;
      s[1] = (s[1] + 1) & 0xff;
    }
    this.outOfDateRenderFlags |= RENDER_SCORE;
  }

  private addLineClearPoints(): void {
    this.holdDownPoints = 0;
    const s = this.score;
    const lo = POINTS_TABLE[this.completedLines * 2];
    const hi = POINTS_TABLE[this.completedLines * 2 + 1];
    let counter = (this.levelNumber + 1) & 0xff;
    do {
      s[0] = (s[0] + lo) & 0xff;
      if (s[0] >= 0xa0) {
        s[0] = (s[0] + 0x60) & 0xff;
        s[1] = (s[1] + 1) & 0xff;
      }
      s[1] = (s[1] + hi) & 0xff;
      if ((s[1] & 0x0f) >= 0x0a) s[1] = (s[1] + 6) & 0xff;
      if ((s[1] & 0xf0) >= 0xa0) {
        s[1] = (s[1] + 0x60) & 0xff;
        s[2] = (s[2] + 1) & 0xff;
      }
      if ((s[2] & 0x0f) >= 0x0a) s[2] = (s[2] + 6) & 0xff;
      if ((s[2] & 0xf0) >= 0xa0) {
        s[0] = s[1] = s[2] = 0x99;
      }
      counter = (counter - 1) & 0xff;
    } while (counter !== 0);
    this.outOfDateRenderFlags |= RENDER_SCORE;
    this.completedLines = 0;
    this.playState++;
  }

  private spawnNextTetrimino(): void {
    if (((this.vramRow - 0x20) & 0xff) & 0x80) return; // wait for the VRAM copy
    this.fallTimer = 0;
    this.tetriminoY = 0;
    this.playState = 1;
    this.tetriminoX = 5;
    this.currentPiece = SPAWN_ORIENTATION_FROM_ORIENTATION[this.nextPiece];
    this.incrementPieceStat(this.currentPiece);
    this.nextPiece = this.pickRandomTetrimino();
    this.autorepeatY = 0;
  }

  private updateGameOverCurtain(): void {
    if (this.curtainRow === 0x14) {
      // Curtain finished (the 300000+ ending animation is not reproduced).
      if (this.newlyPressedButtons === BTN_START) {
        this.playState = 0;
        this.newlyPressedButtons = 0;
      }
      return;
    }
    if (this.frameCounter & 3) return;
    if (!(this.curtainRow & 0x80)) {
      const base = this.curtainRow * 10;
      this.currentPiece = ORI_HIDDEN;
      for (let i = 0; i < 10; i++) this.playfield[base + i] = TILE_CURTAIN;
      this.vramRow = this.curtainRow;
    }
    this.curtainRow = (this.curtainRow + 1) & 0xff;
  }

  // =====================================================================
  // Helpers shared by the play states
  // =====================================================================

  /** isPositionValid for the active piece. */
  isPositionValid(): boolean {
    const base = (this.tetriminoY * 10 + this.tetriminoX) & 0xff;
    const o = this.currentPiece * 12;
    for (let i = 0; i < 4; i++) {
      const yOff = ORIENTATION_TABLE[o + i * 3];
      const xOff = ORIENTATION_TABLE[o + i * 3 + 2];
      if (((yOff + this.tetriminoY + 2) & 0xff) >= 0x16) return false;
      const idx = ((yOff * 10) + base + xOff) & 0xff;
      if (this.playfield[idx] < TILE_EMPTY) return false;
      if (((xOff + this.tetriminoX) & 0xff) >= 0x0a) return false;
    }
    return true;
  }

  /** updatePlayfield: schedule the VRAM copy from two rows above the piece. */
  private updatePlayfield(): void {
    let row = (this.tetriminoY - 2) & 0xff;
    if (row & 0x80) row = 0;
    if (!(((row - this.vramRow) & 0xff) & 0x80)) return; // bpl: row >= vramRow
    this.vramRow = row;
  }

  private incrementPieceStat(orientation: number): void {
    const x = TYPE_FROM_ORIENTATION[orientation] * 2;
    let v = (this.statsByType[x] + 1) & 0xff;
    if ((v & 0x0f) >= 0x0a) {
      v = (v + 6) & 0xff;
      if (v >= 0xa0) {
        v = (v + 0x60) & 0xff;
        this.statsByType[x + 1] = (this.statsByType[x + 1] + 1) & 0xff;
      }
    }
    this.statsByType[x] = v;
    this.outOfDateRenderFlags |= RENDER_STATS;
  }

  /** generateNextPseudorandomNumber with x = rng_seed, y = 2. */
  rngStep(): void {
    const s = this.rngSeed;
    let carry = ((s[0] & 2) ^ (s[1] & 2)) !== 0 ? 1 : 0;
    for (let i = 0; i < 2; i++) {
      const newCarry = s[i] & 1;
      s[i] = (s[i] >> 1) | (carry << 7);
      carry = newCarry;
    }
  }

  /** pickRandomTetrimino: returns a spawn orientation and updates spawnID. */
  pickRandomTetrimino(): number {
    this.spawnCount = (this.spawnCount + 1) & 0xff;
    const index = (this.rngSeed[0] + this.spawnCount) & 0x07;
    if (index !== 7) {
      const candidate = SPAWN_TABLE[index];
      if (candidate !== this.spawnID) {
        this.spawnID = candidate;
        return candidate;
      }
    }
    this.rngStep();
    let a = ((this.rngSeed[0] & 0x07) + this.spawnID) & 0xff;
    while (a >= 7) a = (a - 7) & 0xff;
    this.spawnID = SPAWN_TABLE[a];
    return this.spawnID;
  }

  // =====================================================================
  // Sprites (staged during the main loop, shown by the NMI)
  // =====================================================================

  private stageSpriteForCurrentPiece(): void {
    const baseX = (this.tetriminoX * 8 + 0x60) & 0xff;
    const baseY = (this.tetriminoY * 8 + 0x2f) & 0xff;
    const o = this.currentPiece * 12;
    for (let i = 0; i < 4; i++) {
      const y = (ORIENTATION_TABLE[o + i * 3] * 8 + baseY) & 0xff;
      const tile = ORIENTATION_TABLE[o + i * 3 + 1];
      if (y < 0x2f) {
        this.oamStaging.push({ y, tile: TILE_HIDDEN, attr: 2, x: 0 });
      } else {
        const x = (ORIENTATION_TABLE[o + i * 3 + 2] * 8 + baseX) & 0xff;
        this.oamStaging.push({ y, tile, attr: 2, x });
      }
    }
  }

  private stageSpriteForNextPiece(): void {
    if (this.displayNextPiece !== 0) return;
    const def = NEXT_SPRITE_BY_ORIENTATION[this.nextPiece];
    if (def) this.loadSprite(def, 0xc8, 0x77);
  }

  private loadSprite(def: SpriteDef, xOffset: number, yOffset: number): void {
    for (let i = 0; i < def.length; i += 4) {
      this.oamStaging.push({
        y: (def[i] + yOffset) & 0xff,
        tile: def[i + 1],
        attr: def[i + 2],
        x: (def[i + 3] + xOffset) & 0xff,
      });
    }
  }

  // =====================================================================
  // NMI: render_mode_play_and_demo
  // =====================================================================

  private renderPlay(): void {
    if (this.playState === 4) {
      this.updateLineClearingAnimation();
      this.vramRow = 0;
    } else {
      for (let i = 0; i < 4; i++) this.copyPlayfieldRowToVRAM();
    }
    if (this.outOfDateRenderFlags & RENDER_LINES) {
      this.nametable[0x73] = this.lines[1];
      this.writeTwoDigits(0x74, this.lines[0]);
      this.outOfDateRenderFlags &= ~RENDER_LINES;
    }
    if (this.outOfDateRenderFlags & RENDER_LEVEL) {
      this.writeTwoDigits(0x2ba, LEVEL_DISPLAY_TABLE[this.levelNumber] ?? 0);
      this.updatePaletteForLevel();
      this.outOfDateRenderFlags &= ~RENDER_LEVEL;
    }
    if (this.outOfDateRenderFlags & RENDER_SCORE) {
      this.writeTwoDigits(0x118, this.score[2]);
      this.writeTwoDigits(0x11a, this.score[1]);
      this.writeTwoDigits(0x11c, this.score[0]);
      this.outOfDateRenderFlags &= ~RENDER_SCORE;
    }
    if (this.outOfDateRenderFlags & RENDER_STATS) {
      for (let p = 0; p < 7; p++) {
        const addr = PIECE_STAT_VRAM[p] - 0x2000;
        this.nametable[addr] = this.statsByType[p * 2 + 1];
        this.writeTwoDigits(addr + 1, this.statsByType[p * 2]);
      }
      this.outOfDateRenderFlags &= ~RENDER_STATS;
    }
    // Tetris flash: background palette 3, colour 2.
    let flash = 0x00;
    if (this.completedLines === 4 && (this.frameCounter & 3) === 0) {
      flash = 0x30;
      if ((this.frameCounter & 7) === 0) this.sfxSq1 = SFX_LINE_CLEARING;
    }
    this.bgPalette[0x0e] = flash;
  }

  private copyPlayfieldRowToVRAM(): void {
    if (!(((this.vramRow - 0x15) & 0xff) & 0x80)) return; // bpl: vramRow >= $15
    const row = this.vramRow;
    const dst = playfieldRowVram(row);
    const src = row * 10;
    for (let i = 0; i < 10; i++) this.nametable[dst + i] = this.playfield[src + i];
    this.vramRow++;
    if (!(((this.vramRow - 0x14) & 0xff) & 0x80)) this.vramRow = 0x20; // reached row 20
  }

  private updateLineClearingAnimation(): void {
    if (this.frameCounter & 3) return;
    for (let i = 0; i < 4; i++) {
      const row = this.completedRow[i];
      if (row === 0) continue;
      const base = playfieldRowVram(row);
      this.nametable[base + LEFT_COLUMNS[this.rowY]] = TILE_HIDDEN;
      this.nametable[base + RIGHT_COLUMNS[this.rowY]] = TILE_HIDDEN;
    }
    this.rowY++;
    if (this.rowY >= 5) this.playState++;
  }

  private updatePaletteForLevel(): void {
    let level = this.levelNumber;
    while (!(((level - 0x0a) & 0xff) & 0x80)) level = (level - 0x0a) & 0xff; // bmi loop
    const base = level * 4;
    for (let i = 0; i < 4; i++) {
      const c = COLOR_TABLE[base + i] ?? 0x0f;
      this.bgPalette[8 + i] = c;
      this.spritePalette[8 + i] = c;
    }
  }

  private writeTwoDigits(addr: number, bcd: number): void {
    this.nametable[addr] = bcd >> 4;
    this.nametable[addr + 1] = bcd & 0x0f;
  }

  private pollController(buttons: number): void {
    const b = buttons & 0xff;
    this.newlyPressedButtons = (b ^ this.heldButtons) & b;
    this.heldButtons = b;
  }

  // =====================================================================
  // Convenience accessors
  // =====================================================================

  /** Score as a plain number. */
  get scoreValue(): number {
    return bcdToNumber(this.score);
  }

  get linesValue(): number {
    return bcdToNumber(this.lines);
  }

  /** Palette index (0..3) used by background tile (tx, ty). */
  attributeFor(tx: number, ty: number): number {
    const attr = this.nametable[960 + (ty >> 2) * 8 + (tx >> 2)];
    const shift = ((ty & 2) << 1) | (tx & 2);
    return (attr >> shift) & 3;
  }
}

export function bcdToNumber(bytes: readonly number[]): number {
  let v = 0;
  for (let i = bytes.length - 1; i >= 0; i--) v = v * 100 + (bytes[i] >> 4) * 10 + (bytes[i] & 0x0f);
  return v;
}

export function numberToBcd(n: number, bytes: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes; i++) {
    const lo = n % 10; n = Math.floor(n / 10);
    const hi = n % 10; n = Math.floor(n / 10);
    out.push((hi << 4) | lo);
  }
  return out;
}
