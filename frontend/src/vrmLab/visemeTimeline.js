// Samples a viseme timeline (built by backend/visemes.js) at an arbitrary
// audio time and returns per-expression weights in 0..1.
//
// Each segment contributes its amplitude for its whole duration; the render
// loop's exponential smoothing turns those steps into the attack/release
// ramps. Doing the shaping here instead would fight the smoothing: a 76 ms
// vowel crossed by a 30 ms attack + 60 ms release almost never reaches full
// openness, which reads as a mouth that barely moves.
//
// "close" is not a VRM preset: it is the multiplier the caller applies to the
// five vowel weights so bilabials (m/b/p) actually shut the mouth.

export const VISEME_NAMES = ["aa", "ee", "ih", "oh", "ou"];
export const VISEME_COLORS = {
  aa: "#e11d76",
  ee: "#f0429b",
  ih: "#ffb31a",
  oh: "#38bdf8",
  ou: "#a78bfa",
  close: "#64748b",
};

export function emptyWeights() {
  return { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0, close: 0 };
}

// Index of the last segment that starts at or before t (binary search).
function findIndex(segments, t) {
  let lo = 0;
  let hi = segments.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function sampleTimeline(segments, t) {
  const out = emptyWeights();
  if (!segments || !segments.length) return out;

  // Start a few segments back so a long segment that began earlier is still
  // picked up, and keep scanning through the ones that start after t (they are
  // skipped by the time check, but the loop is tiny either way).
  const start = Math.max(0, findIndex(segments, t) - 4);
  for (let i = start; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.t > t) break;
    const end = seg.t + seg.d;
    if (t < end) {
      const value = seg.amp == null ? 1 : seg.amp;
      if (value > out[seg.v]) out[seg.v] = value;
    }
  }
  return out;
}

// Frame-rate independent exponential smoothing: `tau` is the time constant in
// seconds (63% of the way to the target after `tau`).
export function smoothWeights(current, target, dt, tau = 0.04) {
  const k = 1 - Math.exp(-dt / tau);
  for (const key of Object.keys(current)) {
    current[key] += (target[key] - current[key]) * k;
  }
  return current;
}

export function base64ToBlob(base64, mime = "audio/wav") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
