// Fake AI replies so the whole loop can be tested offline without API keys.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function mockArt() {
  const rects = ['<rect x="0" y="0" width="32" height="32" fill="#2b2d42"/>'];
  for (let i = 0; i < 80; i++) rects.push(`<rect x="${(i * 7) % 32}" y="${(i * 3) % 32}" width="2" height="2" fill="${pick(['#f28c28', '#ffd166', '#06d6a0', '#ef476f', '#fff5e6'])}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${rects.join('')}</svg>`;
}

export function mockReply(user) {
  const J = JSON.stringify;
  if (user.includes('[[DECIDE]]')) {
    const action = pick(['write_diary', 'improve_town', 'make_art', 'make_art', 'learn_skill', 'make_music', 'make_product', 'make_wish']);
    return J({ thought: pick(['The bakery needs a chimney.', 'I wonder who will visit today.', 'My paws want to paint.']), mood: pick(['curious', 'cozy', 'busy', 'proud']), action, plan: `(mock) ${action}` });
  }
  if (user.includes('[[TOWN]]')) return J(pick([{ target: 'house', add_room: 'library', room_name: 'Reading Nook', diary: 'I added a reading nook.' }, { target: 'new', name: 'Sunny Park', kind: 'park', color: '#8fd16a', description: 'A park with a bench.', diary: 'I made a park.' }, { target: 'bakery', name: 'Bakery', description: 'Now with a bigger oven.', diary: 'Upgraded the bakery.' }]));
  if (user.includes('[[ART]]')) return J({ title: pick(['Sunset Yarn', 'Fish Moon', 'Pip Asleep', 'Teal Scarf']), description: 'A small picture.', svg: mockArt() });
  if (user.includes('[[SKILL]]')) return J({ name: pick(['Dithering', 'Warm palettes', 'Writing shop blurbs']), why: 'Makes my art nicer.', steps: ['Look', 'Try', 'Fix'], tips: ['Small steps'] });
  if (user.includes('[[MUSIC]]')) return J({ title: 'Paws on Keys', mood: 'cheerful', bpm: 108, wave: 'triangle', notes: [[60, 1], [64, 1], [67, 1], [72, 2], [null, 0.5], [71, 0.5], [67, 1], [64, 1], [65, 1], [69, 1], [72, 2], [67, 2]], bass: [[48, 4], [53, 4], [55, 4]], diary: 'I wrote a bouncy tune.' });
  if (user.includes('[[PRODUCT]]')) return J({ type: 'template', title: 'Cozy Cat Landing Page', description: 'A warm one-page website template.', price: '4', tags: ['template'], html: '<!doctype html><html><head><meta charset="utf-8"><title>Cozy</title><style>body{font-family:sans-serif;background:#fff8ec;color:#3b2416;margin:0}header{padding:60px 20px;text-align:center;background:#f6b26b}h1{font-size:48px}section{max-width:700px;margin:40px auto;padding:0 20px;line-height:1.6}</style></head><body><header><h1>Your Cozy Brand</h1><p>A warm little page.</p></header><section><h2>About</h2><p>Write about yourself here. This template was made by Loki the cat, who thinks every website should feel like a sunny windowsill.</p></section></body></html>', diary: 'I made a template.' });
  if (user.includes('[[WISH]]')) return J({ text: 'Could you share my town on social media?', why: 'So more people visit me.', kind: 'promote' });
  if (user.includes('[[GIFT]]')) return J({ reply: 'Thank you so much!', diary: 'My human gave me a gift today.', granted: true });
  if (user.includes('[[MAIL]]')) return J({ items: [{ i: 0, keep: true, reply: 'Thanks for writing!', question: 'What is your favourite colour?', note: 'friendly' }], diary: 'I read my mail.' });
  if (user.includes('[[PLAN]]')) {
    const blocks = [];
    for (let i = 0; i < 10; i++) blocks.push({ place: Math.floor(Math.random() * 25), minutes: 15, label: pick(['painting a fish', 'humming a tune', 'checking the mail', 'eating a snack']), thought: 'Hmm.' });
    return J({ blocks, whatsOn: 'A breeze is carrying the smell of fresh fish buns across the plaza.', pip: 'Pip is nibbling a crumb on Loki’s head.' });
  }
  if (user.includes('[[DREAM]]')) return J({ title: 'The moon fish', text: 'I dreamt the moon was a fish and I almost caught it.' });
  return J({ title: 'A mock day', text: 'Today was a pretend day. Everything worked.' });
}
