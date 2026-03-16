const axios = require("axios");
const cheerio = require("cheerio");
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const TEMPLATES_DIR = path.join(__dirname, "../..");
const TEMP_DIR = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const NAME_SIZE = 40, TOPIC_SIZE = 34, DATE_SIZE = 37;
const NAME_COLOR = "#4a0080", TOPIC_COLOR = "#4a0080", DATE_COLOR = "#333333";

const COUNTRIES = [
  { label: "🇨🇦 Canada",  file: "Canada certificate.pdf",  nameY: 0.42, topicY: 0.52, dateX: 0.78, dateY: 0.88 },
  { label: "🇩🇰 Denmark",  file: "Denmark certificate.pdf", nameY: 0.42, topicY: 0.52, dateX: 0.33, dateY: 0.88 },
  { label: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 England",  file: "England certificate.pdf", nameY: 0.42, topicY: 0.52, dateX: 0.40, dateY: 0.88 },
  { label: "🇫🇷 France",   file: "France certificate.pdf",  nameY: 0.42, topicY: 0.52, dateX: 0.33, dateY: 0.88 },
  { label: "🇮🇹 Italy",    file: "Italy certificate.pdf",   nameY: 0.42, topicY: 0.52, dateX: 0.33, dateY: 0.88 },
  { label: "🇷🇺 Russia",   file: "Russia certificate.pdf",  nameY: 0.42, topicY: 0.52, dateX: 0.33, dateY: 0.88 },
  { label: "🇹🇷 Turkey",   file: "Turkey certificate.pdf",  nameY: 0.42, topicY: 0.52, dateX: 0.33, dateY: 0.88 },
  { label: "🇺🇸 USA",      file: "usa certificate.pdf",     nameY: 0.42, topicY: 0.52, dateX: 0.33, dateY: 0.88 },
];

async function getArticleInfo(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const $ = cheerio.load(data);

    const authorsFromMeta = $('meta[name="citation_author"]')
      .map((i, el) => $(el).attr("content"))
      .get()
      .filter(Boolean)
      .map((a) => a.trim());

    let authors = authorsFromMeta;

    if (authors.length === 0) {
      const fallback =
        $('meta[name="author"]').first().attr("content") ||
        $('meta[property="article:author"]').first().attr("content") ||
        $(".author").first().text().trim() ||
        "Muallif noma'lum";
      authors = [fallback.trim()];
    }

    const title =
      $('meta[name="citation_title"]').first().attr("content") ||
      $('meta[property="og:title"]').first().attr("content") ||
      $('meta[name="title"]').first().attr("content") ||
      $("h1").first().text().trim() ||
      $("title").first().text().trim() ||
      "Mavzu noma'lum";

    return { authors, title: title.trim() };
  } catch (err) {
    console.error("getArticleInfo xato:", err.message);
    return null;
  }
}

function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  return text.match(urlRegex) || [];
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width > maxWidth) {
        let w = word;
        while (w.length > 1 && ctx.measureText(w + "...").width > maxWidth) w = w.slice(0, -1);
        current = w + "...";
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawAutoFitText(ctx, text, x, y, maxWidth, maxLines, initialSize) {
  let fontSize = initialSize;
  let lines = [];
  while (fontSize >= 14) {
    ctx.font = `italic ${fontSize}px Arial`;
    lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
    fontSize -= 2;
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "...").width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "...";
  }
  ctx.font = `italic ${fontSize}px Arial`;
  const lineHeight = fontSize + 8;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
}

async function loadPdfTemplate(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdfDoc = await pdfjsLib.getDocument({
    data,
    standardFontDataUrl: path.join(__dirname, "../../node_modules/pdfjs-dist/standard_fonts") + path.sep,
  }).promise;
  const page = await pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, ctx, W: viewport.width, H: viewport.height };
}

async function generateCertificate(author, title, date, country) {
  try {
    const templatePath = path.join(TEMPLATES_DIR, country.file);
    const { canvas, ctx, W, H } = await loadPdfTemplate(templatePath);

    console.log(`Canvas: ${W}x${H}, country: ${country.label}`);

    const CX = W / 2;
    const maxWidth = W * 0.65;

    // ISM
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${NAME_SIZE}px Arial`;
    ctx.fillStyle = NAME_COLOR;
    ctx.fillText(author.toUpperCase(), CX, H * (country.nameY || 0.42));

    // MAVZU
    ctx.fillStyle = TOPIC_COLOR;
    ctx.textBaseline = "top";
    drawAutoFitText(ctx, title, CX, H * (country.topicY || 0.52), maxWidth, 3, TOPIC_SIZE);

    // SANA
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${DATE_SIZE}px Arial`;
    ctx.fillStyle = DATE_COLOR;
    ctx.fillText(date, W * (country.dateX || 0.33), H * (country.dateY || 0.88));

    const pngBuffer = canvas.toBuffer("image/png");
    const pdfDoc = await PDFDocument.create();
    const pngImage = await pdfDoc.embedPng(pngBuffer);
    const page = pdfDoc.addPage([W, H]);
    page.drawImage(pngImage, { x: 0, y: 0, width: W, height: H });
    const pdfBytes = await pdfDoc.save();

    const safeName = author.replace(/[^a-zA-ZА-Яа-яЎўҚқҒғҲҳ0-9 ]/g, "").trim() || "certificate";
    const outPath = path.join(TEMP_DIR, `${safeName}_${Date.now()}.pdf`);
    fs.writeFileSync(outPath, pdfBytes);
    return { path: outPath, authorName: safeName };
  } catch (err) {
    console.error("generateCertificate xato:", err.message);
    return null;
  }
}

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

module.exports = { getArticleInfo, generateCertificate, extractUrls, deleteFile, COUNTRIES };