// Sends the messages Loki queued during his session — run after his work is published.
import fs from 'node:fs';
import { sendNow, announceNow } from './gifts.js';
import { sendPost } from './poster.js';

const file = `${process.env.RUNNER_TEMP || '.'}/loki-outbox.jsonl`;
if (fs.existsSync(file)) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      if (m.type === 'post') await sendPost(m);
      else if (m.type === 'announce') await announceNow(m.items);
      else await sendNow(m.title, m.body, m.go);
      console.log(`sent: ${m.title || 'what Loki made'}`);
    } catch (e) {
      console.warn('could not send:', e.message);
    }
  }
  fs.unlinkSync(file);
} else console.log('nothing to send');
