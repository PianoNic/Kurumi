# kurumi-chat-bot

The long-running service: a Discord bot that bridges chat into the **Claude Code CLI**, themed as Kurumi Tokisaki. Users @mention the bot (or DM her, or post in an auto-respond channel); the bot spawns `claude -p ... --model <cfg.model> --resume <session>` inside its container and streams the output back into the channel. Each Discord channel gets its own persistent Claude Code session.

For the full stack picture (login flow, shared OAuth volume, the embedded `discord-server-bot` MCP, agent-sdk), see [`../README.md`](../README.md) and [`../DOCKER.md`](../DOCKER.md).

## 1. Create the Discord bot

1. https://discord.com/developers/applications → **New Application** → name it `KURUMI`.
2. **Bot** tab → Reset Token, copy.
3. **Bot** → enable:
   - **MESSAGE CONTENT INTENT** (so she can read message text)
   - **SERVER MEMBERS INTENT** (so role-based founder detection works without a fetch on every message)
4. **OAuth2 → URL Generator** → scopes: `bot`, `applications.commands` (the latter is required for runtime slash commands). Permissions: `Manage Channels`, `Manage Roles`, `Manage Server`, `Read Messages/View Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`, `Add Reactions`, `Use External Emojis`, `Use External Stickers`, `Moderate Members` (for timeouts), plus `Kick Members` / `Ban Members` if you want her to moderate. Open the URL, invite the bot.

> **Single bot identity across the stack.** The embedded `discord-server-bot` MCP falls back to `KURUMI_BOT_TOKEN` when `DISCORD_BOT_TOKEN` isn't set, so you only need one token for everything — no separate "MCP bot" application.

## 2. Configure

```powershell
cd C:\Coding\KurumiStack\kurumi-chat-bot
copy .env.example .env
notepad .env
```

Minimum required:

```env
KURUMI_BOT_TOKEN=<token from step 1>
KURUMI_OWNERS=<your Discord user id>   # comma-separated for multiple
```

Optional but useful:

```env
GH_TOKEN=ghp_...                                  # authenticates `gh` CLI inside the container
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic # custom LLM backend
ANTHROPIC_AUTH_TOKEN=...                          # token for the custom backend
ANTHROPIC_SMALL_FAST_MODEL=glm-4.5-air            # cheap-model override for claude-code internals
KURUMI_FOUNDER_ROLE=Founder                       # case-insensitive substring match on role name
```

See `.env.example` for the full annotated list.

## 3. Run

Assumes you've already done the one-time `/login` flow described in [`../DOCKER.md`](../DOCKER.md) so the shared `kurumistack_claude-config` volume has an OAuth token — OR you're using a custom endpoint via `ANTHROPIC_BASE_URL` (no OAuth required).

```powershell
cd C:\Coding\KurumiStack
docker compose up -d kurumi-chat-bot
docker compose logs -f kurumi-chat-bot
```

Healthy startup looks like:

```
entrypoint: restoring /root/.claude.json from /root/.claude/backups/...
[kurumi] starting up — node v22.x.x, token length 72
[kurumi] login() resolved
Kurumi online as KURUMI#9162 — workspace /workspace — model claude-haiku-4-5 — endpoint <anthropic default> — founder role: "founder" — auto-respond patterns: ["kurumi"] — owners: 566263... — config file: /state/kurumi-config.json
  ↳ cached 21 members of "<guild>"
```

Then in Discord:

> @KURUMI what files are in this workspace?

She'll show the native typing indicator immediately, stream the response, and stop typing the instant the message goes out.

## Triggers — when she responds

In **guild channels**, she responds when:

- You @mention her, **or**
- You reply to one of her messages, **or**
- The channel/category name contains one of `cfg.autoRespondPatterns` (default `["kurumi"]`) **and** the message passes the casual-gating check (a cheap haiku call deciding whether the casual message is worth a real reply).

In **DMs**, every message is treated as a direct address — no @mention needed, no casual gating.

She **ignores**:

- Her own messages
- Other bots (`cfg.ignoreOtherBots: true`)
- Channels in `cfg.mutedChannels` (unless sender is OWNER)
- Users in `cfg.mutedUsers` (unless sender is OWNER)
- Messages shorter than `cfg.autoRespondMinChars` in auto-respond zones

## How conversations work

- Each **Discord channel** gets its own Claude Code session ID, persisted in `/state/sessions.json`.
- First message in a channel: starts a new Claude Code session.
- Follow-up messages: resume that channel's session with `--resume <id>`. Claude Code auto-compacts when the context window fills — older turns get summarized, the session ID stays the same.
- Reset a channel's memory: `docker compose exec kurumi-chat-bot sh -c 'echo "{}" > /state/sessions.json'` (no restart needed; next message starts fresh).
- Concurrent messages in the same channel queue serially (per-channel queue, depth-capped). Different channels run as separate concurrent subprocesses.

## Three tiers of users

Resolved per message:

| Tier | Who | What they get |
|---|---|---|
| **OWNER** | Discord user IDs listed in `KURUMI_OWNERS` | Everything. All Discord tools, all built-in tools (Bash/Read/Edit/Write/Glob/Grep/Web), the full `kurumi-self` MCP (admin tier: config_set, mute_user, loose_tool_*, loose_command_*, etc.). Owner messages bypass mute lists and the casual gate. |
| **FOUNDER** | Anyone with a role whose name **contains** `cfg.founderRole` (default `"Founder"`, case-insensitive — decorated names like `✧ Founder` work) | Full Discord tools, built-in tools, and the *self tier* of `kurumi-self`: `mute_channel`, `auto_respond_add`, `note_*`, `gif_*`, read-only config. No `config_set`, no `mute_user`, no loose-* registration. |
| **everyone else** | — | Pure chat. All execution tools passed via `--disallowed-tools`. She'll talk, refuse, joke, explain, and not touch anything. |

## Workspace

Claude Code runs inside `/workspace`, bind-mounted from `./kurumi-workspace/` on the host. Files created by one channel are visible to the next. She uses `--permission-mode bypassPermissions` so founders/owner get free filesystem access within that folder — **don't bind-mount your real source tree here.**

Separate from this is `/kurumi-tools/`, also bind-mounted, holding her runtime extensions:

- `loose/` — internal scripts she invokes herself via `loose_tool_run`. Not visible to users.
- `loose-commands/` — Discord slash commands she registers at runtime via `loose_command_create`. Visible to everyone as `/<name>` in the slash menu.

See the [scope-discipline rules](../README.md#persona) in the main README for what does and doesn't belong in `/kurumi-tools/`.

## Tuning

All knobs are live-overridable from chat (owner only, via `config_set <key> <value>`). Env vars below are *boot defaults* — `/state/kurumi-config.json` overrides them.

### Required env

| Var | Default | Purpose |
|---|---|---|
| `KURUMI_BOT_TOKEN` | — | Discord bot token. |
| `KURUMI_OWNERS` | — | Comma-separated Discord user IDs with full unconditional access. |

### Common env

| Var | Default | Purpose |
|---|---|---|
| `KURUMI_FOUNDER_ROLE` | `Founder` | Substring (case-insensitive) match on role name to grant founder tier. |
| `KURUMI_AUTO_RESPOND_PATTERNS` | `kurumi` | Comma-separated channel/category name substrings that trigger auto-engage. |
| `KURUMI_TIMEOUT_MS` | `300000` | Hard kill on claude subprocess after 5 min. |
| `KURUMI_HISTORY_LINES` | `10` | How many recent channel messages to inject into each prompt's context. |
| `KURUMI_WORKSPACE` | `/workspace` | Claude Code working directory. |
| `KURUMI_SESSIONS_FILE` | `/state/sessions.json` | Where channel→session map is persisted. |
| `CLAUDE_BIN` | `claude` | Path to claude CLI (installed globally in the image). |
| `IS_SANDBOX` | `1` | Required so claude-code allows running as root in the container. |

### LLM backend env

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_BASE_URL` | — | When set, points claude-code at a custom Anthropic-compatible endpoint (Z.AI / GLM, OpenRouter shim, LiteLLM, vLLM, etc.). |
| `ANTHROPIC_AUTH_TOKEN` | — | Token for the custom endpoint. Sent as `ANTHROPIC_AUTH_TOKEN`; `ANTHROPIC_API_KEY` is auto-cleared from env when base URL is set. |
| `ANTHROPIC_SMALL_FAST_MODEL` | — | Override claude-code's internal cheap-model slot (compaction, edits). |
| `ANTHROPIC_API_KEY` | — | Fallback when neither OAuth nor base URL is configured. Avoid — see the warning in the main README. |

### Tooling env

| Var | Default | Purpose |
|---|---|---|
| `GH_TOKEN` | — | Authenticates `gh` (GitHub CLI) inside the container. Without it `gh` works anonymously for public-repo reads. |

### Runtime config (chat-managed only; no env var equivalent)

Set via `config_set <key> <value>` from owner messages. Lives in `/state/kurumi-config.json`:

| Key | Default | Purpose |
|---|---|---|
| `model` | `claude-haiku-4-5` | LLM model used for replies. Free-form string when using a custom endpoint. |
| `effort` | `medium` | Thinking/reasoning effort (auto-skipped on haiku). |
| `personaAddendum` | `""` | Extra prompt text appended to `SYSTEM_APPEND`. |
| `presenceStatus` | `dnd` | Discord presence: `online`, `idle`, `dnd`, `invisible`. Re-asserted every 60s + after every typing call. |
| `presenceActivityType` | `Watching` | `Playing`, `Streaming`, `Listening`, `Watching`, `Competing`. |
| `presenceActivityText` | `the clock tick` | Custom status text. |
| `casualMessageGating` | `true` | Enable the cheap secondary-inference filter in auto-respond zones. |
| `casualMessageGatingModel` | `claude-haiku-4-5` | Model used for the gating call. |
| `cooldownSecondsPerChannel` | `0` | Min seconds between replies in the same channel. |
| `autoRespondMinChars` | `6` | Min message length in an auto-respond zone. |
| `autoRespondChance` | `1` | Probability (0-1) she engages with a qualifying casual message. |
| `maxReplyChars` | `1900` | Per-message cap (Discord limit is 2000). |
| `ignoreOtherBots` | `true` | Whether to ignore bot-authored messages. |
| `mutedChannels` | `[]` | Channel IDs she stays quiet in. |
| `mutedUsers` | `[]` | User IDs she ignores entirely. |

## State files

All persisted in the `kurumistack_kurumi-state` named volume at `/state`:

| File | Purpose |
|---|---|
| `sessions.json` | `{channelId: claudeSessionId}` map for `--resume`. |
| `kurumi-config.json` | Live runtime config (overrides ENV_DEFAULTS). |
| `kurumi-notes.json` | Three-tier memory — `[{id, scope, text, tier, createdAt}]`. |
| `attachments/` | Image attachments downloaded for vision (`Read` tool). |
| `gif-library/` | Saved GIFs (files) + `index.json` with metadata (name, description, tags, source URL). |
| `loose-commands.json` | Dispatch map for runtime slash commands (`{name: {scriptPath, interpreter, guildId, commandId, ...}}`). |
| `active-channels.json` | Recently-active channels + last shutdown timestamp, for goodbye/hello messages around restarts. |

## Architecture inside the container

```
kurumi-chat-bot (this process, Node 22, discord.js v14)
│
├── src/index.js           ← Discord client, intents, MessageCreate/InteractionCreate handlers,
│                            tier resolution, per-channel queue, prompt assembly, presence loop,
│                            restart-aware goodbye/hello, GIF/sticker post-processing
│
├── src/self-mcp.js        ← spawned per-turn for OWNER/FOUNDER as `kurumi-self` MCP server
│                            (admin or self tier depending on caller). Manages config, notes,
│                            mute lists, gif library, loose tools, loose commands.
│
└── (spawns) claude        ← claude-code CLI, per-message subprocess
    │                        invoked with --resume <session>, --model <cfg.model>, --mcp-config <json>
    │
    ├── kurumi-self        ← stdio MCP (self-mcp.js above)
    │
    └── discord-server-bot ← stdio MCP at /opt/discord-server-bot/src/index.js
                              embedded in the image at build time, no docker-in-docker, no socket
```

The `claude` subprocess is what actually generates each reply. The bot process is "just" a Discord adapter + prompt assembler + tool plumber.

## Troubleshooting

- **Container exits with `KURUMI_BOT_TOKEN missing`** — `.env` doesn't exist or doesn't contain the token.
- **Container starts and exits silently with code 0** — usually a bad/revoked bot token. Discord drops the WebSocket, nothing keeps the event loop alive. Check the token in the Discord Dev Portal, regenerate, update `.env`, rebuild.
- **`spawn claude ENOENT`** — `@anthropic-ai/claude-code` didn't install in the image. Rebuild with `docker compose build kurumi-chat-bot`.
- **`Claude configuration file not found at: /root/.claude.json`** — first boot after a fresh volume. The entrypoint normally restores `.claude.json` from the latest backup; if no backup exists, run the login flow: `docker compose --profile login run --rm agent-sdk-login`.
- **`cannot be used with root/sudo privileges`** — `IS_SANDBOX=1` is missing from the env. compose.yml sets it.
- **Bot doesn't respond to @mentions** — Message Content Intent isn't enabled in the Dev Portal, or the bot lacks `Read Messages` perm in that channel.
- **Presence keeps flipping from dnd to online** — should be fixed by the post-typing reassert + 60s background refresh + shardResume re-apply. If it returns, check `docker compose logs` for shard reconnect spam.
- **Founder role not recognized** — role matching is case-insensitive *substring* on `cfg.founderRole` ("Founder" matches `Founder`, `✧ Founder`, `Founder of Time`, etc.). Check `KURUMI_FOUNDER_ROLE` in `.env` and verify the user has the role with `docker compose logs` after they message.
- **`/state/sessions.json` keeps getting wiped** — that's just maintenance noise from rebuilds during development; sessions auto-recreate. To preserve a session across a rebuild explicitly, don't wipe the file.
- **"the clock ticks down — i'm being restarted" repeated rapidly** — that's the rebuild-churn suppression *not* working. Should only fire when the bot was alive >90s before SIGTERM. If you see it on every rebuild, the `bootedAt` timestamp logic broke; check `src/index.js`.
