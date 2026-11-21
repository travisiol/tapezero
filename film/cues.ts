// Shared timing for picture and sound (seconds). 105 BPM → one beat = 0.5714 s.
const B = 60 / 105;

export const FPS = 30;
export const FILM_CUES = {
  playheadOn: 0.55, // the coral playhead lights up — mechanical click
  splitStart: 0.7, // the doubled edge drifts apart
  align: 4 * B, // 2.29 s — layers realign on the first impact
  grooveIn: 4 * B,
  liveStart: 7 * B, // 4.0 s — cut to the terminal
  rewind: 16 * B, // 9.14 s — the playhead goes back 15 s
  peakZoom: 26 * B, // 14.86 s — zoom on the peak
  bassOut: 27 * B, // 15.43 s — bass removed while the candle opens
  swapPings: [30 * B, 32 * B, 34 * B], // 17.1 / 18.3 / 19.4 s — the three swaps light up
  bassIn: 36 * B, // 20.57 s
  compare: 40 * B, // 22.86 s — two launches align on their first swap
  outroCalm: 50 * B, // 28.57 s — back to the zero
  liveReturn: 52 * B, // 29.71 s — the playhead joins the live edge, pulse returns
  finalImpact: 58 * B, // 33.14 s
  end: 35,
};

/** 10-second trailer (homepage, inline). Same tempo; every visual beat lands on a beat. */
export const TRAILER_CUES = {
  playheadOn: 0.3,
  splitStart: 0.45,
  align: 3 * B, // 1.71 s — the doubled edge snaps back on the first impact
  live: 3 * B + 0.1, // terminal
  rewind: 8 * B, // 4.57 s
  inspect: 11 * B, // 6.29 s — the candle opens, bass drops
  pings: [12 * B, 12.5 * B, 13 * B], // three biggest buys light up
  outro: 15 * B + 0.1, // 8.67 s — back to the zero
  final: 16 * B, // 9.14 s
  end: 10,
};

/** X launch post — 1080×1350, 31 s. One plain sentence per screen; every cut lands on a beat. */
export const PROMO_CUES = {
  feed: 0,
  explode: 6 * B, // 3.43
  chart: 12 * B, // 6.86
  brand: 18 * B, // 10.29
  brandAlign: 20 * B, // 11.43
  rewindShot: 23 * B, // 13.14
  rewind: 26 * B, // 14.86
  inspect: 31 * B, // 17.71
  lines: [32.5 * B, 34 * B, 35.5 * B], // 18.57 / 19.43 / 20.29
  proof: 41 * B, // 23.43
  end: 47 * B, // 26.86
  final: 51 * B, // 29.14
  total: 31,
};
