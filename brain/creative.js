// New things Loki can do with his free toolbox (no accounts): real illustrations,
// research with real facts and trends, reading public-domain books, and illustrated stories.
import fs from 'node:fs';
import path from 'node:path';
import { slugify, clip } from './util.js';
import { reviewAndFix } from './quality.js';
import { illustrate, wiki, trends, findBooks, readBook, palette } from './tools.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Illustrations are made 768x832 and shown cropped to a square from the top
// (the free image service stamps a small logo in the bottom corner).
const ILL = { width: 768, height: 832 };
const STYLE = 'cozy storybook illustration, soft watercolor and ink, warm light, gentle colours, no text';
const LOKI = 'an orange tabby cat with a tiny grey mouse sitting on his head';

export const CREATIVE_ACTIONS = {
  make_illustration: 'Make a real illustration (painted look, not pixel art) with your image tool, for your gallery, art wall and future products.',
  research: 'Research something real (Wikipedia facts + what people talk about online) to get better ideas for your art, products, games or business.',
  read_book: 'Read a chapter of a free classic book from your library and think about what it teaches you.',
  write_story: 'Write and illustrate a short picture-book story (about you, Pip, your town or your visitors). It goes on the book stand in your town.',
};

export const creative = {
  async make_illustration({ brain, mem, system, now }, choice) {
    const r = await brain.ask(
      system,
      `[[ILLUSTRATE]] You decided: "${choice.plan}". You are painting an illustration with your image tool.
Describe ONE clear scene (subject first, then setting, then mood). If you are in it, describe yourself as "${LOKI}".
Reply as JSON: {"title": "title", "description": "one sentence for visitors", "scene": "the picture, max 40 words"}`,
      { json: true },
    );
    const title = clip(r.title || 'Untitled', 60);
    const img = await illustrate(`${clip(r.scene || title, 300)}, ${STYLE}`, ILL);
    if (!img) throw new Error('My image tool is busy right now');
    const file = `${now.date}-${slugify(title)}-${Date.now().toString(36).slice(-4)}.${img.ext}`;
    fs.mkdirSync(mem.p('art'), { recursive: true });
    fs.writeFileSync(path.join(mem.p('art'), file), img.buf);
    const gallery = mem.readJson('gallery.json', []);
    gallery.unshift({ file, title, description: clip(r.description, 200), date: now.date, kind: 'illustration', forSale: false });
    mem.writeJson('gallery.json', gallery.slice(0, 300));
    const go = `art:${file}`;
    mem.addDiary(now.date, now.time, `New illustration: ${title}`, r.description || title, { type: 'go', go });
    return { title, summary: `painted an illustration "${title}"`, xp: 11, location: 'gallery', made: { kind: 'picture', title, go } };
  },

  async research({ brain, mem, system, state, now }, choice) {
    const q = await brain.ask(
      system,
      `[[RESEARCH]] You decided: "${choice.plan}". Pick ONE thing to research that helps you make or sell better things.
Reply as JSON: {"topic": "a Wikipedia topic (2-4 words)", "trend_query": "2-3 words to search what people discuss online"}`,
      { json: true },
    );
    const [w, t] = await Promise.all([wiki(clip(q.topic || 'pixel art', 60)), trends(clip(q.trend_query || q.topic || 'indie games', 60))]);
    if (!w && !t.length) throw new Error('The internet was too quiet for research today');
    const r = await brain.ask(
      system,
      `[[RESEARCH2]] You researched "${q.topic}".
Wikipedia says: ${w ? `${w.title}: ${w.extract}` : 'nothing found'}
People online are talking about: ${t.map((x) => `"${x.title}" (${x.points} points)`).join('; ') || 'nothing found'}
What did you learn, and what will you make or try because of it?
Reply as JSON: {"notes": ["3-5 short facts or lessons"], "ideas": ["1-3 concrete ideas for things to make or sell"], "diary": "2-3 sentences"}`,
      { json: true },
    );
    const slug = slugify(q.topic || 'research');
    const notes = (r.notes || []).slice(0, 6).map((n) => clip(n, 200));
    const ideas = (r.ideas || []).slice(0, 3).map((n) => clip(n, 160));
    fs.mkdirSync(mem.p('research'), { recursive: true });
    fs.writeFileSync(mem.p('research', `${now.date}-${slug}.md`), `# ${q.topic}\n\n${now.date}\n\n## Facts\n${notes.map((n) => `- ${n}`).join('\n')}\n\n## Ideas\n${ideas.map((n) => `- ${n}`).join('\n')}\n\n## Sources\n- ${w?.url || 'Wikipedia: nothing'}\n${t.map((x) => `- HN: ${x.title}`).join('\n')}\n`);
    const list = mem.list('research.json');
    list.unshift({ topic: clip(q.topic, 60), date: now.date, notes, ideas, source: w?.url || null });
    mem.saveList('research.json', list, 100);
    state.ideas = [...ideas, ...(state.ideas || [])].slice(0, 6);
    mem.addDiary(now.date, now.time, `Researched: ${clip(q.topic, 40)}`, r.diary || notes.join(' '));
    return { title: q.topic, summary: `researched ${clip(q.topic, 40)} and got ${ideas.length} new ideas`, xp: 7, location: 'library' };
  },

  async read_book({ brain, mem, system, now }, choice) {
    const read = mem.list('books.json');
    const shelf = await findBooks(choice.plan);
    const fresh = shelf.filter((b) => read.filter((x) => x.id === b.id).length < 3);
    const book = (fresh.length ? fresh : shelf)[Math.floor(Math.random() * (fresh.length || shelf.length))];
    const text = await readBook(book, 3200);
    if (!text) throw new Error('The library was closed (could not fetch the book)');
    const r = await brain.ask(
      system,
      `[[READ]] You read a few pages of "${book.title}" by ${book.author} (public domain):
"""${text}"""
Reply as JSON: {"thought": "what you think about it, first person, 1-2 sentences", "lesson": "one thing it teaches you for your own art/stories/business", "diary": "2-4 sentences, in your voice"}`,
      { json: true },
    );
    read.unshift({ id: book.id, title: book.title, author: book.author, date: now.date, thought: clip(r.thought, 240), lesson: clip(r.lesson, 200) });
    mem.saveList('books.json', read, 200);
    mem.addDiary(now.date, now.time, `Reading: ${book.title}`, r.diary || r.thought || `I read some of ${book.title}.`);
    return { title: book.title, summary: `read some of "${book.title}" by ${book.author}`, xp: 6, location: 'library' };
  },

  async write_story({ brain, mem, system, site, now }, choice) {
    const stories = mem.list('stories.json');
    const r = await brain.ask(
      system,
      `[[STORY]] You decided: "${choice.plan}". Write an ORIGINAL short picture-book story for children and grown-ups (never copy existing stories).
${stories.length ? `Your earlier stories: ${stories.slice(0, 5).map((s) => s.title).join(', ')}. Make this one different.` : ''}
4 pages, each 50-110 words. For each page also describe its picture (max 30 words; if you or Pip are in it, say "${LOKI}").
Reply as JSON: {"title": "title", "blurb": "one sentence", "cover": "cover picture description", "pages": [{"text": "...", "picture": "..."}], "diary": "one sentence"}`,
      { json: true, quality: 'high' },
    );
    const pages = (r.pages || []).filter((p) => p && String(p.text || '').length > 30).slice(0, 5);
    if (pages.length < 3) throw new Error('My story came out too short');
    const title = clip(r.title || 'A little story', 70);
    const slug = `${slugify(title)}-${Date.now().toString(36).slice(-4)}`;
    if (!site) throw new Error('no website folder');
    const dir = path.join(site, 'stories', slug);
    fs.mkdirSync(dir, { recursive: true });
    const pics = [];
    const prompts = [r.cover || title, ...pages.map((p) => p.picture || p.text.slice(0, 120))];
    for (let i = 0; i < prompts.length; i++) {
      const img = await illustrate(`${clip(prompts[i], 300)}, ${STYLE}`, { ...ILL, seed: 1000 + i * 7 + stories.length });
      if (img) {
        const f = `${i ? `p${i}` : 'cover'}.${img.ext}`;
        fs.writeFileSync(path.join(dir, f), img.buf);
        pics[i] = f;
      }
    }
    const card = (i) => (pics[i] ? `<div class="pic"><img src="${pics[i]}" alt="" loading="${i > 1 ? 'lazy' : 'eager'}"></div>` : '');
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · a story by Loki</title><meta name="description" content="${esc(r.blurb || '')}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(r.blurb || '')}">${pics[0] ? `<meta property="og:image" content="https://lokistown.github.io/stories/${slug}/${pics[0]}">` : ''}
<link rel="icon" href="../../favicon.svg">
<style>@font-face{font-family:Fredoka;src:url(../../vendor/fonts/fredoka-latin.woff2) format('woff2');font-weight:300 700}
:root{--ink:#3b2416;--paper:#fff8ec;--accent:#e07a1f}*{box-sizing:border-box}body{margin:0;background:#f3e6cf;color:var(--ink);font:19px/1.65 Georgia,serif}
header{text-align:center;padding:36px 16px 10px}h1{font:700 clamp(2rem,6vw,3.2rem)/1.1 Fredoka,sans-serif;margin:0 0 8px}.by{font-family:Fredoka,sans-serif;color:#8a6f5c}
.book{max-width:760px;margin:0 auto;padding:0 16px 60px}.page{background:var(--paper);border:3px solid var(--ink);border-radius:22px;margin:26px 0;overflow:hidden;box-shadow:0 6px 0 rgba(59,36,22,.25)}
.pic{aspect-ratio:1/1;overflow:hidden;border-bottom:3px solid var(--ink)}.pic img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.page p{margin:0;padding:22px 26px 26px}.num{font:600 .85rem Fredoka,sans-serif;color:#8a6f5c;padding:12px 26px 0}
footer{text-align:center;font-family:Fredoka,sans-serif;padding:20px}a{color:var(--accent)}.btn{display:inline-block;margin:6px;padding:10px 18px;border:3px solid var(--ink);border-radius:999px;background:#f6b26b;color:var(--ink);text-decoration:none;font-weight:600}</style></head>
<body><header><h1>${esc(title)}</h1><div class="by">a picture-book story written by Loki the cat · ${now.date}</div></header>
<main class="book"><div class="page">${card(0)}<p>${esc(r.blurb || '')}</p></div>
${pages.map((p, i) => `<div class="page">${card(i + 1)}<div class="num">page ${i + 1}</div><p>${esc(p.text)}</p></div>`).join('\n')}
<footer><p>The end.</p><a class="btn" href="../../?go=story:${slug}">Visit Loki's town</a><a class="btn" href="https://ko-fi.com/lokistown">Buy Loki a fish</a><p class="by">Pictures painted with Pollinations AI from Loki's descriptions.</p></footer></main></body></html>
`,
    );
    stories.unshift({ slug, title, blurb: clip(r.blurb, 200), date: now.date, pages: pages.length, cover: pics[0] ? `stories/${slug}/${pics[0]}` : null });
    mem.saveList('stories.json', stories, 200);
    const go = `story:${slug}`;
    mem.addDiary(now.date, now.time, `New story: ${title}`, r.diary || r.blurb || `I wrote a story called ${title}.`, { type: 'go', go });
    return { title, summary: `wrote and illustrated a story "${title}"`, xp: 18, location: 'library', made: { kind: 'story', title, go } };
  },
};

// A palette suggestion for pixel art (free Color API), so his pictures get nicer colours.
export async function paletteHint() {
  const base = ['f28c28', '2a9d8f', 'e76f51', '6a4c93', '3a86ff', 'ffb703', 'ef476f'][Math.floor(Math.random() * 7)];
  const mode = ['analogic', 'complement', 'triad', 'monochrome'][Math.floor(Math.random() * 4)];
  const p = await palette(base, mode);
  return p.length ? `A palette from your colour tool you may use: ${p.join(', ')}.` : '';
}

// ---------------- inventions: Loki decides WHAT to make, in any digital format ----------------
const SEEDS = [
  'an interactive toy (a tiny instrument, a bubble machine, a cat-pat simulator)',
  'a generative art machine people can play with and save pictures from',
  'a printable (colouring page, sticker sheet, bookmark set, planner page, recipe card) as SVG/HTML ready to print',
  'a mini web app that helps with something cosy (a tea timer, a mood journal, a gift idea picker)',
  'a choose-your-own-adventure story set in your town',
  'a little zine or comic made in HTML/CSS/SVG',
  'a puzzle or riddle hunt with a secret ending',
  'a screensaver or ambient scene (rain on a window, fireflies, a night train)',
  'a poem or haiku generator with beautiful typography',
  'a virtual pet, a fortune cookie, a daily horoscope for cats',
  'a font specimen, a colour palette tool, a pattern maker',
  'something nobody has thought of yet',
];
export const INVENT_ACTION = {
  invent: 'Invent and build something NEW that nobody asked for: any digital creation you can imagine (a toy, generative art, a printable, a mini app, an interactive story, a zine...). Surprise your human. It goes into Loki\'s Lab in your town.',
};
export async function invent(ctx, choice, design) {
  const { brain, mem, system, site, now } = ctx;
  const made = mem.list('made.json');
  const idea = await brain.ask(
    system,
    `[[INVENT]] You decided: "${choice.plan}". You are an inventor. Think of ONE original digital creation that would delight people and that nobody asked you for.
Things you made before (do something DIFFERENT): ${made.slice(0, 8).map((m) => `${m.title} (${m.kind})`).join('; ') || 'nothing yet'}.
Sparks (only for inspiration, invent your own if you can): ${SEEDS.join('; ')}.
Reply as JSON: {"title": "catchy name", "kind": "what it is in 2-4 words", "pitch": "one sentence for visitors", "concept": "how it works and what makes it special, 3-5 sentences", "surprise": "the unexpected detail"}`,
    { json: true, quality: 'high' },
  );
  const r = await brain.ask(
    system,
    `[[INVENT2]] ${design}
Build your invention as ONE complete, polished, self-contained HTML page.
Title: ${idea.title}
Kind: ${idea.kind}
Concept: ${idea.concept}
Surprise: ${idea.surprise}
Rules: single file, inline CSS and JS, the only external things allowed are Google Fonts and images from https://lokistown.github.io. It must WORK (no dead buttons, no errors), look beautiful on phone and desktop, and include a small footer "Made by Loki the cat · lokistown.github.io" with a link back to https://lokistown.github.io/?go=made:SLUG (write SLUG literally, it is replaced for you).
Reply as JSON: {"html": "<!doctype html>... complete page", "diary": "one or two sentences in your voice about inventing it"}`,
    { json: true, quality: 'high' },
  );
  let html = String(r.html || '');
  if (html.length < 2500) throw new Error('My invention came out too small');
  const title = clip(idea.title || 'An invention', 60);
  const slug = `${slugify(title, 36)}-${Date.now().toString(36).slice(-4)}`;
  html = html.replace(/SLUG/g, slug);
  const checked = await reviewAndFix(ctx, html, `${idea.kind}: ${idea.pitch}`);
  if (!checked.ok) throw new Error(`My invention did not pass my own check: ${checked.log.slice(0, 2).join('; ')}`);
  if (!site) throw new Error('no website folder');
  fs.mkdirSync(path.join(site, 'made', slug), { recursive: true });
  fs.writeFileSync(path.join(site, 'made', slug, 'index.html'), checked.html);
  made.unshift({ slug, title, kind: clip(idea.kind, 40), pitch: clip(idea.pitch, 200), date: now.date });
  mem.saveList('made.json', made, 300);
  const go = `made:${slug}`;
  mem.addDiary(now.date, now.time, `I invented: ${title}`, r.diary || idea.pitch || `I invented ${title}.`, { type: 'go', go });
  return { title, summary: `invented "${title}" (${clip(idea.kind, 30)})`, xp: 22, location: 'workshop', made: { kind: 'invention', title, go } };
}
