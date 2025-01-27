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

app.get("/api/json", (req, res) => {
    const text = req.query.text || "brat";  // Texto por defecto
    const imgCanvas = createCanvas(500, 500);  // Crear un canvas de 500x500
    const ctx = imgCanvas.getContext("2d");

    // Limpiar el canvas y establecer el fondo blanco
    ctx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);
    ctx.fillStyle = "#FFFFFF";  // Fondo blanco
    ctx.fillRect(0, 0, imgCanvas.width, imgCanvas.height);

    // Establecer color y fuente
    ctx.fillStyle = "black";
    ctx.font = "75px Arial Narrow";  // Fuente de texto

    // Dividir el texto en líneas si es necesario
    let textArray = text.split("\n");
    let tick = 0;
    const lineHeight = 75;
    const maxWidth = 400;  // Ancho máximo para el texto
    const totalHeight = textArray.length * lineHeight;
    const margin = (imgCanvas.height - totalHeight) / 2;  // Centrar verticalmente

    // Escribir el texto en el canvas
    textArray.forEach((lineText) => {
        // Medir el ancho del texto para centrarlo
        const textWidth = ctx.measureText(lineText).width;
        const x = (imgCanvas.width - textWidth) / 2;  // Centrar horizontalmente
        ctx.fillText(lineText, x, margin + 75 * tick + 60);  // Posición ajustada
        tick++;
    });

    // Guardar la imagen en el servidor
    const imagePath = path.join(IMAGE_FOLDER, `image_${Date.now()}.png`);
    const out = fs.createWriteStream(imagePath);
    const stream = imgCanvas.createPNGStream();
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
