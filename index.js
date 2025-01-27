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
    const text = req.query.text || "Quiero pene de samu";  // Texto por defecto
    const imgCanvas = createCanvas(500, 500);  // Crear un canvas de 500x500
    const ctx = imgCanvas.getContext("2d");

    // Limpiar el canvas
    ctx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);

    // Fondo blanco
    ctx.fillStyle = "#FFFFFF";  // Fondo blanco
    ctx.fillRect(0, 0, imgCanvas.width, imgCanvas.height);

    // Establecer color y fuente
    ctx.fillStyle = "black";
    ctx.font = "75px Arial Narrow";  // Fuente de texto

    // Dividir el texto en líneas si es necesario
    let lines = [];
    let line = "";
    const lineHeight = 75;
    const maxWidth = 400;  // Ancho máximo para el texto

    // Ajustar el texto para que quepa en el canvas
    for (let i = 0; i < text.length; i++) {
        line += text[i];
        const width = ctx.measureText(line).width;
        if (width > maxWidth) {
            lines.push(line.substring(0, line.length - 1));  // Agregar la línea anterior
            line = text[i];  // Comenzar una nueva línea
        }
    }
    lines.push(line);  // Agregar la última línea

    // Centrar el texto en el canvas
    const totalHeight = lines.length * lineHeight;
    let y = (imgCanvas.height - totalHeight) / 2;  // Centramos verticalmente

    // Escribir el texto en el canvas
    let tick = 0;
    lines.forEach((lineText) => {
        ctx.fillText(lineText, imgCanvas.width / 2, y + 60 + 75 * tick);
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
