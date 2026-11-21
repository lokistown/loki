// Loki's knowledge of his town's geometry (mirrors the website's layout.js),
// so he can place new things on free ground: never on roads, buildings or other props.
import { DEFAULT_ROOMS } from './config.js';

export const PLOT = 32;
const RINGS = 24;
let order = null;
function cells() {
  if (order) return order;
  const c = [];
  for (let i = -RINGS; i <= RINGS; i++)
    for (let j = -RINGS; j <= RINGS; j++) {
      if (!i && !j) continue;
      c.push({ i, j, ring: Math.max(Math.abs(i), Math.abs(j)), ang: (Math.atan2(j, i) + Math.PI * 2.25) % (Math.PI * 2) });
    }
  c.sort((a, b) => a.ring - b.ring || a.ang - b.ang);
  return (order = c);
}
export function plotInfo(index) {
  const { i, j, ring } = cells()[Math.min(index, cells().length - 1)];
  let dx = 0, dz = 0;
  if (Math.abs(i) >= Math.abs(j)) dx = -Math.sign(i);
  else dz = -Math.sign(j);
  return { x: i * PLOT, z: j * PLOT, dx, dz, ring };
}
export function footprint(b) {
  const info = plotInfo(b.plot);
  const rooms = Array.isArray(b.rooms) && b.rooms.length ? b.rooms.length : (DEFAULT_ROOMS[b.kind] || []).length;
  if (!rooms) return { x: info.x, z: info.z, hw: b.kind === 'park' || b.kind === 'garden' ? 9.5 : 4, hd: b.kind === 'park' || b.kind === 'garden' ? 9.5 : 4 };
  const n = Math.min(12, rooms);
  const cols = n <= 2 ? n : n <= 6 ? Math.ceil(n / 2) : 4;
  const rows = Math.ceil(n / cols);
  const cell = n <= 2 ? 8.4 : 6.4;
  const W = cols * cell + 1, D = rows * cell + 4; // + porch
  const side = Math.abs(info.dx) > 0;
  return { x: info.x, z: info.z, hw: (side ? D : W) / 2, hd: (side ? W : D) / 2 };
}

function onRoad(x, z) {
  const near = (v) => Math.abs(((v + PLOT / 2) % PLOT + PLOT) % PLOT) < 2.8 || Math.abs(((v + PLOT / 2) % PLOT + PLOT) % PLOT - PLOT) < 2.8;
  return near(x) || near(z);
}

// Find a free spot near an anchor ('plaza' or a building id). Deterministic per seed.
export function findSpot(town, anchor, radius, seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ 0x9e3779b9) >>> 0) / 4294967296;
  const fps = town.buildings.map(footprint);
  const props = (town.props || []).filter((p) => p.type !== 'mural');
  const b = town.buildings.find((x) => x.id === anchor);
  const center = b ? footprint(b) : { x: 0, z: 0, hw: 10.5, hd: 10.5 };
  for (let tries = 0; tries < 200; tries++) {
    const a = rnd() * Math.PI * 2;
    const ring = Math.max(center.hw, center.hd) + radius + 1.5 + rnd() * (4 + tries / 20);
    const x = center.x + Math.cos(a) * ring, z = center.z + Math.sin(a) * ring;
    if (onRoad(x, z)) continue;
    if (Math.hypot(x, z) < 10.8 + radius) continue; // plaza paving stays clear
    if (fps.some((f) => Math.abs(x - f.x) < f.hw + radius + 1.2 && Math.abs(z - f.z) < f.hd + radius + 1.2)) continue;
    if (props.some((p) => Math.hypot(p.x - x, p.z - z) < (p.radius || 1.5) + radius + 1)) continue;
    return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  }
  return null;
}
