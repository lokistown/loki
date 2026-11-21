// Central settings. Anything here can be overridden with environment variables.
const env = process.env;

export const config = {
  timezone: 'Europe/London',
  sleepStartHour: Number(env.LOKI_SLEEP_START ?? 23), // 23:00 UK
  sleepEndHour: Number(env.LOKI_SLEEP_END ?? 7), //      07:00 UK

  // Per work session limits (keeps us inside free AI quotas).
  maxCallsPerSession: Number(env.LOKI_MAX_CALLS ?? 14),
  maxMinutesPerSession: Number(env.LOKI_MAX_MINUTES ?? 35),
  maxTasksPerSession: Number(env.LOKI_MAX_TASKS ?? 6),

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
