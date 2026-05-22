# Contributing to KurumiStack

Thanks for poking at this. The repo is small but has three moving pieces — please skim [`README.md`](README.md) and [`DOCKER.md`](DOCKER.md) before opening a PR so you know which service you're touching.

## Local setup

Follow the "Quick start" section in `README.md`. You need:

- Docker Desktop (or Docker Engine on Linux)
- A Claude Max subscription (for OAuth — API keys are explicitly rejected)
- Two Discord bot tokens (one for the MCP server, one for Kurumi)

## Before you push

```powershell
# 1. Validate compose file
docker compose config --quiet

# 2. Validate Node syntax for both Node services
node --check src/index.js
node --check kurumi-chat-bot/src/index.js

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
| New MCP tool / Discord guild operation | `src/index.js` + update `README.md` MCP tools list |
| Kurumi persona, chat behavior, session handling | `kurumi-chat-bot/src/index.js` |
| Agent SDK demo | `agent-sdk/src/agent.ts` |
| Docker orchestration, volumes, profiles | `compose.yml` + `DOCKER.md` |
| OAuth / login flow | usually `agent-sdk/Dockerfile` (claude CLI install) or `compose.yml` (volume mounts) |

## Coding style

- ESM modules, top-level `await` is fine (we're on Node 22).
- No comments that just narrate what code does — explain *why* if anything.
- Keep MCP tool descriptions and Zod schemas tight; Claude Code reads them.
- The MCP server is invoked by Claude Code via `docker run -i`, so anything written to `stdout` that isn't valid JSON-RPC will break the transport. Use `console.error` for logs.

## Secrets

There are no committed secrets in this repo, and there shouldn't ever be. `.env` files are listed twice in `.gitignore`. If a token leaks, the fix is:

1. Rotate the token in the Discord Developer Portal immediately.
2. `git rm --cached` the file, force-rewrite history with `git filter-repo` if it was pushed.
3. Then fix the `.gitignore` rule that let it through.

## Filing issues

Include:
- `docker compose version`
- Which service is misbehaving (`discord-server-bot`, `kurumi-chat-bot`, or `agent-sdk`)
- The exact command you ran and the last ~30 lines of `docker compose logs <service>`
- Whether you've completed the one-time `/login` flow
