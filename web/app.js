(() => {
const C = window.BIRDID;
const DEMO = /[?&]demo=1/.test(location.search);
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { accessToken: async () => (await window.Clerk?.session?.getToken()) || null });
const $ = (s, r = document) => r.querySelector(s);
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HABITATS = [['garden', 'Garden'], ['park', 'Park'], ['forest', 'Woods'], ['water', 'Water'], ['urban', 'Street'], ['farm', 'Fields']];
let user = null, profile = null, obs = [], tab = 'listen', mode = 'catch', loc = null, habitat = null, clip = null, favOnly = false, map = null, mapLayer = null;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800); }
const fmtT = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

/* ---------- time of day: the page follows the light ---------- */
function todOf(h) { return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 19.5 ? 'dusk' : 'night'; }
const TOD_COPY = {
  dawn: ['Dawn chorus', 'the best hour of the day. Go now.'],
  day: ['Daylight hours', 'quieter, but edges and hedges still sing.'],
  dusk: ['Evening song', 'thrushes and robins sing late. Stay a while.'],
  night: ['After dark', 'owls and nightjars. Listen closely.']
};
function applyTod() {
  const pref = localStorage.getItem('birdid-theme') || 'auto';
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  const t = pref === 'auto' ? todOf(h) : pref;
  document.documentElement.dataset.tod = t;
  document.querySelector('meta[name=theme-color]').content = t === 'night' ? '#141b2a' : '#f2ead6';
  $('#scene').innerHTML = scenePlate(t, h); $('#scene').classList.toggle('listening', !!Mic.on);
  const nm = (profile?.display_name || '').split(' ')[0];
  $('#helloH').textContent = TOD_COPY[t][0] + (nm ? ', ' + nm : '');
  $('#helloP').textContent = TOD_COPY[t][1];
}
/* ---------- header: a field-guide plate that follows the light ---------- */
/* Public-domain plates (see README): Jerdon, Illustrations of Indian Ornithology, 1847; Hardwicke nightjar, 1790s. */
const PLATES = {
  dawn:  { img: 'assets/plate-prinia.webp',     cls: 'prinia',     cap: 'Pl. VI \u00b7 Prinia socialis \u00b7 ashy prinia' },
  day:   { img: 'assets/plate-flycatcher.webp', cls: 'flycatcher', cap: 'Pl. VII \u00b7 Muscipeta paradisi \u00b7 Indian paradise flycatcher' },
  dusk:  { img: 'assets/plate-fantail.webp',    cls: 'fantail',    cap: 'Pl. II \u00b7 Leucocirca albofrontata \u00b7 white-browed fantail' },
  night: { img: 'assets/plate-nightjar-night.webp',   cls: 'nightjar',   cap: 'Caprimulgus indicus \u00b7 Indian nightjar' }
};
function scenePlate(t, h) {
  const p = PLATES[t], night = t === 'night';
  const frac = night ? 0.5 : Math.min(1, Math.max(0, (h - 5.5) / 14));
  const ox = 8 + frac * 26, oy = 62 - Math.sin(frac * Math.PI) * 38;
  const orb = night
    ? '<svg class="orb" style="left:22%;top:16%" viewBox="0 0 40 40"><defs><mask id="mm"><rect width="40" height="40" fill="#fff"/><circle cx="27.5" cy="16" r="12.5" fill="#000"/></mask></defs><circle cx="20" cy="20" r="14" fill="#e8e0c6" mask="url(#mm)"/></svg>'
    : `<svg class="orb" style="left:${ox}%;top:${oy}%" viewBox="0 0 40 40"><g stroke="${t === 'day' ? '#eab54e' : '#e08a4a'}" stroke-width="2.4" stroke-linecap="round"><path d="M20 3v5M20 32v5M3 20h5M32 20h5M8 8l3.5 3.5M28.5 28.5L32 32M32 8l-3.5 3.5M11.5 28.5L8 32"/></g><circle cx="20" cy="20" r="8.5" fill="${t === 'day' ? '#f2c35e' : '#e8955a'}"/></svg>`;
  const stars = night ? '<div class="stars">' + Array.from({ length: 30 }, (_, i) => `<i style="left:${(i * 89) % 96 + 2}%;top:${(i * 47) % 62 + 3}%;width:${i % 4 ? 2 : 3}px;height:${i % 4 ? 2 : 3}px;opacity:${.35 + (i % 5) / 7}"></i>`).join('') + '</div>' : '';
  const notes = '<div class="pnotes"><i>\u266a</i><i>\u266b</i></div>';
  return `<img class="plate ${p.cls}" src="${p.img}" alt="">${stars}<div class="wash"></div>${orb}${notes}<div class="platecap">${p.cap}</div>`;
}

/* ---------- species info (Wikipedia) ---------- */
const infoCache = {};
async function speciesInfo(sci, common) {
  const key = sci || common; if (infoCache[key]) return infoCache[key];
  const tryTitle = async (t) => { const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_')) + '?redirect=true'); if (!r.ok) return null; const j = await r.json(); return j.type === 'standard' ? j : null; };
  let j = null; try { j = (sci && await tryTitle(sci)) || (common && await tryTitle(common)); } catch (e) {}
  const out = j ? { thumb: j.thumbnail?.source, image: j.originalimage?.source || j.thumbnail?.source, extract: j.extract, url: j.content_urls?.desktop?.page } : {};
  infoCache[key] = out; return out;
}
async function fillThumb(node, sci, common) { const i = await speciesInfo(sci, common); if (i.thumb) node.style.backgroundImage = `url("${i.thumb}")`; }
async function openSpecies(sci, common) {
  const body = $('#sheetBody'); body.innerHTML = `<h2 class="serif">${esc(common)}</h2><p class="sci">${esc(sci || '')}</p><p class="small">Looking it up…</p>`; $('#sheet').hidden = false;
  const i = await speciesInfo(sci, common), mine = obs.filter(o => o.species_common === common);
  const first = mine.length ? new Date(Math.min(...mine.map(o => +new Date(o.observed_at)))).toLocaleDateString() : null;
  body.innerHTML = `${i.image ? `<img class="hero" src="${esc(i.image)}" alt="">` : ''}<h2 class="serif" style="margin:10px 0 0">${esc(common)}</h2><p class="sci" style="margin:0 0 8px">${esc(sci || '')}</p>
    <p>${esc(i.extract || 'No summary found for this species.')}</p>${mine.length ? `<p class="hand" style="font-size:21px;color:var(--rust)">Heard ${mine.length}× · first on ${first}</p>` : ''}
    ${i.url ? `<p><a href="${esc(i.url)}" target="_blank" rel="noopener">Read more on Wikipedia</a></p>` : ''}`;
}
$('#sheetClose').onclick = () => $('#sheet').hidden = true; $('#sheet').onclick = (e) => { if (e.target.id === 'sheet') $('#sheet').hidden = true; };

/* ---------- place ---------- */
async function placeName(lat, lon) {
  try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=15&lat=${lat}&lon=${lon}`, { headers: { 'Accept-Language': 'en' } }); const j = await r.json(), a = j.address || {};
    const parts = [a.leisure || a.park || a.amenity, a.neighbourhood || a.suburb || a.village || a.hamlet, a.city || a.town || a.county || a.state_district].filter(Boolean);
    return [...new Set(parts)].slice(0, 2).join(', ') || (j.display_name || '').split(',').slice(0, 2).join(',').trim() || null; } catch (e) { return null; }
}
function getLocation() {
  return new Promise((res) => { if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(async (p) => { const l = { lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), place: null }; res(l); placeName(l.lat, l.lon).then(n => { l.place = n; renderMeta(); }); }, () => res(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }); });
}
function renderMeta() { $('#recMeta').textContent = loc ? ('📍 ' + (loc.place || `${loc.lat}, ${loc.lon}`)) : 'Location off: species suggestions are less accurate'; }

/* ---------- auth ---------- */
function authView() { $('#v-auth').innerHTML = `<div class="auth"><h1>Your field notebook</h1><p class="hand note">Listen. Name the bird. Keep the page.</p><div id="clerkAuth"></div></div>`; Clerk.mountSignIn($('#clerkAuth'), { routing: 'virtual' }); }

/* ---------- audio: mic ring buffer ---------- */
let actx = null;
function ensureCtx() { const AC = window.AudioContext || window.webkitAudioContext; if (!actx) actx = new AC(); if (actx.state === 'suspended') actx.resume(); return actx; }
const Mic = {
  on: false, chunks: [], total: 0, levels: [], maxSec: 30, t0: 0, sr: 0,
  async start(maxSec) {
    const ctx = ensureCtx(); this.sr = ctx.sampleRate;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    this.maxSec = maxSec; this.chunks = []; this.total = 0; this.levels = []; this.t0 = performance.now();
    this.src = ctx.createMediaStreamSource(this.stream); this.node = ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0), c = new Float32Array(d); this.chunks.push(c); this.total += c.length;
      let s = 0; for (let i = 0; i < c.length; i += 8) s += c[i] * c[i]; this.levels.push(Math.sqrt(s / (c.length / 8)));
      const cap = this.maxSec * this.sr; while (this.total - this.chunks[0].length >= cap) { this.total -= this.chunks.shift().length; this.levels.shift(); }
    };
    const mute = ctx.createGain(); mute.gain.value = 0; this.src.connect(this.node); this.node.connect(mute); mute.connect(ctx.destination);
    try { this.lock = await navigator.wakeLock?.request('screen'); } catch (e) {}
    this.on = true;
  },
  seconds() { return this.total / this.sr; },
  grab(sec) { const n = Math.min(this.total, Math.floor(sec * this.sr)), out = new Float32Array(n); let p = n; for (let i = this.chunks.length - 1; i >= 0 && p > 0; i--) { const c = this.chunks[i], k = Math.min(c.length, p); out.set(c.subarray(c.length - k), p - k); p -= k; } return out; },
  stop() { this.on = false; try { this.node.disconnect(); this.src.disconnect(); } catch (e) {} this.stream?.getTracks().forEach(t => t.stop()); try { this.lock?.release(); } catch (e) {} this.chunks = []; this.total = 0; }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && Mic.on && mode === 'catch') { /* keep listening; wake lock handles the screen */ } });

/* ---------- listen view ---------- */
const ICON_MIC = '<svg viewBox="0 0 24 24"><path d="M12 3a4 4 0 00-4 4v5a4 4 0 008 0V7a4 4 0 00-4-4zM5 11a7 7 0 0014 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_BIRD = '<svg viewBox="0 0 24 24"><path d="M3 9c3-1 5 0 7 2 1-3 4-5 8-4-1 1-1 2-1 3 1 6-4 11-10 10-2 0-4-1-5-2 3 0 5-1 6-3-2 0-4-1-5-3 1 0 2 0 3 0-1-1-2-2-3-3z" fill="currentColor"/></svg>';
const NOTES = {
  catch: ['Tap Start, then carry on. When a bird sings, tap “I heard it!” and the last 30 seconds are yours.', 'Stand still. Birds resume singing once they stop noticing you.', 'Face the sound. A cupped hand behind the ear helps your phone too.'],
  record: ['Tap Start, tap Stop. Up to a minute.', 'Hold the phone mic towards the sound, not at your chest.']
};
let noteI = 0;
function setMode(m) {
  if (Mic.on) return toast('Stop first, then switch');
  mode = m; document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  drawIdle(); updateStage();
}
function updateStage() {
  const b = $('#mainBtn'), on = Mic.on;
  b.classList.toggle('live', on); $('#scene').classList.toggle('listening', on);
  $('#mainIcon').innerHTML = on ? ICON_BIRD : ICON_MIC;
  $('#mainLbl').textContent = on ? (mode === 'catch' ? 'I heard it!' : 'Stop') : (mode === 'catch' ? 'Start listening' : 'Start recording');
  $('#stopLink').hidden = !(on && mode === 'catch');
  $('#tapeLbl').textContent = mode === 'catch' ? 'LAST 30 SECONDS' : 'THIS RECORDING';
  if (!on || $('#stageNote').textContent === '') { const n = NOTES[mode]; $('#stageNote').textContent = n[(noteI++) % n.length]; }
}
function drawIdle() { const cv = $('#tape'), g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--line'); for (let x = 4; x < cv.width; x += 10) g.fillRect(x, cv.height / 2 - 2, 5, 4); }
let tapeRaf = 0;
function tapeLoop() {
  cancelAnimationFrame(tapeRaf); const cv = $('#tape'), g = cv.getContext('2d'), W = cv.width, H = cv.height, N = 120;
  const css = getComputedStyle(document.documentElement), c1 = css.getPropertyValue('--moss').trim(), c2 = css.getPropertyValue('--rust').trim();
  const draw = () => {
    if (!Mic.on) return; g.clearRect(0, 0, W, H);
    const per = 4096 / Mic.sr, lv = Mic.levels, rec = mode === 'record', span = rec ? 60 : Mic.maxSec, colSec = span / N;
    for (let c = 0; c < N; c++) {
      let i0, i1;
      if (rec) { i0 = Math.floor(c * colSec / per); i1 = Math.floor((c + 1) * colSec / per) + 1; if (i0 >= lv.length) continue; }
      else { const eEnd = (N - 1 - c) * colSec, eStart = eEnd + colSec; i0 = lv.length - Math.ceil(eStart / per); i1 = lv.length - Math.floor(eEnd / per); if (i1 <= 0) continue; }
      let m = 0; for (let i = Math.max(0, i0); i < Math.min(lv.length, i1); i++) m = Math.max(m, lv[i] || 0);
      const v = Math.min(1, Math.sqrt(m) * 2.8), h = 3 + v * (H - 8); g.fillStyle = v > .45 ? c2 : c1; g.fillRect(c * (W / N) + 1, (H - h) / 2, W / N - 2.5, h);
    }
    const s = Mic.seconds(); $('#recMeta').textContent = (mode === 'catch' ? `buffer ${fmtT(Math.min(s, 30))} of 0:30` : `recording ${fmtT(s)} of ${fmtT(60)}`) + (loc ? ' · 📍 ' + (loc.place || 'located') : '');
    if (mode === 'record' && s >= 60) return mainAction();
    if (mode === 'catch' && (performance.now() - Mic.t0) > 20 * 60 * 1000) { stopMic(); toast('Stopped listening after 20 minutes'); return; }
    tapeRaf = requestAnimationFrame(draw);
  }; draw();
}
async function startMic() {
  try { await Mic.start(mode === 'catch' ? 30 : 60); } catch (e) { $('#stageNote').textContent = 'Microphone blocked. Allow it in your browser settings.'; return; }
  if (!loc) getLocation().then(l => { loc = l; renderMeta(); }); fetch(C.API_URL + '/').catch(() => {});
  $('#review').hidden = true; $('#review').innerHTML = ''; clip = null; updateStage(); tapeLoop();
}
function stopMic() { Mic.stop(); updateStage(); drawIdle(); renderMeta(); }
async function mainAction() {
  if (!Mic.on) return startMic();
  const secs = Mic.seconds(); if (secs < 1.5) return toast('Give it a couple of seconds first');
  const x = Mic.grab(mode === 'catch' ? 30 : 60), sr = Mic.sr; const keep = mode === 'catch';
  if (!keep) stopMic(); else { $('#stageNote').textContent = 'Got it. Still listening for the next one.'; }
  startReview(x, sr);
}
$('#mainBtn').onclick = mainAction; $('#stopLink').onclick = stopMic;
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));

/* ---------- DSP bridge (worker) ---------- */
let worker = null, wid = 0; const wait = {}; const cleanCache = new WeakMap();
function cleanAsync(x, sr) {
  if (cleanCache.has(x)) return cleanCache.get(x);
  const p = new Promise((res) => {
    try { worker = worker || new Worker('dsp-worker.js'); worker.onmessage = (e) => wait[e.data.id]?.(e.data.y); const id = ++wid; wait[id] = res; worker.postMessage({ id, x: x.slice(), sr }); }
    catch (err) { res(BirdDSP.clean(x, sr)); }
  });
  cleanCache.set(x, p); return p;
}
const LUT = (() => { const l = [], st = [[0, [14, 17, 12]], [.35, [40, 84, 52]], [.7, [196, 206, 104]], [1, [255, 244, 190]]]; for (let i = 0; i < 256; i++) { const t = i / 255; let k = 0; while (k < st.length - 2 && t > st[k + 1][0]) k++; const [a, A] = st[k], [b, B] = st[k + 1], f = Math.min(1, Math.max(0, (t - a) / (b - a))); l.push(A.map((v, j) => Math.round(v + (B[j] - v) * f))); } return l; })();
function drawSpec(cv, x, sr) {
  const S = BirdDSP.spectrogram(x, sr, 320, 80); cv.width = S.w; cv.height = S.h; const g = cv.getContext('2d'), im = g.createImageData(S.w, S.h);
  for (let r = 0; r < S.h; r++) for (let c = 0; c < S.w; c++) { const v = S.data[c * S.h + r], [R, G, B] = LUT[v], o = (r * S.w + c) * 4; im.data[o] = R; im.data[o + 1] = G; im.data[o + 2] = B; im.data[o + 3] = 255; }
  g.putImageData(im, 0, 0);
}
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>', ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>';
/* a player: spectrogram with playhead, Original/Cleaned toggle */
function mountPlayer(box, x, sr, o = {}) {
  box.innerHTML = `<div class="spec"><canvas></canvas><div class="ph"></div>${o.win ? '<div class="win"></div>' : ''}<span class="axis" style="top:2px">10 kHz</span><span class="axis" style="bottom:2px">0</span></div>
  <div class="player"><button class="play" aria-label="Play">${ICON_PLAY}</button><div class="grow"><div class="seg"><button data-v="orig" class="on">Original</button><button data-v="clean">Cleaned</button></div></div><div class="tm mono">0:00 / ${fmtT(x.length / sr)}</div></div>`;
  const cv = $('canvas', box), ph = $('.ph', box), spec = $('.spec', box), tt = $(".tm", box), btn = $('.play', box);
  let data = x, v = 'orig', src = null, startAt = 0, off = 0, raf = 0; const dur = () => data.length / sr;
  drawSpec(cv, x, sr);
  if (o.win) { const w = $('.win', box); w.style.left = (o.win[0] / (x.length / sr) * 100) + '%'; w.style.width = ((o.win[1] - o.win[0]) / (x.length / sr) * 100) + '%'; }
  const stop = () => { if (src) { src.onended = null; try { src.stop(); } catch (e) {} src = null; } cancelAnimationFrame(raf); btn.innerHTML = ICON_PLAY; };
  const pos = () => src ? off + (actx.currentTime - startAt) : off;
  const tick = () => { const p = Math.min(pos(), dur()); ph.style.left = (p / dur() * 100) + '%'; tt.textContent = fmtT(p) + ' / ' + fmtT(dur()); if (src) raf = requestAnimationFrame(tick); };
  const play = (from) => { stop(); const ctx = ensureCtx(); const buf = ctx.createBuffer(1, data.length, sr); buf.copyToChannel(data, 0); src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); off = Math.max(0, Math.min(from, dur() - .05)); startAt = ctx.currentTime; src.onended = () => { src = null; off = 0; btn.innerHTML = ICON_PLAY; cancelAnimationFrame(raf); ph.style.left = '0'; tt.textContent = '0:00 / ' + fmtT(dur()); }; src.start(0, off); btn.innerHTML = ICON_PAUSE; tick(); };
  btn.onclick = () => src ? (off = pos(), stop()) : play(off);
  spec.onclick = (e) => { const r = spec.getBoundingClientRect(); const t = (e.clientX - r.left) / r.width * dur(); play(t); };
  box.querySelectorAll('.seg button').forEach(b => b.onclick = async () => {
    if (b.dataset.v === v) return; const was = !!src, at = pos(); stop();
    box.querySelectorAll('.seg button').forEach(z => z.classList.toggle('on', z === b)); v = b.dataset.v;
    if (v === 'clean') { b.textContent = 'Cleaning…'; data = await cleanAsync(x, sr); b.textContent = 'Cleaned'; } else data = x;
    drawSpec(cv, data, sr); off = at; if (was) play(at);
  });
  return { destroy: stop };
}

/* ---------- review: the field sheet ---------- */
let revPlayer = null;
function startReview(x, sr) {
  revPlayer?.destroy(); habitat = null;
  const dur = x.length / sr, win = dur <= 20 ? [0, dur] : BirdDSP.bestWindow(x, sr, 20);
  clip = { x, sr, dur, win, at: new Date().toISOString(), loc: loc ? { ...loc } : null, dets: null };
  const box = $('#review'); box.hidden = false;
  box.innerHTML = `<div class="sheetpage"><div class="stamp">Field sheet · ${new Date().toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${fmtT(dur)}${loc?.place ? ' · ' + esc(loc.place) : ''}</div>
    <h2>Listen back</h2><p class="small" style="margin:0">Tap the picture to jump anywhere. “Cleaned” turns down hiss, wind and rumble so the call stands out.${dur > 20 ? ' The green box is the 20 s that gets saved.' : ''}</p><div id="pl"></div></div>
    <div id="ids"><div class="working">Asking BirdNET (first try after a pause can take a minute)</div></div>`;
  revPlayer = mountPlayer($('#pl'), x, sr, { win: dur > 20 ? win : null });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  identify();
}
function toWavBlob(x, sr, to) { return new Blob([BirdDSP.wav(BirdDSP.resample(x, sr, to), to)], { type: 'audio/wav' }); }
async function postPiece(x, sr) {
  const fd = new FormData(); fd.append('file', toWavBlob(x, sr, 32000), 'clip.wav'); fd.append('min_conf', '0.25'); if (clip.loc) { fd.append('lat', clip.loc.lat); fd.append('lon', clip.loc.lon); }
  const r = await fetch(C.API_URL + '/identify', { method: 'POST', body: fd }); return r.json();
}
async function detect(x, sr) {
  const best = {}, L = 30 * sr; let err = false;
  for (let p = 0; p < x.length; p += L) { if (x.length - p < 2 * sr && p > 0) break; const j = await postPiece(x.subarray(p, Math.min(x.length, p + L)), sr); if (j.error) { err = true; continue; } for (const d of j.detections) if (!best[d.scientific_name] || best[d.scientific_name].confidence < d.confidence) best[d.scientific_name] = d; }
  return { dets: Object.values(best).sort((a, b) => b.confidence - a.confidence), err };
}
async function identify() {
  const c = clip; let res;
  try { res = await detect(c.x, c.sr); if (!res.dets.length && !res.err) { $('#ids').innerHTML = '<div class="working">Nothing on the raw sound, trying the cleaned version</div>'; res = await detect(await cleanAsync(c.x, c.sr), c.sr); } }
  catch (e) { $('#ids').innerHTML = `<div class="empty">Could not reach the server. Try again in a moment.</div>`; return; }
  if (c !== clip) return;
  if (res.err && !res.dets.length) { $('#ids').innerHTML = `<div class="empty">Could not read that recording.</div>`; return; }
  c.dets = res.dets; renderIds();
}
function renderIds() {
  const c = clip, box = $('#ids'); if (!c) return;
  if (!c.dets.length) { box.innerHTML = `<div class="empty">No bird made it through. Replay it above: if you can hear one, try again closer, or wait for the next song.</div>`; return; }
  const min = profile?.min_confidence ?? 0.4; c.sel = c.sel || new Set(c.dets.filter(d => d.confidence >= min).map(d => d.scientific_name)); if (!c.sel.size) c.sel.add(c.dets[0].scientific_name);
  box.innerHTML = `<div class="id-head"><h3>Who sang</h3><span class="stamp">${c.dets.length} possible</span></div>`;
  c.dets.slice(0, 6).forEach(d => {
    const lit = Math.max(1, Math.round(d.confidence * 10));
    const n = el(`<div class="spc"><div class="polaroid"><i></i></div><div class="grow"><div class="name">${esc(d.common_name)}</div><div class="sci">${esc(d.scientific_name)}</div><div class="ticks">${Array.from({ length: 10 }, (_, i) => `<b class="${i < lit ? 'on' : ''}"></b>`).join('')}<span>${Math.round(d.confidence * 100)}%</span></div></div><label><input type="checkbox" ${c.sel.has(d.scientific_name) ? 'checked' : ''}>keep</label></div>`);
    fillThumb($('i', n), d.scientific_name, d.common_name); $('.grow', n).onclick = () => openSpecies(d.scientific_name, d.common_name);
    $('input', n).onchange = (e) => e.target.checked ? c.sel.add(d.scientific_name) : c.sel.delete(d.scientific_name); box.appendChild(n);
  });
  box.appendChild(el(`<div><p class="hand note" style="margin:10px 0 0;text-align:left">Where were you?</p><div class="chips" id="habChips">${HABITATS.map(([k, l]) => `<button class="chip ${habitat === k ? 'on' : ''}" data-h="${k}">${l}</button>`).join('')}</div></div>`));
  box.querySelectorAll('#habChips .chip').forEach(b => b.onclick = () => { habitat = habitat === b.dataset.h ? null : b.dataset.h; box.querySelectorAll('#habChips .chip').forEach(z => z.classList.toggle('on', z.dataset.h === habitat)); });
  const save = el('<button class="btn">Pin to my notebook</button>'); save.onclick = () => saveSighting(save); box.appendChild(save);
  const skip = el('<button class="btn ghost">Discard</button>'); skip.onclick = () => { revPlayer?.destroy(); clip = null; $('#review').hidden = true; $('#review').innerHTML = ''; }; box.appendChild(skip);
}
async function saveSighting(btn) {
  const c = clip; if (!c) return; if (DEMO) return toast('Demo mode: nothing is saved');
  btn.disabled = true; btn.textContent = 'Pinning…';
  const seg = c.x.subarray(Math.floor(c.win[0] * c.sr), Math.floor(c.win[1] * c.sr)), blob = toWavBlob(seg, c.sr, 24000), dur = +(seg.length / c.sr).toFixed(1);
  const path = `${user.id}/${Date.now()}.wav`; const up = await sb.storage.from('recordings').upload(path, blob, { contentType: 'audio/wav' });
  const audio_path = up.error ? null : path; if (up.error) toast('Audio not saved: ' + up.error.message);
  const rows = c.dets.filter(d => c.sel.has(d.scientific_name)).map(d => ({ user_id: user.id, source: 'phone', species_common: d.common_name, species_scientific: d.scientific_name, confidence: d.confidence, observed_at: c.at, lat: c.loc?.lat ?? null, lon: c.loc?.lon ?? null, place_name: c.loc?.place ?? loc?.place ?? null, habitat, audio_path, audio_duration_s: dur, alternatives: c.dets.filter(x => x.scientific_name !== d.scientific_name).slice(0, 4) }));
  const { error } = await sb.from('observations').insert(rows);
  if (error) { toast('Save failed: ' + error.message); btn.disabled = false; btn.textContent = 'Pin to my notebook'; return; }
  revPlayer?.destroy(); clip = null; $('#review').hidden = true; $('#review').innerHTML = ''; $('#stageNote').textContent = `Pinned ${rows.length} sighting${rows.length > 1 ? 's' : ''} to today's page.`;
  await loadObs(); toast('Saved to your notebook');
}

/* ---------- data ---------- */
async function loadObs() {
  if (DEMO) return; const { data, error } = await sb.from('observations').select('*').order('observed_at', { ascending: false }).limit(2000);
  if (error) { toast(error.message); return; } obs = data || []; renderCurrent();
}
const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function renderRecent() {
  const box = $('#recent'); if (!box) return; if (!obs.length) { box.innerHTML = ''; return; }
  const species = new Set(obs.map(o => o.species_common)).size, today = obs.filter(o => new Date(o.observed_at).toDateString() === new Date().toDateString());
  box.innerHTML = `<div class="stats"><div class="stat"><b>${species}</b><span>species on your checklist</span></div><div class="stat"><b>${today.length}</b><span>pinned today</span></div></div><div class="sec">Latest in the notebook</div>`;
  obs.slice(0, 3).forEach(o => { const n = el(`<div class="spc"><div class="polaroid"><i></i></div><div class="grow"><div class="name">${esc(o.species_common)}</div><div class="meta">${when(o.observed_at)}${o.place_name ? '<br>' + esc(o.place_name) : ''}</div></div></div>`); fillThumb($('i', n), o.species_scientific, o.species_common); n.onclick = () => openSpecies(o.species_scientific, o.species_common); box.appendChild(n); });
}
function renderCurrent() { renderRecent(); if (tab === 'log') renderLog(); if (tab === 'life') renderLife(); if (tab === 'map') renderMap(); }
let logPlayers = [];
async function renderLog() {
  logPlayers.forEach(p => p.destroy()); logPlayers = [];
  const q = $('#q').value.trim().toLowerCase(), box = $('#logList');
  const list = obs.filter(o => (!favOnly || o.favourite) && (!q || (o.species_common + ' ' + (o.place_name || '') + ' ' + (o.habitat || '')).toLowerCase().includes(q)));
  if (!list.length) { box.innerHTML = `<div class="empty">${obs.length ? 'Nothing matches.' : 'The first page is blank. Go and listen.'}</div>`; return; }
  box.innerHTML = ''; let lastDay = '';
  list.forEach(o => {
    const d = new Date(o.observed_at), dk = d.toDateString();
    if (dk !== lastDay) { lastDay = dk; const n = list.filter(z => new Date(z.observed_at).toDateString() === dk).length; box.appendChild(el(`<div class="day"><h4>${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}</h4><hr><span>${n} noted</span></div>`)); }
    const n = el(`<div class="entry"><div class="polaroid"><i></i></div><div class="grow"><div class="name">${esc(o.species_common)}</div><div class="sci">${esc(o.species_scientific || '')}</div>
      <div class="meta">${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${Math.round(o.confidence * 100)}%${o.place_name ? ' · ' + esc(o.place_name) : ''}${o.habitat ? ' · ' + esc(o.habitat) : ''}${o.source === 'device' ? ' · device' : ''}</div>
      <div class="row">${o.audio_path ? '<button class="mini pl">▶ Listen</button>' : ''}<button class="mini del">Delete</button></div><div class="inplayer"></div></div><button class="star ${o.favourite ? 'on' : ''}">★</button></div>`);
    fillThumb($('i', n), o.species_scientific, o.species_common); $('.polaroid', n).onclick = () => openSpecies(o.species_scientific, o.species_common);
    $('.star', n).onclick = async (e) => { o.favourite = !o.favourite; e.target.classList.toggle('on', o.favourite); await sb.from('observations').update({ favourite: o.favourite }).eq('id', o.id); };
    $('.del', n).onclick = async () => { if (!confirm('Delete this sighting and its recording?')) return; const others = obs.filter(x => x.audio_path === o.audio_path && x.id !== o.id).length; if (o.audio_path && !others) await sb.storage.from('recordings').remove([o.audio_path]); await sb.from('observations').delete().eq('id', o.id); await loadObs(); };
    const pb = $('.pl', n); if (pb) pb.onclick = async () => {
      const slot = $('.inplayer', n); if (slot.classList.contains('on')) { slot.classList.remove('on'); slot.innerHTML = ''; return; }
      pb.textContent = 'Loading…'; try {
        const { data } = await sb.storage.from('recordings').createSignedUrl(o.audio_path, 600); if (!data) throw 0;
        const ab = await (await fetch(data.signedUrl)).arrayBuffer(); const buf = await ensureCtx().decodeAudioData(ab);
        slot.classList.add('on'); logPlayers.push(mountPlayer(slot, buf.getChannelData(0).slice(), buf.sampleRate)); pb.textContent = '▶ Listen';
        $('.play', slot).click();
      } catch (e) { pb.textContent = '▶ Listen'; toast('Recording unavailable'); }
    };
    box.appendChild(n);
  });
}
async function renderLife() {
  const box = $('#lifeList'); const { data } = await sb.from('life_list').select('*').order('first_seen', { ascending: true }); const rows = data || [];
  if (!rows.length) { box.innerHTML = '<div class="empty">Nothing ticked yet. Every new species you pin lands here with the date.</div>'; return; }
  box.innerHTML = `<div class="life-hero"><div class="life-n">${rows.length}</div><p>species ticked off<br>on your life list</p></div>`;
  rows.forEach((r, i) => { const n = el(`<div class="chk"><span class="no">${String(i + 1).padStart(3, '0')}</span><span class="box">✓</span><div class="grow"><div class="name">${esc(r.species_common)}</div><div class="sci">${esc(r.species_scientific || '')} · ${r.sightings}×</div></div><span class="when">${new Date(r.first_seen).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span></div>`); n.onclick = () => openSpecies(r.species_scientific, r.species_common); box.appendChild(n); });
}
function renderMap() {
  const pts = obs.filter(o => o.lat != null && o.lon != null); $('#mapEmpty').textContent = pts.length ? '' : 'No located sightings yet. Allow location when you listen.';
  if (!map) { map = L.map('map', { zoomControl: true }).setView([20, 0], 2); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map); }
  setTimeout(() => map.invalidateSize(), 50); if (mapLayer) mapLayer.remove(); mapLayer = L.layerGroup().addTo(map); const b = [];
  pts.forEach(o => { L.circleMarker([o.lat, o.lon], { radius: 9, color: '#2a2820', weight: 2, fillColor: '#b4532c', fillOpacity: .9 }).addTo(mapLayer).bindPopup(`<b>${esc(o.species_common)}</b><br>${when(o.observed_at)}${o.place_name ? '<br>' + esc(o.place_name) : ''}`); b.push([o.lat, o.lon]); });
  if (b.length) map.fitBounds(b, { padding: [30, 30], maxZoom: 15 });
}
function exportCsv() {
  const cols = ['observed_at', 'species_common', 'species_scientific', 'confidence', 'place_name', 'habitat', 'lat', 'lon', 'source', 'favourite'], q = (v) => v == null ? '' : '"' + String(v).replace(/"/g, '""') + '"';
  const csv = [cols.join(','), ...obs.map(o => cols.map(c => q(o[c])).join(','))].join('\n'); const a = el(`<a download="bird-id-sightings.csv"></a>`); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- profile ---------- */
async function openProfile() {
  const { data: devs } = await sb.from('devices').select('*').order('created_at'), body = $('#sheetBody'), th = localStorage.getItem('birdid-theme') || 'auto';
  body.innerHTML = `<h2 class="serif">${esc(profile?.display_name || 'Profile')}</h2><p class="small">${esc(user.email || '')}</p>
    <p class="small" style="margin-top:14px">Pre-tick suggestions at or above <b id="mcv">${Math.round((profile?.min_confidence ?? .4) * 100)}%</b></p>
    <input id="mc" type="range" min="10" max="90" step="5" value="${Math.round((profile?.min_confidence ?? .4) * 100)}" style="width:100%">
    <input class="t" id="dn" value="${esc(profile?.display_name || '')}" placeholder="Display name">
    <p class="small" style="margin:12px 0 4px">Light</p><div class="seg" id="thm">${['auto', 'day', 'dusk', 'night'].map(k => `<button data-k="${k}" class="${th === k ? 'on' : ''}">${k}</button>`).join('')}</div>
    <button class="btn ghost" id="saveProf">Save profile</button>
    <div class="dev"><h3 class="serif" style="margin:0 0 6px">Field devices</h3><p class="small">For a 24/7 recorder that sends isolated bird-call clips. The key is shown once.</p>
    ${(devs || []).map(d => `<div class="row small" style="justify-content:space-between"><span>${esc(d.name)}${d.last_seen_at ? ' · seen ' + when(d.last_seen_at) : ''}</span><button class="mini del" data-d="${d.id}">Remove</button></div>`).join('')}
    <input class="t" id="dname" placeholder="Device name (e.g. Backyard mic)"><button class="btn ghost" id="addDev">Add device</button><div id="devOut"></div></div>
    <button class="btn ghost" id="signOut" style="margin-top:18px">Sign out</button>`;
  $('#sheet').hidden = false; $('#mc').oninput = (e) => $('#mcv').textContent = e.target.value + '%';
  $('#thm').querySelectorAll('button').forEach(b => b.onclick = () => { localStorage.setItem('birdid-theme', b.dataset.k); $('#thm').querySelectorAll('button').forEach(z => z.classList.toggle('on', z === b)); applyTod(); });
  $('#saveProf').onclick = async () => { const { data } = await sb.from('profiles').update({ display_name: $('#dn').value.trim() || null, min_confidence: $('#mc').value / 100 }).eq('id', user.id).select().single(); if (data) { profile = data; setAvatar(); applyTod(); toast('Profile saved'); } };
  body.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { await sb.from('devices').delete().eq('id', b.dataset.d); openProfile(); });
  $('#addDev').onclick = async () => {
    const name = $('#dname').value.trim() || 'My device', key = 'bd_' + [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const { error } = await sb.from('devices').insert({ user_id: user.id, name, key_hash: hash }); if (error) return toast(error.message);
    $('#devOut').innerHTML = `<p class="small">Device key (copy now, it will not be shown again):</p><code>${key}</code><p class="small">POST clips to <code>${esc(C.API_URL)}/ingest</code> with form fields <code>file</code>, <code>device_key</code>, <code>isolated=true</code>, <code>isolation_score</code>, optional <code>lat</code>, <code>lon</code>, <code>place_name</code>, <code>habitat</code>.</p>`;
  };
  $('#signOut').onclick = async () => { $('#sheet').hidden = true; await Clerk.signOut(); };
}
function setAvatar() { const a = $('#avatarBtn'), n = (profile?.display_name || user?.email || '?').trim(); a.textContent = profile?.avatar_url ? '' : n[0].toUpperCase(); a.style.backgroundImage = profile?.avatar_url ? `url("${profile.avatar_url}")` : ''; }

/* ---------- shell ---------- */
function show(t) {
  tab = t; document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); renderCurrent(); if (t !== 'listen') window.scrollTo(0, 0);
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));
$('#avatarBtn').onclick = () => user && openProfile(); $('#q').oninput = renderLog; $('#exportBtn').onclick = exportCsv;
$('#favFilter').onclick = (e) => { favOnly = !favOnly; e.target.setAttribute('aria-pressed', favOnly); renderLog(); };

async function onClerkUser(cu) {
  user = cu ? { id: cu.id, email: cu.primaryEmailAddress?.emailAddress || '' } : null;
  $('#tabs').style.display = user ? '' : 'none'; $('#avatarBtn').style.display = user ? '' : 'none';
  if (!user) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-auth')); authView(); return; }
  let { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!data) { const dn = cu.fullName || (user.email ? user.email.split('@')[0] : null); const ins = await sb.from('profiles').insert({ id: user.id, display_name: dn }).select().single(); data = ins.data; }
  profile = data; setAvatar(); applyTod(); show(tab === 'auth' ? 'listen' : tab); getLocation().then(l => { loc = l; renderMeta(); }); loadObs();
}
applyTod(); setInterval(() => { if (!Mic.on) applyTod(); }, 10 * 60 * 1000); drawIdle(); updateStage(); renderMeta();
if (DEMO) {
  user = { id: 'demo', email: 'demo@example.com' }; profile = { display_name: 'Chanakya', min_confidence: .4 }; setAvatar(); applyTod(); show('listen');
  const mk = (sp, sc, c, h, pl, hab) => ({ id: sp + h, species_common: sp, species_scientific: sc, confidence: c, observed_at: new Date(Date.now() - h * 3600e3).toISOString(), place_name: pl, habitat: hab, audio_path: 'x', lat: 17.4, lon: 78.4, favourite: h === 2 });
  obs = [mk('Eurasian Blackbird', 'Turdus merula', .94, 1, 'Lake Park, Hyderabad', 'park'), mk('Oriental Magpie-Robin', 'Copsychus saularis', .88, 2, 'Lake Park, Hyderabad', 'garden'), mk('Common Tailorbird', 'Orthotomus sutorius', .71, 30, 'Banjara Hills', 'urban')]; renderCurrent();
  window.__demo = (secs) => { const sr = 32000, n = sr * secs, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = (Math.random() - .5) * .03; for (const t of [3, 7.5, 12, 15.2]) for (let k = 0; k < 0.5 * sr; k++) { const f = 3000 + 2500 * Math.sin(k / sr * 18 + t) + 1800 * (k / sr); x[Math.floor(t * sr) + k] += .35 * Math.sin(2 * Math.PI * f * k / sr) * Math.sin(Math.PI * k / (.5 * sr)); } startReview(x, sr); clip.dets = [{ common_name: 'Eurasian Blackbird', scientific_name: 'Turdus merula', confidence: .93 }, { common_name: 'European Robin', scientific_name: 'Erithacus rubecula', confidence: .52 }]; renderIds(); };
} else (async () => {
  while (!window.Clerk) await new Promise(r => setTimeout(r, 60)); await Clerk.load(); Clerk.addListener(({ user: cu }) => { onClerkUser(cu); }); onClerkUser(Clerk.user);
})();
})();
