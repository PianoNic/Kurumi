# Docker Setup — full operational walkthrough

Everything runs in Docker. One top-level `compose.yml` at the repo root orchestrates all services. One shared OAuth volume so a single `claude /login` covers both the Agent SDK demo and the Discord chat bot — or skip OAuth entirely with a custom Anthropic-compatible endpoint.

> Examples below assume the repo is cloned at `C:\Coding\KurumiStack`. Adjust paths if you clone elsewhere — the only file with a hardcoded host path is `.mcp.json`, which you'll need to update to point at your `.env` if you use host-side Claude Code with the standalone MCP image.

## Services

| Service | Lifetime | How it runs | Purpose |
|---|---|---|---|
| `discord-server-bot` | per-invocation | Built as a standalone image; launched by host-side Claude Code via `docker run -i` through `.mcp.json` | MCP server for one-off Discord ops from your terminal |
| `kurumi-chat-bot` | long-running | `docker compose up -d kurumi-chat-bot` | The main Discord bot. Embeds `discord-server-bot` as a child process via `node` — no docker-in-docker needed |
| `agent-sdk-login` | one-shot, interactive | `docker compose --profile login run --rm agent-sdk-login` | Interactive shell to run `/login` once |
| `agent-sdk` | one-shot | `docker compose --profile agent run --rm agent-sdk` | Hello-world Agent SDK call (validates OAuth) |

## Volumes

| Volume | Mount | Contents | Survives `docker compose down`? |
|---|---|---|---|
| `kurumistack_claude-config` | `/root/.claude` in chat-bot + agent-sdk | OAuth token, `.claude.json`, backups, settings | yes — until `docker volume rm` |
| `kurumistack_kurumi-state` | `/state` in chat-bot | All runtime state — sessions, config, notes, gif library, loose-commands map, etc. (see below) | yes — until `docker volume rm` |
| bind: `./kurumi-workspace` | `/workspace` in chat-bot | Working dir for Claude Code's filesystem tools. Files persist on host. | yes (it's just a folder) |
| bind: `./kurumi-tools` | `/kurumi-tools` in chat-bot | Kurumi's persistent dev folder — loose tools, loose commands | yes (it's just a folder) |

Volume names are prefixed with `kurumistack_` because `compose.yml` sets `name: kurumistack`.

### Contents of `kurumistack_kurumi-state` (`/state`)

| Path | Purpose |
|---|---|
| `sessions.json` | `{channelId: claudeSessionId}` for `--resume`. Wipe to reset all conversations. |
| `kurumi-config.json` | Live runtime config (overrides env-var defaults). Changes apply on the next spawn. |
| `kurumi-notes.json` | Three-tier memory (short / long / archive), scoped by `global` / `guild:<id>` / `channel:<id>` / `user:<id>`. |
| `attachments/` | Image attachments downloaded per message for `Read`-tool vision. Cleared on full state reset; not auto-pruned. |
| `gif-library/` | Saved reaction GIFs + `index.json` with metadata (`name`, `description`, `tags`, `path`, `sourceUrl`). Used by `{{gif:<id>}}` macros in replies. |
| `loose-commands.json` | Dispatch map for runtime-registered Discord slash commands. `{commandName: {scriptPath, interpreter, guildId, commandId, description, registeredAt}}`. |
| `active-channels.json` | List of recently-active channels + last shutdown timestamp, for the goodbye/hello messages around restarts. |

## First-time setup

```powershell
cd C:\Coding\KurumiStack

# 1. Make sure ANTHROPIC_API_KEY is NOT in your shell.
#    If it's set, the SDK silently bills against API credits instead of your subscription.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

# 2. Drop your tokens in:
copy kurumi-chat-bot\.env.example kurumi-chat-bot\.env
notepad kurumi-chat-bot\.env
#    Required:  KURUMI_BOT_TOKEN, KURUMI_OWNERS
#    Optional:  GH_TOKEN, ANTHROPIC_BASE_URL/AUTH_TOKEN (skip OAuth via custom endpoint),
#               KURUMI_FOUNDER_ROLE, KURUMI_AUTO_RESPOND_PATTERNS, etc.

# 3. Build all images. `agent-sdk-login` reuses the `agent-sdk` image.
docker compose --profile agent --profile build-only build

# 4. Log into Claude Code inside the container.
#    SKIP this step if you set ANTHROPIC_BASE_URL — the custom endpoint replaces OAuth.
docker compose --profile login run --rm agent-sdk-login
#    inside the container:  /login  → open the URL on host → finish auth → /exit

# 5. Smoke-test the Agent SDK.
docker compose --profile agent run --rm agent-sdk

# 6. Start the Discord chat bot (long-running).
docker compose up -d kurumi-chat-bot
docker compose logs -f kurumi-chat-bot   # to watch
```

The standalone `discord-server-bot` MCP image is built by step 2 (note the `build-only` profile flag). Host-side Claude Code (running on your laptop, not in a container) picks it up from `.mcp.json` next time you launch — no `up` needed for that one. The *embedded* `discord-server-bot` running inside `kurumi-chat-bot` is built into that image and always available.

## Day-to-day commands

```powershell
# Rebuild after code changes
docker compose build kurumi-chat-bot
docker compose --profile build-only build discord-server-bot   # then restart host-side Claude Code
docker compose --profile agent build agent-sdk

# Restart the long-running bot after a rebuild (preserves volumes)
docker compose up -d kurumi-chat-bot
# OR force-recreate without preserving the container (volumes still persist)
docker compose up -d --force-recreate kurumi-chat-bot

# Tail logs
docker compose logs -f kurumi-chat-bot

# Run the agent-sdk hello-world again
docker compose --profile agent run --rm agent-sdk

# Re-login if OAuth expired
docker compose --profile login run --rm agent-sdk-login

# Stop everything (volumes persist)
docker compose down

# Wipe OAuth (forces re-login) — also affects kurumi-chat-bot
docker volume rm kurumistack_claude-config

# Wipe all bot state (sessions, config, notes, gifs, loose commands)
# — useful for a clean slate after dev churn
docker compose stop kurumi-chat-bot
docker volume rm kurumistack_kurumi-state
docker compose up -d kurumi-chat-bot
```

## Selective state wipes

When you want a clean slate without losing everything, target individual files:

```powershell
# Reset only chat history (every channel starts a fresh Claude session)
docker compose exec kurumi-chat-bot sh -c 'echo "{}" > /state/sessions.json'

# Reset runtime config back to env defaults
docker compose exec kurumi-chat-bot sh -c 'echo "{}" > /state/kurumi-config.json'

# Reset memory
docker compose exec kurumi-chat-bot sh -c 'echo "[]" > /state/kurumi-notes.json'

# Reset just the loose-commands dispatch map (Discord-side registrations stay live —
# delete those via slash-command-remove from chat or `gh` / curl + DELETE /applications/.../commands/...)
docker compose exec kurumi-chat-bot sh -c 'echo "{}" > /state/loose-commands.json'

# Clean attachments (just the downloaded image cache)
docker compose exec kurumi-chat-bot sh -c 'rm -rf /state/attachments/* && mkdir -p /state/attachments'
```

## Backups & restores

```powershell
# Snapshot both persistent volumes
$ts = Get-Date -Format yyyyMMdd-HHmmss
docker run --rm `
  -v kurumistack_claude-config:/claude:ro `
  -v kurumistack_kurumi-state:/state:ro `
  -v ${PWD}:/backup `
  alpine sh -c "tar czf /backup/kurumi-backup-$ts.tgz -C / claude state"

# Restore a snapshot
docker volume create kurumistack_claude-config
docker volume create kurumistack_kurumi-state
docker run --rm `
  -v kurumistack_claude-config:/claude `
  -v kurumistack_kurumi-state:/state `
  -v ${PWD}:/backup:ro `
  alpine sh -c "tar xzf /backup/kurumi-backup-20260522-180000.tgz -C /"
```

## .env files

Tokens live in per-project `.env` files (gitignored). Compose reads them per service:

| File | Variables | Used by |
|---|---|---|
| `./.env` | `DISCORD_BOT_TOKEN` (legacy — for the standalone MCP only) | `discord-server-bot` standalone (via `.mcp.json` `--env-file`) |
| `./kurumi-chat-bot/.env` | `KURUMI_BOT_TOKEN`, `KURUMI_OWNERS`, optional `GH_TOKEN`, `ANTHROPIC_*` | `kurumi-chat-bot` (via compose `env_file:`) |

The chat-bot container deliberately does **not** load the root `.env` — the embedded `discord-server-bot` MCP falls back to `KURUMI_BOT_TOKEN` so the whole stack runs on a single Discord application identity.

`ANTHROPIC_API_KEY` is not in any `.env` and is not forwarded by compose — the Agent SDK uses your subscription's OAuth instead, **or** your custom endpoint via `ANTHROPIC_BASE_URL`.

## Using a custom LLM backend (no OAuth)

If you don't have a Claude Max subscription or you want to route through a different provider (Z.AI / GLM, OpenRouter via anthropic shim, LiteLLM proxy, local vLLM with anthropic-translate, etc.):

```env
# kurumi-chat-bot/.env
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
ANTHROPIC_AUTH_TOKEN=<your provider token>
ANTHROPIC_SMALL_FAST_MODEL=glm-4.5-air   # what claude-code uses for internal cheap operations
```

Then in chat (owner):

```
@KURUMI config_set model glm-4.6
@KURUMI config_set casualMessageGatingModel glm-4.5-air
```

Skip the `/login` step entirely. The bot will print `endpoint <your-url>` on the startup line instead of `endpoint <anthropic default>`.

To switch back: `@KURUMI config_set anthropicBaseUrl null` (and re-do OAuth if needed).

## How host-side Claude Code launches the standalone MCP server

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

If you cloned the repo somewhere other than `C:\Coding\KurumiStack`, update the `--env-file` path. When you change MCP server source, rebuild and restart host-side Claude Code (or `/mcp` reconnect):

```powershell
docker compose --profile build-only build discord-server-bot
```

This is only relevant if you're running Claude Code on your **host** and want it to reach Discord through this MCP server. The bot container has its own embedded copy and doesn't use this file.

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

**C. Use a custom endpoint instead.** Skip OAuth entirely (see the section above).

## Footguns

- **`docker compose up` doesn't start `discord-server-bot`.** That's intentional — it's behind the `build-only` profile so it only builds, never runs as a service. The standalone image is for host-side Claude Code; the embedded copy inside `kurumi-chat-bot` is what the bot uses.
- **First `agent-sdk` run after a host reboot fails auth?** OAuth token in the volume may have expired. Re-run the `login` service.
- **`kurumi-chat-bot` can't find `claude` inside its container?** The Dockerfile installs `@anthropic-ai/claude-code` globally — confirm with `docker compose exec kurumi-chat-bot which claude`.
- **`kurumi-chat-bot` exits silently with code 0 right after startup?** Almost always a bad/revoked bot token. Discord drops the WebSocket, nothing keeps Node alive. Regenerate the token, update `.env`, rebuild.
- **Edited code, change not visible?** `kurumi-chat-bot` and `discord-server-bot` `COPY` source at build time, so you must rebuild. `agent-sdk` bind-mounts `./agent-sdk/src` so it picks up changes on next run without rebuild. `kurumi-tools/` is also bind-mounted, so loose tools / loose commands she creates appear instantly inside the container.
- **`/state/loose-commands.json` lists commands but `/foo` doesn't appear in Discord?** The Discord-side registration may have been deleted out-of-band, or the bot is missing the `applications.commands` OAuth scope. Re-register via `loose_command_create` (the dispatch map is rebuilt). For global commands, allow up to 1 hour for propagation.
- **Bot keeps "restarting" in chat (`*the clock ticks down...*` then `*…back. the clock resumes its tick.*`).** That's the graceful shutdown / startup announcement. It's auto-suppressed within 90s of the previous boot (rebuild churn), so if you see it on every rebuild, check the logs for `[kurumi] booted Xs ago — suppressing goodbye message`. If genuinely restarting outside rebuilds, look for Docker restart loops with `docker inspect kurumi-chat-bot --format '{{.State}}'`.
