(() => {
const C = window.BIRDID;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
const $ = (s, r = document) => r.querySelector(s);
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HABITATS = [['garden','Garden'],['park','Park'],['forest','Forest'],['water','Water'],['urban','Urban'],['farm','Farm']];
let user = null, profile = null, obs = [], tab = 'record', loc = null, habitat = null, lastClip = null, favOnly = false, map = null, mapLayer = null;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800); }

/* ---------- species info (Wikipedia) ---------- */
const infoCache = {};
async function speciesInfo(sci, common) {
  const key = sci || common;
  if (infoCache[key]) return infoCache[key];
  const tryTitle = async (t) => {
    const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_')) + '?redirect=true');
    if (!r.ok) return null; const j = await r.json(); return j.type === 'standard' ? j : null;
  };
  let j = null;
  try { j = (sci && await tryTitle(sci)) || (common && await tryTitle(common)); } catch (e) {}
  const out = j ? { thumb: j.thumbnail?.source, image: j.originalimage?.source || j.thumbnail?.source, extract: j.extract, url: j.content_urls?.desktop?.page } : {};
  infoCache[key] = out; return out;
}
async function fillThumb(node, sci, common) { const i = await speciesInfo(sci, common); if (i.thumb) node.style.backgroundImage = `url("${i.thumb}")`; }
async function openSpecies(sci, common) {
  const body = $('#sheetBody'); body.innerHTML = `<h2 class="serif">${esc(common)}</h2><p class="sci">${esc(sci || '')}</p><p class="small">Loading…</p>`;
  $('#sheet').hidden = false;
  const i = await speciesInfo(sci, common);
  const mine = obs.filter(o => o.species_common === common);
  const first = mine.length ? new Date(Math.min(...mine.map(o => +new Date(o.observed_at)))).toLocaleDateString() : null;
  body.innerHTML = `${i.image ? `<img class="hero" src="${esc(i.image)}" alt="">` : ''}<h2 class="serif" style="margin:4px 0">${esc(common)}</h2><p class="sci">${esc(sci || '')}</p>
    <p>${esc(i.extract || 'No Wikipedia summary found for this species.')}</p>
    ${mine.length ? `<p class="small">Your sightings: ${mine.length} · first ${first}</p>` : ''}
    ${i.url ? `<p><a href="${esc(i.url)}" target="_blank" rel="noopener">Read more on Wikipedia</a></p>` : ''}`;
}
$('#sheetClose').onclick = () => $('#sheet').hidden = true;
$('#sheet').onclick = (e) => { if (e.target.id === 'sheet') $('#sheet').hidden = true; };

/* ---------- place ---------- */
async function placeName(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=15&lat=${lat}&lon=${lon}`, { headers: { 'Accept-Language': 'en' } });
    const j = await r.json(); const a = j.address || {};
    const parts = [a.leisure || a.park || a.amenity, a.neighbourhood || a.suburb || a.village || a.hamlet, a.city || a.town || a.county || a.state_district].filter(Boolean);
    return [...new Set(parts)].slice(0, 2).join(', ') || (j.display_name || '').split(',').slice(0, 2).join(',').trim() || null;
  } catch (e) { return null; }
}
function getLocation() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(async (p) => {
      const l = { lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), place: null };
      res(l); placeName(l.lat, l.lon).then(n => { l.place = n; renderMeta(); });
    }, () => res(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });
  });
}
function renderMeta() { $('#recMeta').textContent = loc ? ('📍 ' + (loc.place || `${loc.lat}, ${loc.lon}`)) : 'Location off: species suggestions are less accurate'; }

/* ---------- auth ---------- */
function authView() {
  const v = $('#v-auth');
  const dev = location.hash === '#dev';
  v.innerHTML = `<div class="auth"><div style="font-size:54px">🐦</div><h1>Bird ID</h1><p class="hint">Record a birdsong, get a name, build your life list.</p>
    <div id="authForm"><input class="t" id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com">
    <button class="btn" id="sendLink">Email me a sign-in link</button></div><p class="small" id="authMsg"></p>
    ${dev ? `<div class="dev"><input class="t" id="dpw" type="password" placeholder="dev password"><button class="btn ghost" id="devIn">Dev sign in</button></div>` : ''}</div>`;
  $('#sendLink').onclick = async () => {
    const email = $('#email').value.trim(); if (!email) return;
    $('#sendLink').disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $('#sendLink').disabled = false;
    if (error) { $('#authMsg').textContent = error.message.includes('rate') ? 'Too many emails right now. Wait a few minutes and try again.' : error.message; return; }
    $('#authForm').innerHTML = `<p>Check your email for the sign-in link and tap it. It opens the app signed in.</p><button class="btn ghost" id="again">Use a different email</button>`;
    $('#again').onclick = authView;
  };
  if (dev) $('#devIn').onclick = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#dpw').value });
    if (error) $('#authMsg').textContent = error.message;
  };
}

/* ---------- recording ---------- */
let recording = false;
async function startRecording() {
  if (recording) return; 
  $('#result').innerHTML = ''; habitat = null; lastClip = null;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
  catch (e) { $('#recStatus').textContent = 'Microphone blocked. Allow it in your browser settings.'; return; }
  recording = true;
  if (!loc) loc = await getLocation(); renderMeta();
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''].find(m => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)));
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
  const chunks = []; mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); const an = ac.createAnalyser(); an.fftSize = 256;
  ac.createMediaStreamSource(stream).connect(an);
  const btn = $('#recBtn'), cv = $('#wave'), g = cv.getContext('2d'), data = new Uint8Array(an.frequencyBinCount);
  btn.classList.add('live'); const t0 = performance.now(); const DUR = 10000;
  let raf; const draw = () => {
    const t = performance.now() - t0, left = Math.max(0, Math.ceil((DUR - t) / 1000));
    $('#recLabel').textContent = left + 's'; $('#recStatus').textContent = 'Listening…';
    an.getByteFrequencyData(data); const W = cv.width, c = W / 2; g.clearRect(0, 0, W, W);
    const n = 48, R = W * 0.34;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2, v = data[Math.floor(i / n * data.length * 0.7)] / 255, len = 14 + v * 70;
      g.strokeStyle = 'rgba(255,255,255,' + (0.35 + v * 0.6) + ')'; g.lineWidth = 8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R); g.lineTo(c + Math.cos(a) * (R + len), c + Math.sin(a) * (R + len)); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 6; g.beginPath(); g.arc(c, c, W * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.min(1, t / DUR) * Math.PI * 2); g.stroke();
    raf = requestAnimationFrame(draw);
  }; draw();
  const done = new Promise(r => mr.onstop = r);
  mr.start(); setTimeout(() => mr.state !== 'inactive' && mr.stop(), DUR); await done;
  cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); ac.close().catch(() => {});
  g.clearRect(0, 0, cv.width, cv.height); btn.classList.remove('live'); $('#recLabel').textContent = 'Record'; recording = false;
  const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
  await identify(blob);
}
async function identify(blob) {
  $('#recStatus').textContent = 'Identifying… (first try after a pause can take up to a minute)';
  const fd = new FormData(); const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  fd.append('file', blob, 'clip.' + ext); fd.append('min_conf', '0.25');
  if (loc) { fd.append('lat', loc.lat); fd.append('lon', loc.lon); }
  let j;
  try { const r = await fetch(C.API_URL + '/identify', { method: 'POST', body: fd }); j = await r.json(); }
  catch (e) { $('#recStatus').textContent = 'Could not reach the server. Try again in a moment.'; return; }
  if (j.error) { $('#recStatus').textContent = 'Could not read that recording. Try again.'; return; }
  lastClip = { blob, ext, dets: j.detections, at: new Date().toISOString(), loc: loc ? { ...loc } : null };
  $('#recStatus').textContent = j.detections.length ? '' : 'No bird heard. Move closer and try again.';
  renderResult();
}
function renderResult() {
  const c = lastClip, box = $('#result'); if (!c || !c.dets.length) { box.innerHTML = ''; return; }
  const min = profile?.min_confidence ?? 0.4;
  c.sel = c.sel || new Set(c.dets.filter(d => d.confidence >= min).map(d => d.scientific_name));
  if (!c.sel.size) c.sel.add(c.dets[0].scientific_name);
  box.innerHTML = '';
  c.dets.slice(0, 6).forEach(d => {
    const n = el(`<div class="card"><div class="thumb"></div><div class="grow"><div class="name">${esc(d.common_name)}</div><div class="sci">${esc(d.scientific_name)}</div><div class="bar"><b style="width:${Math.round(d.confidence * 100)}%"></b></div></div><div><div class="pct">${Math.round(d.confidence * 100)}%</div><label class="small"><input type="checkbox" ${c.sel.has(d.scientific_name) ? 'checked' : ''}> save</label></div></div>`);
    fillThumb($('.thumb', n), d.scientific_name, d.common_name);
    $('.grow', n).onclick = () => openSpecies(d.scientific_name, d.common_name);
    $('input', n).onchange = (e) => e.target.checked ? c.sel.add(d.scientific_name) : c.sel.delete(d.scientific_name);
    box.appendChild(n);
  });
  box.appendChild(el(`<div><p class="small" style="margin:14px 0 0">Where was this?</p><div class="chips" id="habChips">${HABITATS.map(([k, l]) => `<button class="chip ${habitat === k ? 'on' : ''}" data-h="${k}">${l}</button>`).join('')}</div></div>`));
  box.querySelectorAll('#habChips .chip').forEach(b => b.onclick = () => { habitat = habitat === b.dataset.h ? null : b.dataset.h; renderResult(); });
  const save = el('<button class="btn">Save sighting</button>'); save.onclick = () => saveSighting(save);
  box.appendChild(save);
  const skip = el('<button class="btn ghost">Discard</button>'); skip.onclick = () => { lastClip = null; box.innerHTML = ''; };
  box.appendChild(skip);
}
async function saveSighting(btn) {
  const c = lastClip; if (!c) return; btn.disabled = true; btn.textContent = 'Saving…';
  const path = `${user.id}/${Date.now()}.${c.ext}`;
  const up = await sb.storage.from('recordings').upload(path, c.blob, { contentType: c.blob.type || 'audio/webm' });
  const audio_path = up.error ? null : path;
  if (up.error) toast('Audio not saved: ' + up.error.message);
  const rows = c.dets.filter(d => c.sel.has(d.scientific_name)).map(d => ({
    user_id: user.id, source: 'phone', species_common: d.common_name, species_scientific: d.scientific_name, confidence: d.confidence,
    observed_at: c.at, lat: c.loc?.lat ?? null, lon: c.loc?.lon ?? null, place_name: c.loc?.place ?? loc?.place ?? null, habitat, audio_path, audio_duration_s: 10,
    alternatives: c.dets.filter(x => x.scientific_name !== d.scientific_name).slice(0, 4)
  }));
  const { error } = await sb.from('observations').insert(rows);
  if (error) { toast('Save failed: ' + error.message); btn.disabled = false; btn.textContent = 'Save sighting'; return; }
  lastClip = null; $('#result').innerHTML = ''; $('#recStatus').textContent = `Saved ${rows.length} sighting${rows.length > 1 ? 's' : ''}.`;
  await loadObs(); toast('Saved to your log');
}

/* ---------- data ---------- */
async function loadObs() {
  const { data, error } = await sb.from('observations').select('*').order('observed_at', { ascending: false }).limit(2000);
  if (error) { toast(error.message); return; } obs = data || []; renderCurrent();
}
function renderRecent() {
  const box = $('#recent'); if (!box) return;
  if (!obs.length) { box.innerHTML = ''; return; }
  const species = new Set(obs.map(o => o.species_common)).size;
  box.innerHTML = `<div class="stats"><div class="stat"><b>${species}</b><span>species on your life list</span></div><div class="stat"><b>${obs.length}</b><span>sightings logged</span></div></div><div class="sec"><span>Recently heard</span></div>`;
  obs.slice(0, 3).forEach(o => {
    const n = el(`<div class="card"><div class="thumb"></div><div class="grow"><div class="name">${esc(o.species_common)}</div><div class="small">${when(o.observed_at)}${o.place_name ? ' · ' + esc(o.place_name) : ''}</div></div><div class="pct">${Math.round(o.confidence * 100)}%</div></div>`);
    fillThumb($('.thumb', n), o.species_scientific, o.species_common); n.onclick = () => openSpecies(o.species_scientific, o.species_common); box.appendChild(n);
  });
}
function renderCurrent() { renderRecent(); if (tab === 'log') renderLog(); if (tab === 'life') renderLife(); if (tab === 'map') renderMap(); }
function when(t) { return new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
async function renderLog() {
  const q = $('#q').value.trim().toLowerCase(); const box = $('#logList');
  const list = obs.filter(o => (!favOnly || o.favourite) && (!q || (o.species_common + ' ' + (o.place_name || '') + ' ' + (o.habitat || '')).toLowerCase().includes(q)));
  if (!list.length) { box.innerHTML = `<div class="empty">${obs.length ? 'Nothing matches.' : 'No sightings yet. Record your first bird.'}</div>`; return; }
  box.innerHTML = '';
  list.forEach(o => {
    const n = el(`<div class="card" style="align-items:flex-start"><div class="thumb"></div><div class="grow"><div class="name">${esc(o.species_common)} <span class="pct">${Math.round(o.confidence * 100)}%</span></div>
      <div class="small">${when(o.observed_at)}${o.place_name ? ' · ' + esc(o.place_name) : ''}${o.habitat ? ' · ' + esc(o.habitat) : ''}${o.source === 'device' ? ' · device' : ''}</div>
      <div class="audioslot"></div>
      <div class="row" style="margin-top:4px"><button class="del">Delete</button></div></div><button class="star ${o.favourite ? 'on' : ''}">★</button></div>`);
    fillThumb($('.thumb', n), o.species_scientific, o.species_common);
    $('.thumb', n).onclick = () => openSpecies(o.species_scientific, o.species_common);
    $('.star', n).onclick = async (e) => { o.favourite = !o.favourite; e.target.classList.toggle('on', o.favourite); await sb.from('observations').update({ favourite: o.favourite }).eq('id', o.id); };
    $('.del', n).onclick = async () => {
      if (!confirm('Delete this sighting and its recording?')) return;
      const others = obs.filter(x => x.audio_path === o.audio_path && x.id !== o.id).length;
      if (o.audio_path && !others) await sb.storage.from('recordings').remove([o.audio_path]);
      await sb.from('observations').delete().eq('id', o.id); await loadObs();
    };
    if (o.audio_path) {
      const b = el('<button class="chip" style="margin-top:6px">▶ Play recording</button>');
      b.onclick = async () => { const { data } = await sb.storage.from('recordings').createSignedUrl(o.audio_path, 600); if (!data) return toast('Recording unavailable'); const a = el(`<audio controls autoplay src="${data.signedUrl}"></audio>`); b.replaceWith(a); };
      $('.audioslot', n).appendChild(b);
    }
    box.appendChild(n);
  });
}
async function renderLife() {
  const box = $('#lifeList'); const { data } = await sb.from('life_list').select('*').order('first_seen', { ascending: false });
  const rows = data || [];
  if (!rows.length) { box.innerHTML = '<div class="empty">Your life list is empty. Every new species you save lands here.</div>'; return; }
  box.innerHTML = `<div class="life-n">${rows.length}</div><p class="small" style="margin:2px 2px 8px">species on your life list</p>`;
  rows.forEach(r => {
    const n = el(`<div class="card"><div class="thumb"></div><div class="grow"><div class="name">${esc(r.species_common)}</div><div class="sci">${esc(r.species_scientific || '')}</div><div class="small">First seen ${new Date(r.first_seen).toLocaleDateString()} · ${r.sightings}×</div></div><div class="pct">${Math.round(r.best_confidence * 100)}%</div></div>`);
    fillThumb($('.thumb', n), r.species_scientific, r.species_common); n.onclick = () => openSpecies(r.species_scientific, r.species_common); box.appendChild(n);
  });
}
function renderMap() {
  const pts = obs.filter(o => o.lat != null && o.lon != null);
  $('#mapEmpty').textContent = pts.length ? '' : 'No located sightings yet. Allow location when recording.';
  if (!map) { map = L.map('map', { zoomControl: true }).setView([20, 0], 2); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map); }
  setTimeout(() => map.invalidateSize(), 50);
  if (mapLayer) mapLayer.remove(); mapLayer = L.layerGroup().addTo(map);
  const b = [];
  pts.forEach(o => { const m = L.circleMarker([o.lat, o.lon], { radius: 9, color: '#44683c', weight: 2, fillColor: '#c2603a', fillOpacity: .85 }).addTo(mapLayer);
    m.bindPopup(`<b>${esc(o.species_common)}</b><br>${when(o.observed_at)}${o.place_name ? '<br>' + esc(o.place_name) : ''}`); b.push([o.lat, o.lon]); });
  if (b.length) map.fitBounds(b, { padding: [30, 30], maxZoom: 15 });
}
function exportCsv() {
  const cols = ['observed_at', 'species_common', 'species_scientific', 'confidence', 'place_name', 'habitat', 'lat', 'lon', 'source', 'favourite'];
  const q = (v) => v == null ? '' : '"' + String(v).replace(/"/g, '""') + '"';
  const csv = [cols.join(','), ...obs.map(o => cols.map(c => q(o[c])).join(','))].join('\n');
  const a = el(`<a download="bird-id-sightings.csv"></a>`); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- profile ---------- */
async function openProfile() {
  const { data: devs } = await sb.from('devices').select('*').order('created_at');
  const body = $('#sheetBody');
  body.innerHTML = `<h2 class="serif">${esc(profile?.display_name || 'Profile')}</h2><p class="small">${esc(user.email || '')}</p>
    <p class="small" style="margin-top:14px">Save suggestions at or above <b id="mcv">${Math.round((profile?.min_confidence ?? .4) * 100)}%</b></p>
    <input id="mc" type="range" min="10" max="90" step="5" value="${Math.round((profile?.min_confidence ?? .4) * 100)}" style="width:100%">
    <input class="t" id="dn" value="${esc(profile?.display_name || '')}" placeholder="Display name">
    <button class="btn ghost" id="saveProf">Save profile</button>
    <div class="dev"><h3 class="serif" style="margin:0 0 6px">Field devices</h3><p class="small">For a 24/7 recorder that sends isolated bird-call clips. The key is shown once.</p>
    ${(devs || []).map(d => `<div class="row small" style="justify-content:space-between"><span>${esc(d.name)}${d.last_seen_at ? ' · seen ' + when(d.last_seen_at) : ''}</span><button class="del" data-d="${d.id}">Remove</button></div>`).join('')}
    <input class="t" id="dname" placeholder="Device name (e.g. Backyard mic)"><button class="btn ghost" id="addDev">Add device</button><div id="devOut"></div></div>
    <button class="btn ghost" id="signOut" style="margin-top:18px">Sign out</button>`;
  $('#sheet').hidden = false;
  $('#mc').oninput = (e) => $('#mcv').textContent = e.target.value + '%';
  $('#saveProf').onclick = async () => { const { data } = await sb.from('profiles').update({ display_name: $('#dn').value.trim() || null, min_confidence: $('#mc').value / 100 }).eq('id', user.id).select().single(); if (data) { profile = data; setAvatar(); toast('Profile saved'); } };
  body.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { await sb.from('devices').delete().eq('id', b.dataset.d); openProfile(); });
  $('#addDev').onclick = async () => {
    const name = $('#dname').value.trim() || 'My device'; const key = 'bd_' + [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const { error } = await sb.from('devices').insert({ user_id: user.id, name, key_hash: hash }); if (error) return toast(error.message);
    $('#devOut').innerHTML = `<p class="small">Device key (copy now, it will not be shown again):</p><code>${key}</code><p class="small">POST clips to <code>${esc(C.API_URL)}/ingest</code> with form fields <code>file</code>, <code>device_key</code>, <code>isolated=true</code>, <code>isolation_score</code>, optional <code>lat</code>, <code>lon</code>, <code>place_name</code>, <code>habitat</code>.</p>`;
  };
  $('#signOut').onclick = async () => { $('#sheet').hidden = true; await sb.auth.signOut(); };
}
function setAvatar() { const a = $('#avatarBtn'); const n = (profile?.display_name || user?.email || '?').trim(); a.textContent = profile?.avatar_url ? '' : n[0].toUpperCase(); a.style.backgroundImage = profile?.avatar_url ? `url("${profile.avatar_url}")` : ''; }

/* ---------- shell ---------- */
function show(t) {
  tab = t; document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); renderCurrent();
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));
$('#recBtn').onclick = startRecording; $('#avatarBtn').onclick = () => user && openProfile();
$('#q').oninput = renderLog; $('#exportBtn').onclick = exportCsv;
$('#favFilter').onclick = (e) => { favOnly = !favOnly; e.target.setAttribute('aria-pressed', favOnly); renderLog(); };

async function onSession(session) {
  user = session?.user || null;
  $('#tabs').style.display = user ? '' : 'none'; $('#avatarBtn').style.display = user ? '' : 'none';
  if (!user) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-auth')); authView(); return; }
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle(); profile = data; setAvatar();
  show(tab === 'auth' ? 'record' : tab); getLocation().then(l => { loc = l; renderMeta(); }); loadObs();
}
sb.auth.onAuthStateChange((ev, s) => { if (ev === 'INITIAL_SESSION' || ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(() => onSession(s), 0); });
renderMeta();
})();
