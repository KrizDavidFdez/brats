 const express = require("express");
const path = require("path");
const fs = require("fs");
const { createCanvas } = require("canvas");
const app = express();
const PORT = 3333;

// Carpeta para guardar las imágenes generadas
const IMAGE_FOLDER = path.join(__dirname, "public", "images");
if (!fs.existsSync(IMAGE_FOLDER)) {
    fs.mkdirSync(IMAGE_FOLDER, { recursive: true });
}

app.use(express.static(path.join(__dirname, "public")));

// Asegúrate de que el servidor pueda manejar JSON en el cuerpo de las solicitudes POST
app.use(express.json());

async function ytdls(query, desiredQuality) {
    const searchUrl = "https://ssvid.net/api/ajax/search";
    const convertUrl = "https://ssvid.net/api/ajax/convert";

    try {
        const searchBody = `query=${encodeURIComponent(query)}&vt=home`;
        const searchResponse = await fetch(searchUrl, {
            method: "POST",
            headers: {
                "accept": "*/*",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: searchBody
        });
        const searchData = await searchResponse.json();
        const vid = searchData.vid;
        const title = searchData.title;
        const highQualityThumbnail = `https://img.youtube.com/vi/${vid}/maxresdefault.jpg`;
        const mediumQualityThumbnail = `https://img.youtube.com/vi/${vid}/sddefault.jpg`;
        const lowQualityThumbnail = `https://img.youtube.com/vi/${vid}/default.jpg`;
        let thumbnailUrl = highQualityThumbnail;
        const highResponse = await fetch(highQualityThumbnail).catch(() => '');
        if (!highResponse || !highResponse.ok) {
            const mediumResponse = await fetch(mediumQualityThumbnail).catch(() => '');
            if (mediumResponse && mediumResponse.ok) {
                thumbnailUrl = mediumQualityThumbnail;
            } else {
                thumbnailUrl = lowQualityThumbnail;
            }
        }
        const qualityMap = {
            "360p": "134",
            "720p": "136",
            "1080p": "137",
            "128kbps": "mp3128"
        };

        const qualityKey = qualityMap[desiredQuality];

        const links = {
            mp4: JSON.stringify(searchData.links.mp4),
            mp3: JSON.stringify(searchData.links.mp3)
        };

        const parsedLinks = {
            mp4: JSON.parse(links.mp4),
            mp3: JSON.parse(links.mp3)
        };

        const videoQuality = parsedLinks.mp4[qualityKey] || parsedLinks.mp3[qualityKey];

        const { k, size } = videoQuality;
        const convertBody = `vid=${vid}&k=${encodeURIComponent(k)}`;
        const convertResponse = await fetch(convertUrl, {
            method: "POST",
            headers: {
                "accept": "*/*",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: convertBody
        });
        const conversionResult = await convertResponse.json();
        return {
            creator: "@Samush$_",
            data: {
                title,
                size,
                thumbnail: thumbnailUrl,
                vid,
                dl_url: conversionResult.dlink
            }
        };
    } catch (error) {
    }}

app.get('/starlight/youtube-mp3', async (req, res) => {
  //  actualizarStats(req);
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: 'falta el parametro url' });
    }

    try {
      const desiredQuality = "128kbps"; 
        const result = await ytdls(url, desiredQuality);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).send(JSON.stringify(result, null, 4));
    } catch (error) {
        res.status(500).json({ error: '://' });
    }
});

app.get('/starlight/youtube-mp4', async (req, res) => {
    const url = req.query.url;
    const desiredQuality = req.query.q || ""; 
    if (!url) {
        return res.status(400).json({ error: 'falta parametro url' });
    }
    try {
        const result = await ytdls(url, desiredQuality);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).send(JSON.stringify(result, null, 4));
    } catch (error) {
        res.status(500).json({ error: '://' });
    }
});

app.post("/api/json", (req, res) => {
    const text = req.body.text || "brat"; // Texto por defecto

    // Crear un canvas de menor resolución para el efecto pixelado
    const smallCanvas = createCanvas(250, 250); // Canvas pequeño
    const ctx = smallCanvas.getContext("2d");

    // Limpiar el canvas y establecer el fondo blanco
    ctx.clearRect(0, 0, smallCanvas.width, smallCanvas.height);
    ctx.fillStyle = "#FFFFFF"; // Fondo blanco
    ctx.fillRect(0, 0, smallCanvas.width, smallCanvas.height);

    // Establecer color y fuente con mayor tamaño de letra
    ctx.fillStyle = "black";
    ctx.font = "24px Arial Narrow"; // Fuente de texto más grande

    // Función para dividir el texto en líneas
    const wrapText = (context, text, maxWidth) => {
        const words = text.split(" ");
        let lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = context.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    };

    // Dividir el texto automáticamente
    const maxLineWidth = 200; // Ancho máximo para cada línea
    const textArray = wrapText(ctx, text, maxLineWidth);

    // Posicionar el texto en el canvas pequeño
    const lineHeight = 30; // Altura de cada línea más grande
    const totalTextHeight = textArray.length * lineHeight;
    const startY = (smallCanvas.height - totalTextHeight) / 2; // Centrado verticalmente

    textArray.forEach((lineText, index) => {
        const textWidth = ctx.measureText(lineText).width;
        const startX = (smallCanvas.width - textWidth) / 2; // Centrado horizontalmente
        ctx.fillText(lineText, startX, startY + lineHeight * index);
    });

    // Crear un canvas más grande para escalar y pixelar
    const largeCanvas = createCanvas(500, 500);
    const largeCtx = largeCanvas.getContext("2d");

    // Escalar el canvas pequeño al tamaño grande para el efecto pixelado
    largeCtx.drawImage(smallCanvas, 0, 0, largeCanvas.width, largeCanvas.height);

    // Guardar la imagen en el servidor
    const imagePath = path.join(IMAGE_FOLDER, `image_${Date.now()}.png`);
    const out = fs.createWriteStream(imagePath);
    const stream = largeCanvas.createPNGStream();
    stream.pipe(out);

    out.on("finish", () => {
        res.json({
            success: true,
            imageUrl: `/images/${path.basename(imagePath)}`
        });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
       
