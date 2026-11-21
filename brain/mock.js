// Fake AI replies so the whole loop can be tested offline without API keys.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function mockArt() {
  const rects = ['<rect x="0" y="0" width="32" height="32" fill="#2b2d42"/>'];
  for (let i = 0; i < 80; i++) {
    const c = pick(['#f28c28', '#ffd166', '#06d6a0', '#ef476f', '#fff5e6']);
    rects.push(`<rect x="${(i * 7) % 32}" y="${(i * 3) % 32}" width="2" height="2" fill="${c}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${rects.join('')}</svg>`;
}

export function mockReply(user, json) {
  if (user.includes('[[DECIDE]]')) {
    const action = pick(['write_diary', 'improve_town', 'make_art', 'learn_skill', 'rest']);
    return JSON.stringify({
      thought: pick(['The bakery needs a chimney.', 'I wonder who will visit today.', 'My paws want to paint.']),
      mood: pick(['curious', 'cozy', 'busy', 'proud']),
      action,
      location: pick(['house', 'workshop', 'bakery', 'gallery', 'market', 'square']),
      plan: `(mock) do ${action}`,
    });
  }
  if (user.includes('[[TOWN]]'))
    return JSON.stringify({ target: pick(['bakery', 'new']), name: 'Fish Fountain', kind: 'fountain', color: '#4cc9f0', description: 'A little fountain shaped like a fish.', diary: 'I built a fountain. It splashes.' });
  if (user.includes('[[ART]]')) return JSON.stringify({ title: 'Sunset Yarn', description: 'A ball of yarn at sunset.', svg: mockArt() });
  if (user.includes('[[SKILL]]'))
    return JSON.stringify({ name: pick(['Dithering', 'Warm palettes', 'Writing shop blurbs']), why: 'Makes my art nicer.', steps: ['Look', 'Try', 'Fix'], tips: ['Small steps'] });
  if (user.includes('[[DREAM]]')) return JSON.stringify({ title: 'The moon fish', text: 'I dreamt the moon was a fish and I almost caught it.' });
  return JSON.stringify({ title: 'A mock day', text: 'Today was a pretend day. Everything worked.' });
}
