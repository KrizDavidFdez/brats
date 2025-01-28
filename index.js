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
       
