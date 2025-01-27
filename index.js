const express = require("express");
const path = require("path");
const fs = require("fs");
const canvas = require("canvas");
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
    const { createCanvas } = canvas;

    // Crear un canvas de 500x500 (cuadrado)
    const imgCanvas = createCanvas(500, 500);
    const ctx = imgCanvas.getContext("2d");

    // Limpiar el canvas
    ctx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);
    ctx.fillStyle = "white";  // Fondo blanco

    // Rellenar el fondo con blanco
    ctx.fillRect(0, 0, imgCanvas.width, imgCanvas.height);

    // Establecer el color del texto y la fuente
    ctx.fillStyle = "black";
    ctx.font = "30px 'Segoe UI Emoji'";  // Usar una fuente que soporte emojis

    // Dividir el texto en líneas si es necesario
    let lines = [];
    let line = "";
    const lineHeight = 40;
    const maxWidth = 450; // Ancho máximo para el texto

    // Ajustar el texto para que quepa en el canvas
    for (let i = 0; i < text.length; i++) {
        line += text[i];
        const width = ctx.measureText(line).width;
        if (width > maxWidth) {
            lines.push(line.substring(0, line.length - 1));  // Agregar la línea anterior
            line = text[i];  // Comenzar una nueva línea
        }
    }
    lines.push(line);
    const totalHeight = lines.length * lineHeight;
    let y = (imgCanvas.height - totalHeight) / 2;  // Centramos verticalmente

    for (let i = 0; i < lines.length; i++) {
        const textLine = lines[i];
        ctx.fillText(textLine, imgCanvas.width / 2 - ctx.measureText(textLine).width / 2, y);
        y += lineHeight;
        }
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
        
