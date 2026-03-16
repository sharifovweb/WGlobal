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

// Koordinatalar
const NAME_X = 843, NAME_Y = 574;
const TOPIC_X = 843, TOPIC_Y = 660;
const DATE_X = 560, DATE_Y = 1070;
const NAME_SIZE = 40, TOPIC_SIZE = 34, DATE_SIZE = 37;
const NAME_COLOR = "#4a0080", TOPIC_COLOR = "#4a0080", DATE_COLOR = "#333333";
const MAX_TEXT_WIDTH = 900;

const COUNTRIES = [
  { label: "🇨🇦 Canada",  file: "Canada certificate.pdf",  dateX: 1492, dateY: 980  },
  { label: "🇩🇰 Denmark",  file: "Denmark certificate.pdf", dateX: 560,  dateY: 1040 },
  { label: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 England",  file: "England certificate.pdf", dateX: 770,  dateY: 1010 },
  { label: "🇫🇷 France",   file: "France certificate.pdf"  },
  { label: "🇮🇹 Italy",    file: "Italy certificate.pdf"   },
  { label: "🇷🇺 Russia",   file: "Russia certificate.pdf"  },
  { label: "🇹🇷 Turkey",   file: "Turkey certificate.pdf"  },
  { label: "🇺🇸 USA",      file: "usa certificate.pdf"     },
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

    // Barcha mualliflarni olish (citation_author bir nechta bo'lishi mumkin)
    const authorsFromMeta = $('meta[name="citation_author"]')
      .map((i, el) => $(el).attr("content"))
      .get()
      .filter(Boolean)
      .map((a) => a.trim());

    let authors = authorsFromMeta;

    // Meta dan topilmasa boshqa yerdan qidirish
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

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `bold ${NAME_SIZE}px Arial`;
    ctx.fillStyle = NAME_COLOR;
    ctx.fillText(author.toUpperCase(), NAME_X, NAME_Y);

    ctx.fillStyle = TOPIC_COLOR;
    drawAutoFitText(ctx, title, TOPIC_X, TOPIC_Y, MAX_TEXT_WIDTH, 3, TOPIC_SIZE);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${DATE_SIZE}px Arial`;
    ctx.fillStyle = DATE_COLOR;
    ctx.fillText(date, country.dateX || DATE_X, country.dateY || DATE_Y);

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