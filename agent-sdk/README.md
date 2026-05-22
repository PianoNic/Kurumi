# agent-sdk

Minimal Claude Agent SDK hello-world, authenticated via your **Claude Max subscription** (OAuth), running entirely in Docker.

## Prerequisites

1. **Verify your Claude Code CLI on the host** (just to confirm you have a working Max login somewhere — we won't reuse host credentials in the container, but it's a sanity check). In a separate PowerShell window:
   ```powershell
   claude --version
   claude   # then /login if it doesn't say you're already authenticated
   ```
   Inside the container we'll do a fresh `/login` — the container can't reliably reuse the host's Windows credential storage.

2. **Docker Desktop running** on Windows.

3. **Confirm `ANTHROPIC_API_KEY` is unset in the shell you'll use to launch the container.** If it's set, it propagates and silently overrides OAuth, billing against API credits instead of your subscription.

   ```powershell
   $env:ANTHROPIC_API_KEY   # should print nothing
   Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue   # unset it for this session
   ```

   The compose file does not forward `ANTHROPIC_API_KEY` into the container, but it's still good hygiene to keep it out of your shell. `src/agent.ts` also asserts it at startup and exits loud if present.

## One-time setup: log in once inside the container

The OAuth token lives in a named Docker volume (`kurumistack_claude-config`) mounted at `/root/.claude`. You log in once interactively, the token persists across container restarts. The compose file lives at the **project root** (`..\compose.yml`) and orchestrates all three projects — see `..\DOCKER.md` for the full picture.

```powershell
cd C:\Coding\KurumiStack
docker compose --profile login run --rm agent-sdk-login
```

This drops you into Claude Code inside the container. Run:

```
/login
```

Follow the browser flow (it'll print a URL you open on your Windows host — copy/paste). When it confirms you're authenticated, type `/exit`.

## Run the hello-world

```powershell
cd C:\Coding\KurumiStack
docker compose --profile agent run --rm agent-sdk
```

Expected output: a short greeting streamed character-by-character, then a `✓ done — turns: 1, duration: ...ms, session: ...` line on stderr.

## How to confirm the call billed against your subscription

After running, check **claude.ai → Settings → Usage** (the Claude Code / subscription usage view) — you should see a small bump there. The **API console** (console.anthropic.com → Usage) should **not** show any usage from this run. If you see usage in the API console instead, `ANTHROPIC_API_KEY` slipped through somehow — re-check your shell and the compose `environment` blocks.

## Iterating

`src/` is bind-mounted into the container, so edits on your host are picked up on the next `docker compose run --rm agent`. No rebuild needed unless you change `package.json` or `Dockerfile`.

## Files

| File | Why |
|---|---|
| `Dockerfile` | Node 22 + Claude Code CLI + npm deps |
| `compose.yml` | Two services (`login` interactive, `agent` one-shot) sharing the OAuth volume |
| `src/agent.ts` | The minimal SDK call. Asserts `ANTHROPIC_API_KEY` is unset. |
| `tsconfig.json` | ES2022 / ESM / strict / noEmit (tsx handles execution) |
| `package.json` | `"type": "module"`, deps, `npm run agent` script |

## Common footguns

- **Browser callback fails on `/login`** — the Docker container can't open a browser, but Claude Code's OAuth flow prints a URL you paste into your host browser. Don't run the container in headless mode (no `tty`/`stdin_open`) for the login step.
- **`agent` service prints the API-key error and exits** — `ANTHROPIC_API_KEY` is leaking in. Check `docker compose run --rm agent env | grep ANTHROPIC` — if you see it, audit the compose `environment` blocks or your host shell.
- **`assistant` messages stream nothing, then `result.subtype` is `error_during_execution`** — usually means the OAuth token expired. Re-run the `login` service.
