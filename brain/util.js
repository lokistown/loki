import { config } from './config.js';

// Current time in the UK (handles summer time automatically).
export function ukNow(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, hour: Number(parts.hour) };
}

export function isSleepHour(hour) {
  const { sleepStartHour: s, sleepEndHour: e } = config;
  return s > e ? hour >= s || hour < e : hour >= s && hour < e;
}

// The "night" a sleep belongs to, e.g. 01:00 on the 5th belongs to the night of the 4th.
export function nightKey(d = new Date()) {
  const { hour } = ukNow(d);
  const base = hour < config.sleepEndHour ? new Date(d.getTime() - 12 * 3600_000) : d;
  return ukNow(base).date;
}

export function timeOfDay(hour) {
  if (hour < 7) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'late evening';
}

export function slugify(s, max = 40) {
  return (
    String(s || 'untitled')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, max)
      .replace(/-$/, '') || 'untitled'
  );
}

export function clip(s, n) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const HEX = /^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/;
export function safeColor(c, fallback = '#c98b5a') {
  return HEX.test(String(c || '').trim()) ? String(c).trim() : fallback;
}

// Rebuild AI-made pixel art from whitelisted <rect> elements only.
// Nothing else from the AI's SVG survives, so it can never contain scripts or links.
export function cleanPixelSvg(raw, size = 32) {
  const rects = [];
  const re = /<rect\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(String(raw || ''))) && rects.length < 2500) {
    const attrs = {};
    m[1].replace(/([a-zA-Z-]+)\s*=\s*["']([^"']*)["']/g, (_, k, v) => (attrs[k.toLowerCase()] = v));
    const num = (k, d) => {
      const v = Number(attrs[k] ?? d);
      return Number.isFinite(v) ? Math.max(0, Math.min(size, v)) : null;
    };
    const x = num('x', 0), y = num('y', 0), w = num('width', 1), h = num('height', 1);
    const fill = safeColor(attrs.fill, null);
    if ([x, y, w, h].includes(null) || !fill || w <= 0 || h <= 0) continue;
    rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`);
  }
  if (rects.length < 12) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}
