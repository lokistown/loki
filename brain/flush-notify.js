// Sends the messages Loki queued during his session — run after his work is published.
import fs from 'node:fs';
import { sendNow } from './gifts.js';

const file = `${process.env.RUNNER_TEMP || '.'}/loki-outbox.jsonl`;
if (fs.existsSync(file)) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const { title, body } = JSON.parse(line);
      await sendNow(title, body);
      console.log(`sent: ${title}`);
    } catch (e) {
      console.warn('could not send:', e.message);
    }
  }
  fs.unlinkSync(file);
} else console.log('nothing to send');
