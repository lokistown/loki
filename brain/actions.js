// Everything Loki can do. Each action returns { title, summary, xp }.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { slugify, clip, safeColor, cleanPixelSvg } from './util.js';

export const ACTIONS = {
  write_diary: 'Write a diary entry about your day, a feeling, a visitor or an idea.',
  improve_town: 'Improve an existing building in your town or build a new one.',
  make_art: 'Make a new pixel-art picture for your gallery (cats, town life, objects, moods).',
  learn_skill: 'Learn a new skill and write yourself a short how-to guide for it.',
  rest: 'Have a short nap, stretch, or just look around (use rarely).',
};

const BUILDING_KINDS = ['house', 'workshop', 'bakery', 'gallery', 'market', 'cafe', 'shop', 'library', 'tower', 'park', 'garden', 'fountain', 'tree', 'other'];

export async function runAction(ctx, choice) {
  const fn = handlers[choice.action] || handlers.rest;
  return fn(ctx, choice);
}

const handlers = {
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
Either upgrade one existing building (give its id) ${canBuild ? 'or build something new (target "new")' : '(the town is full, so upgrade one)'}.
Building kinds: ${BUILDING_KINDS.join(', ')}. Your town is a 3D town that visitors walk around, so think about what would make it a lovely place to explore (shops, parks, cafes, places to show your art and sell your things).
Levels go 1-5: each level makes a building bigger and fancier.
Reply as JSON: {"target": "<id or new>", "name": "name", "kind": "<kind>", "color": "#rrggbb main colour",
"description": "how it looks now (max 25 words)", "diary": "one or two sentences about doing it, in your voice"}`,
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
    } else {
      b = b || town.buildings[Math.floor(Math.random() * town.buildings.length)];
      b.level = Math.min(5, (b.level || 1) + 1);
      if (r.name) b.name = clip(r.name, 40);
      summary = `upgraded ${b.name} to level ${b.level}`;
    }
    b.color = safeColor(r.color, b.color || '#c98b5a');
    b.description = clip(r.description || b.description, 160);
    b.updated = now.date;
    mem.saveTown(town);
    mem.addDiary(now.date, now.time, `Town: ${summary}`, r.diary || summary);
    return { title: summary, summary, xp: 10, location: b.id };
  },

  async make_art({ brain, mem, system, site, now }, choice) {
    const r = await brain.ask(
      system,
      `[[ART]] You decided: "${choice.plan}".
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
    mem.addDiary(now.date, now.time, `New art: ${title}`, r.description || title);
    return { title, summary: `made a pixel-art picture "${title}"`, xp: 12, location: 'gallery' };
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
