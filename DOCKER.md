# Docker Setup — all three projects

Everything runs in Docker. One top-level `compose.yml` at the repo root orchestrates all services. One shared OAuth volume so a single `claude /login` covers both the Agent SDK demo and the Discord chat bot.

> Examples below assume the repo is cloned at `C:\Coding\KurumiStack`. Adjust paths if you clone elsewhere — the only file with a hardcoded host path is `.mcp.json`, which you'll need to update to point at your `.env`.

## Services

| Service | Lifetime | How it runs | Purpose |
|---|---|---|---|
| `discord-server-bot` | per-invocation | Built as image; **launched by Claude Code via `docker run -i`** through `.mcp.json` | MCP server for Discord setup tools |
| `kurumi-chat-bot` | long-running | `docker compose up -d kurumi-chat-bot` | Discord @mention bridge → spawns `claude` CLI |
| `agent-sdk-login` | one-shot, interactive | `docker compose --profile login run --rm agent-sdk-login` | Interactive shell to run `/login` once |
| `agent-sdk` | one-shot | `docker compose --profile agent run --rm agent-sdk` | Hello-world Agent SDK call |

## Volumes

- **`kurumistack_claude-config`** — `/root/.claude` inside containers. Holds the OAuth token. Shared by `kurumi-chat-bot` and the agent-sdk services so one login works for both.
- **`kurumistack_kurumi-state`** — `/state` inside `kurumi-chat-bot`. Persists `sessions.json` across restarts.
- **bind: `./kurumi-workspace` → `/workspace`** — the workspace Claude Code operates in for the chat bot. Files persist on your host.

Volume names are prefixed with `kurumistack_` because `compose.yml` sets `name: kurumistack`.

## First-time setup

```powershell
cd C:\Coding\KurumiStack

# 1. Make sure ANTHROPIC_API_KEY is not in your shell.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

# 2. Build all images. `agent-sdk-login` reuses the `agent-sdk` image.
docker compose --profile agent --profile build-only build

# 3. Log into Claude Code inside the container (writes OAuth to the shared volume).
docker compose --profile login run --rm agent-sdk-login
#    inside the container:  /login  → open the URL on host → finish auth → /exit

# 4. Smoke-test the Agent SDK.
docker compose --profile agent run --rm agent-sdk

# 5. Start the Discord chat bot (long-running).
docker compose up -d kurumi-chat-bot
docker compose logs -f kurumi-chat-bot   # to watch
```

The `discord-server-bot` MCP image is built by step 2 (note the `build-only` profile flag). Claude Code picks it up from `.mcp.json` next time you launch it in this directory — no `up` needed for that one.

## Day-to-day commands

```powershell
# Rebuild after code changes
docker compose build kurumi-chat-bot
docker compose --profile build-only build discord-server-bot   # then restart Claude Code so it re-pulls
docker compose --profile agent build agent-sdk

# Restart the long-running bot after a rebuild
docker compose up -d --force-recreate kurumi-chat-bot

# Tail logs
docker compose logs -f kurumi-chat-bot

# Run the agent-sdk hello-world again
docker compose --profile agent run --rm agent-sdk

# Re-login if OAuth expired
docker compose --profile login run --rm agent-sdk-login

# Stop everything
docker compose down

# Wipe OAuth (forces re-login) — careful, this also affects kurumi-chat-bot
docker volume rm kurumistack_claude-config
```

## .env files

Tokens live in per-project `.env` files (gitignored). Compose reads them per service:

| File | Variables | Used by |
|---|---|---|
| `./.env` | `DISCORD_BOT_TOKEN` | `discord-server-bot` (via `.mcp.json` `--env-file`) |
| `./kurumi-chat-bot/.env` | `KURUMI_BOT_TOKEN` | `kurumi-chat-bot` (via compose `env_file:`) |

`ANTHROPIC_API_KEY` is not in any `.env` and is not forwarded by compose — the Agent SDK uses your subscription's OAuth instead.

## How Claude Code launches the MCP server

`.mcp.json` (committed to the repo):

```json
{
  "mcpServers": {
    "discord-server-bot": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--env-file", "C:\\Coding\\KurumiStack\\.env", "discord-server-bot:latest"]
    }
  }
}
```

If you cloned the repo somewhere other than `C:\Coding\KurumiStack`, update the `--env-file` path. When you change MCP server source, rebuild and restart Claude Code (or `/mcp` reconnect):

```powershell
docker compose --profile build-only build discord-server-bot
```

## Logging in on a headless production server

The OAuth URL `/login` prints works from any browser. Two options:

**A. SSH in, browser on your laptop.** Run the `login` profile on the prod server, copy the URL it prints, paste into your local browser, complete OAuth, paste the resulting code back into the container's prompt. Same flow as local — just over SSH.

**B. Log in locally, transplant the volume.** Run the login on your dev machine, then:

```powershell
# Export the volume
docker run --rm `
  -v kurumistack_claude-config:/data:ro `
  -v ${PWD}:/backup `
  alpine tar czf /backup/claude-config.tgz -C /data .

# Copy to prod, then restore there:
# docker volume create kurumistack_claude-config
# docker run --rm -v kurumistack_claude-config:/data -v /tmp:/backup:ro \
#   alpine sh -c "cd /data && tar xzf /backup/claude-config.tgz"
```

## Footguns

- **`docker compose up` doesn't start `discord-server-bot`.** That's intentional — it's behind the `build-only` profile so it only builds, never runs as a service. Claude Code is the one that runs it via stdio.
- **First `agent-sdk` run after a host reboot fails auth?** OAuth token in the volume may have expired. Re-run the `login` service.
- **`kurumi-chat-bot` can't find `claude` inside its container?** The Dockerfile installs `@anthropic-ai/claude-code` globally — confirm with `docker compose exec kurumi-chat-bot which claude`.
- **Edited code, change not visible?** `kurumi-chat-bot` and `discord-server-bot` `COPY` source at build time, so you must rebuild. `agent-sdk` bind-mounts `./agent-sdk/src` so it picks up changes on next run without rebuild.
