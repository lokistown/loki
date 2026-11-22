// Copies the public parts of Loki's memory into the website's data folder.
import fs from 'node:fs';
import path from 'node:path';

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function publishSite(siteDir, mem, state, extra = {}) {
  if (!siteDir) return;
  const data = path.join(siteDir, 'data');
  const { xp, level, stage, mood, location, activity, thought, sessions, tasksDone, skills, born, needs, pip, schedule, whatsOn, recent, thoughts, ideas, weather, holidays } = state;
  const site = mem.readJson('website.json', { version: 0 });
  write(path.join(data, 'state.json'), {
    name: 'Loki',
    born,
    xp,
    level,
    stage,
    nextLevelXp: level ** 2 * 10,
    mood,
    location,
    activity,
    thought,
    asleep: !!extra.asleep,
    sessions,
    tasksDone,
    needs,
    pip,
    schedule,
    whatsOn,
    recent,
    thoughts,
    ideas,
    weather: weather || null,
    holidays: holidays || [],
    website: site.version ? { version: site.version, updated: site.updated } : null,
    skills: (skills || []).map((s) => ({ name: s.name, learned: s.learned })),
    updated: new Date().toISOString(),
  });
  write(path.join(data, 'town.json'), mem.loadTown());
  write(path.join(data, 'diary.json'), mem.diaryEntries(40));
  write(path.join(data, 'gallery.json'), mem.list('gallery.json').slice(0, 120));
  write(path.join(data, 'games.json'), mem.list('games.json').slice(0, 60));
  write(path.join(data, 'music.json'), mem.list('music.json').slice(0, 60));
  write(path.join(data, 'stories.json'), mem.list('stories.json').slice(0, 60));
  write(path.join(data, 'books.json'), mem.list('books.json').slice(0, 30).map(({ title, author, date, thought }) => ({ title, author, date, thought })));
  write(path.join(data, 'wishes.json'), mem.list('wishes.json').slice(0, 30).map(({ text, why, status, created }) => ({ text, why, status, created })));
  write(path.join(data, 'products.json'), mem.list('products.json').slice(0, 60).map(({ title, description, status, url, price, type, created, preview, shop }) => ({ title, description, status, url, price, type, created, preview, shop })));
  // copy new gallery images
  const artDir = mem.p('art');
  const galDir = path.join(siteDir, 'gallery');
  if (fs.existsSync(artDir)) {
    fs.mkdirSync(galDir, { recursive: true });
    for (const f of fs.readdirSync(artDir)) if (!fs.existsSync(path.join(galDir, f))) fs.copyFileSync(path.join(artDir, f), path.join(galDir, f));
  }
}
