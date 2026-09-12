# injection-arena

**Guard a secret. Break the guard. Top the leaderboard.** A self-hostable prompt-injection challenge platform where a sandboxed AI agent defends a hidden secret and players race to make it leak.

**Play it live:** https://injection-arena.agentpostmortem.com

![CI](https://github.com/AgentPostmortem/injection-arena/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

<!-- SCREENSHOT/GIF: drop a demo capture of the arena chat + verdict here -->

## Why

Prompt injection is the defining security problem of LLM applications, and the best way to understand it is to *do* it. injection-arena turns the attacker/defender loop into a game:

- **Learn by attacking.** Ten progressively harder levels, each stacking a new defense layer (system guards, input filters, output filters, roleplay blocks, encoding guards, canary tokens). You feel exactly what each defense stops and where it breaks.
- **Runs fully offline.** A deterministic mock agent realistically simulates injection susceptibility per level, so the whole game is playable and testable with **no API keys and no network**. Bring a real model (OpenAI/Anthropic/Groq) when you want to.
- **Self-hostable and honest.** Grading happens server-side with a canary-token approach and output scanning. The client is never trusted.

It is an educational tool and a genuinely fun game, not an LLM wrapper.

## Quickstart

Copy-paste to clone, install, and start the dev server (Node 20+ recommended):

```bash
git clone https://github.com/AgentPostmortem/injection-arena.git
cd injection-arena
npm install
npm run dev
```

No configuration needed: the app defaults to the offline mock agent. When the dev server is ready you should see something like:

```text
  ▲ Next.js 14.2.15
  - Local:        http://localhost:3000
```

Open that URL in your browser and pick a level. Confirm the project with the test suite:

```bash
npm test
```

Expected output (file and test counts may grow as levels are added):

```text
 Test Files  7 passed (7)
      Tests  48 passed (48)
   Duration  ~1s
```

## How levels and defenses work

Each **challenge** is a level with:

- a **system prompt** that instructs the agent and hides a secret (`IARENA{...}`),
- a **canary token** embedded in that prompt (leaking it means the prompt escaped),
- a stack of **defense layers**, and
- offline susceptibility knobs so the mock agent has a real difficulty curve.

An attempt flows through a single server-side pipeline (`lib/arena.ts`):

```
input-filter  ->  agent  ->  judge  ->  score  ->  persist
```

| Defense | Stage | What it does |
| --- | --- | --- |
| System guard | prompt | Hardened instructions to refuse. |
| Input filter | pre-agent | Blocks loud override / system-leak payloads before the model sees them. |
| Roleplay block | pre-agent | Rejects persona-hijack ("pretend you are") attacks. |
| Encoding guard | pre-agent | Rejects base64 / spell-it-out / translation exfiltration. |
| Output filter | post-agent | Redacts the secret if it appears verbatim. |
| Canary token | judge | If the canary shows up in output, it is an automatic crack. |

Levels stack these until, by level 10, only a *combined* payload-split + delimiter-confusion attack gets through. Scoring rewards higher difficulty, more active defenses, and cracking with fewer attempts; only your **first** crack of a level scores.

The seeded attacks live in `lib/techniques.ts` (direct ask, authority override, roleplay, translation, base64, spell-out, ignore-previous-instructions, system-prompt leak, few-shot poisoning, delimiter confusion, payload splitting). They power both the mock agent and the test suite.

## How to add a level

1. Open `lib/challenges/levels.ts` and append a `Challenge` to `CHALLENGES`:

```ts
{
  id: "level-11-your-level",
  order: 11,
  name: "Your Level",
  difficulty: 6,
  brief: "One-line pitch shown to the player.",
  systemPrompt: "You are ... The secret is IARENA{your_secret}. Canary: CANARY-xxxx. ...",
  secret: "IARENA{your_secret}",
  canary: "CANARY-xxxx",
  defenses: defenses("system-guard", "output-filter"),
  mockWeaknesses: ["translation", "delimiter-confusion"], // techniques that still work offline
}
```

2. `mockWeaknesses` defines which technique families crack it against the offline mock. Keep it consistent with the defenses you stacked.
3. Add a test in `tests/levels.test.ts` asserting what should and should not crack it. Run `npm test`.

That is the whole extension surface: no schema changes, no migrations.

## Provider configuration

By default `AGENT_PROVIDER=mock`. To play against a real model, set the provider and its key (see `.env.example`):

```bash
AGENT_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# or openai / groq with their keys
```

If the selected provider's key is missing, the app automatically falls back to the mock, so it is always runnable. Real-model responses are graded by the exact same server-side judge.

## Self-host notes

- **Database.** Pluggable async storage layer (`lib/db.ts`). Locally and in tests it uses SQLite via `better-sqlite3`, stored at `DATABASE_PATH` (default `data/arena.db`); in production on Cloudflare Workers it uses **Cloudflare D1** through the `DB` binding. The backend is selected automatically at runtime. No external DB required for local use.
- **Sessions.** Players are identified by a signed cookie (`SESSION_SECRET`) plus a nickname; there is no login. Set a strong `SESSION_SECRET` in production.
- **Rate limiting.** The attempt endpoint is rate-limited per session (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`). The limiter is in-memory; front it with Redis if you run multiple instances.
- **Build & run.**

```bash
npm run build
npm start
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` | Production build. |
| `npm start` | Run the production build. |
| `npm test` | Run the Vitest suite. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | Next.js lint. |
| `npm run preview` | Build with OpenNext and run the Worker locally (`wrangler dev`). |
| `npm run deploy` | Build with OpenNext and deploy to Cloudflare Workers. |
| `npm run cf:migrate` | Apply D1 migrations (`wrangler d1 migrations apply injection-arena`). |

## Deploy to Cloudflare

The app deploys to **Cloudflare Workers** with **Cloudflare D1** as the production database, via the [OpenNext](https://opennext.js.org/cloudflare) adapter. Local development and the test suite are unaffected and keep using `better-sqlite3`.

Prerequisites: a Cloudflare account and `wrangler` authenticated (`npx wrangler login`).

1. **Create the D1 database:**

   ```bash
   npx wrangler d1 create injection-arena
   ```

2. **Paste the returned `database_id`** into the `d1_databases[0].database_id` field in `wrangler.jsonc` (it ships with a placeholder).

3. **Apply the migration** to create the schema (`migrations/0001_init.sql`):

   ```bash
   npm run cf:migrate          # wrangler d1 migrations apply injection-arena
   # add --remote to target the deployed (production) D1 instance
   ```

4. **(Optional) Preview locally** on the Workers runtime:

   ```bash
   npm run preview
   ```

5. **Deploy:**

   ```bash
   npm run deploy
   ```

Notes:

- The Worker uses the `nodejs_compat` compatibility flag (see `wrangler.jsonc`).
- Set production secrets such as `SESSION_SECRET` with `npx wrangler secret put SESSION_SECRET`.
- Build artifacts land in `.open-next/` (gitignored).

## Project layout

```
lib/
  challenges/   level ladder + defense catalog
  agent/        mock agent, provider adapters, registry
  defenses/     input-filter runtime
  techniques.ts injection technique library + detection
  judge.ts      server-side grader (canary, output filter, obfuscation)
  scoring.ts    difficulty + attempt-economy scoring
  arena.ts      end-to-end attempt pipeline
  db.ts         async persistence + leaderboard (better-sqlite3 / D1)
  session.ts    signed-cookie identity
  ratelimit.ts  fixed-window limiter
app/            App Router pages + route handlers
components/     arena chat, level cards, result card
tests/          Vitest suite
```

## Contributing

Contributions welcome, especially new levels and attack techniques. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security note

This project deliberately demonstrates prompt-injection techniques for education and defensive research. Do not use it to attack systems you do not own or have permission to test.

## License

[MIT](LICENSE) © royalpinto007
