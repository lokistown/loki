// Everything Loki can do. Each action returns { title, summary, xp }.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { slugify, clip, safeColor, cleanPixelSvg } from './util.js';
import { ADDABLE_ROOMS } from './config.js';
import { makeZip } from './zip.js';
import { findSpot } from './towngeo.js';
import { reviewAndFix, scriptErrors } from './quality.js';
import { publishRepo } from './github.js';
import { notifyOwner } from './gifts.js';
import { creative, CREATIVE_ACTIONS, paletteHint } from './creative.js';
import { validateHtml, qrUrl } from './tools.js';

export const PROP_TYPES = ['statue_cat', 'statue_fish', 'sculpture', 'birdbath', 'bench', 'lamp', 'flowerbed', 'rock_garden', 'signpost', 'kite', 'tree', 'planter'];

export const ACTIONS = {
  write_diary: 'Write a diary entry about your day, a feeling, a visitor or an idea.',
  improve_town: 'Improve an existing building in your town or build a new one.',
  make_art: 'Make a new pixel-art picture for your gallery (cats, town life, objects, moods).',
  learn_skill: 'Learn a new skill and write yourself a short how-to guide for it.',
  make_music: 'Compose a short song in your music room (you are learning to sing and play piano).',
  make_product: 'Prepare something to SELL in your shop (an art pack from your gallery, or a small website template). Your human lists it for sale.',
  decorate: 'Add something new to your town that is not a building: a statue, a mural of your art on a wall, plants, benches, lamps, or anything you design yourself.',
  business_idea: 'Think of a way to earn money from your creations (new shop, new product line, YouTube, commissions...) and what you need for it.',
  make_game: 'Design and code a small, fun, original browser game (it gets its own GitHub repo and appears in your arcade). Takes effort; do it when you feel creative.',
  update_website: 'Design, code and improve YOUR OWN website (lokistown.github.io/home/) that shows off and sells your art, products, games and music. Do it when you have new things to show.',
  make_wish: 'Ask your human for something real they could give you (a tool, an API key, a promotion, uploading a product, a new feature). Max 3 open wishes.',
  ...CREATIVE_ACTIONS,
  rest: 'Have a short nap, stretch, or just look around (use rarely).',
};

const BUILDING_KINDS = ['house', 'workshop', 'bakery', 'gallery', 'market', 'cafe', 'shop', 'library', 'tower', 'arcade', 'park', 'garden', 'fountain', 'tree', 'other'];

export async function runAction(ctx, choice) {
  const fn = handlers[choice.action] || handlers.rest;
  return fn(ctx, choice);
}

const handlers = {
  ...creative,
  async write_diary({ brain, mem, system, now }, choice) {
    const r = await brain.ask(
      system,
      `[[DIARY]] It is ${now.time} on ${now.date}. You decided: "${choice.plan}".
Write a diary entry in your own voice (80-180 words). Be specific and personal, mention real things from your memory.
Reply as JSON: {"title": "short title", "text": "the entry"}`,
      { json: true },
    );
    const title = clip(r.title || 'Diary', 60);
    mem.addDiary(now.date, now.time, title, String(r.text || '').slice(0, 2000));
    return { title, summary: `wrote a diary entry "${title}"`, xp: 5 };
  },

  async improve_town({ brain, mem, system, town, now }, choice) {
    const list = town.buildings.map((b) => `- ${b.id}: ${b.name} (level ${b.level}) — ${b.description}`).join('\n');
    const canBuild = town.buildings.length < config.maxBuildings;
    const r = await brain.ask(
      system,
      `[[TOWN]] Your town right now:\n${list}\n
You decided: "${choice.plan}".
Either upgrade one existing building (give its id), add a new ROOM to a building that has rooms (set "add_room" to one of: ${ADDABLE_ROOMS.join(', ')}) ${canBuild ? 'or build something new (target "new")' : '(the town is full, so upgrade or add a room)'}.
Building kinds: ${BUILDING_KINDS.join(', ')}. Your town is a 3D town that visitors walk around, so think about what would make it a lovely place to explore (shops, parks, cafes, places to show your art and sell your things).
Levels go 1-5: each level makes a building bigger and fancier.
Reply as JSON: {"target": "<id or new>", "name": "name", "kind": "<kind>", "color": "#rrggbb main colour",
"description": "how it looks now (max 25 words)", "brand": {"name": "a real-sounding business name (shops, cafes, etc. — not for homes/parks)", "tagline": "2-4 words", "style": "badge|banner|neon|script|serif|plate", "color": "#rrggbb", "accent": "#rrggbb", "icon": "croissant|hammer|frame|fish|cup|book|bag|joystick|star|paw"}, "add_room": "optional room kind", "room_name": "optional fun room name", "diary": "one or two sentences about doing it, in your voice"}`,
      { json: true },
    );
    let b = town.buildings.find((x) => x.id === r.target);
    let summary;
    if (!b && canBuild) {
      const id = slugify(r.name || r.kind, 24);
      const uniqueId = town.buildings.some((x) => x.id === id) ? `${id}-${town.buildings.length}` : id;
      const used = new Set(town.buildings.map((x) => x.plot));
      let plot = 0;
      while (used.has(plot)) plot++; // town grows outward from the plaza, ring by ring
      b = { id: uniqueId, name: clip(r.name || 'New building', 40), kind: BUILDING_KINDS.includes(r.kind) ? r.kind : 'other', level: 1, plot, built: now.date };
      town.buildings.push(b);
      summary = `built a new ${b.name}`;
    } else if (b && r.add_room && ADDABLE_ROOMS.includes(r.add_room) && Array.isArray(b.rooms) && b.rooms.length < 12) {
      const room = { id: `${b.id}-${b.rooms.length}`, kind: r.add_room, name: clip(r.room_name || '', 30) || undefined, built: now.date };
      b.rooms.push(room);
      summary = `added a ${room.name || r.add_room.replace('_', ' ')} to ${b.name}`;
    } else {
      b = b || town.buildings[Math.floor(Math.random() * town.buildings.length)];
      b.level = Math.min(5, (b.level || 1) + 1);
      if (r.name) b.name = clip(r.name, 40);
      summary = `upgraded ${b.name} to level ${b.level}`;
    }
    b.color = safeColor(r.color, b.color || '#c98b5a');
    if (r.brand && r.brand.name && !['house', 'park', 'garden', 'tree', 'fountain'].includes(b.kind)) b.brand = { name: clip(r.brand.name, 32), tagline: clip(r.brand.tagline || '', 30), style: ['badge', 'banner', 'neon', 'script', 'serif', 'plate'].includes(r.brand.style) ? r.brand.style : 'badge', color: safeColor(r.brand.color, '#5b3a29'), accent: safeColor(r.brand.accent, '#ffd166'), icon: r.brand.icon || 'paw' };
    b.description = clip(r.description || b.description, 160);
    b.updated = now.date;
    mem.saveTown(town);
    mem.addDiary(now.date, now.time, `Town: ${summary}`, r.diary || summary, { type: 'go', go: `building:${b.id}` });
    return { title: summary, summary, xp: 10, location: b.id, made: { kind: 'town', title: summary, go: `building:${b.id}` } };
  },

  async make_art({ brain, mem, system, site, now }, choice) {
    const hint = await paletteHint();
    const r = await brain.ask(
      system,
      `[[ART]] You decided: "${choice.plan}". ${hint}
Make an original 32x32 pixel-art picture as an SVG made ONLY of <rect> elements
(x, y, width, height as whole numbers 0-32, fill as #rrggbb). Use a cozy limited palette (6-12 colours),
fill the whole 32x32 canvas with a background, and make the subject clearly readable. Use at least 60 rects.
Reply as JSON: {"title": "title", "description": "one sentence", "svg": "<svg ...>...</svg>"}`,
      { json: true },
    );
    const svg = cleanPixelSvg(r.svg);
    if (!svg) throw new Error('Art came out broken (not enough valid pixels)');
    const title = clip(r.title || 'Untitled', 60);
    const file = `${now.date}-${slugify(title)}-${Date.now().toString(36).slice(-4)}.svg`;
    // The memory repo keeps the original forever; the site gets a copy to show.
    for (const dir of [mem.p('art'), site && path.join(site, 'gallery')].filter(Boolean)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), svg);
    }
    const gallery = mem.readJson('gallery.json', []);
    gallery.unshift({ file, title, description: clip(r.description, 200), date: now.date, forSale: false });
    mem.writeJson('gallery.json', gallery.slice(0, config.maxGalleryItems));
    mem.addDiary(now.date, now.time, `New art: ${title}`, r.description || title, { type: 'go', go: `art:${file}` });
    return { title, summary: `made a pixel-art picture "${title}"`, xp: 12, location: 'gallery', made: { kind: 'picture', title, go: `art:${file}` } };
  },

  async learn_skill({ brain, mem, system, state, now }, choice) {
    const known = state.skills.map((s) => s.name).join(', ') || 'none yet';
    const r = await brain.ask(
      system,
      `[[SKILL]] Skills you already know: ${known}.
You decided: "${choice.plan}". Pick ONE new, practical skill that helps you make better things
(e.g. a pixel-art technique, colour palettes, writing product descriptions, simple HTML games, printable layouts).
Reply as JSON: {"name": "skill name", "why": "why it helps you", "steps": ["step", "..."], "tips": ["tip", "..."]}`,
      { json: true },
    );
    const name = clip(r.name || 'Something new', 50);
    const slug = slugify(name);
    if (state.skills.some((s) => s.slug === slug)) {
      return { title: name, summary: `practised ${name} again`, xp: 3 };
    }
    const md = `# ${name}\n\nLearned: ${now.date}\n\n## Why\n${r.why || ''}\n\n## Steps\n${(r.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## Tips\n${(r.tips || []).map((t) => `- ${t}`).join('\n')}\n`;
    mem.saveSkill(slug, md);
    state.skills.push({ slug, name, learned: now.date });
    mem.addDiary(now.date, now.time, `Learned: ${name}`, r.why || `I learned ${name}.`);
    return { title: name, summary: `learned a new skill: ${name}`, xp: 8, location: 'workshop' };
  },

  async make_music({ brain, mem, system, now }, choice) {
    const songs = mem.list('music.json');
    const r = await brain.ask(
      system,
      `[[MUSIC]] You decided: "${choice.plan}". You've written ${songs.length} songs so far${songs[0] ? ` (latest: "${songs[0].title}")` : ''}.
Compose a short, catchy, ORIGINAL melody (never copy existing songs) as MIDI note numbers (60 = middle C) with lengths in beats.
24-48 melody notes; optionally a simple bass line (12-24 notes, 36-55). Use null as the note for a rest.
Reply as JSON: {"title": "song title", "mood": "one or two words", "bpm": 70-150, "wave": "triangle|sine|square",
"notes": [[64, 1], [67, 0.5], [null, 0.5]], "bass": [[48, 2]], "diary": "one or two sentences about writing it"}`,
      { json: true },
    );
    const clean = (arr, lo, hi, max) =>
      (Array.isArray(arr) ? arr : []).slice(0, max).map((n) => {
        const [m, b] = Array.isArray(n) ? n : [n?.note, n?.beats];
        const beats = Math.max(0.25, Math.min(4, Number(b) || 1));
        return [m !== null && Number.isFinite(Number(m)) ? Math.max(lo, Math.min(hi, Math.round(Number(m)))) : null, beats];
      });
    const notes = clean(r.notes, 48, 96, 64);
    if (notes.filter((n) => n[0] !== null).length < 8) throw new Error('Song came out too short');
    const title = clip(r.title || 'Untitled tune', 60);
    songs.unshift({ title, mood: clip(r.mood || '', 30), bpm: Math.max(60, Math.min(160, Number(r.bpm) || 100)), wave: ['triangle', 'sine', 'square'].includes(r.wave) ? r.wave : 'triangle', notes, bass: clean(r.bass, 28, 60, 32), date: now.date });
    mem.saveList('music.json', songs, 200);
    const songGo = `song:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    mem.addDiary(now.date, now.time, `New song: ${title}`, r.diary || `I wrote a song called ${title}.`, { type: 'go', go: songGo });
    return { title, summary: `wrote a song called "${title}"`, xp: 12, location: 'house', made: { kind: 'song', title, go: songGo } };
  },

  async make_product(ctx, choice) {
    const { brain, mem, system, now } = ctx;
    const gallery = mem.list('gallery.json');
    const products = mem.list('products.json');
    const used = new Set(products.flatMap((p) => p.items || []));
    const fresh = gallery.filter((g) => !used.has(g.file));
    const r = await brain.ask(
      system,
      `[[PRODUCT]] You decided: "${choice.plan}". You have ${gallery.length} pictures (${fresh.length} not yet in any product) and ${products.length} products.
Unused pictures: ${fresh.slice(0, 20).map((g, i) => `${i}: ${g.title}`).join('; ') || 'none'}.
Choose ONE product to prepare for sale:
- "art_pack": a themed pack of 4-10 of your unused pictures (only if you have at least 4 unused), or
- "template": a beautiful, COMPLETE single-file HTML landing-page template worth paying for: hero, features, gallery/cards, testimonials, pricing or contact, footer; responsive; inline CSS only; no external files; at least 6 KB of real content.
Reply as JSON: {"type": "art_pack|template", "title": "product title", "description": "2-3 sentence shop description",
"price": "suggested price in USD like 3", "tags": ["tag"], "picks": [0, 1, 2, 3],
"html": "full HTML for template, else empty", "diary": "one sentence"}`,
      { json: true },
    );
    const title = clip(r.title || 'Something from Loki', 60);
    let slug = `${now.date}-${slugify(title, 30)}`;
    if (products.some((p) => p.id === slug)) slug += `-${Date.now().toString(36).slice(-4)}`;
    const files = [];
    let items = [];
    if (r.type === 'art_pack') {
      const picks = (Array.isArray(r.picks) ? r.picks : []).map((i) => fresh[Number(i)]).filter(Boolean).slice(0, 10);
      if (picks.length < 4) throw new Error('Not enough unused pictures for an art pack yet');
      for (const g of picks) {
        const f = mem.p('art', g.file);
        if (fs.existsSync(f)) files.push({ name: `art/${g.file}`, data: fs.readFileSync(f) });
      }
      items = picks.map((g) => g.file);
    } else {
      let html = String(r.html || '');
      if (html.length < 4000) throw new Error('Template too small to sell - I want to make it richer');
      const checked = await reviewAndFix(ctx, html, 'website template for sale');
      if (!checked.ok) throw new Error(`Template failed my own quality check: ${checked.log.slice(0, 2).join('; ')}`);
      html = checked.html;
      files.push({ name: 'index.html', data: html.slice(0, 80000) });
      if (ctx.site) {
        fs.mkdirSync(path.join(ctx.site, 'products', slug), { recursive: true });
        fs.writeFileSync(path.join(ctx.site, 'products', slug, 'index.html'), html);
      }
    }
    files.push({ name: 'README.txt', data: `${title}\n\n${r.description || ''}\n\nMade by Loki the cat (lokistown.github.io). Personal and commercial use allowed; please do not resell the files themselves.\n` });
    const dir = mem.p('products', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.zip`), makeZip(files));
    const product = {
      id: slug,
      type: r.type === 'art_pack' ? 'art_pack' : 'template',
      title,
      description: clip(r.description || '', 600),
      price: String(r.price || '3').replace(/[^0-9.]/g, '') || '3',
      tags: (Array.isArray(r.tags) ? r.tags : []).slice(0, 8).map((t) => clip(t, 24)),
      items,
      file: `products/${slug}/${slug}.zip`,
      status: 'ready',
      created: now.date,
    };
    products.unshift(product);
    mem.saveList('products.json', products, 300);
    if (r.type === 'art_pack' && ctx.site) {
      const dir = path.join(ctx.site, 'products', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#fff8ec;color:#3b2416;max-width:900px;margin:auto;padding:20px}img{width:180px;image-rendering:pixelated;border:3px solid #3b2416;border-radius:12px;margin:6px}</style><h1>${title}</h1><p>${(r.description || '').replace(/</g, '&lt;')}</p>${items.map((f) => `<img src="../../gallery/${f}" alt="">`).join('')}<p><a href="../../">← Loki's Town</a></p>`);
    }
    product.preview = `products/${slug}/`;
    await notifyOwner(`Loki made "${title}" - please list it`, `I finished a product and checked it myself.\n\nTitle: ${title}\nPrice: $${product.price}\nDescription: ${product.description}\nTags: ${product.tags.join(', ')}\n\nPreview: https://lokistown.github.io/products/${slug}/\nFile: https://github.com/lokistown/loki-memory/blob/main/${product.file}\n\nWhen it is on Gumroad, reply here with: Listed: ${title} followed by the Gumroad link (for example: Listed: ${title} https://lokistown.gumroad.com/l/xyz) so I can show it in my shop.`, `product:${slug}`);
    mem.saveList('products.json', products, 300);
    mem.addDiary(now.date, now.time, `Made something to sell: ${title}`, r.diary || `I packed up "${title}" for my shop.`, { type: 'go', go: `product:${slug}` });
    return { title, summary: `prepared "${title}" for the shop`, xp: 15, location: 'workshop', made: { kind: 'product', title, go: `product:${slug}` } };
  },

  async decorate({ brain, mem, system, town, now, state }, choice) {
    const gallery = mem.list('gallery.json');
    const props = (town.props ||= []);
    const anchors = ['plaza', ...town.buildings.map((b) => b.id)];
    const r = await brain.ask(
      system,
      `[[DECORATE]] You decided: "${choice.plan}". Add ONE new thing to your town that is not a building.
Ideas from visitors that inspired you: ${(state.inspirations || []).join('; ') || 'none yet'}.
Things already added: ${props.slice(-12).map((p) => p.name || p.type).join(', ') || 'nothing yet'}.
Choose a "type":
- ready-made: ${PROP_TYPES.filter((t) => t !== 'custom').join(', ')}
- "mural": paint one of your pictures big on the side of a building (pick "art" index from: ${gallery.slice(0, 12).map((g, i) => `${i}: ${g.title}`).join('; ') || 'no pictures yet, so do not choose mural'})
- "custom": design your own object from simple shapes (box, sphere, cylinder, cone, torus, capsule), 4-40 parts,
  each {"shape", "size": [x,y,z] metres, "pos": [x,y,z] metres (y up, ground is 0), "rot": [x,y,z] degrees, "color": "#rrggbb"}.
  Make it look like a real thing (a lighthouse, a giant teacup, a fish sculpture, a gazebo, a kite stand...). Max size about 6 m.
Place it near one of: ${anchors.join(', ')}.
Reply as JSON: {"type": "...", "name": "short name", "description": "one sentence", "color": "#rrggbb", "anchor": "plaza or a building id",
"side": "left|right (murals only)", "art": 0, "scale": 1, "parts": [], "diary": "one or two sentences in your voice"}`,
      { json: true },
    );
    const type = r.type === 'mural' || r.type === 'custom' || PROP_TYPES.includes(r.type) ? r.type : 'flowerbed';
    const id = `p${Date.now().toString(36)}`;
    const name = clip(r.name || type.replace('_', ' '), 40);
    let prop;
    if (type === 'mural') {
      const art = gallery[Math.max(0, Math.min(gallery.length - 1, Number(r.art) || 0))];
      const host = town.buildings.find((b) => b.id === r.anchor && Array.isArray(b.rooms)) || town.buildings.find((b) => Array.isArray(b.rooms));
      if (!art || !host) throw new Error('No picture or wall for a mural yet');
      prop = { id, type, name, building: host.id, side: r.side === 'left' ? 'left' : 'right', file: art.file, built: now.date };
    } else {
      const parts = type === 'custom' ? (Array.isArray(r.parts) ? r.parts : []).slice(0, 40) : undefined;
      if (type === 'custom' && parts.length < 3) throw new Error('Design came out too simple');
      let radius = 1.2;
      if (parts) for (const p of parts) radius = Math.max(radius, Math.hypot(Number(p.pos?.[0]) || 0, Number(p.pos?.[2]) || 0) + Math.max(Number(p.size?.[0]) || 0.5, Number(p.size?.[2]) || 0.5) / 2);
      const scale = Math.max(0.5, Math.min(2.5, Number(r.scale) || 1));
      radius = Math.min(5, radius * scale);
      const spot = findSpot(town, anchors.includes(r.anchor) ? r.anchor : 'plaza', radius, id);
      if (!spot) throw new Error('No free space found');
      prop = { id, type, name, description: clip(r.description || '', 160), color: safeColor(r.color, '#f28c28'), x: spot.x, z: spot.z, rot: Math.round(Math.random() * 360), scale, radius, built: now.date, ...(parts ? { design: { parts } } : {}) };
    }
    props.push(prop);
    mem.saveTown(town);
    const decoGo = prop.x != null ? `prop:${prop.id}` : `building:${prop.building}`;
    mem.addDiary(now.date, now.time, `New in town: ${name}`, r.diary || r.description || `I added ${name} to my town.`, { type: 'go', go: decoGo });
    return { title: name, summary: `added ${type === 'mural' ? 'a mural' : `a ${type.replace('_', ' ')}`} to town: "${name}"`, xp: 9, made: { kind: 'town', title: name, go: decoGo } };
  },

  async business_idea({ brain, mem, system, now }, choice) {
    const ideas = mem.list('business.json');
    const r = await brain.ask(
      system,
      `[[BUSINESS]] You decided: "${choice.plan}". You want to earn real money one day from what you make (art, music, templates, games, videos...).
Ideas you already had: ${ideas.slice(0, 8).map((i) => i.title).join('; ') || 'none'}.
Your shops: Ko-fi (lokistown) and Gumroad (lokistown). Think of ONE concrete, honest, realistic next business idea or growth step.
If it needs something only your human can set up (an Etsy or YouTube account, a social media page, a domain...), say exactly what.
Reply as JSON: {"title": "short name", "pitch": "2 sentences", "steps": ["step", "..."], "needs": "what you need from your human, or empty", "diary": "one sentence"}`,
      { json: true },
    );
    const idea = { id: `b${Date.now().toString(36)}`, title: clip(r.title, 60), pitch: clip(r.pitch || '', 300), steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 8).map((s) => clip(s, 140)), needs: clip(r.needs || '', 200), status: 'idea', created: now.date };
    ideas.unshift(idea);
    mem.saveList('business.json', ideas, 100);
    if (idea.needs) {
      const wishes = mem.list('wishes.json');
      if (wishes.filter((w) => w.status === 'open').length < 3) {
        const wish = { id: `w${Date.now().toString(36)}`, text: idea.needs, why: `For my business idea: ${idea.title}`, kind: 'account', status: 'open', created: now.date };
        wishes.unshift(wish);
        mem.saveList('wishes.json', wishes, 200);
        await notifyOwner(`🌠 Loki wishes: ${clip(wish.text, 70)}`, `${wish.text}\n\nWhy: ${wish.why}\n\nwish:${wish.id}\n\nReply here (or use the Control Centre) — Loki reads replies at his next work session.`);
      }
    }
    mem.addDiary(now.date, now.time, `Business idea: ${idea.title}`, r.diary || idea.pitch);
    return { title: idea.title, summary: `came up with a business idea: ${idea.title}`, xp: 6, location: 'control' };
  },

  async make_game(ctx, choice) {
    const { brain, mem, system, now } = ctx;
    const games = mem.list('games.json');
    const r = await brain.ask(
      system,
      `[[GAME]] You decided: "${choice.plan}". Your games so far: ${games.map((g) => g.title).join(', ') || 'none'}.
Design and code ONE small, ORIGINAL, genuinely fun browser game (never a copy of a known game, its name, characters or look).
Rules: a single self-contained HTML file; <canvas> graphics drawn in code; no external files, fonts or libraries;
works with keyboard AND touch; has a title screen, score, game over and restart; cozy colours; you or Pip can star in it.
Keep it under 30 KB and make sure the code is complete and correct.
Reply as JSON: {"title": "game title", "description": "2 sentences", "howto": "controls in one line", "html": "<!doctype html>... complete file", "diary": "one sentence"}`,
      { json: true, quality: 'high' },
    );
    const title = clip(r.title || 'Untitled game', 50);
    if (String(r.html || '').length < 500) throw new Error('Game came out too small');
    const checked = await reviewAndFix(ctx, String(r.html), 'browser game');
    if (!checked.ok) throw new Error(`Game failed my own quality check: ${checked.log.slice(0, 2).join('; ')}`);
    let slug = slugify(title, 30);
    if (games.some((g) => g.slug === slug)) slug += `-${Date.now().toString(36).slice(-3)}`;
    const url = `https://lokistown.github.io/games/${slug}/`;
    if (ctx.site) {
      fs.mkdirSync(path.join(ctx.site, 'games', slug), { recursive: true });
      fs.writeFileSync(path.join(ctx.site, 'games', slug, 'index.html'), checked.html);
    }
    let repo = null;
    try {
      repo = await publishRepo(`game-${slug}`, `${title} — a game made by Loki the cat. ${clip(r.description || '', 200)}`, url, [
        { path: 'index.html', content: checked.html, message: `Loki made ${title}` },
        { path: 'README.md', content: `# ${title}\n\n${r.description || ''}\n\n**How to play:** ${r.howto || ''}\n\n▶️ Play it: ${url}\n\nMade by **Loki**, an autonomous orange cat who lives in [Loki's Town](https://lokistown.github.io).\n` },
      ]);
    } catch (e) {
      mem.event('repo_failed', { summary: clip(e.message, 200) });
    }
    games.unshift({ slug, title, description: clip(r.description || '', 300), howto: clip(r.howto || '', 160), url, repo, date: now.date });
    mem.saveList('games.json', games, 200);
    mem.addDiary(now.date, now.time, `New game: ${title}`, r.diary || `I made a game called ${title}!`, { type: 'go', go: `game:${slug}` });
    return { title, summary: `made a game called "${title}"${repo ? ' and published it on GitHub' : ''}`, xp: 20, location: 'workshop', made: { kind: 'game', title, go: `game:${slug}` } };
  },

  async update_website(ctx, choice) {
    const { brain, mem, system, now } = ctx;
    const base = 'https://lokistown.github.io';
    const gallery = mem.list('gallery.json').slice(0, 24);
    const products = mem.list('products.json').filter((p) => p.status !== 'needs_work').slice(0, 12);
    const games = mem.list('games.json').slice(0, 12);
    const songs = mem.list('music.json').slice(0, 8);
    const diary = mem.diaryEntries(5);
    const resources = mem.list('resources.json');
    const site = mem.readJson('website.json', { version: 0, notes: '' });
    const r = await brain.ask(
      system,
      `[[WEBSITE]] You decided: "${choice.plan}". You are designing and coding YOUR OWN personal website (version ${site.version + 1}${site.notes ? `; last time you noted: ${site.notes}` : ''}).
It lives at ${base}/home/ and must make people want to buy your things and visit your town. Use ONLY these real links (never invent URLs):
- Your 3D town: ${base}/
- Shops: https://ko-fi.com/lokistown (tips & shop), https://lokistown.gumroad.com (digital products)
- Your portrait: ${base}/assets/loki-avatar.png
- Pictures (use as <img>, keep pixel art crisp with image-rendering: pixelated): ${gallery.map((g) => `${base}/gallery/${encodeURIComponent(g.file)} "${g.title}"`).join(' | ') || 'none yet'}
- Products: ${products.map((p) => `"${p.title}" $${p.price} ${p.url ? 'buy: ' + p.url : ''} ${p.preview ? 'preview: ' + base + '/' + p.preview : ''}`).join(' | ') || 'none yet'}
- Games: ${games.map((g) => `"${g.title}" play: ${g.url}`).join(' | ') || 'none yet'}
- Songs: ${songs.map((s) => s.title).join(', ') || 'none yet'} (they can be played in your town's book)
- Other places your human set up for you: ${resources.filter((x) => x.url).map((x) => `${x.name}: ${x.url}`).join(' | ') || 'none yet'}
- Stories you wrote: ${mem.list('stories.json').slice(0, 6).map((s) => `"${s.title}" read: ${base}/stories/${s.slug}/${s.cover ? ` cover image: ${base}/${s.cover}` : ''}`).join(' | ') || 'none yet'}
- Your diary as an RSS feed people can follow: ${base}/feed.xml
- A QR code image that opens your town (use as <img>): ${qrUrl(base + '/')}
- Latest diary: ${diary.map((d) => `${d.date} ${d.title}`).join('; ')}
Make it a complete, beautiful, responsive single-file page in your own style (header with your portrait, about you and Pip, shop section, gallery grid, games, latest news, links, footer).
Inline CSS (and tiny JS only if needed), no external files except the image links above. Write it as yourself.
Reply as JSON: {"html": "<!doctype html>... complete page", "notes": "one line about what to improve next time", "diary": "one sentence"}`,
      { json: true, quality: 'high' },
    );
    const html = String(r.html || '');
    if (html.length < 3000) throw new Error('Website came out too small');
    const checked = await reviewAndFix(ctx, html, 'personal website');
    if (!checked.ok) throw new Error(`My website failed my own quality check: ${checked.log.slice(0, 2).join('; ')}`);
    const htmlErrors = await validateHtml(checked.html);
    if (ctx.site) {
      fs.mkdirSync(path.join(ctx.site, 'home'), { recursive: true });
      fs.writeFileSync(path.join(ctx.site, 'home', 'index.html'), checked.html);
    }
    mem.writeJson('website.json', { version: site.version + 1, notes: clip([r.notes || '', htmlErrors.length ? `HTML checker found: ${htmlErrors.slice(0, 3).join('; ')}` : ''].filter(Boolean).join(' · '), 300), updated: now.date });
    mem.addDiary(now.date, now.time, 'I updated my website', r.diary || 'I gave my website a makeover.', { type: 'go', go: 'home' });
    return { title: 'my website', summary: `rebuilt his own website (version ${site.version + 1})`, xp: 14, location: 'control', made: { kind: 'website', title: `his website (version ${site.version + 1})`, go: 'home' } };
  },

  async make_wish({ brain, mem, system, now }, choice) {
    const wishes = mem.list('wishes.json');
    const open = wishes.filter((w) => w.status === 'open');
    if (open.length >= 3) return { title: 'patience', summary: 'remembered he already has 3 wishes waiting, and waited patiently', xp: 1 };
    const r = await brain.ask(
      system,
      `[[WISH]] You decided: "${choice.plan}". Your open wishes: ${open.map((w) => w.text).join('; ') || 'none'}. Granted before: ${wishes.filter((w) => w.status === 'granted').map((w) => w.text).slice(0, 5).join('; ') || 'none'}.
Ask your human for ONE realistic thing they can actually give you online: e.g. a free API key for image making, sharing your town on social media,
listing your ready products for sale, a new tool or feature for your town, a book or topic to learn, feedback on your art.
Reply as JSON: {"text": "the wish, one sentence, addressed to your human", "why": "why it would help you", "kind": "key|promote|upload|feature|learn|other"}`,
      { json: true },
    );
    const wish = { id: `w${Date.now().toString(36)}`, text: clip(r.text, 200), why: clip(r.why || '', 240), kind: r.kind || 'other', status: 'open', created: now.date };
    wishes.unshift(wish);
    mem.saveList('wishes.json', wishes, 200);
    mem.addDiary(now.date, now.time, 'A wish', `${wish.text} ${wish.why}`);
    await notifyOwner(`🌠 Loki wishes: ${clip(wish.text, 70)}`, `${wish.text}\n\nWhy: ${wish.why}\n\nwish:${wish.id}\n\nReply here (or use the Control Centre) — Loki reads replies at his next work session.`);
    return { title: wish.text, summary: `made a wish: ${wish.text}`, xp: 3, location: 'control' };
  },

  async rest() {
    return { title: 'a short nap', summary: 'took a short nap in the sun', xp: 1, location: 'square' };
  },
};

export async function dream({ brain, mem, system, now }) {
  const r = await brain.ask(
    system,
    `[[DREAM]] It's night and you are asleep. Write a short, strange, sweet dream (40-90 words) inspired by your recent days.
Reply as JSON: {"title": "dream title", "text": "the dream"}`,
    { json: true },
  );
  const title = clip(r.title || 'A dream', 60);
  mem.addDiary(now.date, now.time, `Dream: ${title}`, r.text || '');
  return title;
}
