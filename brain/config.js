// Central settings. Anything here can be overridden with environment variables.
const env = process.env;

export const config = {
  timezone: 'Europe/London',
  sleepStartHour: Number(env.LOKI_SLEEP_START ?? 23), // 23:00 UK
  sleepEndHour: Number(env.LOKI_SLEEP_END ?? 7), //      07:00 UK

  // Per work session limits (keeps us inside free AI quotas).
  maxCallsPerSession: Number(env.LOKI_MAX_CALLS ?? 12),
  dailyCallBudget: Number(env.LOKI_DAILY_CALLS ?? 420), // stays under Gemini free limits (lite ~500/day per model)
  maxMinutesPerSession: Number(env.LOKI_MAX_MINUTES ?? 35),
  maxTasksPerSession: Number(env.LOKI_MAX_TASKS ?? 4),

  // AI providers, tried in this order. Missing keys are skipped.
  providers: [
    { name: 'gemini', keyEnv: 'GEMINI_API_KEY', model: env.GEMINI_MODEL || null },
    { name: 'groq', keyEnv: 'GROQ_API_KEY', model: env.GROQ_MODEL || 'openai/gpt-oss-120b' },
    { name: 'openrouter', keyEnv: 'OPENROUTER_API_KEY', model: env.OPENROUTER_MODEL || null },
  ],

  // Places in town Loki can be. The website draws these.
  baseLocations: ['house', 'bakery', 'workshop', 'gallery', 'market', 'square'],

  maxGalleryItems: 500,
  maxBuildings: 14,
};

// ---- the map Loki knows (must match the website's rooms) ----
export const DEFAULT_ROOMS = {
  house: ['hall', 'living', 'kitchen', 'studio', 'music', 'bedroom', 'laundry', 'control'],
  workshop: ['workshop', 'storage'],
  bakery: ['bakery', 'cafe'],
  cafe: ['cafe'],
  gallery: ['gallery', 'gallery'],
  library: ['library', 'library'],
  shop: ['shop'],
  tower: ['library'],
  arcade: ['arcade', 'cafe'],
  other: ['living'],
};
export const ENTERABLE = Object.keys(DEFAULT_ROOMS);
export const ROOM_ACTS = {
  hall: ['greet'], living: ['relax', 'radio'], kitchen: ['eat', 'cook'], bedroom: ['sleep', 'stretch'], laundry: ['laundry'],
  music: ['sing', 'piano'], studio: ['paint'], control: ['work'], workshop: ['build', 'print'], storage: ['tidy'], bakery: ['bake'],
  cafe: ['coffee', 'sit'], gallery: ['admire'], library: ['read'], shop: ['sell'], garden_room: ['garden'], bathroom: ['bath'], arcade: ['play'],
};
export const OUTDOOR_ACTS = { park: ['sit', 'stroll'], garden: ['garden', 'sit', 'stroll'], fountain: ['watch'], tree: ['nap'], market: ['sell'] };
export const PLAZA_ACTS = ['stroll', 'sit', 'mail', 'write'];
export const ADDABLE_ROOMS = ['kitchen', 'bedroom', 'bathroom', 'laundry', 'music', 'studio', 'workshop', 'storage', 'library', 'cafe', 'gallery', 'garden_room', 'arcade', 'living'];
