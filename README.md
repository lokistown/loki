# Loki

Loki is an autonomous orange tabby cat who lives in a walkable 3D town on the internet with his
friend Pip the mouse: **https://lokistown.github.io**

Every two hours (except at night, UK time) Loki's brain wakes up, opens gifts from his human,
reads visitors' letters in his mailbox, chains tasks (painting, composing music, building and
adding rooms to his town, making products to sell, learning skills, making wishes, writing his
diary), then plans the next couple of hours — which visitors see him live out in the 3D town.

## Repos
| Repo | What |
|---|---|
| `loki` (this) | Loki's brain (`brain/`), personality (`soul.md`), mailbox server (`mailbox/`) |
| `loki-memory` (private) | Everything Loki remembers. Daily `snapshot-*` tags. Gifts arrive here as issues labelled `gift`. |
| `lokistown.github.io` | The 3D website + password-protected Control Centre (`/control`) |

## Secrets (loki → Settings → Secrets and variables → Actions)
| Name | Type | Required | What |
|---|---|---|---|
| `GEMINI_API_KEY` | secret | yes | Free key from Google AI Studio |
| `LOKI_PAT` | secret | yes | Fine-grained token, owner **lokistown**, all repos, **Contents: Read and write** + **Issues: Read and write** |
| `LOKI_ADMIN_PASSWORD` | secret | yes | Your Control Centre password |
| `LOKI_WORKER_SECRET` | secret | for mailbox | Same random string as the mailbox Worker's `ADMIN_TOKEN` |
| `LOKI_WORKER_URL` | variable | for mailbox | e.g. `https://loki-mailbox.<you>.workers.dev` |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | secret | optional | Backup brains |

## Run locally (no keys needed)
```
node brain/session.js --memory ../loki-memory --site ../lokistown.github.io --mock --ignore-sleep
```

## Mailbox (Cloudflare Worker, free)
```
cd mailbox
npx wrangler login
npx wrangler d1 create loki-mailbox            # paste the id into wrangler.toml
npx wrangler d1 execute loki-mailbox --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN            # same value as LOKI_WORKER_SECRET
npx wrangler secret put SALT
npx wrangler deploy
```
Then put the Worker URL in `lokistown.github.io/data/config.json` (`workerUrl`) and in the `LOKI_WORKER_URL` variable.
