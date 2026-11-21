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
  const { xp, level, stage, mood, location, activity, thought, sessions, tasksDone, skills, born } = state;
  const nextLevelXp = (level) ** 2 * 10;
  write(path.join(data, 'state.json'), {
    name: 'Loki',
    born,
    xp,
    level,
    stage,
    nextLevelXp,
    mood,
    location,
    activity,
    thought,
    asleep: !!extra.asleep,
    sessions,
    tasksDone,
    skills: skills.map((s) => ({ name: s.name, learned: s.learned })),
    updated: new Date().toISOString(),
    recent: extra.recent || [],
  });
  write(path.join(data, 'town.json'), mem.loadTown());
  write(path.join(data, 'diary.json'), mem.diaryEntries(40));
  write(path.join(data, 'gallery.json'), mem.readJson('gallery.json', []).slice(0, 120));
}
