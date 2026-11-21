import type { SwapSeries } from './series.ts';

export type Speed = 0.5 | 1 | 2 | 5;
export const SPEEDS: Speed[] = [0.5, 1, 2, 5];

export type MetricFilter = 'buys' | 'sells' | 'largest' | 'firstTime' | 'top3' | 'earlySellers' | 'clusters' | 'largestBuy';

export interface PlayerState {
  playhead: number; // tl ms
  playing: boolean;
  speed: Speed;
  following: boolean; // pinned to the live edge
  selection: [number, number] | null;
  viewport: [number, number];
  highlight: string | null; // swap id
  filter: MetricFilter | null;
  blind: boolean; // Blind Replay: nothing after the playhead is visible
  bucket: number | null; // candle size in ms; null = automatic from the zoom level
}

/**
 * Pure playback controller shared by the terminal, the landing replay and the film.
 * Incoming events never move the playhead unless `following` is true.
 */
export class PlayerController {
  series: SwapSeries;
  isLive: boolean;
  s: PlayerState;
  private listeners = new Set<() => void>();
  private lastTick = 0;
  version = 0;

  constructor(series: SwapSeries, isLive: boolean, init?: Partial<PlayerState>) {
    this.series = series;
    this.isLive = isLive;
    const edge = series.liveEdge;
    const start = series.start;
    const span = Math.max(30_000, Math.min(120_000, edge - start + 5000));
    this.s = {
      playhead: isLive ? edge : start,
      playing: false,
      speed: 1,
      following: isLive,
      selection: null,
      viewport: isLive ? [edge - span * 0.85, edge + span * 0.15] : [start - 2000, start - 2000 + span],
      highlight: null,
      filter: null,
      blind: false,
      bucket: null,
      ...init,
    };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
  set(p: Partial<PlayerState>) {
    this.s = { ...this.s, ...p };
    this.emit();
  }

  get liveEdge() {
    return this.series.liveEdge;
  }
  get behindMs() {
    return Math.max(0, this.liveEdge - this.s.playhead);
  }

  /** Advance the clock. Call from rAF with performance.now(). */
  tick(now: number) {
    const dt = this.lastTick ? Math.min(250, now - this.lastTick) : 0;
    this.lastTick = now;
    const s = this.s;
    const edge = this.liveEdge;
    let playhead = s.playhead;
    let playing = s.playing;
    let following = s.following;
    if (following) {
      playhead = edge;
    } else if (playing) {
      playhead += dt * s.speed;
      if (playhead >= edge) {
        playhead = edge;
        if (this.isLive) following = true; // caught up with the live edge
        else playing = false;
      }
    }
    let viewport = s.viewport;
    const span = viewport[1] - viewport[0];
    if (following) {
      const want: [number, number] = [edge - span * 0.85, edge + span * 0.15];
      if (Math.abs(want[1] - viewport[1]) > 1) viewport = want;
    } else if (playing && playhead > viewport[0] + span * 0.9) {
      viewport = [playhead - span * 0.5, playhead + span * 0.5];
    }
    if (playhead !== s.playhead || playing !== s.playing || following !== s.following || viewport !== s.viewport) {
      this.s = { ...s, playhead, playing, following, viewport };
      this.emit();
    }
  }

  togglePlay() {
    const s = this.s;
    if (s.following) return this.set({ following: false, playing: false });
    if (!s.playing && !this.isLive && s.playhead >= this.liveEdge) return this.set({ playing: true, playhead: this.series.start });
    this.set({ playing: !s.playing });
  }
  pause() {
    this.set({ playing: false, following: false });
  }
  goLive() {
    const edge = this.liveEdge;
    const span = this.s.viewport[1] - this.s.viewport[0];
    this.set({ following: this.isLive, playing: this.isLive ? this.s.playing : false, playhead: edge, viewport: [edge - span * 0.85, edge + span * 0.15] });
  }
  seek(t: number, keepView = false) {
    const t2 = clamp(t, this.series.start, this.liveEdge);
    const p: Partial<PlayerState> = { playhead: t2, following: false };
    if (!keepView) p.viewport = this.ensureVisible(t2);
    this.set(p);
  }
  rewind(ms: number) {
    this.set({ playing: this.s.playing, following: false, playhead: clamp(this.s.playhead - ms, this.series.start, this.liveEdge), viewport: this.ensureVisible(this.s.playhead - ms) });
  }
  /** Move to previous/next swap. */
  step(dir: 1 | -1): string | null {
    const a = this.series.swaps;
    if (!a.length) return null;
    const i = this.series.indexAt(this.s.playhead);
    let j: number;
    if (dir > 0) j = Math.min(a.length - 1, i + 1);
    else j = a[i] && a[i].tl < this.s.playhead - 0.5 ? i : Math.max(0, i - 1);
    const sw = a[j];
    this.set({ playhead: sw.tl, following: false, playing: false, highlight: sw.id, viewport: this.ensureVisible(sw.tl) });
    return sw.id;
  }
  select(a: number, b: number) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    this.set({ selection: [lo, hi], filter: null });
  }
  clearSelection() {
    this.set({ selection: null, filter: null });
  }
  /** Keyboard selection: extend from anchor to the next/previous swap. */
  extendSelection(dir: 1 | -1) {
    const anchor = this.s.selection ? (this.s.selection[0] === this.s.playhead ? this.s.selection[1] : this.s.selection[0]) : this.s.playhead;
    this.step(dir);
    const ph = this.s.playhead;
    this.set({ selection: [Math.min(anchor, ph), Math.max(anchor, ph)] });
  }
  highlightSwap(id: string | null, seek = true) {
    if (!id) return this.set({ highlight: null });
    const sw = this.series.swaps.find((x) => x.id === id);
    if (!sw) return;
    if (seek) this.set({ highlight: id, playhead: sw.tl, following: false, playing: false, viewport: this.ensureVisible(sw.tl) });
    else this.set({ highlight: id });
  }
  zoom(factor: number, anchorT?: number) {
    const [v0, v1] = this.s.viewport;
    const span = clamp((v1 - v0) * factor, 4000, Math.max(60_000, this.liveEdge - this.series.start + 60_000) * 1.2);
    const anchor = anchorT ?? (this.s.following ? v1 : (v0 + v1) / 2);
    const k = (anchor - v0) / (v1 - v0);
    this.set({ viewport: [anchor - span * k, anchor + span * (1 - k)] });
  }
  pan(dt: number) {
    const [v0, v1] = this.s.viewport;
    this.set({ viewport: [v0 + dt, v1 + dt], following: false });
  }
  fit() {
    const a = this.series.start;
    const b = this.liveEdge;
    const pad = Math.max(1000, (b - a) * 0.04);
    this.set({ viewport: [a - pad, b + pad] });
  }
  private ensureVisible(t: number): [number, number] {
    const [v0, v1] = this.s.viewport;
    const span = v1 - v0;
    if (t >= v0 + span * 0.05 && t <= v1 - span * 0.05) return this.s.viewport;
    return [t - span * 0.5, t + span * 0.5];
  }
}

export const clamp = (x: number, a: number, b: number) => (b < a ? a : Math.max(a, Math.min(b, x)));
