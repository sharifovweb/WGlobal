require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

// Excel bot modullari
const { scrapeConference, isValidConferenceUrl } = require("./excel/scraper");
const { generateExcel, deleteFile: deleteExcel } = require("./excel/excel");

// Sertifikat bot modullari
const {
  getArticleInfo,
  generateCertificate,
  extractUrls,
  deleteFile: deleteCert,
  COUNTRIES,
} = require("./certificate/certificate");

// ─────────────────────────────────────────────
// TOKENLAR
// ─────────────────────────────────────────────
const EXCEL_TOKEN = process.env.EXCEL_BOT_TOKEN;
const CERT_TOKEN = process.env.CERT_BOT_TOKEN;
const CHANNEL = process.env.CHANNEL || "@kanferensiyasertifikatlari";

if (!EXCEL_TOKEN || !CERT_TOKEN) {
  console.error("❌ EXCEL_BOT_TOKEN yoki CERT_BOT_TOKEN topilmadi! .env faylni tekshiring.");
  process.exit(1);
}

// ─────────────────────────────────────────────
// IKKI ALOHIDA BOT
// ─────────────────────────────────────────────
const excelBot = new Telegraf(EXCEL_TOKEN);
const certBot = new Telegraf(CERT_TOKEN);

console.log("✅ Botlar ishga tushmoqda...");

// ═══════════════════════════════════════════════════════════════
//  EXCEL BOT
// ═══════════════════════════════════════════════════════════════

const excelSessions = new Set(); // aktiv scraping sessiyalari

excelBot.command("start", (ctx) => {
  const name = ctx.from.first_name || "Foydalanuvchi";
  ctx.reply(
    `👋 Salom, *${name}*!\n\n` +
    `📊 Men konferensiya maqolalarini *Excel* formatiga o'tkazib beraman.\n\n` +
    `📋 *Qanday foydalanish:*\n` +
    `wglobalconference.com saytidagi konferensiya URL ini yuboring.\n\n` +
    `*Misol:*\n` +
    "`https://wglobalconference.com/ojs/index.php/turkey`",
    { parse_mode: "Markdown" }
  );
});

excelBot.command("help", (ctx) => {
  ctx.reply(
    `📖 *Yordam*\n\n` +
    `1️⃣ wglobalconference.com saytiga kiring\n` +
    `2️⃣ Konferensiya sahifasining URL ini nusxa oling\n` +
    `3️⃣ Shu botga yuboring\n` +
    `4️⃣ Excel fayl qaytariladi\n\n` +
    `*Excel faylida:* №, Sarlavha, Muallif(lar), Betlar, Link`,
    { parse_mode: "Markdown" }
  );
});

excelBot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const chatId = ctx.chat.id;

  if (text.startsWith("/")) return;

  if (!text.startsWith("http")) {
    return ctx.reply(
      `❌ Noto'g'ri format. To'liq URL yuboring.\n\n*Misol:*\n\`https://wglobalconference.com/ojs/index.php/turkey\``,
      { parse_mode: "Markdown" }
    );
  }

  if (!isValidConferenceUrl(text)) {
    return ctx.reply(
      `⛔ Faqat *wglobalconference.com* saytidagi linklar qabul qilinadi.`,
      { parse_mode: "Markdown" }
    );
  }

  if (excelSessions.has(chatId)) {
    return ctx.reply(`⏳ Oldingi so'rov bajarilmoqda. Iltimos, kuting...`);
  }

  excelSessions.add(chatId);
  const statusMsg = await ctx.reply(
    `🔍 Sahifa tekshirilmoqda...\n\n🔗 \`${text}\``,
    { parse_mode: "Markdown" }
  );

  let excelPath = null;

  try {
    const onProgress = async (current, total, title) => {
      if (current === 1 || current % 5 === 0 || current === total) {
        const percent = Math.round((current / total) * 100);
        const filled = Math.floor(percent / 10);
        const bar = "█".repeat(filled) + "░".repeat(10 - filled);
        try {
          await ctx.telegram.editMessageText(
            chatId, statusMsg.message_id, null,
            `📥 Maqolalar yuklanmoqda...\n\n[${bar}] ${percent}%\n✅ ${current} / ${total}\n\n📄 *${title.slice(0, 50)}${title.length > 50 ? "..." : ""}*`,
            { parse_mode: "Markdown" }
          );
        } catch (_) {}
      }
    };

    const articles = await scrapeConference(text, onProgress);

    await ctx.telegram.editMessageText(
      chatId, statusMsg.message_id, null,
      `⚙️ Excel fayl tayyorlanmoqda... (${articles.length} ta maqola)`
    );

    excelPath = await generateExcel(articles, text);

    await ctx.replyWithDocument(
      { source: excelPath, filename: `conference_maqolalar_${Date.now()}.xlsx` },
      {
        caption:
          `✅ *Tayyor!*\n\n📊 Jami: *${articles.length}* ta maqola\n🔗 Manba: \`${text}\``,
        parse_mode: "Markdown",
      }
    );

    await ctx.telegram.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
  } catch (err) {
    console.error(`Excel scraping xato:`, err.message);
    let msg = `❌ Xatolik yuz berdi.\n\n`;
    if (err.message.includes("topilmadi")) {
      msg += `⚠️ Sahifada maqolalar topilmadi. URL to'g'riligini tekshiring.`;
    } else if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
      msg += `🌐 Server bilan ulanishda xatolik. Keyinroq urinib ko'ring.`;
    } else {
      msg += `🛠 Texnik xato: ${err.message.slice(0, 100)}`;
    }
    await ctx.telegram.editMessageText(chatId, statusMsg.message_id, null, msg).catch(() => ctx.reply(msg));
  } finally {
    if (excelPath) deleteExcel(excelPath);
    excelSessions.delete(chatId);
  }
});

excelBot.catch((err) => console.error("Excel bot xatosi:", err.message));

// ═══════════════════════════════════════════════════════════════
//  SERTIFIKAT BOT
// ═══════════════════════════════════════════════════════════════

const certSessions = {};

function getTodayDate() {
  return new Date().toLocaleDateString("ru-RU");
}

function countryKeyboard() {
  const buttons = COUNTRIES.map((c, i) => Markup.button.callback(c.label, `country_${i}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return Markup.inlineKeyboard(rows);
}

certBot.command("start", (ctx) => {
  const name = ctx.from.first_name || "Foydalanuvchi";
  ctx.reply(
    `👋 Salom, *${name}*!\n\n` +
    `🎓 Men maqola havolasini yuborgan foydalanuvchiga *sertifikat* tayyorlab beraman.\n\n` +
    `📋 *Qanday foydalanish:*\n` +
    `Maqola URL ini yuboring — sertifikat avtomatik tayyorlanadi.`,
    { parse_mode: "Markdown" }
  );
});

certBot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (text.startsWith("/")) return;

  // Sana kutilayotgan bo'lsa
  if (certSessions[userId] && certSessions[userId].step === "date") {
    if (/\d/.test(text)) {
      certSessions[userId].date = text;
      certSessions[userId].step = "country";
      await ctx.reply("🌍 Davlatni tanlang:", countryKeyboard());
    } else {
      ctx.reply("⚠️ Iltimos, sana kiriting (masalan: 15.03.2026) yoki tugmani bosing.");
    }
    return;
  }

  const urls = extractUrls(text);
  if (urls.length === 0) {
    return ctx.reply("⚠️ Iltimos, https:// bilan boshlanadigan URL yuboring.");
  }

  await ctx.reply(`⏳ ${urls.length > 1 ? urls.length + " ta link" : "Ma'lumot"} olinmoqda...`);

  let preview = urls.length > 1 ? `✅ ${urls.length} ta link topildi:\n\n` : "";
  for (let i = 0; i < urls.length; i++) {
    const info = await getArticleInfo(urls[i]);
    if (urls.length > 1) {
      preview += info
        ? `${i + 1}. 👥 ${info.authors.join(", ")}\n   📄 ${info.title}\n\n`
        : `${i + 1}. ❌ Ma'lumot olinmadi\n\n`;
    } else if (info) {
      preview = `✅ Ma'lumot topildi:\n\n` +
        `👥 Muallif(lar): ${info.authors.join(", ")}\n` +
        `📊 Jami: ${info.authors.length} ta muallif\n` +
        `📄 Mavzu: ${info.title}\n\n`;
    } else {
      return ctx.reply("❌ Saytdan ma'lumot olinmadi.");
    }
  }

  certSessions[userId] = { urls, step: "date" };
  const today = getTodayDate();
  preview += `📅 Sana tanlang yoki o'zingiz kiriting:`;

  await ctx.reply(
    preview,
    Markup.inlineKeyboard([[Markup.button.callback(`📅 Bugun: ${today}`, "date_today")]])
  );
});

certBot.action("date_today", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = certSessions[userId];
  if (!session) return ctx.reply("⚠️ Sessiya topilmadi.");
  session.date = getTodayDate();
  session.step = "country";
  await ctx.reply("🌍 Davlatni tanlang:", countryKeyboard());
});

certBot.action(/^country_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const session = certSessions[userId];
  if (!session) return ctx.reply("⚠️ Sessiya topilmadi. Qaytadan link yuboring.");

  const country = COUNTRIES[parseInt(ctx.match[1])];
  if (!country) return ctx.reply("⚠️ Noto'g'ri tanlov.");

  const { urls, date } = session;
  await ctx.reply(`✅ ${country.label} tanlandi. Sertifikat tayyorlanmoqda...`);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const prefix = urls.length > 1 ? `[${i + 1}/${urls.length}] ` : "";
    const info = await getArticleInfo(url);
    if (!info) { await ctx.reply(`${prefix}❌ Ma'lumot olinmadi: ${url}`); continue; }

    if (info.authors.length > 1) {
      await ctx.reply(`👥 ${info.authors.length} ta muallif topildi, har biriga sertifikat tayyorlanmoqda...`);
    }

    for (const author of info.authors) {
      const result = await generateCertificate(author, info.title, date, country);
      if (!result) { await ctx.reply(`❌ Sertifikat yaratilmadi: ${author}`); continue; }

      await ctx.replyWithDocument(
        { source: result.path, filename: `${result.authorName}.pdf` },
        { caption: `${url}` }
      );

      try {
        await ctx.telegram.sendDocument(
          CHANNEL,
          { source: result.path, filename: `${result.authorName}.pdf` },
          { caption: `${url}` }
        );
      } catch (err) {
        console.error("Kanalga yuborishda xato:", err.message);
      }

      deleteCert(result.path);
    }
  }

  delete certSessions[userId];
});

certBot.catch((err) => console.error("Sertifikat bot xatosi:", err.message));

// ─────────────────────────────────────────────
// ISHGA TUSHIRISH
// ─────────────────────────────────────────────
function launchBots() {
  excelBot.launch()
    .then(() => console.log("📊 Excel bot ishga tushdi!"))
    .catch((err) => {
      console.error("Excel bot ulanishda xato:", err.message);
      setTimeout(launchBots, 5000);
    });

  certBot.launch()
    .then(() => console.log("🎓 Sertifikat bot ishga tushdi!"))
    .catch((err) => {
      console.error("Sertifikat bot ulanishda xato:", err.message);
      setTimeout(launchBots, 5000);
    });
}

launchBots();

process.once("SIGINT", () => { excelBot.stop("SIGINT"); certBot.stop("SIGINT"); });
process.once("SIGTERM", () => { excelBot.stop("SIGTERM"); certBot.stop("SIGTERM"); });