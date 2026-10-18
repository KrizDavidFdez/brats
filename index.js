// ─────────────────────────────────────────────────────────────────────────────
//  YT Music Downloader – un solo archivo (sin yt-dlp)
//  Requisitos:   npm i express youtubei.js
//  Ejecutar:     node server.js   →   http://localhost:3000
// ─────────────────────────────────────────────────────────────────────────────
const dns = require('node:dns');
const net = require('node:net');
const { existsSync, readFileSync } = require('node:fs');
const express = require('express');

// La URL de googlevideo queda atada a la IP con que se pidió: si Node alterna
// IPv4/IPv6 entre "resolver" y "descargar" → 403. Forzamos IPv4 siempre.
dns.setDefaultResultOrder('ipv4first');
try { net.setDefaultAutoSelectFamily(false); } catch {}

const BASE_URL = 'https://music.youtube.com';
const MAX_PIECE = 9 * 1024 * 1024;
const MIN_PIECE = 256 * 1024;
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_VR = 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
const UA_IOS = 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)';
const UA_VISION = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ───────────────────────── Utilidades ───────────────────────── */

function parseCookies(input = null) {
  if (input && typeof input === 'string' && input.includes('=')) return input.trim();
  for (const f of ['ytmusic.txt', 'ytcook.txt']) {
    if (!existsSync(f)) continue;
    try {
      return readFileSync(f, 'utf8').split('\n').map(l => l.trim())
        .filter(l => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_')))
        .map(l => {
          const c = l.replace(/^#HttpOnly_/, '');
          const p = c.includes('\t') ? c.split('\t') : c.split(/\s+/);
          return p.length >= 7 ? `${p[5]}=${p[6]}` : l;
        }).join('; ');
    } catch {}
  }
  return '';
}
const cookiesFile = () => ['ytmusic.txt', 'ytcook.txt'].find(existsSync);

function extractVideoId(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?(?:.+&)?v=))([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{11}$/.test(s) ? s : null;
}

/* ───────────────────────── Innertube (búsqueda) ───────────────────────── */

let ctxCache = null, ctxTime = 0;
async function getInnertubeConfig() {
  const cookieHeader = parseCookies();
  if (ctxCache && Date.now() - ctxTime < 1800000) return ctxCache;
  const [html, visitorData] = await Promise.all([
    fetch(BASE_URL, { headers: { 'User-Agent': CHROME_UA, 'Accept-Language': 'en-US,en;q=0.9', ...(cookieHeader ? { Cookie: cookieHeader } : {}) } }).then(r => r.text()),
    fetch('https://www.youtube.com/sw.js_data', { headers: cookieHeader ? { Cookie: cookieHeader } : {} })
      .then(r => r.text()).then(t => JSON.parse(t.slice(5))[0][2][0][0][13]).catch(() => undefined)
  ]);
  const apiKey = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/)?.[1] || '1.20261011.16.00';
  ctxCache = { apiKey, visitorData, cookieHeader, context: { client: { clientName: 'WEB_REMIX', clientVersion, hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) } } };
  ctxTime = Date.now();
  return ctxCache;
}

async function apiRequest(endpoint, payload) {
  const cfg = await getInnertubeConfig();
  const res = await fetch(`${BASE_URL}/youtubei/v1/${endpoint}?key=${cfg.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Referer: `${BASE_URL}/`, 'User-Agent': CHROME_UA, ...(cfg.cookieHeader ? { Cookie: cfg.cookieHeader } : {}) },
    body: JSON.stringify({ context: cfg.context, ...payload })
  });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  return res.json();
}

const flex = (ir, i) => ir?.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

function parseItem(item) {
  const ir = item.musicResponsiveListItemRenderer;
  if (!ir) return null;
  const c0 = flex(ir, 0), c1 = flex(ir, 1), c2 = flex(ir, 2);
  const videoId = ir.playlistItemData?.videoId
    || ir.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
    || c0[0]?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;
  const artists = c1.filter(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')).map(r => ({ name: r.text }));
  const dur = [...c1, ...c2].find(r => /^\d+:\d+$/.test(r.text))?.text
    || ir.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || null;
  return { videoId, title: c0[0]?.text || '', artists, duration: dur, thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` };
}

async function searchMusic(q) {
  const data = await apiRequest('search', { query: q, params: 'EgWKAQIIAWoSEAUQAxAJEAoQERAQEAQQDhAV' });
  const sec = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  return (sec[0]?.musicShelfRenderer?.contents || []).map(parseItem).filter(Boolean);
}

/* ───────────────────────── Resolvers de stream ─────────────────────────
   Cada resolver devuelve { url, headers, size, ext, mimeType, title, author }.
   Toda URL se VALIDA con una petición real antes de aceptarla (evita el 403). */

const withRange = (url, a, b) => `${url}${url.includes('?') ? '&' : '?'}range=${a}-${b}`;

async function probe(url, headers) {
  try {
    const r = await fetch(withRange(url, 0, 1), { headers });
    r.body?.cancel().catch(() => {});
    if (r.status !== 200 && r.status !== 206) return { ok: false, error: `HTTP ${r.status}` };
    const cr = r.headers.get('content-range');
    let total = cr ? parseInt(cr.split('/')[1], 10) : 0;
    if (!total) total = parseInt(new URL(url).searchParams.get('clen'), 10) || 0;
    if (!total && r.status === 200) total = parseInt(r.headers.get('content-length'), 10) || 0;
    return { ok: true, total };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function oembed(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    const j = await r.json();
    return { title: j.title, author: (j.author_name || '').replace(/\s*-\s*Topic$/i, '') };
  } catch { return {}; }
}

const std = (h) => ({ Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...h });

// 1) Clientes "raw" de Innertube
const RAW = {
  ANDROID_VR: { ua: UA_VR, client: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' } },
  VISIONOS: { ua: UA_VISION, client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471' } },
  IOS: { ua: UA_IOS, client: { clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83' } }
};

async function resolveRaw(id, name) {
  const c = RAW[name];
  const cfg = await getInnertubeConfig();
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, ...(cfg.cookieHeader ? { Cookie: cfg.cookieHeader } : {}) },
    body: JSON.stringify({ context: { client: { ...c.client, visitorData: cfg.visitorData, hl: 'en', gl: 'US' } }, videoId: id })
  });
  const data = await res.json();
  if (data.playabilityStatus?.status !== 'OK') throw new Error(data.playabilityStatus?.reason || data.playabilityStatus?.status || 'no OK');
  const afs = data.streamingData?.adaptiveFormats || [];
  const f = afs.find(x => x.itag === 140 && x.url) || afs.find(x => x.itag === 251 && x.url) || afs.find(x => x.mimeType?.includes('audio') && x.url);
  if (!f) throw new Error('sin formato de audio con URL directa');
  const vd = data.videoDetails || {};
  return {
    url: f.url, headers: std({ 'User-Agent': c.ua }),
    size: parseInt(f.contentLength, 10) || 0,
    ext: f.mimeType?.includes('mp4') ? 'm4a' : 'webm', mimeType: f.mimeType?.split(';')[0],
    title: vd.title, author: (vd.author || '').replace(/\s*-\s*Topic$/i, '')
  };
}

// 2) youtubei.js (descifra firmas/"n" por sí mismo)
let ytPromise = null;
const getYT = () => (ytPromise ||= import('youtubei.js').then(m => m.Innertube.create({ retrieve_player: true })).catch(e => { ytPromise = null; throw new Error('youtubei.js no instalado (npm i youtubei.js): ' + e.message); }));
const YT_UA = { ANDROID_VR: UA_VR, IOS: UA_IOS, ANDROID: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip' };

async function resolveYtjs(id, client) {
  const yt = await getYT();
  let fmt;
  try { fmt = await yt.getStreamingData(id, { type: 'audio', quality: 'best', format: 'mp4', client }); }
  catch { fmt = await yt.getStreamingData(id, { type: 'audio', quality: 'best', format: 'any', client }); }
  const url = fmt.url || (await fmt.decipher(yt.session.player));
  if (!url) throw new Error('sin URL');
  const mime = fmt.mime_type || '';
  return {
    url, headers: std({ 'User-Agent': YT_UA[client] || CHROME_UA }),
    size: fmt.content_length || 0, ext: mime.includes('mp4') ? 'm4a' : 'webm', mimeType: mime.split(';')[0]
  };
}

const RESOLVERS = [
  ['raw:ANDROID_VR', id => resolveRaw(id, 'ANDROID_VR')],
  ['raw:VISIONOS', id => resolveRaw(id, 'VISIONOS')],
  ['raw:IOS', id => resolveRaw(id, 'IOS')],
  ['youtubei.js:ANDROID_VR', id => resolveYtjs(id, 'ANDROID_VR')],
  ['youtubei.js:IOS', id => resolveYtjs(id, 'IOS')],
  ['youtubei.js:ANDROID', id => resolveYtjs(id, 'ANDROID')],
  ['youtubei.js:TV', id => resolveYtjs(id, 'TV')],
  ['youtubei.js:WEB_EMBEDDED', id => resolveYtjs(id, 'WEB_EMBEDDED')],
  ['youtubei.js:MWEB', id => resolveYtjs(id, 'MWEB')]
];

const cache = new Map(); // id → { at, src }
async function resolveStream(id, { fresh = false } = {}) {
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.src;

  const attempts = [];
  for (const [name, fn] of RESOLVERS) {
    try {
      const src = await fn(id);
      const p = await probe(src.url, src.headers);
      if (!p.ok) throw new Error(`URL rechazada (${p.error})`);
      src.size = p.total || src.size || 0;
      src.method = name;
      if (!src.title) Object.assign(src, await oembed(id));
      src.title ||= id; src.author ||= 'YouTube Music';
      const base = `${src.author} - ${src.title}`.replace(/[/\\?%*:|"<>]/g, '_');
      src.filename = `${base}.${src.ext}`;
      cache.set(id, { at: Date.now(), src });
      console.log(`✔ resolver ${name} | ${src.size} bytes | ${src.filename}`);
      return src;
    } catch (e) {
      attempts.push({ method: name, error: String(e.message).slice(0, 160) });
      console.log(`✖ resolver ${name}: ${e.message}`);
    }
  }
  const err = new Error('Ningún método pudo obtener un audio válido.');
  err.attempts = attempts;
  throw err;
}

/* ───────────────────────── Descarga por chunks ───────────────────────── */

async function fetchPiece(src, start, end, tries = 5) {
  const expected = end - start + 1;
  let last;
  for (let t = 0; t < tries; t++) {
    try {
      const viaHeader = t % 2 === 1;
      const r = await fetch(viaHeader ? src.url : withRange(src.url, start, end), {
        headers: { ...src.headers, ...(viaHeader ? { Range: `bytes=${start}-${end}` } : {}) }
      });
      if (r.status !== 200 && r.status !== 206) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length !== expected) throw new Error(`tamaño ${buf.length}/${expected}`);
      return buf;
    } catch (e) { last = e; await sleep(250 * (t + 1)); }
  }
  throw last;
}

async function streamChunked(src, chunks, res) {
  const total = src.size;
  const size = Math.min(Math.max(Math.ceil(total / chunks), MIN_PIECE), MAX_PIECE);
  const ranges = [];
  for (let s = 0; s < total; s += size) ranges.push([s, Math.min(s + size, total) - 1]);

  const slots = ranges.map(() => { let resolve; const p = new Promise(r => (resolve = r)); return { p, resolve }; });
  let next = 0, stop = false;
  res.on('close', () => { stop = true; });

  const worker = async () => {
    while (!stop) {
      const i = next++;
      if (i >= ranges.length) return;
      try { slots[i].resolve({ buf: await fetchPiece(src, ...ranges[i]) }); }
      catch (err) { slots[i].resolve({ err }); }
    }
  };
  const pool = Array.from({ length: Math.min(chunks, ranges.length) }, worker);

  for (let i = 0; i < ranges.length; i++) {
    const { buf, err } = await slots[i].p;
    if (err) { stop = true; throw err; }
    slots[i] = null;
    if (stop) return;
    if (!res.write(buf)) await new Promise(r => res.once('drain', r));
  }
  await Promise.all(pool);
  res.end();
}

async function streamSingle(src, res) {
  const r = await fetch(src.url, { headers: src.headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  for await (const part of r.body) { if (!res.write(part)) await new Promise(x => res.once('drain', x)); }
  res.end();
}

/* ───────────────────────── Express ───────────────────────── */

const app = express();
app.get('/', (_req, res) => res.type('html').send(HTML));

app.get('/api/status', async (_req, res) => {
  let ytjs = true; try { await import('youtubei.js'); } catch { ytjs = false; }
  res.json({ node: process.version, youtubeiJs: ytjs, cookies: !!cookiesFile() });
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Consulta vacía' });
  try { return res.json(await searchMusic(q)); }
  catch (e) { return res.status(502).json({ error: 'Búsqueda falló: ' + e.message }); }
});

app.get('/api/resolve', async (req, res) => {
  const id = extractVideoId(req.query.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const s = await resolveStream(id, { fresh: req.query.fresh === '1' });
    res.json({ id, method: s.method, size: s.size, filename: s.filename, ext: s.ext });
  } catch (e) {
    res.status(502).json({
      error: e.message, attempts: e.attempts,
      hint: 'Instala youtubei.js (npm i youtubei.js) y actualízalo regularmente: npm i youtubei.js@latest'
    });
  }
});

app.get('/api/download', async (req, res) => {
  const id = extractVideoId(req.query.id);
  if (!id) return res.status(400).send('ID inválido');
  const chunks = Math.min(Math.max(parseInt(req.query.chunks, 10) || 4, 1), 32);
  let src;
  try { src = await resolveStream(id); } catch (e) { return res.status(502).send(e.message); }

  res.setHeader('Content-Type', src.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${src.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(src.filename)}`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
  if (src.size) res.setHeader('Content-Length', src.size);

  const t0 = Date.now();
  const steps = [];
  if (src.size) steps.push(['chunks x' + chunks, () => streamChunked(src, chunks, res)]);
  steps.push(['stream único', () => streamSingle(src, res)]);

  for (const [name, fn] of steps) {
    try {
      await fn();
      console.log(`✔ ${src.filename} | ${name} | ${((Date.now() - t0) / 1000).toFixed(2)}s`);
      return;
    } catch (e) {
      console.log(`✖ ${name}: ${e.message}`);
      if (res.headersSent) return res.destroy();
      cache.delete(id);
    }
  }
  res.removeHeader('Content-Length');
  res.status(502).send('Falló la descarga con todos los métodos.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
  let ytjs = true; try { await import('youtubei.js'); } catch { ytjs = false; }
  console.log(`http://localhost:${PORT}`);
  console.log(`youtubei.js: ${ytjs ? 'OK' : 'NO (npm i youtubei.js)'}`);
});

/* ───────────────────────── HTML ───────────────────────── */

const HTML = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YT Music Downloader</title>
<style>
:root{--bg:#0f0f12;--card:#1a1a20;--tx:#f2f2f5;--mut:#9a9aa6;--ac:#ff3d5a}
*{box-sizing:border-box}body{margin:0 auto;font-family:system-ui,sans-serif;background:var(--bg);color:var(--tx);padding:16px;max-width:720px}
h1{font-size:20px;margin:4px 0 14px}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;padding:12px;border-radius:10px;border:1px solid #2b2b34;background:var(--card);color:var(--tx);font-size:16px}
button{padding:12px 16px;border:0;border-radius:10px;background:var(--ac);color:#fff;font-weight:600;font-size:15px}
.chunks{margin:14px 0;background:var(--card);padding:12px;border-radius:12px}
.chunks small{color:var(--mut);display:block;margin-bottom:8px}
.pills{display:flex;flex-wrap:wrap;gap:6px}
.pill{padding:8px 12px;border-radius:999px;background:#2a2a33}
.pill.on{background:var(--ac)}
.item{background:var(--card);padding:10px;border-radius:12px;margin-bottom:8px}
.top{display:flex;gap:10px;align-items:center}
.item img{width:56px;height:56px;border-radius:8px;object-fit:cover;background:#2a2a33}
.meta{flex:1;min-width:0}.meta b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta span{color:var(--mut);font-size:13px}
.bar{height:6px;background:#2a2a33;border-radius:4px;margin-top:8px;overflow:hidden;display:none}
.bar i{display:block;height:100%;width:0;background:var(--ac)}
.st{font-size:12.5px;color:var(--mut);margin-top:6px;white-space:pre-wrap;word-break:break-word}
.st.err{color:#ff8a9b}
#msg{color:var(--mut);margin:10px 0}
</style></head><body>
<h1>🎵 YT Music Downloader</h1>
<div class="row"><input id="q" placeholder="Canción, artista o link…"><button id="go">Buscar</button></div>
<div class="chunks"><small>Chunks en paralelo (más chunks = más rápido hasta saturar tu red)</small><div class="pills" id="pills"></div></div>
<div id="msg"></div><div id="list"></div>
<script>
var chunks=+localStorage.getItem('chunks')||4;
var opts=[1,2,3,4,5,6,7,8,10,12,16,24,32];
var pills=document.getElementById('pills');
function drawPills(){pills.innerHTML='';opts.forEach(function(n){var b=document.createElement('button');b.className='pill'+(n===chunks?' on':'');b.textContent=n;b.onclick=function(){chunks=n;localStorage.setItem('chunks',n);drawPills();};pills.appendChild(b);});}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function extractId(s){var m=s.match(/(?:v=|youtu\\.be\\/|shorts\\/)([A-Za-z0-9_-]{11})/);return m?m[1]:(/^[A-Za-z0-9_-]{11}$/.test(s)?s:null);}
function card(x){
  var art=(x.artists||[]).map(function(a){return a.name;}).join(', ');
  var d=document.createElement('div');d.className='item';
  d.innerHTML='<div class="top"><img src="'+esc(x.thumbnail||'')+'"><div class="meta"><b>'+esc(x.title||x.videoId)+'</b><span>'+esc(art)+(x.duration?' · '+esc(x.duration):'')+'</span></div><button>Descargar</button></div><div class="bar"><i></i></div><div class="st"></div>';
  d.querySelector('button').onclick=function(){dl(x.videoId,d);};
  return d;
}
async function dl(id,d){
  var btn=d.querySelector('button'),bar=d.querySelector('.bar'),fill=bar.firstChild,st=d.querySelector('.st');
  st.className='st';btn.disabled=true;btn.textContent='…';st.textContent='Resolviendo audio (probando métodos)…';
  try{
    var r=await fetch('/api/resolve?id='+id);var j=await r.json();
    if(!r.ok){var a=(j.attempts||[]).map(function(t){return '• '+t.method+': '+t.error;}).join('\\n');throw new Error(j.error+'\\n'+a+'\\n\\n'+(j.hint||''));}
    st.textContent='Método: '+j.method+' · '+chunks+' chunks';bar.style.display='block';fill.style.width='0';
    var t0=performance.now();
    var resp=await fetch('/api/download?id='+id+'&chunks='+chunks);
    if(!resp.ok)throw new Error(await resp.text());
    var total=+resp.headers.get('Content-Length')||j.size||0,got=0,parts=[],rd=resp.body.getReader();
    while(true){var c=await rd.read();if(c.done)break;parts.push(c.value);got+=c.value.length;
      var sec=(performance.now()-t0)/1000;
      if(total)fill.style.width=(got/total*100)+'%';
      st.textContent='Método: '+j.method+' · '+chunks+' chunks · '+(got/1048576).toFixed(2)+(total?'/'+(total/1048576).toFixed(2):'')+' MB · '+(got/1048576/Math.max(sec,0.05)).toFixed(2)+' MB/s';}
    var sec2=((performance.now()-t0)/1000).toFixed(2);
    var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(parts));a.download=j.filename||'audio.m4a';document.body.appendChild(a);a.click();a.remove();
    fill.style.width='100%';st.textContent='✔ Listo en '+sec2+' s · '+(got/1048576).toFixed(2)+' MB · '+j.method+' · '+chunks+' chunks';
  }catch(e){st.className='st err';st.textContent='✖ '+e.message;}
  btn.disabled=false;btn.textContent='Descargar';
}
async function search(){
  var q=document.getElementById('q').value.trim();if(!q)return;
  var msg=document.getElementById('msg'),list=document.getElementById('list');list.innerHTML='';
  var id=extractId(q);
  if(id){msg.textContent='';list.appendChild(card({videoId:id,title:id,thumbnail:'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg',artists:[{name:'Enlace directo'}]}));return;}
  msg.textContent='Buscando…';
  try{
    var r=await fetch('/api/search?q='+encodeURIComponent(q));var d=await r.json();
    if(!r.ok)throw new Error(d.error);
    msg.textContent=d.length?'':'Sin resultados';
    d.forEach(function(x){list.appendChild(card(x));});
  }catch(e){msg.textContent='Error: '+e.message;}
}
document.getElementById('go').onclick=search;
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter')search();});
drawPills();
</script></body></html>`;

/* ───────────────────────── Exports (CommonJS) ───────────────────────── */

module.exports = {
  parseCookies,
  extractVideoId,
  resolveStream,
  fetchPiece,
  streamChunked,
  app
};
/* ───────────────────────── Exports (CommonJS) ───────────────────────── */

/*module.exports = {
  parseCookies,
  getInnertubeConfig,
  extractVideoId,
  searchSongs,
  getAudioStream,
  app
};*/
/*const express = require("express");
const path = require("path");
const https = require("https");
const cheerio = require("cheerio");
const { createCanvas, loadImage, registerFont } = require("canvas");

const app = express();
const PORT = 3333;

// Registrar fuentes (ajusta la ruta si es necesario)
registerFont(path.join(__dirname, "./fonts/SF-Pro.ttf"), { family: "SFProDisplay" });
registerFont(path.join(__dirname, "./fonts/SF-Pro.ttf"), { family: "SFProText" });

app.use(express.json());

// Función auxiliar para solicitudes HTTPS
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve(data));
        }).on("error", reject);
    });
}

// Convertir formato ISO8601 a minutos:segundos
function formatDuration(duration) {
    if (!duration) return null;
    const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return duration;

    const min = match[1] ? parseInt(match[1]) : 0;
    const sec = match[2] ? parseInt(match[2]) : 0;
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
}

// Generar un tiempo actual tipo 0:03, 0:10, etc.
function getRandomCurrentTime(maxSeconds = 15) {
    const sec = Math.floor(Math.random() * maxSeconds) + 1;
    return `0:${sec < 10 ? "0" + sec : sec}`;
}

app.post("/api/applemusic", async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: "Falta el parámetro 'url'" });

        // Obtener HTML de Apple Music
        const html = await httpsGet(url);
        const $ = cheerio.load(html);
        const jsonText = $('script#schema\\:song').html();
        if (!jsonText) throw new Error("No se encontró el script schema:song");

        const json = JSON.parse(jsonText);
        const audio = json.audio?.audio || json.audio || {};
        const artist = audio.byArtist?.[0] || json.audio?.byArtist?.[0] || {};
        const albumArtist = audio.inAlbum?.byArtist?.[0] || {};
        const albumTitle = $('h1[data-testid="non-editable-product-title"]').text().trim();

        const info = {
            titulo: json.name || audio.name,
            artista: artist.name || albumArtist.name || null,
            album: albumTitle || null,
            imagen: audio.image || json.image || null,
            duracion: formatDuration(audio.duration || json.timeRequired) || "0:00",
        };

        // Cargar imágenes desde la red
        const baseUrl = "https://raw.githubusercontent.com/IrokzDal/uploads/main/1758134360746.jpeg";
        const loadBuffer = (url) =>
            new Promise((resolve, reject) => {
                https.get(url, (r) => {
                    const chunks = [];
                    r.on("data", (c) => chunks.push(c));
                    r.on("end", () => resolve(Buffer.concat(chunks)));
                }).on("error", reject);
            });

        const baseBuffer = await loadBuffer(baseUrl);
        const coverBuffer = await loadBuffer(info.imagen);

        const base = await loadImage(baseBuffer);
        const cover = await loadImage(coverBuffer);
        const width = base.width;
        const height = base.height;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        // Coordenadas y estilos
        const coverX = 300;
        const coverY = 580;
        const coverSize = 1600;
        const textOffsetY = 2490;
        const fadeArtist = 0.7;
        const radius = 60;
        const currentTime = getRandomCurrentTime(20); // Ejemplo: 0:03, 0:15, etc.

        // Dibujo general
        ctx.drawImage(base, 0, 0, width, height);

        // Marco redondeado de carátula
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(coverX + radius, coverY);
        ctx.lineTo(coverX + coverSize - radius, coverY);
        ctx.quadraticCurveTo(coverX + coverSize, coverY, coverX + coverSize, coverY + radius);
        ctx.lineTo(coverX + coverSize, coverY + coverSize - radius);
        ctx.quadraticCurveTo(coverX + coverSize, coverY + coverSize, coverX + coverSize - radius, coverY + coverSize);
        ctx.lineTo(coverX + radius, coverY + coverSize);
        ctx.quadraticCurveTo(coverX, coverY + coverSize, coverX, coverY + coverSize - radius);
        ctx.lineTo(coverX, coverY + radius);
        ctx.quadraticCurveTo(coverX, coverY, coverX + radius, coverY);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(cover, coverX, coverY, coverSize, coverSize);
        ctx.restore();

        // Texto: título
        ctx.fillStyle = "#fff";
        ctx.font = "bold 90px SFProDisplay";
        ctx.fillText(info.titulo, coverX, textOffsetY);

        // Texto: artista
        ctx.globalAlpha = fadeArtist;
        ctx.font = "70px SFProDisplay";
        ctx.fillText(info.artista, coverX, textOffsetY + 100);
        ctx.globalAlpha = 1;

        // Tiempo actual y duración
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "60px SFProDisplay";
        ctx.fillText(currentTime, coverX, textOffsetY + 220);
        ctx.fillText(info.duracion, coverX + coverSize - 220, textOffsetY + 220);

        // Convertir canvas a base64
        const imageBuffer = canvas.toBuffer("image/png");
        const base64Image = imageBuffer.toString("base64");

        res.json({
            success: true,
            titulo: info.titulo,
            artista: info.artista,
            album: info.album,
            duracion: info.duracion,
            imagen: `data:image/png;base64,${base64Image}`,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
                */
