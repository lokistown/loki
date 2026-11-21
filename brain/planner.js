// Plans Loki's next couple of hours in his town (what the website shows him doing),
// a "what's on" line, Pip's mood, and updates his needs.
import { config, ROOM_ACTS, OUTDOOR_ACTS, PLAZA_ACTS } from './config.js';
import { clip, ukNow, isSleepHour } from './util.js';

export function placesOf(town) {
  const out = [];
  for (const b of town.buildings) {
    if (Array.isArray(b.rooms) && b.rooms.length) {
      const kinds = [...new Set(b.rooms.map((r) => r.kind))];
      for (const k of kinds) for (const act of ROOM_ACTS[k] || []) out.push({ building: b.id, buildingName: b.name, roomKind: k, act });
    } else for (const act of OUTDOOR_ACTS[b.kind] || ['stroll']) out.push({ building: b.id, buildingName: b.name, roomKind: null, act });
  }
  for (const act of PLAZA_ACTS) out.push({ building: 'plaza', buildingName: 'the plaza', roomKind: null, act });
  return out.filter((p) => p.act !== 'sleep');
}

export function mapText(town) {
  return town.buildings
    .map((b) => `- ${b.name} [id ${b.id}, ${b.kind}, level ${b.level}]${b.rooms?.length ? ': rooms ' + b.rooms.map((r) => r.name || r.kind).join(', ') : ''}`)
    .concat('- the plaza (centre of town): mailbox for visitors, diary board, benches')
    .join('\n');
}

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

// Needs drift with time: hunger grows, energy drains while awake and refills at night.
export function driftNeeds(state, hoursSince) {
  const n = state.needs;
  const h = Math.min(hoursSince, 12);
  n.fullness = clamp(n.fullness - h * 4);
  n.energy = clamp(n.energy + (isSleepHour(ukNow().hour) ? h * 10 : -h * 2.5));
  n.calm = clamp(n.calm + h * 1);
  n.curiosity = clamp(n.curiosity + h * 2);
  state.pip.needs.fullness = clamp(state.pip.needs.fullness - h * 5);
}

export const ACTION_NEEDS = {
  write_diary: { calm: 6, joy: 3, energy: -3 },
  improve_town: { joy: 8, energy: -10, curiosity: 4 },
  make_art: { joy: 10, energy: -8, curiosity: -6 },
  make_music: { joy: 12, energy: -8, calm: 4 },
  learn_skill: { curiosity: -12, energy: -6, joy: 4 },
  make_product: { joy: 6, energy: -10, calm: -3 },
  make_wish: { joy: 2, calm: 2 },
  rest: { energy: 12, calm: 8 },
};
export function applyNeeds(state, action) {
  const d = ACTION_NEEDS[action] || {};
  for (const [k, v] of Object.entries(d)) state.needs[k] = clamp((state.needs[k] ?? 60) + v);
}

export async function planSchedule({ brain, system, state, town, now }) {
  const places = placesOf(town);
  const list = places.map((p, i) => `${i}: ${p.act} @ ${p.buildingName}${p.roomKind ? ' / ' + p.roomKind : ''}`).join('\n');
  const n = state.needs;
  const r = await brain.ask(
    system,
    `[[PLAN]] It is ${now.time} UK. Plan what you will physically be doing around your town for the next 2.5 hours,
as 8-12 short blocks of 10-25 minutes. Visitors watch you walk between places, so make it lively and logical:
eat when hungry, rest when tired, practise your hobbies, check the mailbox, look after your town.
Your needs (0-100): fullness ${n.fullness}, energy ${n.energy}, joy ${n.joy}, curiosity ${n.curiosity}, calm ${n.calm}.
Recent: ${(state.recent || []).slice(0, 5).map((x) => x.text).join('; ') || 'nothing yet'}.
Places you can be (index: activity @ place):
${list}

Also write one short line about something happening in town right now ("what's on"), and what Pip (your little mouse friend) is up to.
Reply as JSON: {"blocks": [{"place": <index>, "minutes": <10-25>, "label": "what you're doing, 3-8 words, lowercase, e.g. 'painting a sunset fish'", "thought": "short inner thought"}],
"whatsOn": "one line", "pip": "what Pip is doing, one short line"}`,
    { json: true },
  );
  const blocks = Array.isArray(r.blocks) ? r.blocks : [];
  let t = Date.now();
  const schedule = [];
  for (const b of blocks.slice(0, 14)) {
    const p = places[Number(b.place)];
    if (!p) continue;
    const mins = Math.max(8, Math.min(30, Number(b.minutes) || 15));
    const end = t + mins * 60000;
    schedule.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString(), building: p.building === 'plaza' ? null : p.building, roomKind: p.roomKind, act: p.act, label: clip(b.label || p.act, 70), thought: clip(b.thought || '', 140) });
    t = end;
  }
  // Eating and resting in the plan do actually help.
  if (schedule.some((s) => s.act === 'eat')) state.needs.fullness = clamp(state.needs.fullness + 45);
  if (schedule.some((s) => ['relax', 'nap', 'sit'].includes(s.act))) state.needs.energy = clamp(state.needs.energy + 15);
  state.schedule = schedule;
  state.whatsOn = clip(r.whatsOn || '', 140);
  state.pip.status = clip(r.pip || state.pip.status, 100);
  state.pip.needs.fullness = clamp(state.pip.needs.fullness + 40);
  return schedule.length;
}
