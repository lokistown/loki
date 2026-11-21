// One work session: Loki wakes up, chains tasks until its AI budget or time runs out,
// saving memory after EVERY task so progress can never be lost.
//
//   node brain/session.js --memory ../loki-memory --site ../lokistown.github.io [--mock] [--ignore-sleep]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Brain } from './llm.js';
import { Memory, levelFor, xpForLevel } from './memory.js';
import { ACTIONS, runAction, dream } from './actions.js';
import { publishSite } from './publish.js';
import { ukNow, isSleepHour, nightKey, timeOfDay, clip } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (name) => args.includes(`--${name}`);

const memDir = arg('memory', path.join(here, '..', '..', 'loki-memory'));
const siteDir = arg('site', null);
const mock = flag('mock');
const ignoreSleep = flag('ignore-sleep');

const soul = fs.readFileSync(path.join(here, '..', 'soul.md'), 'utf8');

function buildSystem(state, town) {
  return `${soul}

## Right now
- Level ${state.level} ${state.stage}, ${state.xp} XP (next level at ${xpForLevel(state.level + 1)} XP).
- Mood: ${state.mood}. Tasks done in your life: ${state.tasksDone}.
- Buildings: ${town.buildings.map((b) => `${b.name} (lvl ${b.level})`).join(', ')}.
- Skills you know: ${state.skills.map((s) => s.name).join(', ') || 'none yet'}.

Always answer in English. When asked for JSON, reply with valid JSON only.`;
}

async function decide(ctx, doneThisSession) {
  const { brain, mem, state, town, now, system } = ctx;
  const diary = mem.diaryEntries(6).map((d) => `- ${d.date} ${d.time} ${d.title}: ${clip(d.text, 160)}`).join('\n') || '- (empty, this is your first day)';
  const events = mem.recentEvents(10).map((e) => `- ${e.t.slice(0, 16)} ${e.type}${e.summary ? `: ${e.summary}` : ''}`).join('\n') || '- none';
  const gallery = mem.readJson('gallery.json', []);
  const counts = state.counters || {};
  return brain.ask(
    system,
    `[[DECIDE]] It is ${timeOfDay(now.hour)} (${now.time}, ${now.date}, UK).
Already done this session: ${doneThisSession.join('; ') || 'nothing yet'}.
Lifetime counts: ${JSON.stringify(counts)}. Pictures in gallery: ${gallery.length}.

Recent diary:
${diary}

Recent events:
${events}

What do you do next? Options:
${Object.entries(ACTIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Avoid repeating the same action many times in a row. Places: ${town.buildings.map((b) => b.id).join(', ')}, square.
Reply as JSON: {"thought": "one short inner thought, first person", "mood": "one word",
"action": "<one option>", "location": "<place>", "plan": "what exactly you will do, one sentence"}`,
    { json: true },
  );
}

async function main() {
  const started = Date.now();
  const mem = new Memory(memDir);
  const state = mem.loadState();
  state.counters ||= {};
  const town = mem.loadTown();
  const brain = new Brain({ mock });
  const now = ukNow();
  const ctx = { brain, mem, state, town, now, site: siteDir, system: buildSystem(state, town) };

  // ---------- Birth: create memory and website data without using the AI ----------
  if (flag('init')) {
    if (fs.existsSync(mem.p('state.json'))) return console.log('Loki already exists; not overwriting memory.');
    mem.saveState(state);
    mem.saveTown(town);
    mem.event('born', { summary: 'Loki arrived in his new town' });
    mem.addDiary(now.date, now.time, 'Hello, town', 'I just opened my eyes for the very first time. There is a house, a workshop, a bakery, a gallery and a little market stall. Everything smells new. I think I will like it here.');
    publishSite(siteDir, mem, state, {});
    return console.log('Loki is born.');
  }

  // ---------- Night time ----------
  if (!ignoreSleep && isSleepHour(now.hour)) {
    const night = nightKey();
    let note = 'sleeping';
    if (state.lastDreamNight !== night) {
      try {
        const title = await dream(ctx);
        state.lastDreamNight = night;
        mem.event('dream', { summary: title });
        note = `dreaming about "${title}"`;
      } catch (e) {
        console.warn('Dream failed:', e.message);
      }
    }
    Object.assign(state, { location: 'house', activity: note, thought: 'Zzz…', mood: 'sleepy' });
    mem.saveState(state);
    publishSite(siteDir, mem, state, { asleep: true });
    console.log(`Loki is asleep (${now.time} UK). ${note}`);
    return;
  }

  // ---------- Work session ----------
  state.sessions++;
  mem.event('session_start', { session: state.sessions });
  const done = [];
  const recent = [];
  let tasks = 0;

  const timeLeft = () => config.maxMinutesPerSession * 60_000 - (Date.now() - started);

  while (tasks < config.maxTasksPerSession && brain.budgetLeft >= 2 && timeLeft() > 60_000) {
    let choice;
    try {
      choice = await decide(ctx, done);
    } catch (e) {
      console.warn('Could not decide:', e.message);
      if (e.allFailed) break;
      continue;
    }
    if (!ACTIONS[choice.action]) choice.action = 'rest';
    state.thought = clip(choice.thought, 200);
    state.mood = clip(choice.mood || state.mood, 20);
    state.location = choice.location || state.location;
    state.activity = clip(choice.plan, 140);
    publishSite(siteDir, mem, state, { recent });

    let result;
    try {
      result = await runAction(ctx, choice);
    } catch (e) {
      console.warn(`Action ${choice.action} failed:`, e.message);
      mem.event('task_failed', { action: choice.action, summary: clip(e.message, 200) });
      if (e.allFailed) break;
      tasks++;
      continue;
    }

    tasks++;
    state.tasksDone++;
    state.counters[choice.action] = (state.counters[choice.action] || 0) + 1;
    if (result.location) state.location = result.location;
    state.activity = result.summary;
    const levelUp = mem.addXp(state, result.xp, result.summary);
    mem.event('task', { action: choice.action, summary: result.summary, xp: result.xp });
    if (levelUp) {
      state.thought = `I feel bigger! I'm level ${levelUp} now.`;
      mem.addDiary(now.date, ukNow().time, `Level ${levelUp}!`, `I reached level ${levelUp}. I'm a ${state.stage} now... or soon. ${result.summary} did it.`);
    }
    done.push(result.summary);
    recent.unshift({ time: ukNow().time, text: result.summary });
    // Save after every task: if the run dies, nothing earned is lost.
    mem.saveState(state);
    publishSite(siteDir, mem, state, { recent });
    console.log(`✓ ${result.summary} (+${result.xp} XP, total ${state.xp}, level ${levelFor(state.xp)})`);
  }

  state.activity = done.length ? `resting after: ${done[done.length - 1]}` : state.activity;
  mem.saveState(state);
  mem.event('session_end', { session: state.sessions, tasks, calls: brain.calls, providers: [...new Set(brain.log.map((l) => `${l.provider}:${l.model}`))] });
  publishSite(siteDir, mem, state, { recent });
  console.log(`Session ${state.sessions} done: ${tasks} tasks, ${brain.calls} AI calls via ${[...new Set(brain.log.map((l) => l.provider))].join(', ') || 'none'}.`);
}

main().catch((e) => {
  console.error('Session crashed:', e);
  process.exit(1);
});
