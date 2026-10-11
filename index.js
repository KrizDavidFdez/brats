const express = require('express');

/* =========================================================
 *  CLIENTE CNVMP3
 * =======================================================*/
class CNVMP3 {
  constructor(opts = {}) {
    this.baseUrl     = opts.baseUrl     ?? 'https://cnvmp3.com';
    this.downloadUrl = opts.downloadUrl ?? 'https://apio11dlp.cnvmp3.site';
    this.referer     = opts.referer     ?? `${this.baseUrl}/v55`;
    this.userAgent   = opts.userAgent   ??
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36';
    this.timeout     = opts.timeout ?? 30000;
    this.token       = opts.token   ?? '1234';
  }

  _headers(extra = {}) {
    return {
      'accept':             '*/*',
      'accept-language':    'es-PE,es-419;q=0.9,es;q=0.8',
      'content-type':       'application/json',
      'origin':             this.baseUrl,
      'referer':            this.referer,
      'user-agent':         this.userAgent,
      'sec-ch-ua':          '"Not A(Brand";v="8", "Chromium";v="132"',
      'sec-ch-ua-mobile':   '?1',
      'sec-ch-ua-platform': '"Android"',
      'sec-fetch-dest':     'empty',
      'sec-fetch-mode':     'cors',
      'sec-fetch-site':     'same-origin',
      ...extra,
    };
  }

  async _post(endpoint, body) {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}/${endpoint}`, {
        method:  'POST',
        headers: this._headers(),
        body:    JSON.stringify(body),
        signal:  ctrl.signal,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }

      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} en ${endpoint}`);
        err.status = res.status;
        err.body   = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  async checkDatabase(youtubeId, quality = 4, formatValue = 1) {
    if (!youtubeId) throw new Error('youtubeId es requerido');
    return this._post('check_database.php', {
      youtube_id:  youtubeId,
      quality,
      formatValue,
    });
  }

  async getVideoData(youtubeUrl, token = this.token) {
    if (!youtubeUrl) throw new Error('youtubeUrl es requerido');
    return this._post('get_video_data.php', {
      url:   youtubeUrl,
      token,
    });
  }

  async downloadVideoUcep({ url, quality = 4, title, formatValue = 1 }) {
    if (!url)   throw new Error('url es requerido');
    if (!title) throw new Error('title es requerido');
    return this._post('download_video_ucep.php', {
      url,
      quality,
      title,
      formatValue,
    });
  }

  async insertToDatabase({ youtubeId, serverPath, quality = 4, title, formatValue = 1 }) {
    if (!youtubeId)  throw new Error('youtubeId es requerido');
    if (!serverPath) throw new Error('serverPath es requerido');
    if (!title)      throw new Error('title es requerido');
    return this._post('insert_to_database.php', {
      youtube_id:  youtubeId,
      server_path: serverPath,
      quality,
      title,
      formatValue,
    });
  }

  async smartDownload(youtubeId, { quality = 4, formatValue = 1 } = {}) {
    if (!youtubeId) throw new Error('youtubeId es requerido');

    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

    // 1) ¿Ya existe en la DB?
    const check = await this.checkDatabase(youtubeId, quality, formatValue);
    const raw   = { check };

    if (check?.success && check?.data?.server_path) {
      return {
        source:       'db',
        alreadyInDb:  true,
        title:        check.data.title,
        downloadLink: check.data.server_path,
        raw,
      };
    }

    // 2) Obtener datos del video
    const data = await this.getVideoData(youtubeUrl);
    raw.data = data;
    if (!data?.success || !data?.title) {
      throw new Error(`get_video_data falló: ${JSON.stringify(data)}`);
    }
    const title = data.title;

    // 3) Convertir
    const conv = await this.downloadVideoUcep({
      url: youtubeUrl,
      quality,
      title,
      formatValue,
    });
    raw.convert = conv;

    if (!conv?.download_link) {
      throw new Error(`download_video_ucep falló: ${JSON.stringify(conv)}`);
    }

    // 4) Insertar en DB
    let insertResult;
    try {
      insertResult = await this.insertToDatabase({
        youtubeId,
        serverPath: conv.download_link,
        quality,
        title,
        formatValue,
      });
    } catch (e) {
      insertResult = { success: false, error: e.message };
    }
    raw.insert = insertResult;

    return {
      source:       'fresh',
      alreadyInDb:  insertResult?.success === false &&
                    /duplicate/i.test(insertResult?.error || ''),
      title,
      downloadLink: conv.download_link,
      raw,
    };
  }
}

/* =========================================================
 *  SERVIDOR EXPRESS
 * =======================================================*/
const app  = express();
const PORT = 3333;

app.use(express.json());

const client = new CNVMP3({
  baseUrl:     process.env.CNVMP3_BASE_URL     || 'https://cnvmp3.com',
  downloadUrl: process.env.CNVMP3_DOWNLOAD_URL || 'https://apio11dlp.cnvmp3.site',
  token:       process.env.CNVMP3_TOKEN        || '1234',
  timeout:     Number(process.env.CNVMP3_TIMEOUT || 30000),
});

/* =========================================================
 *  ÚNICO ENDPOINT:  GET /:youtubeId
 * =======================================================*/
app.get('/:youtubeId', async (req, res) => {
  try {
    const { youtubeId } = req.params;
    const quality       = Number(req.query.quality     ?? 4);
    const formatValue   = Number(req.query.formatValue ?? 1);

    const info = await client.smartDownload(youtubeId, { quality, formatValue });

    res.json({
      ok:          true,
      youtubeId,
      source:      info.source,       // 'db' | 'fresh'
      alreadyInDb: info.alreadyInDb,
      title:       info.title,
      url:         info.downloadLink,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
 *  START
 * =======================================================*/
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CNVMP3 URL API escuchando en http://0.0.0.0:${PORT}`);
});
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
