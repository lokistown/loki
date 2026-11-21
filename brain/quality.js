// Loki checks his own work before publishing: syntax-checks every script in an HTML page,
// then reviews it with his brain and fixes problems (one or two rounds).
import { clip } from './util.js';

export function scriptErrors(html) {
  const errs = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const code = m[1];
    if (/\btype\s*=\s*["']module["']/i.test(m[0])) continue;
    try {
      // parse only; never executed here
      new Function(code);
    } catch (e) {
      errs.push(e.message);
    }
  }
  if (/<script[^>]+src=|<iframe|<link[^>]+href=["']https?:|@import\s+url\(["']?https?:/i.test(html)) errs.push('uses external files (must be self-contained)');
  if (html.length > 80000) errs.push('too large');
  if (!/<\/html>\s*$/i.test(html.trim())) errs.push('HTML seems cut off (no closing </html>)');
  return errs;
}

export async function reviewAndFix({ brain, system }, html, what, rounds = 2) {
  let current = html;
  const log = [];
  for (let k = 0; k < rounds && brain.budgetLeft > 2; k++) {
    const errs = scriptErrors(current);
    const r = await brain.ask(
      system,
      `[[REVIEW]] You are checking your own ${what} before publishing it. Automatic checks found: ${errs.join('; ') || 'no syntax errors'}.
Read it carefully as a strict reviewer: does it work, look good on phones and desktops, have no broken logic, no external files, and is it genuinely good quality?
If it needs changes, return the COMPLETE corrected file. Reply as JSON: {"ok": true|false, "problems": ["..."], "html": "full corrected HTML if not ok, else empty"}

${current.slice(0, 60000)}`,
      { json: true, quality: 'high' },
    );
    log.push(...(Array.isArray(r.problems) ? r.problems.map((p) => clip(p, 120)) : []));
    if (r.ok && !errs.length) return { html: current, ok: true, log };
    if (r.html && String(r.html).length > 300) current = String(r.html);
  }
  const final = scriptErrors(current);
  return { html: current, ok: final.length === 0, log: log.concat(final) };
}
