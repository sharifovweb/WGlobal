const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const TEMP_DIR = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

async function generateExcel(articles, conferenceUrl) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Conference Bot";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Maqolalar", {
    pageSetup: { paperSize: 9, orientation: "landscape" },
  });

  worksheet.columns = [
    { header: "№", key: "number", width: 5 },
    { header: "Maqola sarlavhasi", key: "title", width: 60 },
    { header: "Muallif(lar)", key: "authors", width: 35 },
    { header: "Betlar", key: "pages", width: 10 },
    { header: "Maqola linki", key: "link", width: 55 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2F75B6" },
  };
  headerRow.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
  headerRow.height = 35;
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FF1F4E79" } },
      left: { style: "thin", color: { argb: "FF1F4E79" } },
      bottom: { style: "thin", color: { argb: "FF1F4E79" } },
      right: { style: "thin", color: { argb: "FF1F4E79" } },
    };
  });

  articles.forEach((article, idx) => {
    const row = worksheet.addRow({
      number: article.number,
      title: article.title,
      authors: article.authors,
      pages: article.pages,
      link: article.link,
    });

    const bgColor = idx % 2 === 0 ? "FFDCE6F1" : "FFFFFFFF";
    row.eachCell((cell, colNumber) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bgColor },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFBDD7EE" } },
        left: { style: "thin", color: { argb: "FFBDD7EE" } },
        bottom: { style: "thin", color: { argb: "FFBDD7EE" } },
        right: { style: "thin", color: { argb: "FFBDD7EE" } },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (colNumber === 1)
        cell.alignment = { vertical: "middle", horizontal: "center" };
      if (colNumber === 5 && article.link) {
        cell.value = { text: article.link, hyperlink: article.link };
        cell.font = { color: { argb: "FF0563C1" }, underline: true };
      }
    });
    row.height = 40;
  });

  worksheet.addRow([]);
  const infoRow = worksheet.addRow([
    "",
    `Manba: ${conferenceUrl}`,
    "",
    "",
    `Sana: ${new Date().toLocaleDateString("uz-UZ")}`,
  ]);
  infoRow.font = { italic: true, color: { argb: "FF808080" }, size: 9 };
  worksheet.getColumn("number").numFmt = "0";
  worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  const fileName = `conference_${Date.now()}.xlsx`;
  const filePath = path.join(TEMP_DIR, fileName);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error("File delete error:", err.message);
  }
}

module.exports = { generateExcel, deleteFile };
