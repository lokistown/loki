// One work session. Loki wakes up, catches up on his needs, opens gifts from his human,
// reads his mailbox, chains tasks, then plans the next couple of hours in his town.
// Memory is saved after every step, so nothing he earns is ever lost.
//
//   node brain/session.js --memory ../loki-memory --site ../lokistown.github.io [--mock] [--ignore-sleep] [--init]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Brain } from './llm.js';
import { Memory, levelFor, xpForLevel } from './memory.js';
import { ACTIONS, runAction, dream } from './actions.js';
import { publishSite } from './publish.js';
import { writeControl } from './control.js';
import { planSchedule, mapText, driftNeeds, applyNeeds } from './planner.js';
import { fetchGifts, answerGift, ensureGiftLabel } from './gifts.js';
import { readMailbox, mailboxReady } from './offerings.js';
import { ukNow, isSleepHour, nightKey, timeOfDay, clip } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const flag = (n) => args.includes(`--${n}`);
const memDir = arg('memory', path.join(here, '..', '..', 'loki-memory'));
const siteDir = arg('site', null);
const mock = flag('mock');
const soul = fs.readFileSync(path.join(here, '..', 'soul.md'), 'utf8');

function buildSystem(state, town) {
  const n = state.needs;
  return `${soul}

## Right now
- Level ${state.level} ${state.stage}, ${state.xp} XP (next level at ${xpForLevel(state.level + 1)} XP). Mood: ${state.mood}.
- Needs (0-100): fullness ${n.fullness}, energy ${n.energy}, joy ${n.joy}, curiosity ${n.curiosity}, calm ${n.calm}.
- Your friend Pip (a tiny grey mouse) rides on your head and goes everywhere with you.
- Skills: ${state.skills.map((s) => s.name).join(', ') || 'none yet'}.

## Your town (you know it better than anyone)
${mapText(town)}

Always answer in English. When asked for JSON, reply with valid JSON only.`;
}

async function decide(ctx, done) {
  const { brain, mem, state, now, system } = ctx;
  const diary = mem.diaryEntries(6).map((d) => `- ${d.date} ${d.time} ${d.title}: ${clip(d.text, 140)}`).join('\n') || '- (empty: your first day)';
  const counts = state.counters || {};
  const gallery = mem.list('gallery.json').length;
  const products = mem.list('products.json');
  const wishes = mem.list('wishes.json').filter((w) => w.status === 'open').length;
  return brain.ask(
    system,
    `[[DECIDE]] It is ${timeOfDay(now.hour)} (${now.time}, ${now.date}, UK).
Already done this session: ${done.join('; ') || 'nothing yet'}.
Lifetime counts: ${JSON.stringify(counts)}. Pictures: ${gallery}. Songs: ${mem.list('music.json').length}. Products ready to sell: ${products.filter((p) => p.status === 'ready').length}, listed: ${products.filter((p) => p.status === 'listed').length}. Open wishes: ${wishes}.

Recent diary:
${diary}

What do you do next? Options:
${Object.entries(ACTIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Ideas visitors inspired: ${(state.inspirations || []).join('; ') || 'none yet'}. Your plans: ${(state.ideas || []).join('; ') || 'none'}.
Balance creating, decorating and building your town, earning (products, business), learning and looking after yourself. Avoid repeating the same action many times in a row.
Reply as JSON: {"thought": "one short inner thought, first person", "mood": "one word", "action": "<one option>", "plan": "what exactly you will do, one sentence"}`,
    { json: true },
  );
}

async function openGifts(ctx) {
  const { brain, mem, state, now, system } = ctx;
  let gifts = [];
  try {
    await ensureGiftLabel();
    gifts = await fetchGifts();
  } catch (e) {
    mem.event('gifts_error', { summary: clip(e.message, 200) });
    return 0;
  }
  const wishes = mem.list('wishes.json');
  const log = mem.list('gifts.json');
  for (const g of gifts.slice(0, 5)) {
    const wish = g.wishId ? wishes.find((w) => w.id === g.wishId) : null;
    const r = await brain.ask(
      system,
      `[[GIFT]] Your human left you something: "${g.title}"\n${g.body}\n${wish ? `It answers your wish: "${wish.text}"` : ''}
Reply to them warmly (1-3 sentences), and write a diary line about it.
Reply as JSON: {"reply": "...", "diary": "...", "granted": ${wish ? 'true if this grants the wish, false if they declined' : 'false'}}`,
      { json: true },
    );
    if (wish) {
      wish.status = r.granted === false || /declin|no\b|not now/i.test(g.title) ? 'declined' : 'granted';
      wish.closed = now.date;
    }
    await answerGift(g.number, clip(r.reply || 'Thank you!', 500));
    log.unshift({ date: now.date, title: g.title, wish: wish?.text || null, reply: clip(r.reply, 500) });
    // money your human reports ("Sale: $5 for the art pack") goes into Loki's wallet
    const money = `${g.title} ${g.body}`.match(/(sale|sold|income|earned|tip)[^$€£\d]{0,40}[$€£]\s?(\d+(?:\.\d{1,2})?)/i);
    if (money) {
      const ledger = mem.list('ledger.json');
      ledger.unshift({ date: now.date, amount: Number(money[2]), currency: `${g.title} ${g.body}`.includes('€') ? 'EUR' : `${g.title} ${g.body}`.includes('£') ? 'GBP' : 'USD', note: clip(g.title, 100) });
      mem.saveList('ledger.json', ledger, 1000);
    }
    mem.addDiary(now.date, now.time, `A gift: ${clip(g.title, 40)}`, r.diary || r.reply || 'My human gave me something.');
    mem.addRecent(state, now.time, `opened a gift: ${clip(g.title, 50)}`);
    state.needs.joy = Math.min(100, state.needs.joy + 15);
    mem.addXp(state, 5, 'gift');
  }
  mem.saveList('wishes.json', wishes, 200);
  mem.saveList('gifts.json', log, 300);
  return gifts.length;
}

async function main() {
  const started = Date.now();
  const mem = new Memory(memDir);
  const state = mem.loadState();
  state.counters ||= {};
  const town = mem.loadTown();
  mem.saveTown(town);
  const brain = new Brain({ mock });
  const now = ukNow();
  const hoursSince = state.updated ? (Date.now() - new Date(state.updated)) / 3600000 : 0;
  driftNeeds(state, hoursSince);
  const ctx = { brain, mem, state, town, now, site: siteDir, system: buildSystem(state, town) };
  const publish = (extra = {}) => {
    publishSite(siteDir, mem, state, extra);
    writeControl(siteDir, mem, state, { providers: brain.log });
  };

  if (flag('init')) {
    if (state.sessions > 0 || mem.recentEvents(1).length) {
      console.log('Loki already exists; refreshing website data only.');
      mem.saveState(state);
      return publish({});
    }
    mem.saveState(state);
    mem.event('born', { summary: 'Loki arrived in his new town' });
    mem.addDiary(now.date, now.time, 'Hello, town', 'I just opened my eyes for the very first time. There is a house with lots of rooms, a workshop, a bakery, a gallery and a little market stall. Pip the mouse was already asleep on my head. Everything smells new. I think I will like it here.');
    publish({});
    return console.log('Loki is born.');
  }

  // ---------- Night ----------
  if (!flag('ignore-sleep') && isSleepHour(now.hour)) {
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
    Object.assign(state, { location: 'house', activity: note, thought: 'Zzz…', mood: 'sleepy', schedule: [], whatsOn: 'The town is quiet. Only the fountain is still awake.' });
    state.pip.status = 'curled up in her teacup bed';
    mem.saveState(state);
    publish({ asleep: true });
    return console.log(`Loki is asleep (${now.time} UK). ${note}`);
  }

  // ---------- Work session ----------
  state.sessions++;
  mem.event('session_start', { session: state.sessions });
  const done = [];
  const timeLeft = () => config.maxMinutesPerSession * 60_000 - (Date.now() - started);

  // 1) gifts from the human
  try {
    const n = await openGifts(ctx);
    if (n) done.push(`opened ${n} gift(s) from my human`);
  } catch (e) {
    console.warn('Gifts failed:', e.message);
  }
  // 2) mailbox (visitors)
  if (mailboxReady()) {
    try {
      const r = await readMailbox(ctx);
      if (r.read) {
        done.push(`read ${r.read} letters, kept ${r.kept}`);
        mem.addRecent(state, ukNow().time, `read ${r.read} letters from visitors and kept ${r.kept}`);
        mem.event('mail', { summary: `read ${r.read}, kept ${r.kept}` });
        state.needs.joy = Math.min(100, state.needs.joy + r.kept * 3);
        mem.addXp(state, 2 * r.read, 'mail');
      }
    } catch (e) {
      console.warn('Mailbox failed:', e.message);
      mem.event('mail_error', { summary: clip(e.message, 200) });
    }
  }
  mem.saveState(state);

  // 3) tasks, leaving room for planning at the end
  let tasks = 0;
  while (tasks < config.maxTasksPerSession && brain.budgetLeft >= 3 && timeLeft() > 90_000) {
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
    state.activity = clip(choice.plan, 140);
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
    applyNeeds(state, choice.action);
    state.activity = result.summary;
    const levelUp = mem.addXp(state, result.xp, result.summary);
    mem.event('task', { action: choice.action, summary: result.summary, xp: result.xp });
    mem.addRecent(state, ukNow().time, result.summary);
    if (levelUp) {
      state.thought = `I feel bigger! I'm level ${levelUp} now.`;
      mem.addDiary(now.date, ukNow().time, `Level ${levelUp}!`, `I reached level ${levelUp}. ${result.summary} did it.`);
    }
    done.push(result.summary);
    mem.saveState(state);
    publish({});
    console.log(`✓ ${result.summary} (+${result.xp} XP, total ${state.xp}, level ${levelFor(state.xp)})`);
  }

  // 4) plan the next hours in town (what visitors will see him doing)
  try {
    if (brain.budgetLeft >= 1) {
      const n = await planSchedule(ctx);
      console.log(`Planned ${n} blocks for the next hours.`);
    }
  } catch (e) {
    console.warn('Planning failed:', e.message);
    mem.event('plan_failed', { summary: clip(e.message, 200) });
  }

  mem.saveState(state);
  mem.event('session_end', { session: state.sessions, tasks, calls: brain.calls, providers: [...new Set(brain.log.map((l) => `${l.provider}:${l.model}`))] });
  publish({});
  console.log(`Session ${state.sessions} done: ${tasks} tasks, ${brain.calls} AI calls via ${[...new Set(brain.log.map((l) => l.provider))].join(', ') || 'none'}.`);
}

main().catch((e) => {
  console.error('Session crashed:', e);
  process.exit(1);
});
