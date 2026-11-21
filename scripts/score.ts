// Original score for the TAPEZERO film — synthesised from scratch (no samples, no third-party audio).
// Soft, rhythmic electronic at 105 BPM: warm short bass, dry percussion, small playback clicks.
//   node scripts/score.ts  →  public/film/score.wav (48 kHz, 16-bit stereo, 35 s)
import { writeFileSync, mkdirSync } from 'node:fs';
import { FILM_CUES as Q, TRAILER_CUES as T, PROMO_CUES as P } from '../film/cues.ts';

const MODE = process.argv[2] ?? 'film';
const TRAILER = MODE === 'trailer';
const PROMO = MODE === 'promo';

const SR = 48000;
const DUR = PROMO ? 31 : TRAILER ? 10 : 35;
const N = SR * DUR;
const L = new Float32Array(N);
const R = new Float32Array(N);
const BEAT = 60 / 105;

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function add(t0: number, len: number, fn: (t: number, i: number) => number, gain = 1, pan = 0) {
  const s0 = Math.floor(t0 * SR);
  const n = Math.floor(len * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n; i++) {
    const k = s0 + i;
    if (k < 0 || k >= N) continue;
    const v = fn(i / SR, i);
    L[k] += v * gl;
    R[k] += v * gr;
  }
}

// ── instruments ──
function kick(t0: number, g = 0.9) {
  add(t0, 0.42, (t) => {
    const f = 46 + 110 * Math.exp(-t * 28);
    const ph = 2 * Math.PI * (46 * t + (110 / 28) * (1 - Math.exp(-t * 28)));
    void f;
    return Math.sin(ph) * Math.exp(-t * 7.5) * (1 - Math.exp(-t * 900));
  }, g);
}
function impact(t0: number, g = 1) {
  kick(t0, g);
  add(t0, 1.2, (t) => Math.sin(2 * Math.PI * 41 * t) * Math.exp(-t * 2.6) * Math.min(1, t * 300), g * 0.55);
  add(t0, 0.5, (t) => (Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1320 * t) * 0.3) * Math.exp(-t * 9), g * 0.12, 0.2);
}
/** Tonal rise (replaces noise risers): a soft saw sweep under a low-pass. */
function sweep(t0: number, len: number, g = 0.12) {
  let lp = 0;
  let ph = 0;
  add(t0, len, (t) => {
    const x = t / len;
    const f = 110 * Math.pow(2, x * 2.5);
    ph += f / SR;
    const saw = 2 * (ph % 1) - 1;
    lp += (saw - lp) * (0.02 + 0.1 * x);
    return lp * x * x;
  }, g);
}
function hat(t0: number, g = 0.12, pan = 0.25) {
  let prev = 0;
  add(t0, 0.06, (t) => {
    const n = rnd();
    const hp = n - prev;
    prev = n;
    return hp * Math.exp(-t * 70);
  }, g, pan);
}
function rim(t0: number, g = 0.22) {
  add(t0, 0.09, (t) => (Math.sin(2 * Math.PI * 1650 * t) * 0.5 + rnd() * 0.5) * Math.exp(-t * 55), g, -0.15);
}
function click(t0: number, g = 0.35, pan = 0) {
  // mechanical click: two very short transients
  add(t0, 0.03, (t) => (rnd() * 0.6 + Math.sin(2 * Math.PI * 3200 * t)) * Math.exp(-t * 260), g, pan);
  add(t0 + 0.012, 0.03, (t) => Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t * 300), g * 0.6, pan);
}
function tick(t0: number, g = 0.08, pan = 0) {
  add(t0, 0.02, (t) => Math.sin(2 * Math.PI * 4200 * t) * Math.exp(-t * 400), g, pan);
}
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
function bass(t0: number, note: number, len = BEAT * 0.42, g = 0.36) {
  const f = midi(note);
  let lp = 0;
  add(t0, len + 0.08, (t) => {
    const saw = 2 * ((f * t) % 1) - 1;
    const sine = Math.sin(2 * Math.PI * f * t);
    const cutoff = 0.05 + 0.12 * Math.exp(-t * 18);
    lp += (saw - lp) * cutoff;
    const env = Math.min(1, t * 400) * (t < len ? Math.exp(-t * 3) : Math.exp(-len * 3) * Math.exp(-(t - len) * 60));
    return (lp * 0.65 + sine * 0.55) * env;
  }, g);
}
function ping(t0: number, note: number, g = 0.22, pan = 0) {
  const f = midi(note);
  add(t0, 1.2, (t) => (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2.01 * t)) * Math.exp(-t * 4.5) * Math.min(1, t * 600), g, pan);
  add(t0 + 0.214, 0.9, (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 5), g * 0.35, -pan); // dotted echo
}
function reverseSwell(tEnd: number, len: number, g = 0.5) {
  // reversed noise + reversed bass hit, ending on the beat
  let lp = 0;
  add(tEnd - len, len, (t) => {
    const x = t / len; // 0 → 1, grows like a reversed decay
    void lp;
    const tone = Math.sin(2 * Math.PI * midi(45) * (len - t)) * 0.6 + Math.sin(2 * Math.PI * midi(57) * (len - t)) * 0.3;
    return tone * Math.pow(x, 3);
  }, g);
}
function pad(t0: number, len: number, notes: number[], g = 0.06) {
  for (const [i, n] of notes.entries()) {
    const f = midi(n);
    add(t0, len, (t) => {
      const a = Math.min(1, t / 1.2) * Math.min(1, (len - t) / 1.5);
      return (Math.sin(2 * Math.PI * f * t + Math.sin(t * 0.7 + i)) * 0.7 + Math.sin(2 * Math.PI * f * 1.002 * t) * 0.3) * a;
    }, g, i % 2 ? 0.4 : -0.4);
  }
}
function texture(_t0: number, _len: number, _g = 0.05) {
  return; // removed: the filtered-noise bed sounded like the sea
}
function _textureUnused(t0: number, len: number, g = 0.05) {
  let lp = 0;
  let lp2 = 0;
  add(t0, len, (t) => {
    lp += (rnd() - lp) * 0.08;
    lp2 += (lp - lp2) * 0.08;
    const a = Math.min(1, t / 2) * Math.min(1, (len - t) / 2);
    return (lp - lp2) * 3 * a * (0.7 + 0.3 * Math.sin(t * 2 * Math.PI * (105 / 60 / 2)));
  }, g, 0.1);
}

// ── arrangements (cues shared with the picture: film/cues.ts) ──
const beatT = (b: number) => b * BEAT;
const bassLine = [33, 33, 45, 33, 36, 36, 40, 38]; // A1 … warm, short
// ── trailer arrangement (10 s) ──
function trailerArrangement() {
  texture(0, DUR, 0.04);
  pad(0, 2.2, [57, 64, 69], 0.035);
  click(T.playheadOn, 0.45);
  sweep(T.splitStart, T.align - T.splitStart, 0.1);
  impact(T.align, 0.95);
  for (let b = Math.ceil(T.align / BEAT); beatT(b) < T.end - 0.4; b++) {
    const t = beatT(b);
    const brk = t >= T.inspect && t < T.inspect + BEAT * 3;
    kick(t, brk ? 0.3 : 0.8);
    if (b % 2 === 1) rim(t, 0.2);
    hat(t + BEAT / 2, 0.11);
    if (!brk && t < T.outro) bass(t + BEAT / 2, bassLine[b % 8]);
  }
  for (let t = T.live; t < T.rewind - 0.1; t += BEAT / 4) if (rnd() > 0.3) tick(t + 0.01, 0.06, rnd() * 0.6);
  reverseSwell(T.rewind + 0.02, BEAT * 1.5, 0.55);
  for (let i = 0; i < 6; i++) tick(T.rewind + 0.05 + i * 0.07, 0.12 - i * 0.015, -0.3 + i * 0.12);
  T.pings.forEach((t, i) => ping(t, [76, 79, 83][i], 0.2, [-0.35, 0.05, 0.4][i]));
  pad(T.outro, T.end - T.outro, [57, 64, 71], 0.045);
  impact(T.final, 0.9);
}
function filmArrangement() {

texture(0, DUR, 0.045);
pad(0, 9.2, [57, 64, 69], 0.035);
click(Q.playheadOn, 0.45); // the cursor lights up
// split: airy rise while the layers drift apart, impact when they align
sweep(Q.splitStart, Q.align - Q.splitStart, 0.1);
impact(Q.align, 0.95);

for (let b = 4; b < 61; b++) {
  const t = beatT(b);
  const inBreak = t >= Q.bassOut && t < Q.bassIn;
  const inOutro = t >= Q.outroCalm && t < Q.liveReturn;
  if (t >= Q.end - 1.2) break;
  // kick: four on the floor, lighter during the break and the calm before the return
  if (!inOutro) kick(t, inBreak ? 0.35 : 0.8);
  // rim on 2 & 4
  if (b % 2 === 1 && !inOutro) rim(t, inBreak ? 0.12 : 0.2);
  // hats on 8ths and 16th ghost notes
  if (!inOutro) {
    hat(t + BEAT / 2, 0.11);
    if (b % 4 === 3) hat(t + BEAT * 0.75, 0.05, -0.3);
  }
  // bass: short notes on the off-beats (removed during the peak opening)
  if (!inBreak && !inOutro && t >= Q.grooveIn) {
    const n = bassLine[b % 8];
    bass(t + BEAT / 2, n);
    if (b % 4 === 1) bass(t + BEAT * 0.75, n + 12, BEAT * 0.2, 0.18);
  }
}
// small playback clicks while swaps arrive in the live shot
for (let t = Q.liveStart; t < Q.rewind - 0.2; t += BEAT / 4) if (rnd() > 0.35) tick(t + 0.01, 0.06, rnd() * 0.6);
// rewind: brief reversed effect landing on the bar
reverseSwell(Q.rewind + 0.02, BEAT * 2, 0.55);
for (let i = 0; i < 6; i++) tick(Q.rewind + 0.05 + i * 0.07, 0.12 - i * 0.015, -0.3 + i * 0.12);
// the peak opens: bass drops out, then three spaced pings for the three swaps
Q.swapPings.forEach((t, i) => ping(t, [76, 79, 83][i], 0.2, [-0.35, 0.05, 0.4][i]));
pad(Q.bassOut, Q.bassIn - Q.bassOut + 1, [64, 71, 76], 0.03);
// compare: two soft blips when the launches align
ping(Q.compare + 0.05, 69, 0.12, -0.5);
ping(Q.compare + BEAT + 0.05, 69, 0.12, 0.5);
// return to live: pulse comes back, short final impact
pad(Q.outroCalm, Q.end - Q.outroCalm, [57, 64, 71], 0.04);
click(Q.liveReturn - 0.02, 0.35);
for (let b = Math.ceil(Q.liveReturn / BEAT); beatT(b) < Q.finalImpact - 0.01; b++) {
  kick(beatT(b), 0.55);
  hat(beatT(b) + BEAT / 2, 0.08);
  bass(beatT(b) + BEAT / 2, bassLine[b % 8]);
}
impact(Q.finalImpact, 1);

}
// ── X launch post (31 s): clean tones only — no noise beds ──
function promoArrangement() {
  const groove = (from: number, to: number, bassOn = true, lvl = 0.75) => {
    for (let b = Math.ceil(from / BEAT - 1e-6); beatT(b) < to - 0.02; b++) {
      const t = beatT(b);
      kick(t, lvl);
      if (b % 2 === 1) rim(t, 0.16);
      hat(t + BEAT / 2, 0.07);
      if (bassOn) bass(t + BEAT / 2, bassLine[b % 8]);
    }
  };
  // 1 · feed: light pulse, a soft blip for each name that appears
  pad(0, P.explode + 0.5, [57, 64, 69], 0.04);
  for (let b = 0; beatT(b) < P.explode - 0.05; b++) { kick(beatT(b), 0.45); hat(beatT(b) + BEAT / 2, 0.05); }
  for (let i = 0; i < 8; i++) ping(0.5 + i * 0.3, [69, 72, 76, 79][i % 4], 0.07, i % 2 ? 0.35 : -0.35);
  // 2 · explode: the counter climbs on a tonal rise, impact when it lands
  groove(P.explode, P.chart);
  sweep(P.explode + 0.3, 2.3, 0.1);
  impact(P.explode + 2.6, 0.7);
  // 3 · chart: bass out, a question
  groove(P.chart, P.brand, false, 0.4);
  pad(P.chart, P.brand - P.chart + 0.5, [60, 64, 67], 0.035);
  ping(P.chart + 1.35, 83, 0.14);
  // 4 · brand: reversed tone into the realignment
  reverseSwell(P.brandAlign, BEAT * 2, 0.45);
  click(P.brand + 0.1, 0.35);
  impact(P.brandAlign, 0.95);
  pad(P.brandAlign, P.rewindShot - P.brandAlign + 0.6, [57, 64, 71], 0.04);
  // 5 · rewind
  groove(P.rewindShot, P.rewind);
  for (let t = P.rewindShot; t < P.rewind - 0.1; t += BEAT / 4) tick(t + 0.01, 0.045, (t * 7) % 1 - 0.5);
  reverseSwell(P.rewind + 0.02, BEAT * 1.5, 0.5);
  for (let i = 0; i < 6; i++) tick(P.rewind + 0.05 + i * 0.08, 0.11 - i * 0.015, -0.3 + i * 0.12);
  groove(P.rewind, P.inspect);
  // 6 · inspect: bass drops, one note per line
  groove(P.inspect, P.proof, false, 0.4);
  pad(P.inspect, P.proof - P.inspect + 0.6, [64, 71, 76], 0.035);
  P.lines.forEach((t, i) => ping(t, [76, 79, 83][i], 0.17, [-0.3, 0.05, 0.35][i]));
  // 7 · proof: groove back, a click per row
  groove(P.proof, P.end);
  for (let i = 0; i < 5; i++) click(P.proof + 0.4 + i * 0.2, 0.16, -0.3 + i * 0.15);
  // 8 · end
  groove(P.end, P.final, true, 0.55);
  pad(P.end, DUR - P.end, [57, 64, 71], 0.045);
  impact(P.final, 1);
}
if (PROMO) promoArrangement();
else if (TRAILER) trailerArrangement();
else filmArrangement();

// ── master: gentle glue, soft clip, normalise to −1 dBFS, fade out ──
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (SR * 1.2)) * Math.min(1, i / (SR * 0.05));
  L[i] = Math.tanh(L[i] * 1.1) * fade;
  R[i] = Math.tanh(R[i] * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
mkdirSync('public/film', { recursive: true });
writeFileSync(PROMO ? 'public/film/promo.wav' : TRAILER ? 'public/film/trailer.wav' : 'public/film/score.wav', buf);
console.log(`${MODE}.wav written · ${DUR}s · peak normalised from ${peak.toFixed(2)}`);
