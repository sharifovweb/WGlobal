const axios = require("axios");
const cheerio = require("cheerio");

async function fetchPage(url) {
  const response = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    timeout: 30000,
  });
  return response.data;
}

function isValidConferenceUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "wglobalconference.com";
  } catch {
    return false;
  }
}

async function scrapeTableOfContents(url) {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const articles = [];

  $(".obj_article_summary, .article_summary, .tocTitle").each((i, el) => {
    const titleEl = $(el).find(".title a, h3 a, .obj_article_summary .title a");
    const title = titleEl.text().trim();
    const link = titleEl.attr("href");
    if (title && link) {
      const authors = $(el)
        .find(".authors, .author")
        .text()
        .trim()
        .replace(/\s+/g, " ");
      const pages = $(el).find(".pages").text().trim();
      articles.push({
        title,
        authors,
        pages,
        link: link.startsWith("http")
          ? link
          : `https://wglobalconference.com${link}`,
      });
    }
  });

  if (articles.length === 0) {
    $("table.tocArticle tr, .cmp_article_list .obj_article_summary").each(
      (i, el) => {
        const titleEl = $(el).find("td.tocTitle a, .title a");
        const title = titleEl.text().trim();
        const link = titleEl.attr("href");
        if (title && link) {
          const authors = $(el)
            .find("td.tocAuthors, .authors")
            .text()
            .trim()
            .replace(/\s+/g, " ");
          const pages = $(el).find("td.tocPages, .pages").text().trim();
          articles.push({
            title,
            authors,
            pages,
            link: link.startsWith("http")
              ? link
              : `https://wglobalconference.com${link}`,
          });
        }
      },
    );
  }

  if (articles.length === 0) {
    $('a[href*="/article/view/"]').each((i, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr("href");
      if (title && link) {
        const parent = $(el).closest("tr, div, li");
        const authors = parent
          .find(".authors, td:nth-child(2)")
          .text()
          .trim()
          .replace(/\s+/g, " ");
        const pages = parent.find(".pages, td:last-child").text().trim();
        articles.push({
          title,
          authors,
          pages,
          link: link.startsWith("http")
            ? link
            : `https://wglobalconference.com${link}`,
        });
      }
    });
  }

  return articles;
}

async function scrapeArticlePage(articleUrl) {
  try {
    const html = await fetchPage(articleUrl);
    const $ = cheerio.load(html);
    const title =
      $(".page_title h1, .article_title, #title h1, .pkp_structure_page h1")
        .first()
        .text()
        .trim() || $("h1").first().text().trim();
    let authors = "";
    const authorEls = $(".authors .name, .author .name, .pkp_author_name");
    if (authorEls.length > 0) {
      authors = authorEls
        .map((i, el) => $(el).text().trim())
        .get()
        .join(", ");
    } else {
      authors = $(".authors, .author")
        .first()
        .text()
        .trim()
        .replace(/\s+/g, " ");
    }
    const pages = $(".pages, .article_pages").text().trim();
    return { title, authors, pages };
  } catch (err) {
    console.error(`Error scraping article ${articleUrl}:`, err.message);
    return null;
  }
}

async function scrapeConference(url, onProgress) {
  const articles = await scrapeTableOfContents(url);

  if (articles.length === 0) {
    throw new Error(
      "Sahifadan maqolalar topilmadi. URL to'g'ri ekanligini tekshiring.",
    );
  }

  const results = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    if (onProgress) await onProgress(i + 1, articles.length, article.title);

    let authors = article.authors;
    let pages = article.pages;
    let title = article.title;

    if (!authors || !pages) {
      const detail = await scrapeArticlePage(article.link);
      if (detail) {
        authors = authors || detail.authors;
        pages = pages || detail.pages;
        title = title || detail.title;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    results.push({
      number: i + 1,
      title: title || "—",
      authors: authors || "—",
      pages: pages || "—",
      link: article.link,
    });
  }

  // Sahifalar bo'yicha tartiblash
  results.sort((a, b) => {
    const getFirstPage = (pages) => {
      if (!pages || pages === "—") return 9999;
      const match = pages.match(/\d+/);
      return match ? parseInt(match[0]) : 9999;
    };
    return getFirstPage(a.pages) - getFirstPage(b.pages);
  });

  results.forEach((r, i) => (r.number = i + 1));

  return results;
}

module.exports = { scrapeConference, isValidConferenceUrl };
