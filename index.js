const express = require("express");
const path = require("path");
const fs = require("fs");
const canvas = require("canvas");
const app = express();
const PORT = 3333
const IMAGE_FOLDER = path.join(__dirname, "public", "images");
if (!fs.existsSync(IMAGE_FOLDER)) {
    fs.mkdirSync(IMAGE_FOLDER, { recursive: true });
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/api/json", (req, res) => {
    const text = req.query.text || "Quiero pene de samu";
    const { createCanvas } = canvas;
    const imgCanvas = createCanvas(500, 200);
    const ctx = imgCanvas.getContext("2d");
    
    ctx.clearRect(0, 0, imgCanvas.width, imgCanvas.height); 
    ctx.fillStyle = "black";
    ctx.font = "30px Arial";
    ctx.fillText(text, 50, 100);
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
