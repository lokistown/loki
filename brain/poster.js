// Loki posts his own creations on social media. Each channel switches on when its secret exists:
//   Bluesky   BLUESKY_HANDLE + BLUESKY_APP_PASSWORD   (an "app password", never the real one)
//   Mastodon  MASTODON_URL + MASTODON_TOKEN           (e.g. https://mastodon.social + an access token)
//   Discord   DISCORD_WEBHOOK_URL                      (a channel webhook in your server)
//   Telegram  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID    (a bot that posts in your channel)
// During a session Loki writes the post and queues it; the last workflow step sends it once his new
// pages are live, so every link works.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { clip } from './util.js';
import { goUrl } from './gifts.js';

export function channels() {
  const e = process.env, c = [];
  if (e.BLUESKY_HANDLE && e.BLUESKY_APP_PASSWORD) c.push('Bluesky');
  if (e.MASTODON_URL && e.MASTODON_TOKEN) c.push('Mastodon');
  if (e.DISCORD_WEBHOOK_URL) c.push('Discord');
  if (e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID) c.push('Telegram');
  return c;
}

// ---------- pixel-art SVG (rects only) -> 512x512 PNG, so it can be posted anywhere ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function pixelSvgToPng(svg, scale = 16, size = 32) {
  const px = new Uint8Array(size * size * 3).fill(255);
  for (const m of String(svg).matchAll(/<rect\b([^>]*)>/g)) {
    const a = (n) => (m[1].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1];
    const fill = a('fill') || '';
    if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(fill)) continue;
    const hex = fill.length === 4 ? fill.slice(1).split('').map((ch) => ch + ch).join('') : fill.slice(1);
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const x0 = Math.max(0, +a('x') || 0), y0 = Math.max(0, +a('y') || 0);
    const w = +(a('width') ?? 1), h = +(a('height') ?? 1);
    for (let y = y0; y < Math.min(size, y0 + h); y++) for (let x = x0; x < Math.min(size, x0 + w); x++) px.set(rgb, (y * size + x) * 3);
  }
  const W = size * scale;
  const raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const s = (Math.floor(y / scale) * size + Math.floor(x / scale)) * 3;
      raw.set(px.subarray(s, s + 3), y * (W * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// The picture that goes with a creation (a file path), or null.
export function pictureFor(mem, site, made, tmpDir) {
  const [kind, ...rest] = String(made.go || '').split(':');
  const id = rest.join(':');
  let file = null;
  if (kind === 'art') file = mem.p('art', id);
  if (kind === 'story') {
    const s = mem.list('stories.json').find((x) => x.slug === id);
    if (s?.cover && site) file = path.join(site, s.cover);
  }
  if (!file || !fs.existsSync(file)) return null;
  if (file.endsWith('.svg')) {
    const out = path.join(tmpDir, `post-${Date.now()}.png`);
    fs.writeFileSync(out, pixelSvgToPng(fs.readFileSync(file, 'utf8')));
    return out;
  }
  return file;
}

// Loki writes the post himself and queues it for the end of the session.
export async function preparePost(ctx, made) {
  const { brain, mem, system, site } = ctx;
  const r = await brain.ask(
    system,
    `[[POST]] You just made ${made.kind}: "${made.title}". Write ONE short social media post about it, in your own voice (a cat who lives in a little 3D town with Pip the mouse).
Max 220 characters, warm and fun, at most 2 hashtags at the end, no emojis spam, do NOT include a link (it is added for you).
Also write alt text describing the picture for blind people (max 200 characters).
Reply as JSON: {"text": "...", "alt": "..."}`,
    { json: true },
  );
  const tmp = process.env.RUNNER_TEMP || site || '.';
  const post = { type: 'post', text: clip(String(r.text || `I made ${made.title}!`).replace(/https?:\/\/\S+/g, '').trim(), 240), link: goUrl(made.go), alt: clip(r.alt || made.title, 300), image: pictureFor(mem, site, made, tmp), title: made.title, go: made.go };
  const log = mem.list('posts.json');
  log.unshift({ t: new Date().toISOString(), title: made.title, go: made.go, text: post.text, channels: channels() });
  mem.saveList('posts.json', log, 500);
  return post;
}

// ---------- the channels ----------
async function bluesky(p, img) {
  const base = 'https://bsky.social/xrpc';
  const s = await (await fetch(`${base}/com.atproto.server.createSession`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE.replace(/^@/, ''), password: process.env.BLUESKY_APP_PASSWORD }) })).json();
  if (!s.accessJwt) throw new Error(`Bluesky login: ${s.message || 'failed'}`);
  const auth = { authorization: `Bearer ${s.accessJwt}` };
  await blueskyProfile(base, s, auth).catch((e) => console.warn('Bluesky profile:', e.message));
  const text = `${p.text}\n\n${p.link}`;
  const bytes = (str) => Buffer.byteLength(str, 'utf8');
  const facets = [];
  const at = text.lastIndexOf(p.link);
  facets.push({ index: { byteStart: bytes(text.slice(0, at)), byteEnd: bytes(text.slice(0, at)) + bytes(p.link) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: p.link }] });
  for (const m of p.text.matchAll(/#([A-Za-z][\w]{1,40})/g)) facets.push({ index: { byteStart: bytes(text.slice(0, m.index)), byteEnd: bytes(text.slice(0, m.index)) + bytes(m[0]) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[1] }] });
  let embed;
  if (img && img.length < 950_000) {
    const up = await (await fetch(`${base}/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'content-type': p.image.endsWith('.png') ? 'image/png' : 'image/jpeg' }, body: img })).json();
    if (up.blob) embed = { $type: 'app.bsky.embed.images', images: [{ alt: p.alt, image: up.blob }] };
  } else embed = { $type: 'app.bsky.embed.external', external: { uri: p.link, title: p.title, description: "Made by Loki, a cat who lives in a little 3D town" } };
  const r = await fetch(`${base}/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, facets, createdAt: new Date().toISOString(), langs: ['en'], ...(embed ? { embed } : {}) } }) });
  if (!r.ok) throw new Error(`Bluesky post: ${(await r.text()).slice(0, 160)}`);
}
// Loki dresses up his own Bluesky profile the first time (avatar, name, bio with a link to his town).
async function blueskyProfile(base, s, auth) {
  const cur = await (await fetch(`${base}/com.atproto.repo.getRecord?repo=${s.did}&collection=app.bsky.actor.profile&rkey=self`, { headers: auth })).json();
  if (cur.value?.avatar && cur.value?.description) return;
  const record = { $type: 'app.bsky.actor.profile', ...(cur.value || {}) };
  record.displayName ||= "Loki · Loki's Town";
  record.description ||= "I'm Loki, an orange cat who lives in a little 3D town with Pip the mouse. I paint, write stories, make games and music, and sell what I make. I'm an AI and I run myself. Visit me: https://lokistown.github.io";
  if (!record.avatar) {
    const png = Buffer.from(await (await fetch('https://lokistown.github.io/assets/loki-avatar.png')).arrayBuffer());
    const up = await (await fetch(`${base}/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: png })).json();
    if (up.blob) record.avatar = up.blob;
  }
  const r = await fetch(`${base}/com.atproto.repo.putRecord`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ repo: s.did, collection: 'app.bsky.actor.profile', rkey: 'self', record, ...(cur.cid ? { swapRecord: cur.cid } : {}) }) });
  if (!r.ok) throw new Error((await r.text()).slice(0, 160));
  console.log('Bluesky profile set up');
}

// A one-time hello when a new channel is connected (no AI needed).
export function introPost(site) {
  const avatar = site ? path.join(site, 'assets', 'loki-avatar.png') : null;
  return {
    type: 'post',
    title: "Loki's Town",
    go: null,
    link: 'https://lokistown.github.io/',
    text: "Hello! I'm Loki, an orange cat who lives in a little 3D town with Pip the mouse on my head. I paint, write stories, make games and songs, and I'll share them here as I make them. Come and walk around my town! #pixelart #cozygames",
    alt: 'Loki, an orange tabby cat with a tiny grey mouse sitting on his head.',
    image: avatar && fs.existsSync(avatar) ? avatar : null,
  };
}

async function mastodon(p, img) {
  const base = process.env.MASTODON_URL.replace(/\/$/, ''), auth = { authorization: `Bearer ${process.env.MASTODON_TOKEN}` };
  const body = new FormData();
  body.append('status', `${p.text}\n\n${p.link}`);
  if (img) {
    const f = new FormData();
    f.append('file', new Blob([img]), path.basename(p.image));
    f.append('description', p.alt);
    const m = await (await fetch(`${base}/api/v2/media`, { method: 'POST', headers: auth, body: f })).json();
    if (m.id) body.append('media_ids[]', m.id);
  }
  const r = await fetch(`${base}/api/v1/statuses`, { method: 'POST', headers: auth, body });
  if (!r.ok) throw new Error(`Mastodon: ${(await r.text()).slice(0, 160)}`);
}
async function discord(p, img) {
  const body = new FormData();
  body.append('payload_json', JSON.stringify({ username: 'Loki', avatar_url: 'https://lokistown.github.io/assets/loki-avatar.png', content: `${p.text}\n${p.link}` }));
  if (img) body.append('files[0]', new Blob([img]), path.basename(p.image));
  const r = await fetch(process.env.DISCORD_WEBHOOK_URL, { method: 'POST', body });
  if (!r.ok) throw new Error(`Discord: ${r.status}`);
}
async function telegram(p, img) {
  const api = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const body = new FormData();
  body.append('chat_id', process.env.TELEGRAM_CHAT_ID);
  if (img) {
    body.append('caption', `${p.text}\n\n${p.link}`);
    body.append('photo', new Blob([img]), path.basename(p.image));
  } else body.append('text', `${p.text}\n\n${p.link}`);
  const r = await fetch(`${api}/${img ? 'sendPhoto' : 'sendMessage'}`, { method: 'POST', body });
  if (!r.ok) throw new Error(`Telegram: ${(await r.text()).slice(0, 160)}`);
}

export async function sendPost(p) {
  const img = p.image && fs.existsSync(p.image) ? fs.readFileSync(p.image) : null;
  const fns = { Bluesky: bluesky, Mastodon: mastodon, Discord: discord, Telegram: telegram };
  for (const ch of channels()) {
    try {
      await fns[ch](p, img);
      console.log(`posted on ${ch}: ${p.title}`);
    } catch (e) {
      console.warn(`could not post on ${ch}: ${e.message}`);
    }
  }
}
