const https = require("https");
const cheerio = require("cheerio");

const SUBREDDITS = [
  "HistoriasDeReddit",
  "AskRedditEsp",
  "confesiones",
  "anecdotasgraciosas",
  "es",
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
  "Cookie": "over18=1; reddit_session=; loid=",
};

function fetchHTML(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects === 0) return reject(new Error("Demasiadas redirecciones"));

    const req = https.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchHTML(next, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
  });
}

async function fetchPostLinks(subreddit) {
  const url = `https://old.reddit.com/r/${subreddit}/top/?t=week`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const links = [];
  $("div.thing.self").each((_, el) => {
    const $el = $(el);
    // Skip stickied and nsfw
    if ($el.hasClass("stickied") || $el.hasClass("over18")) return;
    const href = $el.find("a.title").attr("href");
    const title = $el.find("a.title").text().trim();
    const score = parseInt($el.find(".score.unvoted").attr("title") || "0", 10);
    if (href && title) links.push({ href, title, score });
  });

  return links;
}

async function fetchPostText(href) {
  // Make sure we use old.reddit.com for consistent HTML
  const url = href.startsWith("http")
    ? href.replace("www.reddit.com", "old.reddit.com")
    : `https://old.reddit.com${href}`;

  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // The selftext is in div.usertext-body > div.md
  const text = $("div.expando div.usertext-body div.md").first().text().trim();
  return text;
}

async function fetchRandomStory(subreddits) {
  const list = subreddits?.length ? subreddits : SUBREDDITS;
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  const errors = [];

  for (const sub of shuffled) {
    try {
      const links = await fetchPostLinks(sub);
      if (!links.length) {
        errors.push(`r/${sub}: sin posts de texto`);
        continue;
      }

      // Shuffle and try up to 5 posts until one has good text
      const candidates = links.sort(() => Math.random() - 0.5).slice(0, 5);
      for (const { href, title } of candidates) {
        try {
          const text = await fetchPostText(href);
          if (text.length < 150 || text.length > 4000) continue;

          const postUrl = href.startsWith("http")
            ? href
            : `https://www.reddit.com${href}`;

          return { subreddit: sub, title, text, url: postUrl };
        } catch (err) {
          // try next candidate
        }
      }

      errors.push(`r/${sub}: ningún post tenía texto válido`);
    } catch (err) {
      errors.push(`r/${sub}: ${err.message}`);
      console.warn(`[reddit] r/${sub}: ${err.message}`);
    }
  }

  throw new Error(`No se encontró ninguna historia: ${errors.join(" | ")}`);
}

module.exports = { fetchRandomStory };
