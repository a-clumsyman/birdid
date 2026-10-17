/* Bird ID audio helpers: noise reduction, activity finder, WAV, resampling. Runs in the browser and in Node (tests). */
(function (root) {
  function fft(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inv ? -1 : 1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  function resample(x, from, to) {
    if (from === to) return x;
    const n = Math.floor(x.length * to / from), out = new Float32Array(n), r = from / to;
    // simple windowed averaging for downsample, linear for upsample
    for (let i = 0; i < n; i++) {
      const p = i * r;
      if (r > 1) { const a = Math.floor(p), b = Math.min(x.length, Math.ceil(p + r)); let s = 0; for (let k = a; k < b; k++) s += x[k]; out[i] = s / Math.max(1, b - a); }
      else { const a = Math.floor(p), f = p - a; out[i] = x[a] * (1 - f) + (x[Math.min(a + 1, x.length - 1)]) * f; }
    }
    return out;
  }

  /* Spectral-gate noise reduction + bird band-pass + loudness normalise. */
  function clean(x, sr, opt) {
    opt = Object.assign({ lo: 800, hi: 11000, strength: 1.6, floor: 0.08, target: 0.9 }, opt || {});
    const N = 1024, H = 256, half = N / 2;
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); // sqrt-hann analysis+synthesis
    const frames = Math.max(1, Math.floor((x.length - N) / H) + 1);
    const mags = [], specs = [];
    for (let f = 0; f < frames; f++) {
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let i = 0; i < N; i++) re[i] = (x[f * H + i] || 0) * win[i];
      fft(re, im, false); specs.push([re, im]);
      const m = new Float32Array(half + 1); for (let k = 0; k <= half; k++) m[k] = Math.hypot(re[k], im[k]); mags.push(m);
    }
    // noise floor per bin = 20th percentile over time, smoothed over frequency
    const noise = new Float32Array(half + 1), col = new Float32Array(frames);
    for (let k = 0; k <= half; k++) { for (let f = 0; f < frames; f++) col[f] = mags[f][k]; const s = Array.from(col).sort((a, b) => a - b); noise[k] = s[Math.floor(s.length * 0.2)]; }
    const nz = new Float32Array(half + 1); for (let k = 0; k <= half; k++) { let s = 0, c = 0; for (let d = -3; d <= 3; d++) { const j = k + d; if (j >= 0 && j <= half) { s += noise[j]; c++; } } nz[k] = s / c; }
    const binHz = sr / N, band = new Float32Array(half + 1);
    for (let k = 0; k <= half; k++) { const hz = k * binHz; band[k] = hz < opt.lo * 0.6 ? 0 : hz < opt.lo ? (hz - opt.lo * 0.6) / (opt.lo * 0.4) : hz > opt.hi * 1.15 ? 0 : hz > opt.hi ? (opt.hi * 1.15 - hz) / (opt.hi * 0.15) : 1; }
    const out = new Float32Array(x.length + N), norm = new Float32Array(x.length + N);
    const prevG = new Float32Array(half + 1).fill(1);
    for (let f = 0; f < frames; f++) {
      const [re, im] = specs[f], m = mags[f];
      for (let k = 0; k <= half; k++) {
        let g = 1 - opt.strength * nz[k] / (m[k] + 1e-9); if (g < opt.floor) g = opt.floor;
        g = Math.max(g, prevG[k] * 0.6); // soften attack/decay to limit musical-noise artefacts
        prevG[k] = g; g *= band[k] * (1 - opt.floor) + opt.floor * band[k];
        re[k] *= g; im[k] *= g; if (k > 0 && k < half) { re[N - k] *= g; im[N - k] *= g; }
      }
      fft(re, im, true);
      for (let i = 0; i < N; i++) { out[f * H + i] += re[i] * win[i]; norm[f * H + i] += win[i] * win[i]; }
    }
    const y = new Float32Array(x.length); let peak = 0;
    for (let i = 0; i < x.length; i++) { y[i] = out[i] / (norm[i] || 1); const a = Math.abs(y[i]); if (a > peak) peak = a; }
    // normalise on a high percentile so one click does not set the level
    const samp = []; for (let i = 0; i < y.length; i += 7) samp.push(Math.abs(y[i])); samp.sort((a, b) => a - b);
    const p99 = samp[Math.floor(samp.length * 0.995)] || peak || 1;
    const gain = Math.min(opt.target / p99, 40);
    for (let i = 0; i < y.length; i++) { let v = y[i] * gain; y[i] = Math.tanh(v * 1.1) / Math.tanh(1.1); }
    return y;
  }

  /* Short-time energy of the bird band (2-9 kHz), one value per 0.1 s */
  function activity(x, sr) {
    const N = 1024, step = Math.floor(sr * 0.1), res = [];
    const kLo = Math.floor(2000 / (sr / N)), kHi = Math.floor(9000 / (sr / N));
    for (let p = 0; p + N <= x.length; p += step) {
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let i = 0; i < N; i++) re[i] = x[p + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
      fft(re, im, false); let e = 0; for (let k = kLo; k < kHi; k++) e += re[k] * re[k] + im[k] * im[k]; res.push(e);
    }
    return res;
  }
  /* start/end (seconds) of the best window of given length by bird-band energy relative to the clip's median */
  function bestWindow(x, sr, len) {
    const dur = x.length / sr; if (dur <= len) return [0, dur];
    const a = activity(x, sr), med = a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)] || 1;
    const w = Math.round(len * 10), v = a.map(e => Math.max(0, Math.log10((e + 1e-12) / (med + 1e-12))));
    let cur = 0, best = -1, bi = 0; for (let i = 0; i < Math.min(w, v.length); i++) cur += v[i]; best = cur;
    for (let i = w; i < v.length; i++) { cur += v[i] - v[i - w]; if (cur > best) { best = cur; bi = i - w + 1; } }
    return [bi / 10, Math.min(dur, bi / 10 + len)];
  }

  function wav(x, sr) {
    const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, x.length * 2, true);
    for (let i = 0; i < x.length; i++) { const c = Math.max(-1, Math.min(1, x[i])); v.setInt16(44 + i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true); }
    return buf;
  }

  /* spectrogram: returns {w,h,data:Uint8 [0..255]} bins 0..10kHz */
  function spectrogram(x, sr, cols, rows) {
    const N = 1024, out = new Uint8Array(cols * rows), kMax = Math.floor(10000 / (sr / N)), hop = Math.max(1, Math.floor((x.length - N) / cols));
    let mx = -1e9, vals = new Float32Array(cols * rows);
    for (let c = 0; c < cols; c++) {
      const re = new Float32Array(N), im = new Float32Array(N), p = c * hop;
      for (let i = 0; i < N; i++) re[i] = (x[p + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
      fft(re, im, false);
      for (let r = 0; r < rows; r++) { const k0 = Math.floor(r / rows * kMax), k1 = Math.max(k0 + 1, Math.floor((r + 1) / rows * kMax)); let e = 0; for (let k = k0; k < k1; k++) e += re[k] * re[k] + im[k] * im[k]; const db = 10 * Math.log10(e / (k1 - k0) + 1e-12); vals[c * rows + (rows - 1 - r)] = db; if (db > mx) mx = db; }
    }
    // show each pitch band relative to its own background so calls stand out of steady rumble/hiss
    for (let r = 0; r < rows; r++) { const col = []; for (let c = 0; c < cols; c++) col.push(vals[c * rows + r]); col.sort((a, b) => a - b); const med = col[Math.floor(cols * 0.5)];
      for (let c = 0; c < cols; c++) out[c * rows + r] = vals[c * rows + r] < mx - 80 ? 0 : Math.max(0, Math.min(255, Math.round((vals[c * rows + r] - med) / 28 * 255))); }
    return { w: cols, h: rows, data: out };
  }
  root.BirdDSP = { fft, resample, clean, activity, bestWindow, wav, spectrogram };
  if (typeof module !== 'undefined') module.exports = root.BirdDSP;
})(typeof window !== 'undefined' ? window : globalThis);
