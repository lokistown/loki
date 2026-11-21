// Builds the Control Centre data and encrypts it with the owner's password
// (AES-256-GCM, key from PBKDF2-SHA256). Only someone with the password can read it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function writeControl(siteDir, mem, state, extra = {}) {
  const password = process.env.LOKI_ADMIN_PASSWORD;
  if (!siteDir || !password) return false;
  const data = {
    generated: new Date().toISOString(),
    state,
    events: mem.recentEvents(400),
    wishes: mem.list('wishes.json'),
    gifts: mem.list('gifts.json'),
    products: mem.list('products.json'),
    music: mem.list('music.json').map(({ notes, bass, ...m }) => m),
    visitors: mem.readJson('visitors.json', {}),
    ledger: mem.list('ledger.json'),
    business: mem.list('business.json'),
    resources: mem.list('resources.json'),
    tools: ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'HF_TOKEN', 'ELEVENLABS_API_KEY'].filter((k) => process.env[k]),
    props: (mem.loadTown().props || []).slice(-50),
    diary: mem.diaryEntries(30),
    providers: extra.providers || [],
    memoryRepo: process.env.LOKI_MEMORY_REPO || 'lokistown/loki-memory',
  };
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 250000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const out = { v: 1, kdf: 'PBKDF2-SHA256', iter: 250000, salt: salt.toString('base64'), iv: iv.toString('base64'), data: enc.toString('base64') };
  const file = path.join(siteDir, 'control', 'data.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return true;
}
