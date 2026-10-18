// npm i express   |   node server.js
const dns = require('dns');
const net = require('net');
const path = require('path');
const { existsSync, readFileSync } = require('fs');
const express = require('express');

// ── FIX 403 (Termux): la URL de googlevideo queda atada a la IP con que se pidió.
// Si Node alterna IPv4/IPv6 entre el "player" y la descarga, da 403. Forzamos IPv4.
dns.setDefaultResultOrder('ipv4first');
try { net.setDefaultAutoSelectFamily(false); } catch {}

const BASE_URL = 'https://music.youtube.com';
const MAX_PIECE = 9 * 1024 * 1024;   // googlevideo corta rangos muy grandes (403)
const MIN_PIECE = 256 * 1024;

let cachedContext = null;
let lastContextTime = 0;

/* ───────────────────────── Cookies / config ───────────────────────── */

function parseCookies(input = null) {
  if (input === false || input === '') return '';
  if (input && typeof input === 'string' && input.includes('=')) return input.trim();

  const parseCookieFile = (filePath) => {
    try {
      return readFileSync(filePath, 'utf8')
        .split('\n').map(l => l.trim())
        .filter(l => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_')))
        .map(l => {
          const clean = l.replace(/^#HttpOnly_/, '');
          const p = clean.includes('\t') ? clean.split('\t') : clean.split(/\s+/);
          return p.length >= 7 ? `${p[5]}=${p[6]}` : l;
        }).join('; ');
    } catch { return ''; }
  };

  if (input && typeof input === 'string' && existsSync(input)) return parseCookieFile(input);

  for (const c of [path.join(__dirname, 'ytmusic.txt'), 'ytmusic.txt',
                   path.join(__dirname, 'ytcook.txt'), 'ytcook.txt']) {
    if (existsSync(c)) return parseCookieFile(c);
  }
  return '';
}

async function getInnertubeConfig(customCookie = null) {
  const cookieHeader = parseCookies(customCookie);
  const now = Date.now();
  if (cachedContext && now - lastContextTime < 1800000 && cachedContext.cookieHeader === cookieHeader) return cachedContext;

  const [musicHtml, visitorData] = await Promise.all([
    fetch(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      }
    }).then(r => r.text()),
    fetch('https://www.youtube.com/sw.js_data', { headers: cookieHeader ? { Cookie: cookieHeader } : {} })
      .then(r => r.text())
      .then(t => JSON.parse(t.slice(5))[0][2][0][0][13])
      .catch(() => undefined)
  ]);

  const apiKey = musicHtml.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/)?.[1];
  const clientVersion = musicHtml.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/)?.[1] || '1.20261011.16.00';

  cachedContext = {
    apiKey, clientVersion, visitorData, cookieHeader,
    context: { client: { clientName: 'WEB_REMIX', clientVersion, hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) } }
  };
  lastContextTime = now;
  return cachedContext;
}

/* ───────────────────────── Helpers ───────────────────────── */

function extractVideoId(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (/^(MPREb_|UC|VL|PL)/.test(str)) return null;
  const m = str.match(/(?:youtu\.be\/|music\.youtube\.com\/(?:watch\?v=|watch\?.+&v=)|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{11}$/.test(str) ? str : null;
}

async function apiRequest(endpoint, payload, options = {}) {
  const cfg = await getInnertubeConfig(options.cookie !== undefined ? options.cookie : options.cookies);
  const res = await fetch(`${BASE_URL}/youtubei/v1/${endpoint}?key=${cfg.apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(cfg.cookieHeader ? { Cookie: cfg.cookieHeader } : {})
    },
    body: JSON.stringify({ context: cfg.context, ...payload })
  });
  if (!res.ok) throw new Error(`YouTube Music API error: HTTP ${res.status}`);
  return res.json();
}

const runsOf = (item, i) => item?.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

function parseResponsiveItem(item) {
  const ir = item.musicResponsiveListItemRenderer;
  if (!ir) return null;
  const c0 = runsOf(ir, 0), c1 = runsOf(ir, 1), c2 = runsOf(ir, 2);

  const artists = c1
    .filter(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
    .map(r => ({ name: r.text, id: r.navigationEndpoint.browseEndpoint.browseId }));

  const albumRun = [...c1, ...c2].find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPREb_'));
  const durationRun = [...c1, ...c2].find(r => /^\d+:\d+$/.test(r.text))
    || ir.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0];

  const videoId = ir.playlistItemData?.videoId
    || ir.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
    || c0[0]?.navigationEndpoint?.watchEndpoint?.videoId;
  const browseId = c0[0]?.navigationEndpoint?.browseEndpoint?.browseId || ir.navigationEndpoint?.browseEndpoint?.browseId;
  const thumbs = ir.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];

  const t = (c1[0]?.text || '').toLowerCase();
  let type = 'unknown';
  if (t.includes('song')) type = 'song';
  else if (t.includes('video')) type = 'video';
  else if (t.includes('artist')) type = 'artist';
  else if (t.includes('album') || t.includes('ep')) type = 'album';
  else if (t.includes('playlist')) type = 'playlist';
  else if (videoId) type = 'song';
  else if (browseId?.startsWith('UC')) type = 'artist';
  else if (browseId?.startsWith('MPREb_')) type = 'album';
  else if (browseId?.startsWith('VL')) type = 'playlist';

  return {
    type, title: c0[0]?.text || '', videoId: videoId || null, browseId: browseId || null,
    artists, album: albumRun ? { name: albumRun.text, id: albumRun.navigationEndpoint.browseEndpoint.browseId } : null,
    duration: durationRun?.text || null,
    thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : null
  };
}

/* ───────────────────────── Búsqueda ───────────────────────── */

async function searchSongs(query, options = {}) {
  if (!query?.trim()) throw new Error('Search query cannot be empty');
  const data = await apiRequest('search', { query: query.trim(), params: 'EgWKAQIIAWoSEAUQAxAJEAoQERAQEAQQDhAV' }, options);
  const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  return (sections[0]?.musicShelfRenderer?.contents || []).map(parseResponsiveItem).filter(Boolean);
}

/* ───────────────────────── Stream de audio (FIX 403) ───────────────────────── */

// Varios clientes: si uno devuelve una URL que da 403, probamos el siguiente.
const CLIENTS = [
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471' }
  },
  {
    ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    client: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' }
  },
  {
    ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
    client: { clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83' }
  }
];

const streamHeaders = (ua) => ({ 'User-Agent': ua, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' });

// Prueba real: pide 2 bytes. Si da 200/206 la URL sirve desde esta IP.
async function probe(url, ua) {
  try {
    const r = await fetch(`${url}&range=0-1`, { headers: streamHeaders(ua) });
    await r.arrayBuffer().catch(() => {});
    return r.status === 200 || r.status === 206;
  } catch { return false; }
}

async function getAudioStream(videoIdOrUrl, options = {}) {
  const videoId = extractVideoId(videoIdOrUrl);
  if (!videoId) throw new Error('ID/URL de YouTube inválido');
  const cfg = await getInnertubeConfig(options.cookie !== undefined ? options.cookie : options.cookies);

  for (const c of CLIENTS) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, ...(cfg.cookieHeader ? { Cookie: cfg.cookieHeader } : {}) },
        body: JSON.stringify({
          context: { client: { ...c.client, visitorData: cfg.visitorData, hl: 'en', gl: 'US' } },
          videoId
        })
      });
      const data = await res.json();
      if (data.playabilityStatus?.status !== 'OK') continue;

      const afs = data.streamingData?.adaptiveFormats || [];
      const best = afs.find(f => f.itag === 140 && f.url) || afs.find(f => f.itag === 251 && f.url)
        || afs.find(f => f.mimeType?.includes('audio') && f.url);
      if (!best) continue;
      if (!(await probe(best.url, c.ua))) continue; // 403 → siguiente cliente

      const vd = data.videoDetails || {};
      const isM4a = best.mimeType?.includes('mp4');
      return {
        videoId, itag: best.itag,
        ext: isM4a ? 'm4a' : 'webm',
        mimeType: best.mimeType?.split(';')[0],
        bitrate: best.bitrate,
        contentLength: best.contentLength ? parseInt(best.contentLength, 10) : null,
        userAgent: c.ua,
        url: best.url,
        title: vd.title || videoId,
        author: (vd.author || 'YouTube Music').replace(/\s*-\s*Topic$/i, ''),
        durationSeconds: parseInt(vd.lengthSeconds, 10) || 0,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      };
    } catch { /* siguiente cliente */ }
  }
  return null;
}

/* ───────────────────────── Descarga por chunks en paralelo ───────────────────────── */

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPiece(audio, start, end, tries = 4) {
  const expected = end - start + 1;
  let lastErr;
  for (let t = 0; t < tries; t++) {
    try {
      // 1º intento: parámetro &range= (lo que usa YouTube); luego header Range.
      const useHeader = t % 2 === 1;
      const res = await fetch(useHeader ? audio.url : `${audio.url}&range=${start}-${end}`, {
        headers: { ...streamHeaders(audio.userAgent), ...(useHeader ? { Range: `bytes=${start}-${end}` } : {}) }
      });
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== expected) throw new Error(`Tamaño ${buf.length}/${expected}`);
      return buf;
    } catch (e) { lastErr = e; await sleep(300 * (t + 1)); }
  }
  throw lastErr;
}

/**
 * Divide el archivo en `chunks` partes, las baja en paralelo y las escribe en orden.
 */
async function streamChunked(audio, chunks, res) {
  const total = audio.contentLength;
  let size = Math.ceil(total / chunks);
  size = Math.min(Math.max(size, MIN_PIECE), MAX_PIECE);

  const ranges = [];
  for (let s = 0; s < total; s += size) ranges.push([s, Math.min(s + size, total) - 1]);

  const slots = ranges.map(() => { let resolve; const p = new Promise(r => (resolve = r)); return { p, resolve }; });
  let next = 0, aborted = false;
  res.on('close', () => { aborted = true; });

  const worker = async () => {
    while (!aborted) {
      const i = next++;
      if (i >= ranges.length) return;
      try { slots[i].resolve({ buf: await fetchPiece(audio, ...ranges[i]) }); }
      catch (err) { slots[i].resolve({ err }); }
    }
  };
  const workers = Array.from({ length: Math.min(chunks, ranges.length) }, worker);

  for (let i = 0; i < ranges.length; i++) {
    const { buf, err } = await slots[i].p;
    if (err) { aborted = true; throw err; }
    slots[i] = null;
    if (aborted) return;
    if (!res.write(buf)) await new Promise(r => res.once('drain', r));
  }
  await Promise.all(workers);
  res.end();
}

/* ───────────────────────── Express ───────────────────────── */

const app = express();

app.get('/', (_req, res) => res.type('html').send(HTML));

app.get('/api/search', async (req, res) => {
  try { res.json(await searchSongs(String(req.query.q || ''))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/download', async (req, res) => {
  try {
    const chunks = Math.min(Math.max(parseInt(req.query.chunks, 10) || 4, 1), 32);
    const audio = await getAudioStream(String(req.query.id || ''));
    if (!audio) return res.status(404).send('No se pudo obtener el audio (todos los clientes dieron 403/no disponible).');

    const base = `${audio.author} - ${audio.title}`.replace(/[/\\?%*:|"<>]/g, '_');
    const filename = `${base}.${audio.ext}`;
    res.setHeader('Content-Type', audio.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

    if (!audio.contentLength) { // sin tamaño no se puede partir: una sola petición
      const r = await fetch(audio.url, { headers: streamHeaders(audio.userAgent) });
      if (!r.ok) return res.status(502).send(`HTTP ${r.status}`);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    res.setHeader('Content-Length', audio.contentLength);
    const t0 = Date.now();
    await streamChunked(audio, chunks, res);
    console.log(`✔ ${filename} | ${chunks} chunks | ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  } catch (e) {
    console.error('✖ download:', e.message);
    if (!res.headersSent) res.status(500).send(e.message); else res.destroy();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`http://localhost:${PORT}`));

/* ───────────────────────── HTML ───────────────────────── */

const HTML = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YT Music Downloader</title>
<style>
:root{--bg:#0f0f12;--card:#1a1a20;--tx:#f2f2f5;--mut:#9a9aa6;--ac:#ff3d5a}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--tx);padding:16px;max-width:720px;margin:auto}
h1{font-size:20px;margin:4px 0 14px}
.row{display:flex;gap:8px}
input{flex:1;padding:12px;border-radius:10px;border:1px solid #2b2b34;background:var(--card);color:var(--tx);font-size:16px}
button{padding:12px 16px;border:0;border-radius:10px;background:var(--ac);color:#fff;font-weight:600;font-size:15px}
.chunks{margin:14px 0;background:var(--card);padding:12px;border-radius:12px}
.chunks small{color:var(--mut);display:block;margin-bottom:8px}
.pills{display:flex;flex-wrap:wrap;gap:6px}
.pill{padding:8px 12px;border-radius:999px;background:#2a2a33;color:var(--tx);font-size:14px}
.pill.on{background:var(--ac)}
.item{display:flex;gap:10px;align-items:center;background:var(--card);padding:10px;border-radius:12px;margin-bottom:8px}
.item img{width:56px;height:56px;border-radius:8px;object-fit:cover}
.meta{flex:1;min-width:0}.meta b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta span{color:var(--mut);font-size:13px}
.item a{padding:9px 12px;border-radius:9px;background:var(--ac);color:#fff;text-decoration:none;font-weight:600;font-size:14px}
#msg{color:var(--mut);margin:10px 0}
</style></head><body>
<h1>🎵 YT Music Downloader</h1>
<div class="row"><input id="q" placeholder="Canción, artista o link…"><button id="go">Buscar</button></div>
<div class="chunks"><small>Chunks en paralelo (más chunks = más rápido, hasta que tu red/servidor se sature)</small>
<div class="pills" id="pills"></div></div>
<div id="msg"></div><div id="list"></div>
<script>
var chunks=+localStorage.getItem('chunks')||4;
var opts=[1,2,3,4,5,6,7,8,10,12,16,24,32];
var pills=document.getElementById('pills');
function drawPills(){pills.innerHTML='';opts.forEach(function(n){var b=document.createElement('button');b.className='pill'+(n===chunks?' on':'');b.textContent=n;b.onclick=function(){chunks=n;localStorage.setItem('chunks',n);drawPills();refreshLinks();};pills.appendChild(b);});}
function refreshLinks(){document.querySelectorAll('a[data-id]').forEach(function(a){a.href='/api/download?id='+a.dataset.id+'&chunks='+chunks;});}
function esc(s){return String(s||'').replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function extractId(s){var m=s.match(/(?:v=|youtu\\.be\\/|shorts\\/)([A-Za-z0-9_-]{11})/);return m?m[1]:(/^[A-Za-z0-9_-]{11}$/.test(s)?s:null);}
async function search(){
  var q=document.getElementById('q').value.trim();if(!q)return;
  var msg=document.getElementById('msg'),list=document.getElementById('list');
  list.innerHTML='';var id=extractId(q);
  if(id){list.innerHTML='<div class="item"><div class="meta"><b>'+id+'</b><span>Enlace directo</span></div><a data-id="'+id+'" download>Descargar</a></div>';refreshLinks();msg.textContent='';return;}
  msg.textContent='Buscando…';
  try{
    var r=await fetch('/api/search?q='+encodeURIComponent(q));var d=await r.json();
    if(!r.ok)throw new Error(d.error);
    msg.textContent=d.length?'':'Sin resultados';
    list.innerHTML=d.filter(function(x){return x.videoId;}).map(function(x){
      var art=(x.artists||[]).map(function(a){return a.name;}).join(', ');
      return '<div class="item"><img src="'+esc(x.thumbnail)+'"><div class="meta"><b>'+esc(x.title)+'</b><span>'+esc(art)+' · '+esc(x.duration||'')+'</span></div><a data-id="'+x.videoId+'" download>Descargar</a></div>';
    }).join('');
    refreshLinks();
  }catch(e){msg.textContent='Error: '+e.message;}
}
document.getElementById('go').onclick=search;
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter')search();});
drawPills();
</script></body></html>`;

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
