const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const cheerio = require("cheerio");
const { createCanvas, loadImage, registerFont } = require("canvas");

const app = express();
const PORT = 3333;

registerFont(path.join(__dirname, "../fonts/SF-Pro.ttf"), { family: "SFProDisplay" });
registerFont(path.join(__dirname, "../fonts/monospace.ttf"), { family: "SFProText" });

const IMAGE_FOLDER = path.join(__dirname, "public", "images");
if (!fs.existsSync(IMAGE_FOLDER)) {
    fs.mkdirSync(IMAGE_FOLDER, { recursive: true });
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve(data));
        }).on("error", reject);
    });
}

function formatDuration(duration) {
    if (!duration) return null;
    const match = duration.match(/PT(\d+M)?(\d+S)?/);
    if (!match) return duration;

    const min = match[1] ? parseInt(match[1]) : 0;
    const sec = match[2] ? parseInt(match[2]) : 0;
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
}

app.post("/api/applemusic", async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: "Falta el parámetro 'url'" });

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

        const baseUrl = "https://raw.githubusercontent.com/IrokzDal/uploads/main/1758134360746.jpeg";
        const baseBuffer = await new Promise((resolve, reject) => {
            https.get(baseUrl, (r) => {
                const chunks = [];
                r.on("data", (c) => chunks.push(c));
                r.on("end", () => resolve(Buffer.concat(chunks)));
            }).on("error", reject);
        });

        const coverBuffer = await new Promise((resolve, reject) => {
            https.get(info.imagen, (r) => {
                const chunks = [];
                r.on("data", (c) => chunks.push(c));
                r.on("end", () => resolve(Buffer.concat(chunks)));
            }).on("error", reject);
        });

        const base = await loadImage(baseBuffer);
        const cover = await loadImage(coverBuffer);
        const width = base.width;
        const height = base.height;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        const coverX = 300;
        const coverY = 580;
        const coverSize = 1600;
        const textOffsetY = 2490;
        const fadeArtist = 0.7;
        const radius = 60;
        const currentTime = `0:${Math.floor(Math.random() * 8) + 3}`;
        ctx.drawImage(base, 0, 0, width, height);
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
        ctx.fillStyle = "#fff";
        ctx.font = "bold 90px SFProDisplay";
        ctx.fillText(info.titulo, coverX, textOffsetY);

        ctx.globalAlpha = fadeArtist;
        ctx.font = "70px SFProDisplay";
        ctx.fillText(info.artista, coverX, textOffsetY + 100);
        ctx.globalAlpha = 1;

        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "60px SFProText";
        ctx.fillText(currentTime, coverX, textOffsetY + 220);
        ctx.fillText(info.duracion, coverX + coverSize - 220, textOffsetY + 220);

        const imagePath = path.join(IMAGE_FOLDER, `applemusic_${Date.now()}.png`);
        const out = fs.createWriteStream(imagePath);
        const stream = canvas.createPNGStream();
        stream.pipe(out);
        out.on("finish", () => {
            res.json({
                success: true,
                titulo: info.titulo,
                artista: info.artista,
                album: info.album,
                duracion: info.duracion,
                imageUrl: `/images/${path.basename(imagePath)}`
            });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
