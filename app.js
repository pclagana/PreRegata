/* Pre-Regata — previsioni multi-modello, sinottica, percorso, vele, tattica */
'use strict';

/* ---------------------------------------------------------- utilità */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = x => Math.round(x * 10) / 10;
const norm360 = d => ((d % 360) + 360) % 360;
const angDiff = (a, b) => { let d = norm360(b - a); if (d > 180) d -= 360; return d; }; // b - a in [-180,180]
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const card = d => COMPASS[Math.round(norm360(d) / 22.5) % 16];

function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

/* ---------------------------------------------------------- stato */
const EXAMPLE_BOAT = {
  id: 'esempio', name: 'Barca d\'esempio (ORC ~50 piedi)', example: true, upAngle: 40, downAngle: 150,
  speeds: { bolina: 7.8, traverso: 9.5, lasco: 10.5, poppa: 9.0 },
  sails: [
    { name: 'J1', twaMin: 28, twaMax: 60, twsMin: 0, twsMax: 12 },
    { name: 'J2', twaMin: 28, twaMax: 60, twsMin: 10, twsMax: 18 },
    { name: 'J3', twaMin: 28, twaMax: 65, twsMin: 16, twsMax: 25 },
    { name: 'J4', twaMin: 28, twaMax: 70, twsMin: 23, twsMax: 40 },
    { name: 'Code 0', twaMin: 55, twaMax: 100, twsMin: 0, twsMax: 15 },
    { name: 'A3', twaMin: 80, twaMax: 130, twsMin: 6, twsMax: 20 },
    { name: 'A2', twaMin: 95, twaMax: 165, twsMin: 0, twsMax: 18 },
    { name: 'A4', twaMin: 115, twaMax: 175, twsMin: 16, twsMax: 30 },
    { name: 'J2 + randa', twaMin: 60, twaMax: 110, twsMin: 15, twsMax: 40 },
    { name: 'J4 di poppa', twaMin: 130, twaMax: 180, twsMin: 28, twsMax: 50 }
  ]
};

const S = Object.assign({
  loc: null,          // {lat, lon, name}
  ctx: 'costiero',
  range: 72,
  shown: null,        // modelli mostrati sul grafico
  boats: [EXAMPLE_BOAT],
  boatId: 'esempio',
  route: { start: '', notes: '', wps: [] },
  apiKey: '', aiModel: 'claude-sonnet-5-5'
}, load('prg_state', {}));
const save = () => store('prg_state', S);

let W = load('prg_wx', null);     // ultima previsione elaborata
let SYN = null;                    // carta sinottica
let LEGS = null;                   // lati calcolati
let synImgs = [];                  // carte ufficiali caricate

/* ---------------------------------------------------------- modelli */
// res = risoluzione km, skill = bonus di affidabilità generale
const MODELS = [
  { id: 'meteoswiss_icon_ch1', name: 'ICON-CH1', src: 'MeteoSwiss', res: 1 },
  { id: 'meteoswiss_icon_ch2', name: 'ICON-CH2', src: 'MeteoSwiss', res: 2.1 },
  { id: 'arome_france_hd', name: 'AROME HD', src: 'Météo-France', res: 1.5 },
  { id: 'arome_france', name: 'AROME', src: 'Météo-France', res: 2.5 },
  { id: 'italia_meteo_arpae_icon_2i', name: 'ICON-2I', src: 'ItaliaMeteo', res: 2.2 },
  { id: 'icon_d2', name: 'ICON-D2', src: 'DWD', res: 2.2 },
  { id: 'geosphere_arome_austria', name: 'AROME AT', src: 'GeoSphere', res: 2.5 },
  { id: 'dmi_harmonie_arome_europe', name: 'HARMONIE DMI', src: 'DMI', res: 2 },
  { id: 'knmi_harmonie_arome_europe', name: 'HARMONIE KNMI', src: 'KNMI', res: 5.5 },
  { id: 'icon_eu', name: 'ICON-EU', src: 'DWD', res: 7 },
  { id: 'ukmo_global_deterministic_10km', name: 'UKMO Global', src: 'Met Office', res: 10 },
  { id: 'arpege_europe', name: 'ARPEGE', src: 'Météo-France', res: 11 },
  { id: 'icon_global', name: 'ICON Global', src: 'DWD', res: 13 },
  { id: 'gem_global', name: 'GEM', src: 'Env. Canada', res: 15, skill: 0.8 },
  { id: 'ecmwf_ifs', name: 'ECMWF IFS', src: 'ECMWF', res: 9, skill: 1.45, global: true },
  { id: 'ecmwf_aifs025_single', name: 'ECMWF AIFS', src: 'ECMWF', res: 25, skill: 1.3 },
  { id: 'gfs_global', name: 'GFS', src: 'NOAA', res: 25, skill: 0.85 }
];
const MBYID = Object.fromEntries(MODELS.map(m => [m.id, m]));
const kind = m => m.global ? 'glob' : m.res <= 3 ? 'hr' : m.res <= 12 ? 'reg' : 'glob';

/** Peso di un modello per tipo di campo e anticipo (ore). */
function modelWeight(m, ctx, lead) {
  const k = kind(m);
  const ctxF = {
    lago: { hr: 3.0, reg: 1.4, glob: 0.5 },
    costiero: { hr: 2.2, reg: 1.5, glob: 0.9 },
    offshore: { hr: 1.0, reg: 1.3, glob: 1.5 }
  }[ctx][k];
  let leadF = 1;
  if (lead > 48 && k === 'hr') leadF = 0.6;
  if (lead > 72 && k === 'reg') leadF = 0.8;
  if (lead > 96 && k === 'glob') leadF = 1.1;
  return (m.skill || 1) * ctxF * leadF;
}

/* ---------------------------------------------------------- rete */
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) { let t = ''; try { t = (await r.json()).reason; } catch (e) { } throw new Error(t || ('HTTP ' + r.status)); }
  return r.json();
}
const OM = 'https://api.open-meteo.com/v1/forecast';
const VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl'];

/** Scarica tutti i modelli per un punto. Ritorna {times(epoch ms), tz, series:{modelId:{spd,dir,gst,p}}} */
async function fetchModels(lat, lon, models) {
  const base = `${OM}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${VARS.join(',')}` +
    `&wind_speed_unit=kn&timezone=auto&forecast_days=7&past_hours=3`;
  const pack = (j, ids) => {
    const off = j.utc_offset_seconds * 1000;
    const times = j.hourly.time.map(t => Date.parse(t + 'Z') - off);
    const series = {};
    for (const id of ids) {
      const g = v => j.hourly[ids.length === 1 ? v : `${v}_${id}`];
      const spd = g('wind_speed_10m');
      if (!spd || spd.every(x => x == null)) continue;
      series[id] = { spd, dir: g('wind_direction_10m'), gst: g('wind_gusts_10m'), p: g('pressure_msl') };
    }
    return { times, tzOff: j.utc_offset_seconds, tzName: j.timezone, series };
  };
  try {
    const j = await getJSON(base + '&models=' + models.join(','));
    return pack(j, models);
  } catch (e) {
    // alcuni modelli possono rifiutare la richiesta combinata: li scarico uno per uno
    const parts = await Promise.allSettled(models.map(id => getJSON(base + '&models=' + id).then(j => pack(j, [id]))));
    const ok = parts.filter(p => p.status === 'fulfilled').map(p => p.value);
    if (!ok.length) throw e;
    const out = ok[0];
    for (const p of ok.slice(1)) Object.assign(out.series, alignSeries(p, out.times));
    return out;
  }
}
function alignSeries(p, times) {
  const out = {};
  for (const [id, s] of Object.entries(p.series)) {
    const idx = times.map(t => p.times.indexOf(t));
    const pick = a => idx.map(i => i < 0 ? null : a[i]);
    out[id] = { spd: pick(s.spd), dir: pick(s.dir), gst: pick(s.gst), p: pick(s.p) };
  }
  return out;
}

/* ---------------------------------------------------------- consenso */
/** Media pesata vettoriale per ogni ora. */
function consensus(data, ctx) {
  const { times, series } = data;
  const now = Date.now();
  const ids = Object.keys(series);
  const out = { spd: [], dir: [], gst: [], sd: [], dsd: [], n: [], p: [], weights: {} };
  ids.forEach(id => out.weights[id] = 0);
  for (let i = 0; i < times.length; i++) {
    const lead = Math.max(0, (times[i] - now) / 3600e3);
    let sw = 0, ss = 0, sg = 0, swg = 0, su = 0, sv = 0, sp = 0, swp = 0, n = 0; const vals = [];
    for (const id of ids) {
      const s = series[id], v = s.spd[i], d = s.dir[i];
      if (v == null || d == null) continue;
      const w = modelWeight(MBYID[id], ctx, lead);
      if (lead <= 24) out.weights[id] += w;
      sw += w; ss += w * v; su += w * Math.sin(d * DEG); sv += w * Math.cos(d * DEG); n++;
      vals.push([v, w]);
      if (s.gst[i] != null) { sg += w * s.gst[i]; swg += w; }
      if (s.p && s.p[i] != null) { sp += w * s.p[i]; swp += w; }
    }
    if (!sw) { out.spd.push(null); out.dir.push(null); out.gst.push(null); out.sd.push(null); out.dsd.push(null); out.n.push(0); out.p.push(null); continue; }
    const m = ss / sw;
    const R = Math.hypot(su, sv) / sw;
    out.spd.push(m);
    out.dir.push(norm360(Math.atan2(su, sv) / DEG));
    out.gst.push(swg ? sg / swg : null);
    out.sd.push(Math.sqrt(vals.reduce((a, [v, w]) => a + w * (v - m) ** 2, 0) / sw));
    out.dsd.push(Math.sqrt(-2 * Math.log(Math.max(R, 1e-6))) / DEG);
    out.p.push(swp ? sp / swp : null);
    out.n.push(n);
  }
  const tot = Object.values(out.weights).reduce((a, b) => a + b, 0) || 1;
  out.ranking = ids.map(id => ({ id, w: out.weights[id] / tot })).sort((a, b) => b.w - a.w);
  return out;
}
/** 0..1 → bassa/media/alta incertezza */
function uncertainty(spd, sd, dsd) {
  if (spd == null) return null;
  const x = (sd / Math.max(spd, 6)) + (spd < 4 ? 0 : dsd / 90);
  return x < 0.28 ? 'bassa' : x < 0.55 ? 'media' : 'alta';
}
function interpAt(times, arr, t, isDir) {
  if (t <= times[0]) return arr[0];
  for (let i = 1; i < times.length; i++) {
    if (times[i] >= t) {
      const a = arr[i - 1], b = arr[i]; if (a == null) return b; if (b == null) return a;
      const f = (t - times[i - 1]) / (times[i] - times[i - 1]);
      return isDir ? norm360(a + angDiff(a, b) * f) : a + (b - a) * f;
    }
  }
  return arr[arr.length - 1];
}

/* ---------------------------------------------------------- formattazione tempo */
function fmtT(ms, opt = {}) {
  const off = (W?.tzOff ?? -new Date().getTimezoneOffset() * 60) * 1000;
  const d = new Date(ms + off);
  const p = n => String(n).padStart(2, '0');
  const days = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  if (opt.time) return hm;
  if (opt.day) return `${days[d.getUTCDay()]} ${d.getUTCDate()}`;
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${hm}`;
}
function localInputToMs(v) { const off = (W?.tzOff ?? -new Date().getTimezoneOffset() * 60) * 1000; return Date.parse(v + ':00Z') - off; }

/* ---------------------------------------------------------- posizione */
function parseCoords(s) {
  s = s.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  // gradi decimali "44.3 9.21" o "44.3N 9.21E"
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*([NS])?\s+(-?\d+(?:\.\d+)?)\s*([EWO])?$/i);
  if (m) { let a = +m[1], b = +m[3]; if (/s/i.test(m[2] || '')) a = -a; if (/[wo]/i.test(m[4] || '')) b = -b; if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [a, b]; }
  // gradi e minuti "44°18.5'N 9°12.3'E"
  const re = /(\d+)[°\s]+(\d+(?:\.\d+)?)['′]?\s*([NSEWO])/gi; const parts = [...s.matchAll(re)];
  if (parts.length === 2) {
    const conv = q => { let v = +q[1] + +q[2] / 60; if (/[SWO]/i.test(q[3])) v = -v; return [v, q[3].toUpperCase()]; };
    const [a, b] = parts.map(conv);
    if (/[NS]/.test(a[1])) return [a[0], b[0]]; return [b[0], a[0]];
  }
  return null;
}
const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
function fmtDM(lat, lon) {
  const f = (v, p, n) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return `${d}°${m.toFixed(1)}'${v >= 0 ? p : n}`; };
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}

let locMap, locMarker;
function initLocMap() {
  if (locMap || !window.L) return;
  locMap = L.map('locmap', { zoomControl: true, attributionControl: true }).setView(S.loc ? [S.loc.lat, S.loc.lon] : [43.5, 9.5], S.loc ? 9 : 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: '© OpenStreetMap' }).addTo(locMap);
  locMap.on('click', e => setLoc({ lat: e.latlng.lat, lon: e.latlng.lng, name: fmtDM(e.latlng.lat, e.latlng.lng) }));
  if (S.loc) locMarker = L.marker([S.loc.lat, S.loc.lon]).addTo(locMap);
}
async function searchLoc() {
  const q = $('#locq').value.trim(); if (!q) return;
  const c = parseCoords(q);
  if (c) return setLoc({ lat: c[0], lon: c[1], name: fmtDM(c[0], c[1]) });
  $('#locres').innerHTML = '<span class="small muted"><span class="spin"></span> Cerco…</span>';
  try {
    const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=it&format=json`);
    const r = j.results || [];
    $('#locres').innerHTML = r.length ? '' : '<span class="small muted">Nessun risultato. Provi con le coordinate o tocchi la mappa.</span>';
    r.forEach(x => {
      const b = document.createElement('button');
      b.textContent = `${x.name}${x.admin1 ? ', ' + x.admin1 : ''}${x.country_code ? ' (' + x.country_code + ')' : ''}`;
      b.onclick = () => { $('#locres').innerHTML = ''; setLoc({ lat: x.latitude, lon: x.longitude, name: x.name }); };
      $('#locres').append(b);
    });
  } catch (e) { $('#locres').innerHTML = `<span class="err">Ricerca non riuscita: ${esc(e.message)}</span>`; }
}
function gps() {
  if (!navigator.geolocation) return toast('GPS non disponibile su questo dispositivo');
  toast('Leggo la posizione…');
  navigator.geolocation.getCurrentPosition(p => setLoc({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'Posizione GPS ' + fmtDM(p.coords.latitude, p.coords.longitude) }),
    e => toast('Posizione non disponibile: ' + e.message), { enableHighAccuracy: true, timeout: 15000 });
}
async function setLoc(loc) {
  S.loc = loc; save();
  if (locMap) { locMap.setView([loc.lat, loc.lon], Math.max(locMap.getZoom(), 9)); if (locMarker) locMarker.setLatLng([loc.lat, loc.lon]); else locMarker = L.marker([loc.lat, loc.lon]).addTo(locMap); }
  renderLocChip();
  SYN = null;
  await refreshWind();
}
function renderLocChip() {
  const l = S.loc;
  $('#locchip').innerHTML = l ? `<b>${esc(l.name)}</b> · ${fmtDM(l.lat, l.lon)}${W?.fetched ? ' · agg. ' + fmtT(W.fetched, { time: true }) : ''}` : 'Nessuna posizione';
  if (l) $('#lkWindy').href = `https://www.windy.com/?${l.lat.toFixed(3)},${l.lon.toFixed(3)},8`;
}

/* ---------------------------------------------------------- vento: scarico ed elaboro */
async function marineCheck(lat, lon) {
  try {
    const j = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_period,wave_direction&timezone=GMT&forecast_days=7&past_hours=3`);
    const h = j.hourly.wave_height;
    if (!h || h.every(x => x == null)) return null;
    return { times: j.hourly.time.map(t => Date.parse(t + 'Z')), h, per: j.hourly.wave_period, dir: j.hourly.wave_direction };
  } catch (e) { return null; }
}
async function refreshWind() {
  if (!S.loc) return;
  const st = $('#windStatus');
  st.innerHTML = '<span class="spin"></span> Scarico ' + MODELS.length + ' modelli…';
  try {
    const [data, wave] = await Promise.all([fetchModels(S.loc.lat, S.loc.lon, MODELS.map(m => m.id)), marineCheck(S.loc.lat, S.loc.lon)]);
    W = { ...data, wave, loc: S.loc, fetched: Date.now() };
    // suggerimento tipo di campo
    const hint = wave ? 'Punto in mare: costiero o offshore a seconda della distanza da costa.' : 'Nessun dato d\'onda: probabilmente lago o entroterra.';
    $('#ctxHint').textContent = hint;
    if (!wave && S.ctx !== 'lago' && !S._ctxManual) setCtx('lago', false);
    store('prg_wx', W);
    S.shown = null; save();
    renderWind();
  } catch (e) {
    st.innerHTML = `<span class="err">Non riesco a scaricare le previsioni (${esc(e.message)}).</span>` + (W ? ' Mostro l\'ultima previsione salvata.' : '');
    if (W) renderWind(true);
  }
  renderLocChip();
}
function setCtx(v, manual = true) {
  S.ctx = v; if (manual) S._ctxManual = true; S.shown = null; save();
  $$('#ctxSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  if (W) renderWind();
}

/* ---------------------------------------------------------- vento: render */
let C = null; // consenso corrente
const SERIES_COLORS = () => [cssv('--s1'), cssv('--s2'), cssv('--s3'), cssv('--s4')];

function renderWind(stale) {
  if (!W) return;
  C = consensus(W, S.ctx);
  const rank = C.ranking.filter(r => r.w > 0);
  if (!S.shown) S.shown = rank.slice(0, 3).map(r => r.id);
  const top3 = rank.slice(0, 3).map(r => r.id);
  const nModels = Object.keys(W.series).length;
  const old = (Date.now() - W.fetched) / 3600e3;
  $('#windStatus').innerHTML = `${nModels} modelli disponibili per questo punto · ${S.ctx === 'lago' ? 'campo lacustre' : S.ctx === 'costiero' ? 'campo costiero' : 'regata offshore'}` +
    (stale || old > 6 ? ` · <span class="pill warn">previsione di ${Math.round(old)} ore fa</span>` : '');

  // chip modelli
  const colors = SERIES_COLORS();
  const box = $('#modelChips'); box.innerHTML = '';
  const allIds = [...rank.map(r => r.id), ...Object.keys(W.series).filter(id => !rank.find(r => r.id === id))];
  allIds.forEach(id => {
    const m = MBYID[id], r = rank.find(x => x.id === id);
    const b = document.createElement('button');
    b.className = 'chip' + (top3.includes(id) ? ' top' : '');
    const on = S.shown.includes(id);
    b.setAttribute('aria-pressed', on);
    const ci = S.shown.indexOf(id);
    b.innerHTML = `<i style="background:${on ? colors[ci % 4] : 'var(--rule)'}"></i>${m.name}<span class="w">${r ? Math.round(r.w * 100) + '%' : '—'}</span>`;
    b.title = `${m.src} · ${m.res} km`;
    b.onclick = () => {
      if (S.shown.includes(id)) S.shown = S.shown.filter(x => x !== id);
      else { if (S.shown.length >= 4) S.shown.shift(); S.shown.push(id); }
      save(); renderWind();
    };
    box.append(b);
  });
  $('#wlegend').innerHTML = `<span><i style="background:var(--ink)"></i>Consenso pesato</span><span><i style="background:var(--band);height:8px"></i>Dispersione tra modelli</span><span><i style="border-top:2px dashed var(--ink-2);height:0"></i>Raffiche (consenso)</span>` +
    S.shown.map((id, i) => `<span><i style="background:${colors[i % 4]}"></i>${MBYID[id].name}</span>`).join('');

  renderStats();
  drawWind();
  drawWave();
  renderHourly();
}

function idxRange() {
  const now = Date.now();
  let i0 = W.times.findIndex(t => t >= now - 3600e3); if (i0 < 0) i0 = 0;
  const end = now + S.range * 3600e3;
  let i1 = W.times.findIndex(t => t > end); if (i1 < 0) i1 = W.times.length;
  return [i0, i1];
}

function renderStats() {
  const [i0] = idxRange();
  const now = C.spd[i0], d = C.dir[i0];
  const box = $('#windStats'); box.hidden = false;
  // prossime 12 ore
  let mx = 0, mxT = null, mn = 99;
  for (let i = i0; i < Math.min(i0 + 12, C.spd.length); i++) { if (C.spd[i] == null) continue; if (C.spd[i] > mx) { mx = C.spd[i]; mxT = W.times[i]; } mn = Math.min(mn, C.spd[i]); }
  const i12 = Math.min(i0 + 12, C.dir.length - 1);
  const rot = C.dir[i12] != null && d != null ? angDiff(d, C.dir[i12]) : 0;
  const u = uncertainty(now, C.sd[i0], C.dsd[i0]);
  const uc = { bassa: 'good', media: 'warn', alta: 'bad' }[u] || 'info';
  const p0 = C.p[i0], p24 = C.p[Math.min(i0 + 24, C.p.length - 1)];
  const tend = p0 != null && p24 != null ? p24 - p0 : null;
  box.innerHTML = `
    <div class="stat"><span class="eyebrow">Ora</span><span class="v num">${now == null ? '—' : Math.round(now)} <small>kn da ${d == null ? '' : card(d) + ' ' + Math.round(d) + '°'}</small></span><span class="small muted">raffiche ${C.gst[i0] == null ? '—' : Math.round(C.gst[i0]) + ' kn'}</span></div>
    <div class="stat"><span class="eyebrow">Prossime 12 ore</span><span class="v num">${Math.round(mn)}–${Math.round(mx)} <small>kn</small></span><span class="small muted">massimo verso le ${mxT ? fmtT(mxT, { time: true }) : '—'}</span></div>
    <div class="stat"><span class="eyebrow">Rotazione in 12 ore</span><span class="v num">${rot > 0 ? '+' : ''}${Math.round(rot)}° <small>${Math.abs(rot) < 10 ? 'stabile' : rot > 0 ? 'a destra (ruota in senso orario)' : 'a sinistra (antiorario)'}</small></span><span class="small muted">verso ${C.dir[i12] == null ? '—' : card(C.dir[i12])}</span></div>
    <div class="stat"><span class="eyebrow">Accordo tra modelli</span><span class="v"><span class="pill ${uc}">incertezza ${u || '—'}</span></span><span class="small muted">±${r1(C.sd[i0] || 0)} kn · ±${Math.round(C.dsd[i0] || 0)}°</span></div>
    <div class="stat"><span class="eyebrow">Pressione</span><span class="v num">${p0 == null ? '—' : Math.round(p0)} <small>hPa</small></span><span class="small muted">${tend == null ? '' : (tend > 0 ? '+' : '') + r1(tend) + ' hPa in 24h'}</span></div>`;
}

/* --- canvas helpers */
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function drawArrow(g, x, y, dirFrom, len, color) {
  // freccia che punta dove va il vento (sottovento)
  const a = (dirFrom + 180) * DEG;
  const dx = Math.sin(a), dy = -Math.cos(a);
  g.save(); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(x - dx * len / 2, y - dy * len / 2); g.lineTo(x + dx * len / 2, y + dy * len / 2); g.stroke();
  const hx = x + dx * len / 2, hy = y + dy * len / 2;
  g.beginPath(); g.moveTo(hx, hy);
  g.lineTo(hx - dx * 5 - dy * 3.5, hy - dy * 5 + dx * 3.5); g.lineTo(hx - dx * 5 + dy * 3.5, hy - dy * 5 - dx * 3.5); g.closePath(); g.fill();
  g.restore();
}
function nightSpans(t0, t1) {
  // alba/tramonto approssimati con l'equazione solare
  const spans = []; const { lat, lon } = W.loc;
  for (let day = t0 - 86400e3; day < t1 + 86400e3; day += 86400e3) {
    const d = new Date(day); const n = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400e3);
    const decl = 23.44 * Math.sin(DEG * 360 / 365 * (n - 81));
    const cosH = (Math.sin(-0.83 * DEG) - Math.sin(lat * DEG) * Math.sin(decl * DEG)) / (Math.cos(lat * DEG) * Math.cos(decl * DEG));
    if (Math.abs(cosH) > 1) continue;
    const H = Math.acos(cosH) / DEG / 15; // ore
    const B = DEG * 360 / 365 * (n - 81); const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const noon = 12 - lon / 15 - eot / 60;
    const mid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    spans.push([mid + (noon - H) * 3600e3, mid + (noon + H) * 3600e3]); // alba, tramonto
  }
  const nights = [];
  for (let i = 0; i < spans.length - 1; i++) nights.push([spans[i][1], spans[i + 1][0]]);
  return nights;
}

let wGeom = null;
function drawWind() {
  const cv = $('#wchart'); const { g, w, h } = setupCanvas(cv);
  const [i0, i1] = idxRange();
  const T = W.times.slice(i0, i1); if (T.length < 2) return;
  const ink = cssv('--ink'), ink2 = cssv('--ink-2'), ink3 = cssv('--ink-3'), rule = cssv('--rule'), band = cssv('--band'), night = cssv('--night');
  const colors = SERIES_COLORS();
  const L = 36, R = 10, TOP = 34, B = 26;
  const pw = w - L - R, ph = h - TOP - B;
  let ymax = 10;
  for (let i = i0; i < i1; i++) { ymax = Math.max(ymax, (C.gst[i] || 0), (C.spd[i] || 0) + (C.sd[i] || 0)); for (const id of S.shown) { const v = W.series[id]?.spd[i]; if (v != null) ymax = Math.max(ymax, v); } }
  const step = ymax > 40 ? 10 : 5; ymax = Math.ceil(ymax / step) * step;
  const x = t => L + (t - T[0]) / (T[T.length - 1] - T[0]) * pw;
  const y = v => TOP + ph - v / ymax * ph;
  wGeom = { x, y, T, i0, i1, L, pw, TOP, ph };

  // notte
  g.fillStyle = night;
  for (const [a, b] of nightSpans(T[0], T[T.length - 1])) { const xa = Math.max(L, x(a)), xb = Math.min(L + pw, x(b)); if (xb > xa) g.fillRect(xa, TOP, xb - xa, ph); }
  // griglia
  g.font = '11px ' + cssv('--f-mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let v = 0; v <= ymax; v += step) {
    g.strokeStyle = rule; g.lineWidth = 1; g.beginPath(); g.moveTo(L, y(v) + .5); g.lineTo(L + pw, y(v) + .5); g.stroke();
    g.fillStyle = ink3; g.fillText(v, L - 6, y(v));
  }
  g.save(); g.translate(10, TOP + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = ink3; g.fillText('nodi', 0, 0); g.restore();
  // asse tempo
  const span = (T[T.length - 1] - T[0]) / 3600e3;
  const tick = span <= 30 ? 3 : span <= 80 ? 6 : 12;
  g.textAlign = 'center'; g.textBaseline = 'top';
  T.forEach((t, k) => {
    const hh = Math.round(((t + W.tzOff * 1000) % 86400e3) / 3600e3) % 24;
    if (hh % tick) return;
    const xx = x(t);
    g.strokeStyle = hh === 0 ? ink3 : rule; g.beginPath(); g.moveTo(xx + .5, TOP + ph); g.lineTo(xx + .5, TOP + ph + 4); g.stroke();
    g.fillStyle = hh === 0 ? ink : ink3;
    g.fillText(hh === 0 ? fmtT(t, { day: true }) : String(hh).padStart(2, '0'), xx, TOP + ph + 7);
  });
  // banda dispersione
  g.fillStyle = band; g.beginPath(); let started = false;
  for (let i = i0; i < i1; i++) { if (C.spd[i] == null) continue; const v = C.spd[i] + C.sd[i]; started ? g.lineTo(x(W.times[i]), y(v)) : (g.moveTo(x(W.times[i]), y(v)), started = true); }
  for (let i = i1 - 1; i >= i0; i--) { if (C.spd[i] == null) continue; g.lineTo(x(W.times[i]), y(Math.max(0, C.spd[i] - C.sd[i]))); }
  g.closePath(); g.fill();
  // modelli
  const line = (arr, color, width, dash) => {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.lineJoin = 'round'; g.beginPath(); let s = false;
    for (let i = i0; i < i1; i++) { const v = arr[i]; if (v == null) { s = false; continue; } s ? g.lineTo(x(W.times[i]), y(v)) : (g.moveTo(x(W.times[i]), y(v)), s = true); }
    g.stroke(); g.setLineDash([]);
  };
  S.shown.forEach((id, k) => { if (W.series[id]) line(W.series[id].spd, colors[k % 4], 1.5); });
  line(C.gst, ink2, 1.3, [4, 4]);
  line(C.spd, ink, 2.6);
  // frecce direzione
  const every = Math.max(1, Math.round((T.length) / Math.max(8, pw / 38)));
  g.font = '10px ' + cssv('--f-mono'); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  for (let i = i0; i < i1; i += every) {
    if (C.dir[i] == null) continue;
    const xx = x(W.times[i]);
    drawArrow(g, xx, 13, C.dir[i], 16, ink);
    g.fillStyle = ink3; g.fillText(card(C.dir[i]), xx, 31);
  }
  // ora attuale
  const nx = x(Date.now());
  if (nx > L && nx < L + pw) { g.strokeStyle = cssv('--accent'); g.lineWidth = 1.5; g.beginPath(); g.moveTo(nx, TOP); g.lineTo(nx, TOP + ph); g.stroke(); g.fillStyle = cssv('--accent'); g.font = '600 10px ' + cssv('--f-body'); g.textAlign = 'left'; g.fillText('ora', nx + 3, TOP + 10); }
  // punto finale enfatizzato
  for (let i = i1 - 1; i >= i0; i--) if (C.spd[i] != null) { g.fillStyle = ink; g.beginPath(); g.arc(x(W.times[i]), y(C.spd[i]), 3.5, 0, 7); g.fill(); break; }
}

function hoverWind(ev) {
  if (!wGeom || !C) return;
  const cv = $('#wchart'), tip = $('#wtip');
  const rect = cv.getBoundingClientRect();
  const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
  const { x, T, i0, i1, L, pw, TOP, ph } = wGeom;
  if (px < L || px > L + pw) { tip.hidden = true; drawWind(); return; }
  let best = i0, bd = 1e9;
  for (let i = i0; i < i1; i++) { const d = Math.abs(x(W.times[i]) - px); if (d < bd) { bd = d; best = i; } }
  drawWind();
  const g = cv.getContext('2d'); const xx = x(W.times[best]);
  g.strokeStyle = cssv('--ink-3'); g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(xx, TOP); g.lineTo(xx, TOP + ph); g.stroke(); g.setLineDash([]);
  const colors = SERIES_COLORS();
  const i = best;
  const u = uncertainty(C.spd[i], C.sd[i], C.dsd[i]);
  tip.innerHTML = `<div class="t">${fmtT(W.times[i])}</div>
    <div class="r"><span>Consenso</span><span>${C.spd[i] == null ? '—' : r1(C.spd[i]) + ' kn'}</span></div>
    <div class="r"><span>Direzione</span><span>${C.dir[i] == null ? '—' : card(C.dir[i]) + ' ' + Math.round(C.dir[i]) + '°'}</span></div>
    <div class="r"><span>Raffiche</span><span>${C.gst[i] == null ? '—' : r1(C.gst[i]) + ' kn'}</span></div>
    <div class="r"><span>Incertezza</span><span>${u || '—'}</span></div>` +
    S.shown.map((id, k) => { const s = W.series[id]; if (!s) return ''; return `<div class="r"><span><i class="swatch" style="background:${colors[k % 4]};width:8px;height:8px"></i> ${MBYID[id].name}</span><span>${s.spd[i] == null ? '—' : Math.round(s.spd[i]) + ' kn ' + card(s.dir[i])}</span></div>`; }).join('');
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = (xx + 12 + tw > cv.clientWidth ? xx - tw - 12 : xx + 12) + 'px';
  tip.style.top = (TOP + 4) + 'px';
}

function drawWave() {
  const box = $('#waveBox');
  if (!W.wave || S.ctx === 'lago') { box.hidden = true; return; }
  box.hidden = false;
  const cv = $('#wavechart'); const { g, w, h } = setupCanvas(cv);
  const { x: X, T, L, pw } = wGeom || {}; if (!X) return;
  const wv = W.wave; const TOP = 8, B = 18, ph = h - TOP - B;
  const idx = wv.times.map((t, i) => [t, wv.h[i]]).filter(([t, v]) => t >= T[0] && t <= T[T.length - 1] && v != null);
  if (!idx.length) { box.hidden = true; return; }
  let ymax = Math.max(1, ...idx.map(a => a[1])); ymax = Math.ceil(ymax * 2) / 2;
  const y = v => TOP + ph - v / ymax * ph;
  const rule = cssv('--rule'), ink3 = cssv('--ink-3'), acc = cssv('--accent');
  g.font = '11px ' + cssv('--f-mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
  [0, ymax / 2, ymax].forEach(v => { g.strokeStyle = rule; g.beginPath(); g.moveTo(L, y(v) + .5); g.lineTo(L + pw, y(v) + .5); g.stroke(); g.fillStyle = ink3; g.fillText(v.toFixed(1), L - 6, y(v)); });
  g.fillStyle = cssv('--band'); g.beginPath(); g.moveTo(X(idx[0][0]), y(0));
  idx.forEach(([t, v]) => g.lineTo(X(t), y(v))); g.lineTo(X(idx[idx.length - 1][0]), y(0)); g.closePath(); g.fill();
  g.strokeStyle = acc; g.lineWidth = 2; g.beginPath(); idx.forEach(([t, v], k) => k ? g.lineTo(X(t), y(v)) : g.moveTo(X(t), y(v))); g.stroke();
}

function renderHourly() {
  const [i0, i1] = idxRange();
  let html = '<thead><tr><th>Ora</th><th>Direzione</th><th style="text-align:right">Vento</th><th style="text-align:right">Raffiche</th><th style="text-align:right">±kn</th><th style="text-align:right">±°</th><th style="text-align:right">hPa</th>' + (W.wave && S.ctx !== 'lago' ? '<th style="text-align:right">Onda</th>' : '') + '</tr></thead><tbody>';
  let lastDay = '';
  for (let i = i0; i < i1; i++) {
    if (C.spd[i] == null) continue;
    const day = fmtT(W.times[i], { day: true });
    if (day !== lastDay) { html += `<tr class="day"><td colspan="8">${day}</td></tr>`; lastDay = day; }
    let wave = '';
    if (W.wave && S.ctx !== 'lago') { const k = W.wave.times.indexOf(W.times[i]); wave = `<td class="n">${k >= 0 && W.wave.h[k] != null ? W.wave.h[k].toFixed(1) + ' m' : '—'}</td>`; }
    html += `<tr><td class="mono">${fmtT(W.times[i], { time: true })}</td><td>${arrowSvg(C.dir[i])} ${card(C.dir[i])} <span class="muted mono">${Math.round(C.dir[i])}°</span></td>
      <td class="n"><b>${r1(C.spd[i])}</b></td><td class="n">${C.gst[i] == null ? '—' : r1(C.gst[i])}</td><td class="n">${r1(C.sd[i])}</td><td class="n">${Math.round(C.dsd[i])}</td><td class="n">${C.p[i] == null ? '—' : Math.round(C.p[i])}</td>${wave}</tr>`;
  }
  $('#htable').innerHTML = html + '</tbody>';
}
function arrowSvg(d) { return `<svg class="arrow" viewBox="-7 -7 14 14"><g transform="rotate(${norm360(d + 180)})"><path d="M0 6V-5M-3.5-1.5L0-6l3.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g></svg>`; }

/* ---------------------------------------------------------- sinottica */
const SYN_MODELS = ['ecmwf_ifs', 'icon_global', 'gfs_global'];
async function loadSynoptic() {
  if (!S.loc) return toast('Scelga prima una posizione nella scheda Vento');
  const btn = $('#synLoad'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Scarico la carta…';
  try {
    const step = 2, dLat = 14, dLon = 20;
    const lat0 = Math.round((S.loc.lat - dLat) / step) * step, lon0 = Math.round((S.loc.lon - dLon) / step) * step;
    const lats = [], lons = [];
    for (let la = lat0; la <= lat0 + 2 * dLat; la += step) if (la > -85 && la < 85) lats.push(la);
    for (let lo = lon0; lo <= lon0 + 2 * dLon; lo += step) lons.push(lo);
    const pts = []; lats.forEach(la => lons.forEach(lo => pts.push([la, lo])));
    let j = null, used = null;
    for (const mdl of SYN_MODELS) {
      try {
        j = await getJSON(`${OM}?latitude=${pts.map(p => p[0]).join(',')}&longitude=${pts.map(p => p[1]).join(',')}&hourly=pressure_msl,wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&models=${mdl}&timezone=GMT&forecast_days=6`);
        if (!Array.isArray(j)) j = [j];
        if (j[0].hourly.pressure_msl.some(v => v != null)) { used = mdl; break; }
      } catch (e) { j = null; }
    }
    if (!j) throw new Error('nessun modello globale ha risposto');
    const times = j[0].hourly.time.map(t => Date.parse(t + 'Z'));
    const now = Date.now();
    const steps = [];
    for (let k = 0; k < times.length; k += 6) if (times[k] >= now - 3 * 3600e3) steps.push(k);
    const grids = steps.map(k => lats.map((la, a) => lons.map((lo, b) => j[a * lons.length + b].hourly.pressure_msl[k])));
    const winds = steps.map(k => lats.map((la, a) => lons.map((lo, b) => { const h = j[a * lons.length + b].hourly; return [h.wind_speed_10m[k], h.wind_direction_10m[k]]; })));
    SYN = { lats, lons, step, times: steps.map(k => times[k]), grids, winds, model: used };
    $('#synSrc').textContent = `Isobare ogni 4 hPa · modello ${MBYID[used].name} · griglia ${step}°`;
    const sl = $('#synT'); sl.max = steps.length - 1; sl.value = 0;
    SYN.analysis = analyseSynoptic();
    drawSynoptic(0);
    renderSynSummary();
  } catch (e) { toast('Carta non disponibile: ' + e.message, 4000); }
  btn.disabled = false; btn.textContent = 'Aggiorna carta';
}

function upsample(G, f) {
  const R = G.length, Cn = G[0].length, out = [];
  for (let a = 0; a <= (R - 1) * f; a++) {
    const row = [];
    for (let b = 0; b <= (Cn - 1) * f; b++) {
      const ya = a / f, xb = b / f, i = Math.min(Math.floor(ya), R - 2), k = Math.min(Math.floor(xb), Cn - 2), fy = ya - i, fx = xb - k;
      const q = [G[i][k], G[i][k + 1], G[i + 1][k], G[i + 1][k + 1]];
      row.push(q.some(v => v == null) ? null : q[0] * (1 - fx) * (1 - fy) + q[1] * fx * (1 - fy) + q[2] * (1 - fx) * fy + q[3] * fx * fy);
    }
    out.push(row);
  }
  return out;
}
/** Marching squares: segmenti di isolinea in coordinate di griglia (riga, colonna). */
function contour(G, level) {
  const segs = [];
  for (let i = 0; i < G.length - 1; i++) for (let k = 0; k < G[0].length - 1; k++) {
    const a = G[i][k], b = G[i][k + 1], c = G[i + 1][k + 1], d = G[i + 1][k];
    if (a == null || b == null || c == null || d == null) continue;
    const idx = (a > level) | ((b > level) << 1) | ((c > level) << 2) | ((d > level) << 3);
    if (idx === 0 || idx === 15) continue;
    const t = (p, q) => (level - p) / (q - p);
    const top = [i, k + t(a, b)], right = [i + t(b, c), k + 1], bottom = [i + 1, k + t(d, c)], left = [i + t(a, d), k];
    const map = { 1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bottom]], 5: [[left, top], [right, bottom]], 6: [[top, bottom]], 7: [[left, bottom]],
      8: [[bottom, left]], 9: [[top, bottom]], 10: [[top, right], [bottom, left]], 11: [[right, bottom]], 12: [[right, left]], 13: [[top, right]], 14: [[left, top]] };
    segs.push(...map[idx]);
  }
  return segs;
}
/** Centri di alta e bassa pressione come estremi locali. */
function extrema(G, lats, lons) {
  const out = [], R = G.length, Cn = G[0].length, rad = 2;
  for (let i = 1; i < R - 1; i++) for (let k = 1; k < Cn - 1; k++) {
    const v = G[i][k]; if (v == null) continue;
    let isMax = true, isMin = true, sum = 0, n = 0;
    for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) {
      if (!a && !b) continue; const w = G[i + a]?.[k + b]; if (w == null) continue;
      if (w > v) isMax = false; if (w < v) isMin = false; if (Math.abs(a) === rad || Math.abs(b) === rad) { sum += w; n++; }
    }
    const ring = n ? sum / n : v;
    if (isMax && v - ring > 0.8) out.push({ t: 'H', lat: lats[i], lon: lons[k], p: v });
    if (isMin && ring - v > 0.8) out.push({ t: 'L', lat: lats[i], lon: lons[k], p: v });
  }
  return out;
}
function gridAt(G, lats, lons, lat, lon) {
  const fy = (lat - lats[0]) / (lats[1] - lats[0]), fx = (lon - lons[0]) / (lons[1] - lons[0]);
  const i = clamp(Math.floor(fy), 0, lats.length - 2), k = clamp(Math.floor(fx), 0, lons.length - 2), dy = fy - i, dx = fx - k;
  const q = [G[i][k], G[i][k + 1], G[i + 1][k], G[i + 1][k + 1]]; if (q.some(v => v == null)) return null;
  return q[0] * (1 - dx) * (1 - dy) + q[1] * dx * (1 - dy) + q[2] * (1 - dx) * dy + q[3] * dx * dy;
}
function haversineNm(a, b, c, d) {
  const R = 3440.065, p1 = a * DEG, p2 = c * DEG, dp = (c - a) * DEG, dl = (d - b) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b, c, d) {
  const p1 = a * DEG, p2 = c * DEG, dl = (d - b) * DEG;
  return norm360(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / DEG);
}
/** Gradiente di pressione e vento geostrofico stimato al punto. */
function gradientAt(G, lat, lon) {
  const { lats, lons } = SYN, h = 1;
  const pN = gridAt(G, lats, lons, lat + h, lon), pS = gridAt(G, lats, lons, lat - h, lon), pE = gridAt(G, lats, lons, lat, lon + h), pW = gridAt(G, lats, lons, lat, lon - h);
  if ([pN, pS, pE, pW].some(v => v == null)) return null;
  const dy = 2 * h * 111.2e3, dx = 2 * h * 111.2e3 * Math.cos(lat * DEG);
  const gy = (pN - pS) * 100 / dy, gx = (pE - pW) * 100 / dx; // Pa/m
  const gmag = Math.hypot(gx, gy);
  const f = 2 * 7.292e-5 * Math.sin(Math.abs(lat) * DEG);
  const vg = f > 1e-5 ? gmag / (1.225 * f) * 1.94384 : null; // nodi
  // vento geostrofico: parallelo alle isobare con la bassa a sinistra (emisfero N)
  const sign = lat >= 0 ? 1 : -1;
  const vx = -sign * gy, vy = sign * gx; // direzione verso cui soffia
  const toDir = norm360(Math.atan2(vx, vy) / DEG);
  return { hPa100km: gmag * 1e5 / 100, vg, fromDir: norm360(toDir + 180) };
}
function analyseSynoptic() {
  const { lats, lons, grids, times } = SYN, { lat, lon } = S.loc;
  const steps = grids.map((G, s) => {
    const ex = extrema(G, lats, lons).map(e => ({ ...e, dist: haversineNm(lat, lon, e.lat, e.lon), brg: bearing(lat, lon, e.lat, e.lon) }));
    const gr = gradientAt(G, lat, lon);
    return { t: times[s], p: gridAt(G, lats, lons, lat, lon), ex, gr };
  });
  // traccia della bassa più vicina
  const tracks = [];
  steps.forEach((st, s) => st.ex.filter(e => e.t === 'L').forEach(e => {
    const prev = tracks.find(tr => tr.last === s - 1 && haversineNm(tr.pts.at(-1).lat, tr.pts.at(-1).lon, e.lat, e.lon) < 420);
    if (prev) { prev.pts.push({ ...e, s }); prev.last = s; } else tracks.push({ pts: [{ ...e, s }], last: s });
  }));
  return { steps, tracks };
}
function renderSynSummary() {
  const A = SYN.analysis, st = A.steps, out = [];
  const p0 = st[0].p, at = h => st[Math.min(st.length - 1, Math.round(h / 6))];
  if (p0 != null) {
    const d24 = at(24).p - p0, d48 = at(48).p - p0;
    let t = `<p><b>Barometro sul campo:</b> ${Math.round(p0)} hPa ora, ${d24 > 0 ? '+' : ''}${r1(d24)} hPa in 24 ore e ${d48 > 0 ? '+' : ''}${r1(d48)} in 48 ore. `;
    t += d24 <= -6 ? 'Calo marcato: atteso peggioramento con rinforzo del vento.' : d24 <= -3 ? 'Calo moderato: probabile aumento del vento e instabilità.' : d24 >= 4 ? 'Pressione in aumento: tendenza al miglioramento, vento in attenuazione o in rotazione.' : 'Pressione abbastanza stabile.';
    out.push(t + '</p>');
  }
  const nearLows = st[0].ex.filter(e => e.t === 'L' && e.dist < 900).sort((a, b) => a.dist - b.dist);
  const nearHighs = st[0].ex.filter(e => e.t === 'H' && e.dist < 1200).sort((a, b) => a.dist - b.dist);
  const items = [];
  nearLows.slice(0, 2).forEach(e => {
    const tr = A.tracks.find(t => t.pts[0].s === 0 && t.pts[0].lat === e.lat && t.pts[0].lon === e.lon);
    let mv = '';
    if (tr && tr.pts.length > 2) {
      const a = tr.pts[0], b = tr.pts[Math.min(tr.pts.length - 1, 4)];
      const hrs = (b.s - a.s) * 6, dist = haversineNm(a.lat, a.lon, b.lat, b.lon);
      mv = dist < 60 ? ', quasi stazionaria' : `, in movimento verso ${card(bearing(a.lat, a.lon, b.lat, b.lon))} a circa ${Math.round(dist / hrs)} nodi, ${b.p < a.p - 1 ? 'in approfondimento' : b.p > a.p + 1 ? 'in colmamento' : 'di intensità stabile'} (${Math.round(b.p)} hPa fra ${hrs} ore)`;
    }
    items.push(`<li>Bassa di ${Math.round(e.p)} hPa a ${Math.round(e.dist)} mn verso ${card(e.brg)}${mv}.</li>`);
  });
  nearHighs.slice(0, 2).forEach(e => items.push(`<li>Alta di ${Math.round(e.p)} hPa a ${Math.round(e.dist)} mn verso ${card(e.brg)}.</li>`));
  if (items.length) out.push('<p><b>Centri di pressione vicini</b></p><ul>' + items.join('') + '</ul>');
  const gl = [0, 12, 24, 48].map(h => { const s = at(h); return s.gr ? `<li>+${h}h (${fmtT(s.t)}): gradiente ${r1(s.gr.hPa100km)} hPa/100 km → vento di gradiente circa ${Math.round(s.gr.vg * 0.7)} kn da ${card(s.gr.fromDir)} in mare aperto</li>` : ''; }).join('');
  if (gl) out.push('<p><b>Vento di gradiente stimato</b> (sulle isobare, ridotto per l\'attrito; non include brezze e effetti locali)</p><ul>' + gl + '</ul>');
  if (C && W) {
    const k = W.times.findIndex(t => t >= Date.now());
    const s0 = st[0].gr;
    if (s0 && k >= 0 && C.dir[k] != null && s0.vg * 0.7 > 8) {
      const dd = Math.abs(angDiff(s0.fromDir, C.dir[k]));
      if (dd > 50) out.push(`<p class="note">Il vento dei modelli locali (${card(C.dir[k])}) differisce molto da quello di gradiente (${card(s0.fromDir)}): probabile effetto di brezza, orografia o canalizzazione. Ne tenga conto nella scelta del lato.</p>`);
    }
  }
  $('#synSummary').innerHTML = out.join('') || '<p class="muted">Nessun elemento rilevante vicino al campo.</p>';
}

let synMap, synLayer;
function drawSynoptic(s) {
  if (!SYN || !window.L) return;
  if (!synMap) {
    synMap = L.map('synmap', { attributionControl: true }).setView([S.loc.lat, S.loc.lon], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 9, attribution: '© OpenStreetMap', opacity: 0.55 }).addTo(synMap);
  }
  if (synLayer) synLayer.remove();
  synLayer = L.layerGroup().addTo(synMap);
  const { lats, lons, step } = SYN, G = SYN.grids[s], f = 2;
  const U = upsample(G, f), toLL = ([r, c]) => [lats[0] + r / f * step, lons[0] + c / f * step];
  const vals = U.flat().filter(v => v != null); const lo = Math.ceil(Math.min(...vals) / 4) * 4, hi = Math.floor(Math.max(...vals) / 4) * 4;
  const ink2 = cssv('--ink-2');
  for (let lev = lo; lev <= hi; lev += 4) {
    const segs = contour(U, lev).map(sg => sg.map(toLL));
    if (!segs.length) continue;
    L.polyline(segs, { color: ink2, weight: lev === 1012 ? 1.8 : 1.1, opacity: .85, interactive: false }).addTo(synLayer);
    const lab = segs[Math.floor(segs.length / 2)][0];
    L.marker(lab, { icon: L.divIcon({ className: '', html: `<span class="isolab">${lev}</span>`, iconSize: null }), interactive: false }).addTo(synLayer);
  }
  SYN.analysis.steps[s].ex.forEach(e => L.marker([e.lat, e.lon], { icon: L.divIcon({ className: '', html: `<div class="hl ${e.t}">${e.t === 'H' ? 'A' : 'B'}<small>${Math.round(e.p)}</small></div>`, iconSize: [30, 34], iconAnchor: [15, 17] }), interactive: false }).addTo(synLayer));
  // frecce vento ogni 2 nodi di griglia
  const Wd = SYN.winds[s];
  for (let a = 0; a < lats.length; a += 2) for (let b = 0; b < lons.length; b += 2) {
    const [v, d] = Wd[a][b]; if (v == null || v < 8) continue;
    const col = v >= 34 ? cssv('--bad') : v >= 22 ? cssv('--warn') : cssv('--accent');
    L.marker([lats[a], lons[b]], { icon: L.divIcon({ className: '', html: `<svg width="22" height="22" viewBox="-11 -11 22 22" style="color:${col}"><g transform="rotate(${norm360(d + 180)})"><path d="M0 8V-7M-4-2L0-8l4 6" fill="none" stroke="currentColor" stroke-width="2"/></g></svg>`, iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(synLayer);
  }
  L.marker([S.loc.lat, S.loc.lon], { icon: L.divIcon({ className: '', html: '<div style="font:700 20px sans-serif;color:var(--bad)">✚</div>', iconSize: [20, 20], iconAnchor: [10, 12] }) }).addTo(synLayer);
  const h = Math.round((SYN.times[s] - Date.now()) / 3600e3);
  $('#synTl').textContent = `${fmtT(SYN.times[s])} (${h >= 0 ? '+' : ''}${h}h)`;
}

/* ---------------------------------------------------------- AI (Anthropic) */
async function askClaude(content, system, maxTokens = 2500) {
  if (!S.apiKey) throw new Error('Inserisca la chiave API nelle Impostazioni');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': S.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: S.aiModel || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status);
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}
async function fileToBlock(file, maxDim = 1600) {
  const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  if (file.type === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64.split(',')[1] } };
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = b64; });
  const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.85).split(',')[1] } };
}
function extractJSON(t) { const m = t.match(/```(?:json)?\s*([\s\S]*?)```/) || t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); return JSON.parse(m ? m[1] : t); }
function md(t) {
  const lines = esc(t).split('\n'); let html = '', inList = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^#{1,4}\s/.test(l)) { if (inList) { html += '</ul>'; inList = false; } html += `<h4>${l.replace(/^#+\s/, '')}</h4>`; }
    else if (/^\s*[-*•]\s/.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${l.replace(/^\s*[-*•]\s/, '')}</li>`; }
    else if (l.trim()) { if (inList) { html += '</ul>'; inList = false; } html += `<p>${l}</p>`; }
  }
  return html + (inList ? '</ul>' : '');
}

function forecastDigest(hours = 72) {
  if (!W || !C) return 'Previsione non disponibile.';
  const [i0] = idxRange(); const rows = [];
  for (let i = i0; i < Math.min(C.spd.length, i0 + hours); i += 3) if (C.spd[i] != null)
    rows.push(`${fmtT(W.times[i])}: ${Math.round(C.spd[i])} kn (raffiche ${Math.round(C.gst[i] ?? 0)}) da ${Math.round(C.dir[i])}° ${card(C.dir[i])}, incertezza ±${r1(C.sd[i])} kn/±${Math.round(C.dsd[i])}°, ${C.p[i] ? Math.round(C.p[i]) + ' hPa' : ''}`);
  const top = C.ranking.slice(0, 3).map(r => MBYID[r.id].name).join(', ');
  return `Punto: ${S.loc.name} (${fmtLL(S.loc.lat, S.loc.lon)}), campo ${S.ctx}. Modelli più pesati: ${top}. Fuso orario locale ${W.tzName}.\n` + rows.join('\n');
}
function synDigest() {
  if (!SYN) return 'Carta sinottica non caricata.';
  return SYN.analysis.steps.filter((s, k) => k % 2 === 0).map(s => `${fmtT(s.t)}: p=${s.p ? Math.round(s.p) : '?'} hPa; ` +
    (s.gr ? `gradiente ${r1(s.gr.hPa100km)} hPa/100km, gradiente-vento ${Math.round(s.gr.vg * 0.7)} kn da ${Math.round(s.gr.fromDir)}°; ` : '') +
    s.ex.filter(e => e.dist < 1500).map(e => `${e.t === 'H' ? 'Alta' : 'Bassa'} ${Math.round(e.p)} a ${Math.round(e.dist)} mn ${card(e.brg)}`).join('; ')).join('\n');
}
const SYS_METEO = 'Sei un meteorologo e tattico esperto di regate (inshore e offshore, Mediterraneo e laghi alpini). Rispondi in italiano, dando del Lei. Sii concreto e operativo: orari, direzioni in gradi e nodi. Distingui chiaramente ciò che è certo da ciò che è incerto. Niente premesse.';

async function synAI() {
  const out = $('#synAIout');
  if (!SYN && !synImgs.length) return toast('Carichi la carta o aggiunga delle foto di carte ufficiali');
  out.innerHTML = '<p><span class="spin"></span> Analizzo le carte…</p>';
  try {
    const content = [];
    for (const f of synImgs) content.push(await fileToBlock(f));
    content.push({ type: 'text', text: `Analizza l'evoluzione sinottica per una regata vicino a ${S.loc?.name || '?'}.\n\nDATI DELLA CARTA CALCOLATA (pressione al suolo):\n${synDigest()}\n\nPREVISIONE MODELLI LOCALI:\n${forecastDigest(96)}\n\n${synImgs.length ? 'Le immagini allegate sono carte ufficiali: leggi fronti, centri e isobare.' : ''}\nScrivi: 1) situazione attuale, 2) evoluzione nei prossimi 3-4 giorni con orari, 3) effetti attesi sul vento al campo (rotazioni, rinforzi, passaggi frontali), 4) coerenza o contrasti tra carta e modelli locali, 5) cosa tenere d'occhio. Usa titoli brevi con ### ed elenchi.` });
    out.innerHTML = md(await askClaude(content, SYS_METEO, 2500));
    SYN && (SYN.aiText = out.innerText);
  } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

/* ---------------------------------------------------------- barche e vele */
const boat = () => S.boats.find(b => b.id === S.boatId) || S.boats[0];
const SAIL_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#008300', '#4a3aa7', '#e34948', '#5f7f8f', '#8a5a2b', '#0d6b78', '#7a4fb0'];
const sailColor = i => SAIL_COLORS[i % SAIL_COLORS.length];

function pointOfSail(twa) { twa = Math.abs(twa); return twa < 60 ? 'bolina' : twa < 105 ? 'traverso' : twa < 145 ? 'lasco' : 'poppa'; }
function pickSail(twa, tws, b = boat()) {
  twa = Math.abs(twa);
  const i = b.sails.findIndex(s => twa >= s.twaMin && twa <= s.twaMax && tws >= s.twsMin && tws <= s.twsMax);
  if (i >= 0) return { sail: b.sails[i], i, exact: true };
  let best = -1, bd = 1e9;
  b.sails.forEach((s, k) => { const da = Math.max(0, s.twaMin - twa, twa - s.twaMax), ds = Math.max(0, s.twsMin - tws, tws - s.twsMax); const d = da / 10 + ds / 2; if (d < bd) { bd = d; best = k; } });
  return best >= 0 ? { sail: b.sails[best], i: best, exact: false } : null;
}

function renderBoats() {
  const opts = S.boats.map(b => `<option value="${esc(b.id)}" ${b.id === S.boatId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  $('#boatSel').innerHTML = opts; $('#rBoat').innerHTML = opts;
  const b = boat();
  $('#boatName').value = b.name; $('#boatUp').value = b.upAngle; $('#boatDown').value = b.downAngle;
  $('#exampleNote').hidden = !b.example;
  $('#boatSpeeds').innerHTML = ['bolina', 'traverso', 'lasco', 'poppa'].map(k => `<label class="f">${k}<input type="number" step="0.1" min="0" data-sp="${k}" value="${b.speeds[k]}" style="width:90px"></label>`).join('');
  $$('#boatSpeeds input').forEach(inp => inp.onchange = () => { b.speeds[inp.dataset.sp] = +inp.value; b.example = false; save(); renderBoats(); });
  const tb = $('#sailTable tbody'); tb.innerHTML = '';
  b.sails.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="swatch" style="background:${sailColor(i)}"></span></td>
      <td><input id="sn${i}" value="${esc(s.name)}" aria-label="Nome vela"></td>
      ${['twaMin', 'twaMax', 'twsMin', 'twsMax'].map(k => `<td><input id="s${k}${i}" type="number" value="${s[k]}" data-k="${k}" style="width:68px" aria-label="${k}"></td>`).join('')}
      <td style="white-space:nowrap"><button class="btn ghost" data-a="up" title="Sposta su">↑</button><button class="btn ghost" data-a="del" title="Elimina">✕</button></td>`;
    $('input', tr).onchange = e => { s.name = e.target.value; b.example = false; save(); renderBoats(); };
    $$('input[data-k]', tr).forEach(inp => inp.onchange = () => { s[inp.dataset.k] = +inp.value; b.example = false; save(); renderBoats(); });
    $('[data-a=up]', tr).onclick = () => { if (i) { [b.sails[i - 1], b.sails[i]] = [b.sails[i], b.sails[i - 1]]; save(); renderBoats(); } };
    $('[data-a=del]', tr).onclick = () => { b.sails.splice(i, 1); save(); renderBoats(); };
    tb.append(tr);
  });
  $('#sailLegend').innerHTML = b.sails.map((s, i) => `<span><i class="swatch" style="background:${sailColor(i)}"></i>${esc(s.name)}</span>`).join('');
  drawSailChart();
}

let sGeom = null;
function drawSailChart() {
  const cv = $('#sailchart'); if (!cv.clientWidth) return;
  const { g, w, h } = setupCanvas(cv); const b = boat();
  const L = 40, R = 12, T = 12, B = 30, pw = w - L - R, ph = h - T - B;
  const twsMax = 40;
  const x = a => L + (a - 20) / 160 * pw, y = s => T + ph - s / twsMax * ph;
  sGeom = { x, y, L, T, pw, ph, twsMax };
  const rule = cssv('--rule'), ink3 = cssv('--ink-3'), ink = cssv('--ink');
  g.font = '11px ' + cssv('--f-mono');
  // vele dalla meno prioritaria alla più prioritaria (quella in alto nella lista vince)
  for (let i = b.sails.length - 1; i >= 0; i--) {
    const s = b.sails[i]; const x0 = x(clamp(s.twaMin, 20, 180)), x1 = x(clamp(s.twaMax, 20, 180)), y0 = y(clamp(s.twsMax, 0, twsMax)), y1 = y(clamp(s.twsMin, 0, twsMax));
    g.fillStyle = sailColor(i) + '55'; g.strokeStyle = sailColor(i); g.lineWidth = 1.5;
    g.fillRect(x0, y0, x1 - x0, y1 - y0); g.strokeRect(x0 + .75, y0 + .75, x1 - x0 - 1.5, y1 - y0 - 1.5);
  }
  for (let i = b.sails.length - 1; i >= 0; i--) {
    const s = b.sails[i]; const x0 = x(clamp(s.twaMin, 20, 180)), y1 = y(clamp(s.twsMin, 0, twsMax));
    g.fillStyle = ink; g.font = '600 11px ' + cssv('--f-body'); g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(s.name, x0 + 4, y1 - 3);
  }
  g.font = '11px ' + cssv('--f-mono'); g.fillStyle = ink3; g.strokeStyle = rule; g.lineWidth = 1;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let s = 0; s <= twsMax; s += 10) { g.beginPath(); g.moveTo(L, y(s) + .5); g.lineTo(L + pw, y(s) + .5); g.stroke(); g.fillText(s, L - 6, y(s)); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let a = 30; a <= 180; a += 30) g.fillText(a + '°', x(a), T + ph + 6);
  g.fillText('TWA (angolo al vento reale)', L + pw / 2, T + ph + 18 > h - 12 ? h - 12 : T + ph + 18);
  g.save(); g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText('TWS (nodi)', 0, 0); g.restore();
  // lati
  if (LEGS) LEGS.forEach((lg, k) => {
    if (lg.tws == null) return;
    const px = x(clamp(Math.abs(lg.twa), 20, 180)), py = y(clamp(lg.tws, 0, twsMax));
    g.fillStyle = cssv('--panel'); g.beginPath(); g.arc(px, py, 10, 0, 7); g.fill();
    g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
    g.fillStyle = ink; g.font = '700 11px ' + cssv('--f-body'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k + 1, px, py + .5);
  });
}

/* ---------------------------------------------------------- percorso */
function renderWps() {
  const tb = $('#wpTable tbody'); tb.innerHTML = '';
  S.route.wps.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${i === 0 ? 'P' : i}</td>
      <td><input id="wpn${i}" value="${esc(p.name)}" placeholder="${i === 0 ? 'Partenza' : 'Boa'}"></td>
      <td><input id="wpc${i}" value="${p.lat != null ? fmtDM(p.lat, p.lon) : ''}" placeholder="44°18.5'N 9°12.3'E"></td>
      <td><select id="wpr${i}"><option value="">—</option><option value="sinistra" ${p.round === 'sinistra' ? 'selected' : ''}>sinistra</option><option value="dritta" ${p.round === 'dritta' ? 'selected' : ''}>dritta</option></select></td>
      <td style="white-space:nowrap"><button class="btn ghost" data-a="up" title="Sposta su">↑</button><button class="btn ghost" data-a="del" title="Elimina">✕</button></td>`;
    $(`#wpn${i}`, tr).onchange = e => { p.name = e.target.value; save(); };
    $(`#wpc${i}`, tr).onchange = e => { const c = parseCoords(e.target.value); if (c) { p.lat = c[0]; p.lon = c[1]; e.target.value = fmtDM(c[0], c[1]); } else { toast('Coordinate non riconosciute'); } save(); };
    $(`#wpr${i}`, tr).onchange = e => { p.round = e.target.value; save(); };
    $('[data-a=up]', tr).onclick = () => { if (i) { [S.route.wps[i - 1], S.route.wps[i]] = [S.route.wps[i], S.route.wps[i - 1]]; save(); renderWps(); } };
    $('[data-a=del]', tr).onclick = () => { S.route.wps.splice(i, 1); save(); renderWps(); };
    tb.append(tr);
  });
  if (!S.route.wps.length) tb.innerHTML = '<tr><td colspan="5" class="muted small">Nessun punto. Fotografi le istruzioni di regata o aggiunga le boe a mano.</td></tr>';
  $('#rStart').value = S.route.start || ''; $('#rNotes').value = S.route.notes || '';
}

async function readIdR(files) {
  const st = $('#idrStatus'); st.innerHTML = '<span class="spin"></span> Leggo le istruzioni…';
  try {
    const content = [];
    for (const f of files) content.push(await fileToBlock(f, 2000));
    content.push({ type: 'text', text: `Queste sono le istruzioni di regata (o parti di esse). Estrai il percorso in JSON, senza altro testo:
{"start":"YYYY-MM-DDTHH:MM" (ora locale del primo segnale di partenza, se presente, altrimenti null),
 "waypoints":[{"name":"...","lat":numero decimale o null,"lon":numero decimale o null,"round":"sinistra"|"dritta"|"" }],
 "notes":"cancelli, zone vietate, linea d'arrivo, tempo limite, percorsi alternativi, canale VHF e altre informazioni utili alla tattica"}
Il primo waypoint è la partenza, l'ultimo l'arrivo. Converti le coordinate in gradi decimali (W e S negativi). Se una boa è un'isola o un punto noto senza coordinate, stima le coordinate e scrivi "(stimate)" nel nome. Se ci sono più percorsi, usa quello principale e descrivi gli altri nelle note.` });
    const t = await askClaude(content, 'Estrai dati strutturati da documenti di regata. Rispondi solo con JSON valido.', 3000);
    const j = extractJSON(t);
    S.route.wps = (j.waypoints || []).map(w => ({ name: w.name || '', lat: w.lat ?? null, lon: w.lon ?? null, round: w.round || '' }));
    if (j.start) S.route.start = j.start.slice(0, 16);
    if (j.notes) S.route.notes = j.notes;
    save(); renderWps();
    st.textContent = `Trovati ${S.route.wps.length} punti. Controlli coordinate e lati di passaggio prima di calcolare.`;
  } catch (e) { st.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}

async function readSails(files) {
  const st = $('#sailStatus'); st.innerHTML = '<span class="spin"></span> Leggo le tabelle…';
  try {
    const content = [];
    for (const f of files) content.push(await fileToBlock(f, 2000));
    content.push({ type: 'text', text: `Queste sono tabelle o grafici di utilizzo delle vele di una barca (crossover chart, tabelle di velaio, polari). Estrai in JSON, senza altro testo:
{"boat":"nome barca se presente o null","sails":[{"name":"...","twaMin":num,"twaMax":num,"twsMin":num,"twsMax":num}],"upAngle":num o null,"downAngle":num o null,"speeds":{"bolina":num,"traverso":num,"lasco":num,"poppa":num} oppure null}
TWA in gradi (0-180), TWS in nodi. Se una vela ha un'area non rettangolare, usa il rettangolo che la rappresenta meglio. Ordina dalla vela più specifica alla più generica.` });
    const j = extractJSON(await askClaude(content, 'Estrai dati strutturati da tabelle tecniche di vela. Rispondi solo con JSON valido.', 3000));
    const b = boat();
    if (b.example) { const nb = { id: 'b' + Date.now(), name: j.boat || 'Nuova barca', upAngle: j.upAngle || 40, downAngle: j.downAngle || 150, speeds: { ...EXAMPLE_BOAT.speeds }, sails: [] }; S.boats.push(nb); S.boatId = nb.id; }
    const t = boat();
    t.sails = (j.sails || []).filter(s => s.name).map(s => ({ name: s.name, twaMin: +s.twaMin || 0, twaMax: +s.twaMax || 180, twsMin: +s.twsMin || 0, twsMax: +s.twsMax || 40 }));
    if (j.upAngle) t.upAngle = j.upAngle; if (j.downAngle) t.downAngle = j.downAngle;
    if (j.speeds) for (const k of Object.keys(t.speeds)) if (j.speeds[k]) t.speeds[k] = j.speeds[k];
    t.example = false; save(); renderBoats();
    st.textContent = `Lette ${t.sails.length} vele. Le controlli nella tabella.`;
  } catch (e) { st.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}

/* calcolo lati */
function destPoint(lat, lon, brg, nm) {
  const d = nm / 3440.065, b = brg * DEG, p1 = lat * DEG, l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / DEG, l2 / DEG];
}
async function calcLegs() {
  const wps = S.route.wps.filter(p => p.lat != null && p.lon != null);
  const st = $('#legsStatus');
  if (wps.length < 2) return toast('Servono almeno due punti con coordinate');
  if (!S.route.start) return toast('Inserisca l\'ora di partenza');
  if (!W) return toast('Scelga prima una posizione nella scheda Vento');
  st.innerHTML = '<span class="spin"></span> Scarico il vento lungo il percorso…';
  try {
    const b = boat();
    // punti di campionamento: per ogni lato inizio, metà, fine + lati sinistro/destro della rotta
    const legs = [];
    for (let i = 0; i < wps.length - 1; i++) {
      const A = wps[i], B = wps[i + 1];
      const dist = haversineNm(A.lat, A.lon, B.lat, B.lon), brg = bearing(A.lat, A.lon, B.lat, B.lon);
      const mid = destPoint(A.lat, A.lon, brg, dist / 2);
      const off = clamp(dist * 0.25, 1, 12);
      legs.push({ from: A, to: B, dist, brg, pts: [[A.lat, A.lon], mid, [B.lat, B.lon], destPoint(mid[0], mid[1], brg - 90, off), destPoint(mid[0], mid[1], brg + 90, off)], off });
    }
    const pts = legs.flatMap(l => l.pts);
    const models = C.ranking.slice(0, 4).map(r => r.id);
    if (!models.includes('ecmwf_ifs')) models.push('ecmwf_ifs');
    const j0 = await getJSON(`${OM}?latitude=${pts.map(p => p[0].toFixed(3)).join(',')}&longitude=${pts.map(p => p[1].toFixed(3)).join(',')}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&models=${models.join(',')}&timezone=GMT&forecast_days=7`);
    const arr = Array.isArray(j0) ? j0 : [j0];
    const ctx = S.ctx;
    const series = arr.map(j => {
      const times = j.hourly.time.map(t => Date.parse(t + 'Z'));
      const srs = {};
      models.forEach(id => { const g = v => j.hourly[models.length === 1 ? v : `${v}_${id}`]; const s = g('wind_speed_10m'); if (s && s.some(v => v != null)) srs[id] = { spd: s, dir: g('wind_direction_10m'), gst: g('wind_gusts_10m'), p: null }; });
      const c = consensus({ times, series: srs }, ctx);
      return { times, spd: c.spd, dir: c.dir, gst: c.gst, sd: c.sd };
    });
    const windAt = (pi, t) => { const s = series[pi]; return { tws: interpAt(s.times, s.spd, t), twd: interpAt(s.times, s.dir, t, true), gst: interpAt(s.times, s.gst, t), sd: interpAt(s.times, s.sd, t) }; };

    let t = localInputToMs(S.route.start), pIdx = 0;
    LEGS = legs.map((lg, k) => {
      const base = k * 5;
      const w0 = windAt(base, t);
      const twa0 = angDiff(lg.brg, w0.twd); // + = vento da dritta
      const pos = pointOfSail(twa0);
      // velocità lungo la rotta: in bolina o poppa piena si bordeggia
      let vs = b.speeds[pos] || 6, vmg = vs;
      if (Math.abs(twa0) < b.upAngle) vmg = vs * Math.cos(b.upAngle * DEG) / Math.max(0.2, Math.cos(Math.abs(twa0) * DEG));
      if (Math.abs(twa0) > b.downAngle) vmg = vs * Math.cos((180 - b.downAngle) * DEG) / Math.max(0.2, Math.cos((180 - Math.abs(twa0)) * DEG));
      vmg = Math.max(1.5, Math.min(vs, vmg));
      if (w0.tws != null && w0.tws < 4) vmg *= Math.max(0.35, w0.tws / 4);
      const dur = lg.dist / vmg * 3600e3;
      const t0 = t, t1 = t + dur, tm = t + dur / 2;
      const wm = windAt(base + 1, tm), w1 = windAt(base + 2, t1), wl = windAt(base + 3, tm), wr = windAt(base + 4, tm);
      const twa = angDiff(lg.brg, wm.twd);
      // vele nel corso del lato, ogni 30'
      const changes = []; let last = null;
      for (let tt = t0; tt <= t1 + 1; tt += Math.max(30 * 60e3, dur / 12)) {
        const f = (tt - t0) / Math.max(dur, 1);
        const ww = f < 0.5 ? windAt(base, tt) : windAt(base + 2, tt);
        const wmid = windAt(base + 1, tt);
        const tws = ww.tws == null ? wmid.tws : (ww.tws + wmid.tws) / 2, twd = wmid.twd;
        if (tws == null || twd == null) continue;
        const sp = pickSail(angDiff(lg.brg, twd), tws, b);
        if (sp && sp.sail.name !== last) { changes.push({ t: tt, sail: sp.sail.name, i: sp.i, exact: sp.exact, tws, twa: angDiff(lg.brg, twd) }); last = sp.sail.name; }
      }
      // note tattiche automatiche
      const notes = [];
      const shift = (w1.twd != null && w0.twd != null) ? angDiff(w0.twd, w1.twd) : 0;
      const absT = Math.abs(twa);
      if (absT < b.upAngle + 5) {
        notes.push(`Lato di bolina: rotta diretta non possibile, si bordeggia (circa ${r1(lg.dist / Math.cos(b.upAngle * DEG))} mn percorsi).`);
        if (Math.abs(shift) >= 8) notes.push(`Il vento ruota ${shift > 0 ? 'a destra' : 'a sinistra'} di ${Math.round(Math.abs(shift))}° durante il lato: favorito il lato ${shift > 0 ? 'destro' : 'sinistro'} del campo (si va incontro alla rotazione). Primo bordo consigliato: ${shift > 0 ? 'mure a sinistra' : 'mure a dritta'}.`);
        else { const side = angDiff(lg.brg, wm.twd); notes.push(Math.abs(side) > 4 ? `Vento ${side > 0 ? 'a destra' : 'a sinistra'} della rotta di ${Math.round(Math.abs(side))}°: il bordo lungo (più diretto alla boa) è ${side > 0 ? 'mure a dritta' : 'mure a sinistra'}.` : 'Vento quasi in prua alla boa: bordi simmetrici, decidere sulle raffiche.'); }
      } else if (absT > b.downAngle - 5) {
        notes.push(`Lato di poppa piena: conviene strambare su angoli più stretti (circa ${b.downAngle}°) per la VMG.`);
        if (Math.abs(shift) >= 8) notes.push(`Rotazione ${shift > 0 ? 'a destra' : 'a sinistra'} di ${Math.round(Math.abs(shift))}°: strambare per restare sulle mure che puntano più verso la boa dopo la rotazione.`);
      } else {
        notes.push(`Andatura di ${pointOfSail(twa)}, mure a ${twa > 0 ? 'dritta' : 'sinistra'} (vento da ${twa > 0 ? 'dritta' : 'sinistra'}).`);
        if (Math.abs(shift) >= 15) notes.push(`Il vento ruota di ${Math.round(Math.abs(shift))}° lungo il lato: l'angolo cambia da ${Math.round(Math.abs(twa0))}° a ${Math.round(Math.abs(angDiff(lg.brg, w1.twd)))}°.`);
      }
      if (wl.tws != null && wr.tws != null && Math.abs(wl.tws - wr.tws) >= 2) notes.push(`Più pressione sul lato ${wl.tws > wr.tws ? 'sinistro' : 'destro'} della rotta (${Math.round(Math.max(wl.tws, wr.tws))} kn contro ${Math.round(Math.min(wl.tws, wr.tws))} kn a ${Math.round(lg.off)} mn).`);
      if (wm.sd != null && wm.tws && wm.sd / Math.max(wm.tws, 6) > 0.35) notes.push('Modelli in disaccordo su questo lato: tenersi flessibili.');
      if (wm.tws != null && wm.tws < 5) notes.push('Rischio di bonaccia: cercare pressione e restare vicino alla rotta media.');
      const res = { k, name: `${lg.from.name || 'P'} → ${lg.to.name || 'boa'}`, round: lg.to.round, dist: lg.dist, brg: lg.brg, t0, t1, tws: wm.tws, twd: wm.twd, gst: wm.gst, twa, pos: pointOfSail(twa), vmg, changes, notes, shift, left: wl.tws, right: wr.tws };
      t = t1;
      return res;
    });
    renderLegs();
    st.textContent = '';
  } catch (e) { st.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}
function renderLegs() {
  $('#legsPanel').hidden = false;
  const tot = LEGS.reduce((a, l) => a + l.dist, 0);
  $('#legsMeta').textContent = `${r1(tot)} mn · arrivo stimato ${fmtT(LEGS.at(-1).t1)} · barca: ${boat().name}`;
  $('#legs').innerHTML = LEGS.map((l, k) => `
    <div class="leg">
      <div class="leg-h"><b>${k + 1}. ${esc(l.name)}</b><span class="small muted">${l.round ? 'boa da lasciare a ' + l.round : ''}</span></div>
      <div class="leg-g">
        <div><span>Rotta</span><b>${Math.round(l.brg)}° · ${r1(l.dist)} mn</b></div>
        <div><span>Orario</span><b>${fmtT(l.t0, { time: true })} → ${fmtT(l.t1, { time: true })}</b></div>
        <div><span>Vento a metà lato</span><b>${l.tws == null ? '—' : Math.round(l.tws) + ' kn ' + card(l.twd) + ' ' + Math.round(l.twd) + '°'}</b></div>
        <div><span>Angolo al vento</span><b>${Math.round(Math.abs(l.twa))}° ${l.twa > 0 ? 'mure a dritta' : 'mure a sinistra'}</b></div>
        <div><span>Andatura</span><b>${l.pos}</b></div>
        <div><span>Velocità utile</span><b>${r1(l.vmg)} kn</b></div>
      </div>
      <div class="row">${l.changes.map((c, i) => `<span class="sail" style="background:${sailColor(c.i)}">${esc(c.sail)}${c.exact ? '' : ' *'}</span>${i < l.changes.length - 1 ? `<span class="small muted">→ cambio verso le ${fmtT(l.changes[i + 1].t, { time: true })} →</span>` : ''}`).join('')}</div>
      ${l.changes.some(c => !c.exact) ? '<div class="small muted">* fuori dai range della tabella: vela più vicina.</div>' : ''}
      <ul>${l.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </div>`).join('');
  drawSailChart();
}

async function tacticsAI() {
  const out = $('#tacOut'), st = $('#tacStatus');
  if (!W) return toast('Serve prima la previsione (scheda Vento)');
  st.innerHTML = '<span class="spin"></span> Preparo la tattica…'; out.innerHTML = '';
  try {
    const b = boat();
    const legs = LEGS ? LEGS.map(l => `Lato ${l.k + 1} ${l.name}: rotta ${Math.round(l.brg)}°, ${r1(l.dist)} mn, ${fmtT(l.t0)}→${fmtT(l.t1)}, vento ${l.tws == null ? '?' : Math.round(l.tws)} kn da ${Math.round(l.twd)}°, TWA ${Math.round(l.twa)}°, rotazione durante il lato ${Math.round(l.shift)}°, pressione sx ${l.left == null ? '?' : Math.round(l.left)} kn / dx ${l.right == null ? '?' : Math.round(l.right)} kn, vele: ${l.changes.map(c => c.sail + ' da ' + fmtT(c.t, { time: true })).join(', ')}${l.round ? ', boa a ' + l.round : ''}`).join('\n') : 'Percorso non calcolato.';
    const text = `Prepara il piano tattico per questa regata.\n\nBARCA: ${b.name}; angolo di bolina ${b.upAngle}°, poppa ${b.downAngle}°; velocità ${JSON.stringify(b.speeds)}.\nVELE (TWA/TWS): ${b.sails.map(s => `${s.name} ${s.twaMin}-${s.twaMax}° ${s.twsMin}-${s.twsMax} kn`).join('; ')}\n\nPERCORSO E LATI CALCOLATI:\n${legs}\nNote IdR: ${S.route.notes || '—'}\n\nPREVISIONE (consenso pesato dei modelli migliori per la zona):\n${forecastDigest(96)}\n\nSINOTTICA:\n${synDigest()}\n${SYN?.aiText ? '\nLettura sinottica già fatta:\n' + SYN.aiText.slice(0, 3000) : ''}\n\nScrivi in sezioni brevi con ###: 1) Sintesi in 3 righe, 2) Partenza (lato favorito della linea, mure, prima scelta), 3) Lato per lato: dove andare, quando virare/strambare, vele e cambi con orari, 4) Momenti chiave (rotazioni, passaggi frontali, bonacce, notte), 5) Piano B se la previsione sbaglia (segnali da osservare in acqua), 6) Checklist vele da preparare in coperta per ogni lato.`;
    out.innerHTML = md(await askClaude([{ type: 'text', text }], SYS_METEO, 4000));
    st.textContent = 'Piano generato ' + fmtT(Date.now());
  } catch (e) { st.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}

/* ---------------------------------------------------------- navigazione */
function showTab(t) {
  $$('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('section.view').forEach(s => s.hidden = s.id !== 'v-' + t);
  try { history.replaceState(null, '', '#' + t); } catch (e) { }
  if (t === 'vento') { setTimeout(() => { initLocMap(); locMap && locMap.invalidateSize(); if (W) { drawWind(); drawWave(); } }, 30); }
  if (t === 'sinottica') { setTimeout(() => { if (synMap) synMap.invalidateSize(); else if (S.loc && !SYN) loadSynoptic(); }, 30); }
  if (t === 'vele') setTimeout(drawSailChart, 30);
  window.scrollTo(0, 0);
}

function bind() {
  $$('nav.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('#locSearch').onclick = searchLoc;
  $('#locq').onkeydown = e => { if (e.key === 'Enter') searchLoc(); };
  $('#locGps').onclick = gps;
  $('#refreshBtn').onclick = () => { refreshWind(); if (SYN) loadSynoptic(); };
  $$('#ctxSeg button').forEach(b => b.onclick = () => setCtx(b.dataset.v));
  $$('#rangeSeg button').forEach(b => b.onclick = () => { S.range = +b.dataset.v; save(); $$('#rangeSeg button').forEach(x => x.setAttribute('aria-pressed', x === b)); if (W) renderWind(); });
  const cv = $('#wchart');
  cv.addEventListener('mousemove', hoverWind); cv.addEventListener('touchstart', hoverWind, { passive: true }); cv.addEventListener('touchmove', hoverWind, { passive: true });
  cv.addEventListener('mouseleave', () => { $('#wtip').hidden = true; if (W) drawWind(); });
  $('#synLoad').onclick = loadSynoptic;
  $('#synT').oninput = e => drawSynoptic(+e.target.value);
  $('#synImgs').onchange = e => { synImgs = [...e.target.files]; $('#synImgsN').textContent = synImgs.length ? synImgs.length + ' carte aggiunte' : ''; };
  $('#synAI').onclick = synAI;
  $('#idrFile').onchange = e => e.target.files.length && readIdR([...e.target.files]);
  $('#sailImg').onchange = e => e.target.files.length && readSails([...e.target.files]);
  $('#rStart').onchange = e => { S.route.start = e.target.value; save(); };
  $('#rNotes').onchange = e => { S.route.notes = e.target.value; save(); };
  $('#rBoat').onchange = e => { S.boatId = e.target.value; save(); renderBoats(); };
  $('#wpAdd').onclick = () => { S.route.wps.push({ name: '', lat: null, lon: null, round: '' }); save(); renderWps(); };
  $('#wpHere').onclick = () => { if (!S.loc) return toast('Nessuna posizione impostata'); S.route.wps.push({ name: S.loc.name, lat: S.loc.lat, lon: S.loc.lon, round: '' }); save(); renderWps(); };
  $('#wpClear').onclick = () => { if ($('#wpClear').dataset.c) { S.route.wps = []; save(); renderWps(); delete $('#wpClear').dataset.c; $('#wpClear').textContent = 'Svuota'; } else { $('#wpClear').dataset.c = 1; $('#wpClear').textContent = 'Conferma: svuota'; setTimeout(() => { delete $('#wpClear').dataset.c; $('#wpClear').textContent = 'Svuota'; }, 3000); } };
  $('#legsCalc').onclick = calcLegs;
  $('#tacAI').onclick = tacticsAI;
  $('#boatSel').onchange = e => { S.boatId = e.target.value; save(); renderBoats(); };
  $('#boatNew').onclick = () => { const nb = { id: 'b' + Date.now(), name: 'Nuova barca', upAngle: 40, downAngle: 150, speeds: { bolina: 6, traverso: 7.5, lasco: 8, poppa: 7 }, sails: [] }; S.boats.push(nb); S.boatId = nb.id; save(); renderBoats(); };
  $('#boatDel').onclick = () => { if (S.boats.length < 2) return toast('Serve almeno una barca'); S.boats = S.boats.filter(b => b.id !== S.boatId); S.boatId = S.boats[0].id; save(); renderBoats(); };
  $('#boatName').onchange = e => { boat().name = e.target.value; save(); renderBoats(); };
  $('#boatUp').onchange = e => { boat().upAngle = +e.target.value; save(); };
  $('#boatDown').onchange = e => { boat().downAngle = +e.target.value; save(); };
  $('#sailAdd').onclick = () => { boat().sails.push({ name: 'Nuova vela', twaMin: 30, twaMax: 60, twsMin: 0, twsMax: 15 }); save(); renderBoats(); };
  $('#apiKey').value = S.apiKey; $('#aiModel').value = S.aiModel;
  $('#apiSave').onclick = () => { S.apiKey = $('#apiKey').value.trim(); S.aiModel = $('#aiModel').value.trim() || 'claude-sonnet-5-5'; save(); $('#apiStatus').textContent = 'Salvato'; };
  $('#apiTest').onclick = async () => { $('#apiSave').click(); $('#apiStatus').innerHTML = '<span class="spin"></span>'; try { await askClaude([{ type: 'text', text: 'Rispondi solo: ok' }], 'Test', 10); $('#apiStatus').textContent = 'Funziona'; } catch (e) { $('#apiStatus').innerHTML = `<span class="err">${esc(e.message)}</span>`; } };
  $('#exportBtn').onclick = () => { const box = $('#exportBox'); box.hidden = false; box.value = JSON.stringify({ boats: S.boats, route: S.route }, null, 1); box.select(); try { navigator.clipboard.writeText(box.value); toast('Copiato negli appunti'); } catch (e) { } };
  $('#importFile').onchange = async e => { try { const j = JSON.parse(await e.target.files[0].text()); if (j.boats) S.boats = j.boats; if (j.route) S.route = j.route; S.boatId = S.boats[0].id; save(); renderBoats(); renderWps(); toast('Importato'); } catch (err) { toast('File non valido'); } };
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (W && C) { drawWind(); drawWave(); } drawSailChart(); }, 150); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (W && C) { drawWind(); drawWave(); } drawSailChart(); });
}

function init() {
  bind();
  $$('#ctxSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.ctx));
  $$('#rangeSeg button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.v === S.range));
  renderBoats(); renderWps(); renderLocChip();
  const tab = (location.hash || '#vento').slice(1);
  showTab(['vento', 'sinottica', 'percorso', 'vele', 'impostazioni'].includes(tab) ? tab : 'vento');
  if (W && S.loc) { renderWind(); if ((Date.now() - W.fetched) > 30 * 60e3) refreshWind(); }
  else if (S.loc) refreshWind();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
}
if (typeof window !== 'undefined' && document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
