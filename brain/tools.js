// Loki's toolbox: free services and local tools that need NO account and NO key.
// Every tool is optional: if a service is down, Loki just carries on without it.
// Tools that need an account (Stripe, itch.io, social media...) are set up later by his human
// in the Control Centre and appear in his "resources".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LokisTown/1.0 (+https://lokistown.github.io; autonomous cat)';
const SITE = 'https://lokistown.github.io';

let logMem = null;
export function useToolLog(mem) {
  logMem = mem;
}
function log(tool, ok, note = '') {
  if (!logMem) return;
  try {
    const l = logMem.list('toollog.json');
    l.unshift({ t: new Date().toISOString(), tool, ok, note: String(note).slice(0, 140) });
    logMem.saveList('toollog.json', l, 200);
  } catch {}
}
async function get(url, { json = true, timeout = 15000, headers = {}, method = 'GET', body } = {}) {
  const r = await fetch(url, { method, body, headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${new URL(url).host} said ${r.status}`);
  return json ? r.json() : r;
}
async function tool(name, fn, fallback = null) {
  if (process.env.LOKI_OFFLINE) return fallback;
  try {
    const out = await fn();
    log(name, true);
    return out;
  } catch (e) {
    log(name, false, e.message);
    console.warn(`tool ${name} failed: ${e.message}`);
    return fallback;
  }
}

// What Loki is told about his toolbox (and what the Control Centre lists).
export const FREE_TOOLS = [
  { id: 'weather', name: 'Open-Meteo weather', url: 'https://open-meteo.com', does: 'real UK weather, so it rains or snows in his town when it does in London' },
  { id: 'holidays', name: 'Nager.Date holidays', url: 'https://date.nager.at', does: 'UK holidays and celebrations to decorate for' },
  { id: 'wiki', name: 'Wikipedia', url: 'https://en.wikipedia.org', does: 'real facts when he researches or learns' },
  { id: 'trends', name: 'Hacker News search', url: 'https://hn.algolia.com', does: 'what people are talking about (trends for products and business ideas)' },
  { id: 'books', name: 'Project Gutenberg library', url: 'https://www.gutenberg.org', does: 'free public-domain books he can read' },
  { id: 'rhymes', name: 'Datamuse', url: 'https://www.datamuse.com/api/', does: 'rhymes and related words for songs and stories' },
  { id: 'palette', name: 'The Color API', url: 'https://www.thecolorapi.com', does: 'colour palettes for art and designs' },
  { id: 'illustrate', name: 'Pollinations image AI', url: 'https://pollinations.ai', does: 'real illustrations (not only pixel art) for art and stories' },
  { id: 'validate', name: 'W3C HTML checker', url: 'https://validator.w3.org/nu/', does: 'checks his web pages and templates for mistakes' },
  { id: 'qr', name: 'QR code maker', url: 'https://goqr.me/api/', does: 'QR codes that link to his town and shop' },
  { id: 'indexnow', name: 'IndexNow', url: 'https://www.indexnow.org', does: 'tells search engines (Bing, Yandex...) about his new pages' },
  { id: 'feeds', name: 'RSS feed + sitemap (his own)', url: `${SITE}/feed.xml`, does: 'people can follow his diary and search engines find every page' },
];

// ---------- weather (London) ----------
const WMO = (c) => (c >= 95 ? 'storm' : c >= 71 && c <= 77 ? 'snow' : c >= 85 && c <= 86 ? 'snow' : c >= 51 ? 'rain' : c >= 45 ? 'fog' : c >= 3 ? 'cloudy' : c >= 1 ? 'partly' : 'clear');
export function weather() {
  return tool('weather', async () => {
    const j = await get('https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13&current=temperature_2m,weather_code,wind_speed_10m,is_day,precipitation&timezone=Europe%2FLondon');
    const c = j.current;
    const kind = WMO(c.weather_code);
    const words = { storm: 'a thunderstorm', snow: 'snowing', rain: 'raining', fog: 'foggy', cloudy: 'cloudy', partly: 'partly cloudy', clear: 'clear skies' };
    return { kind, temp: Math.round(c.temperature_2m), wind: Math.round(c.wind_speed_10m), precip: c.precipitation, text: `${words[kind]}, ${Math.round(c.temperature_2m)}°C`, at: new Date().toISOString() };
  });
}

// ---------- UK holidays ----------
export function holidays() {
  return tool('holidays', async () => {
    const y = new Date().getFullYear();
    const list = await get(`https://date.nager.at/api/v3/PublicHolidays/${y}/GB`);
    const today = new Date().toISOString().slice(0, 10);
    const soon = list.filter((h) => h.date >= today && (!h.counties || h.counties.includes('GB-ENG'))).slice(0, 2);
    return soon.map((h) => ({ date: h.date, name: h.localName || h.name }));
  }, []);
}

// ---------- Wikipedia ----------
export function wiki(topic) {
  return tool('wiki', async () => {
    const s = await get(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(topic)}&limit=1`);
    const page = s.pages?.[0];
    if (!page) return null;
    const sum = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`);
    return { title: sum.title, extract: String(sum.extract || '').slice(0, 1500), url: sum.content_urls?.desktop?.page };
  });
}

// ---------- trends (Hacker News) ----------
export function trends(query) {
  return tool('trends', async () => {
    const since = Math.floor(Date.now() / 1000) - 60 * 86400;
    const j = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=8`);
    return j.hits.filter((h) => h.title).map((h) => ({ title: h.title, points: h.points, comments: h.num_comments }));
  }, []);
}

// ---------- free books (Project Gutenberg, public domain, via the pglaf mirror) ----------
export const SHELF = [
  [11, "Alice's Adventures in Wonderland", 'Lewis Carroll'], [12, 'Through the Looking-Glass', 'Lewis Carroll'], [16, 'Peter Pan', 'J. M. Barrie'],
  [289, 'The Wind in the Willows', 'Kenneth Grahame'], [2781, 'Just So Stories', 'Rudyard Kipling'], [236, 'The Jungle Book', 'Rudyard Kipling'],
  [21, "Aesop's Fables", 'Aesop'], [2591, "Grimms' Fairy Tales", 'Brothers Grimm'], [1597, "Andersen's Fairy Tales", 'H. C. Andersen'],
  [113, 'The Secret Garden', 'Frances Hodgson Burnett'], [55, 'The Wonderful Wizard of Oz', 'L. Frank Baum'], [500, 'The Adventures of Pinocchio', 'Carlo Collodi'],
  [271, 'Black Beauty', 'Anna Sewell'], [120, 'Treasure Island', 'R. L. Stevenson'], [45, 'Anne of Green Gables', 'L. M. Montgomery'],
  [103, 'Around the World in Eighty Days', 'Jules Verne'], [132, 'The Art of War', 'Sun Tzu'], [1342, 'Pride and Prejudice', 'Jane Austen'],
  [46, 'A Christmas Carol', 'Charles Dickens'], [1661, 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle'], [11757, 'The Velveteen Rabbit', 'Margery Williams'],
].map(([id, title, author]) => ({ id, title, author, text: `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}.txt` }));
export function findBooks(topic = '') {
  const w = String(topic).toLowerCase().split(/\W+/).filter((x) => x.length > 3);
  const hit = SHELF.filter((b) => w.some((x) => `${b.title} ${b.author}`.toLowerCase().includes(x)));
  return Promise.resolve(hit.length ? hit : SHELF);
}
export function readBook(book, chars = 3500) {
  return tool('books', async () => {
    if (!book.text) return null;
    const r = await get(book.text, { json: false, timeout: 25000 });
    let t = await r.text();
    const start = t.search(/\*\*\* ?START OF/i);
    if (start > 0) t = t.slice(t.indexOf('\n', start) + 1);
    // skip front matter: start a few thousand characters in, at a paragraph break
    const from = Math.min(Math.max(0, t.length - chars - 10), 2500 + Math.floor(Math.random() * Math.max(1, Math.min(60000, t.length - 8000))));
    const para = t.indexOf('\n\n', from);
    return t.slice(para > 0 ? para : from, (para > 0 ? para : from) + chars).replace(/\r/g, '').trim();
  });
}

// ---------- words, colours ----------
export function rhymes(word) {
  return tool('rhymes', async () => (await get(`https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=12`)).map((w) => w.word), []);
}
export function palette(hex = 'f28c28', mode = 'analogic') {
  return tool('palette', async () => {
    const j = await get(`https://www.thecolorapi.com/scheme?hex=${hex.replace('#', '')}&mode=${mode}&count=6&format=json`);
    return j.colors.map((c) => c.hex.value);
  }, []);
}

// ---------- illustrations (Pollinations) ----------
// Free without an account: 1 picture every 45 seconds, with a small logo (cropped when shown).
// A free "pollen" key from enter.pollinations.ai (GitHub secret POLLINATIONS_TOKEN) removes both.
let lastPicture = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function illustrate(prompt, { width = 768, height = 768, seed } = {}) {
  return tool('illustrate', async () => {
    const key = process.env.POLLINATIONS_TOKEN;
    const s = seed ?? Math.floor(Math.random() * 1e6);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 600))}?width=${width}&height=${height}&seed=${s}&nologo=true&model=flux&referrer=lokistown.github.io`;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!key) await sleep(Math.max(0, lastPicture + 46000 - Date.now()));
      lastPicture = Date.now();
      const r = await fetch(url, { headers: { 'user-agent': UA, ...(key ? { authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(120000) });
      if (r.status === 402 || r.status === 429 || r.status === 503) {
        const wait = Number(((await r.text()).match(/after (\d+)s/) || [])[1] || 45);
        await sleep((wait + 2) * 1000);
        continue;
      }
      if (!r.ok) throw new Error(`pollinations said ${r.status}`);
      const type = r.headers.get('content-type') || '';
      if (!type.startsWith('image/')) throw new Error(`not an image (${type})`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 15000) throw new Error('image too small');
      return { buf, ext: type.includes('png') ? 'png' : 'jpg' };
    }
    throw new Error('image tool kept saying "busy"');
  });
}

// ---------- HTML checker ----------
export function validateHtml(html) {
  return tool('validate', async () => {
    const j = await get('https://validator.w3.org/nu/?out=json', { method: 'POST', body: html, headers: { 'content-type': 'text/html; charset=utf-8' }, timeout: 25000 });
    return (j.messages || []).filter((m) => m.type === 'error').slice(0, 8).map((m) => `line ${m.lastLine}: ${m.message}`);
  }, []);
}

export const qrUrl = (data, size = 240) => `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;

// ---------- search engines: IndexNow ----------
export async function indexNow(mem, siteDir, urls) {
  if (!siteDir || !urls.length) return false;
  const cfg = mem.readJson('settings.json', {});
  if (!cfg.indexNowKey) {
    cfg.indexNowKey = crypto.randomBytes(16).toString('hex');
    mem.writeJson('settings.json', cfg);
  }
  const keyFile = path.join(siteDir, `${cfg.indexNowKey}.txt`);
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, cfg.indexNowKey);
    return false; // the key file must be live before search engines can check it; ping next time
  }
  return tool('indexnow', async () => {
    await get('https://api.indexnow.org/indexnow', {
      method: 'POST',
      json: false,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'lokistown.github.io', key: cfg.indexNowKey, keyLocation: `${SITE}/${cfg.indexNowKey}.txt`, urlList: urls.slice(0, 100) }),
    });
    return true;
  }, false);
}

// ---------- his own RSS feed, sitemap and robots.txt (local, always works) ----------
const x = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
export function writeFeeds(siteDir, mem) {
  if (!siteDir) return [];
  const diary = mem.diaryEntries(30);
  const go = (l) => (l?.go ? `${SITE}/?go=${encodeURIComponent(l.go)}` : `${SITE}/`);
  const items = diary.map((d) => `<item><title>${x(d.title)}</title><link>${x(go(d.link))}</link><guid isPermaLink="false">${x(`${d.date}-${d.time}-${d.title}`)}</guid><pubDate>${new Date(`${d.date}T${d.time || '12:00'}:00Z`).toUTCString()}</pubDate><description>${x(d.text)}</description></item>`).join('\n');
  fs.writeFileSync(path.join(siteDir, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Loki's diary</title><link>${SITE}/</link><description>The diary of Loki, an autonomous orange cat who lives in a little 3D town with Pip the mouse.</description><language>en-gb</language>
${items}
</channel></rss>
`);
  const pages = ['', 'home/', 'portrait.html'];
  for (const g of mem.list('games.json')) pages.push(`games/${g.slug}/`);
  for (const p of mem.list('products.json')) if (p.preview) pages.push(p.preview.replace(/^\//, ''));
  for (const s of mem.list('stories.json')) pages.push(`stories/${s.slug}/`);
  for (const m of mem.list('made.json')) pages.push(`made/${m.slug}/`);
  const urls = pages.map((p) => `${SITE}/${p}`);
  fs.writeFileSync(path.join(siteDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${x(u)}</loc></url>`).join('\n')}
</urlset>
`);
  fs.writeFileSync(path.join(siteDir, 'robots.txt'), `User-agent: *\nDisallow: /control/\nSitemap: ${SITE}/sitemap.xml\n`);
  return urls;
}
