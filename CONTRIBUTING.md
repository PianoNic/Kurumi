# Contributing to KurumiStack

Thanks for poking at this. The repo is small but has several moving pieces — please skim [`README.md`](README.md), [`DOCKER.md`](DOCKER.md), and the [`kurumi-chat-bot/README.md`](kurumi-chat-bot/README.md) before opening a PR so you know which service you're touching.

## Local setup

Follow the "Quick start" in `README.md`. You need:

- Docker Desktop (or Docker Engine on Linux)
- Either a Claude Max subscription (OAuth) **or** a custom Anthropic-compatible endpoint with `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` set
- One Discord bot token (`KURUMI_BOT_TOKEN`) — the embedded `discord-server-bot` MCP reuses it; you do *not* need a second bot application
- Your Discord user ID set in `KURUMI_OWNERS` (otherwise no one can drive `kurumi-self`'s admin tools)

## Before you push

```powershell
# 1. Validate compose file
docker compose config --quiet

# 2. Validate Node syntax for everything
node --check src/index.js                       # standalone discord-server-bot MCP
node --check kurumi-chat-bot/src/index.js       # the bot
node --check kurumi-chat-bot/src/self-mcp.js    # kurumi-self MCP

# 3. Make sure no .env files are staged
git status
# If anything in **/.env shows up — STOP, fix .gitignore.

# 4. Optional: rebuild to make sure Dockerfiles still work
docker compose --profile agent --profile build-only build
```

CI runs the first three on every PR (see [`.github/workflows/validate.yml`](.github/workflows/validate.yml)).

## What goes where

| Change touches… | Edit |
|---|---|
| New MCP tool / Discord guild operation (servers, channels, members, moderation, etc.) | `src/index.js` + update tool inventory in main `README.md` |
| Kurumi persona, chat behaviour, session/queue handling, presence, typing | `kurumi-chat-bot/src/index.js` |
| `kurumi-self` MCP — config keys, notes, mute lists, GIF library, loose tools, loose commands | `kurumi-chat-bot/src/self-mcp.js` |
| Agent SDK demo | `agent-sdk/src/agent.ts` |
| Docker orchestration, volumes, profiles | `compose.yml` + `DOCKER.md` |
| OAuth / login flow | `agent-sdk/Dockerfile` (claude CLI install) or `compose.yml` (volume mounts) |
| New CLI baked into the bot container (e.g. `gh`, `jq`, headless browser) | `kurumi-chat-bot/Dockerfile` — **not** `/kurumi-tools/`, never via `apt install` at runtime |
| Loose-tool / loose-command policy, scope rules | `kurumi-tools/README.md` + the `SCOPE DISCIPLINE` block in `kurumi-chat-bot/src/index.js` system prompt |

## Coding style

- ESM modules, top-level `await` is fine (we're on Node 22).
- No comments that just narrate what code does — explain *why* if anything.
- Keep MCP tool descriptions and Zod schemas tight; the LLM reads them and they directly affect tool-selection quality.
- The MCP servers communicate with Claude Code over stdio JSON-RPC. **Anything written to `stdout` that isn't valid JSON-RPC will break the transport.** Use `console.error` for logs.
- New env-driven config goes through `ENV_DEFAULTS` in `kurumi-chat-bot/src/index.js` and gets exposed via `config_get`/`config_set` so the owner can change it live without a rebuild.

## Persona changes

The system prompt (`SYSTEM_APPEND` in `kurumi-chat-bot/src/index.js`) is load-bearing. Several sections were added iteratively in response to actual chat-channel incidents:

- **AI-clichés blocklist + roleplay ban** — added after Kurumi kept emitting `*adjusts clock face*` / `As an AI...` lines
- **SCOPE DISCIPLINE / STOP RULE** — added after a 30+ tool-call loop trying to install Chromium for a weather radar
- **NO LLM-FLEX REQUESTS** — added after a "list 100 animals" request consumed a full context window
- **OWNER / FOUNDER tier rules** — codify the three-tier permission model

If you're tweaking persona, preserve those sections or replace them with stronger alternatives. Don't silently delete them.

## Tool changes

When adding a new `mcp__discord-server-bot__*` tool:

1. Add the Zod schema + handler in `src/index.js`.
2. Test it from chat against a throwaway test server — `@KURUMI use the new <tool_name> tool to ...`.
3. Add it to the tool inventory in `README.md`.
4. Bump the `"version"` field in the `Server` constructor.

When adding a new `mcp__kurumi-self__*` tool:

1. Add it to `kurumi-chat-bot/src/self-mcp.js`.
2. Decide its tier: admin-only (owner) or self-tier (owner + founders). Add it to the appropriate filter in `index.js`'s MCP-config builder.
3. Add a one-line description to the corresponding tools section in the `SYSTEM_APPEND` block so Kurumi knows when to reach for it.

## Secrets

There are no committed secrets in this repo, and there shouldn't ever be. `.env` files are listed in `.gitignore`. If a token leaks, the fix is:

1. Rotate the token in the Discord Developer Portal **immediately**.
2. `git rm --cached` the file, force-rewrite history with `git filter-repo` if it was pushed.
3. Then fix the `.gitignore` rule that let it through.

The same applies to `ANTHROPIC_AUTH_TOKEN` if you're using a custom endpoint — rotate at the provider, never commit.

## Filing issues

Include:

- `docker compose version`
- Which service is misbehaving (`discord-server-bot`, `kurumi-chat-bot`, or `agent-sdk`)
- The exact command you ran and the last ~30 lines of `docker compose logs <service>`
- Whether you've completed the one-time `/login` flow (or whether you're using a custom endpoint)
- Your `KURUMI_*` env keys (names only, **not values**) so we can tell what configuration applied
