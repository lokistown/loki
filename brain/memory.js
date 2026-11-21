// Loki's memory. Everything Loki has ever done lives here, in plain JSON / Markdown,
// so any AI (or a human) can read it. Writes are atomic and every JSON file keeps a
// .bak copy of its last good version. The event log is append-only.
import fs from 'node:fs';
import path from 'node:path';

const STAGES = [
  { minLevel: 1, name: 'kitten' },
  { minLevel: 4, name: 'young cat' },
  { minLevel: 9, name: 'grown cat' },
  { minLevel: 16, name: 'town elder' },
];

export function levelFor(xp) {
  return Math.floor(Math.sqrt(xp / 10)) + 1; // 0xp=1, 10=2, 40=3, 90=4, 250=6, 1000=11 ...
}
export function xpForLevel(level) {
  return (level - 1) ** 2 * 10;
}
export function stageFor(level) {
  return [...STAGES].reverse().find((s) => level >= s.minLevel).name;
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

const DEFAULT_TOWN = {
  buildings: [
    { id: 'house', name: "Loki's House", kind: 'house', level: 1, description: 'A tiny wooden house with a round window and a very soft bed.' },
    { id: 'workshop', name: 'Workshop', kind: 'workshop', level: 1, description: 'A shed full of string, cardboard and half-finished ideas.' },
    { id: 'bakery', name: 'Bakery', kind: 'bakery', level: 1, description: 'Smells of fish buns. Nobody works here yet.' },
    { id: 'gallery', name: 'Gallery', kind: 'gallery', level: 1, description: 'An empty room with white walls waiting for art.' },
    { id: 'market', name: 'Market Stall', kind: 'market', level: 1, description: 'A small stall where Loki will one day sell things.' },
  ],
};

export class Memory {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  p(...parts) {
    return path.join(this.dir, ...parts);
  }

  readJson(name, fallback) {
    const file = this.p(name);
    for (const f of [file, `${file}.bak`]) {
      if (!fs.existsSync(f)) continue;
      try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        console.warn(`! ${f} is damaged, trying backup`);
      }
    }
    return structuredClone(fallback);
  }

  writeJson(name, data) {
    const file = this.p(name);
    const json = JSON.stringify(data, null, 2) + '\n';
    JSON.parse(json); // never write something we can't read back
    if (fs.existsSync(file)) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.copyFileSync(file, `${file}.bak`);
      } catch {
        /* current file damaged: keep the older .bak */
      }
    }
    writeAtomic(file, json);
  }

  // ---- state ----
  loadState() {
    const s = this.readJson('state.json', {
      name: 'Loki',
      born: new Date().toISOString(),
      xp: 0,
      level: 1,
      stage: 'kitten',
      sessions: 0,
      tasksDone: 0,
      mood: 'curious',
      location: 'house',
      activity: 'just woke up for the very first time',
      thought: 'Where am I? It smells like a brand new town.',
      skills: [],
      lastDreamNight: null,
      counters: {},
    });
    return s;
  }

  saveState(s) {
    s.level = levelFor(s.xp);
    s.stage = stageFor(s.level);
    s.updated = new Date().toISOString();
    this.writeJson('state.json', s);
  }

  addXp(state, amount, reason) {
    const before = levelFor(state.xp);
    state.xp += amount;
    const after = levelFor(state.xp);
    if (after > before) {
      this.event('level_up', { from: before, to: after, stage: stageFor(after), reason });
      return after;
    }
    return null;
  }

  // ---- town ----
  loadTown() {
    const town = this.readJson('town.json', DEFAULT_TOWN);
    // Every building gets a permanent plot in the 3D town (0 = next to the plaza).
    const used = new Set(town.buildings.filter((b) => Number.isInteger(b.plot)).map((b) => b.plot));
    let next = 0;
    for (const b of town.buildings) {
      if (Number.isInteger(b.plot)) continue;
      while (used.has(next)) next++;
      b.plot = next;
      used.add(next);
      delete b.x;
    }
    return town;
  }
  saveTown(t) {
    this.writeJson('town.json', t);
  }

  // ---- event log (append-only, never rewritten) ----
  event(type, data = {}) {
    const line = JSON.stringify({ t: new Date().toISOString(), type, ...data });
    fs.appendFileSync(this.p('events.jsonl'), line + '\n');
  }

  recentEvents(n = 25) {
    const f = this.p('events.jsonl');
    if (!fs.existsSync(f)) return [];
    return fs
      .readFileSync(f, 'utf8')
      .trim()
      .split('\n')
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  // ---- diary (one markdown file per day) ----
  addDiary(dateStr, timeStr, title, text) {
    const file = this.p('diary', `${dateStr}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const header = fs.existsSync(file) ? '' : `# ${dateStr}\n\n`;
    fs.appendFileSync(file, `${header}## ${timeStr} — ${title}\n\n${text.trim()}\n\n`);
  }

  diaryEntries(limit = 40) {
    const dir = this.p('diary');
    if (!fs.existsSync(dir)) return [];
    const out = [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse();
    for (const f of files) {
      const date = f.replace('.md', '');
      const parts = fs.readFileSync(path.join(dir, f), 'utf8').split(/^## /m).slice(1);
      for (const part of parts.reverse()) {
        const [head, ...rest] = part.split('\n');
        const [time, ...titleBits] = head.split(' — ');
        out.push({ date, time: time.trim(), title: titleBits.join(' — ').trim(), text: rest.join('\n').trim() });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  // ---- skills ----
  saveSkill(slug, md) {
    writeAtomic(this.p('skills', `${slug}.md`), md);
  }
  readSkill(slug) {
    const f = this.p('skills', `${slug}.md`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  }
}
