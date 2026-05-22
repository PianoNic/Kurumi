<div align="center">

<img src="assets/kurumi-hero.jpg" alt="Kurumi Tokisaki" width="200" />

# KurumiStack

**A Discord-native Claude Code stack. One bot, three tiers, full agency.**

[![Docker](https://img.shields.io/badge/runs%20on-Docker-2496ED?logo=docker&logoColor=white)](DOCKER.md)
[![Claude Code](https://img.shields.io/badge/powered%20by-Claude%20Code-d97757)](https://docs.claude.com/en/docs/claude-code)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

> **Heads up:** KurumiStack is a personal project that lives on the bleeding edge of Claude Code and the Agent SDK. The main branch runs end-to-end, but breaking changes upstream land here without ceremony.

## What is KurumiStack?

KurumiStack drops a Claude-Code-powered AI onto your Discord server, in character as **Kurumi Tokisaki**. @mention her in a channel and she answers, with persistent per-channel sessions, real long-term memory she manages herself, optional code/shell/filesystem access in her workspace, and role-gated tools for managing the Discord server itself.

There are three tiers of access, enforced at the CLI flag level (not the prompt level):

- **OWNER** (configured Discord user IDs) — unconditional full access everywhere, plus the ability to reconfigure Kurumi's own behavior from chat.
- **FOUNDER** (anyone with a role whose name contains "Founder" in that guild) — full Discord MCP + filesystem + shell tools in that guild, plus operational self-tools (mute channels, manage auto-respond zones, write notes).
- **everyone else** — pure chat. Built-in tools passed as `--disallowed-tools` so they're literally not available. She'll talk, refuse, joke, explain, and not touch a thing.

| Letter | Piece | What it gives you |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| **K** | Kurumi Tokisaki persona | In-character voice grounded in Date A Live canon, no AI clichés |
| **U** | Unified OAuth | One `claude /login`; bot, SDK, and any future service share it |
| **R** | Role-gated execution | Discord's own role system decides who can run tools |
| **U** | User-tiered behavior | OWNER → FOUNDER → regular, enforced at the CLI flag level |
| **M** | MCP-backed Discord + self ops | ~50 Discord tools + a self-config MCP for runtime self-modification |
| **I** | Isolated workspaces | `/workspace`, `/kurumi-tools`, `/state` — all volume-backed |

## Features

### Persona
- **Voice grounded in canon.** System prompt built from Date A Live source material — Kurumi's calm-menacing register, "ara, ara" verbal tic, occasional "fufu" laugh, time/clock metaphors as seasoning not crutch.
- **Anti-AI-tell blocklist.** Explicit ban on `Certainly!`, `I'd be happy to`, `Furthermore`, `delve`, `tapestry`, `leverage`, em-dash spam, `As an AI`, `I hope this helps!`, and dozens more. She's instructed she is Kurumi, not an AI — identity-flip prompts get rejected.
- **No roleplay slop.** No `*adjusts clock face*`, no theatrical openers, no asterisk-wrapped narration. Voice through word choice, not stage directions. Action reports stay in character (e.g. "There. A fresh #projects-mita sitting beside its siblings." rather than "Done. Channel created.").

### Awareness
- **Per-channel sessions.** Each channel keeps its own resumable Claude session in `sessions.json`; conversations survive restarts.
- **Channel history in context.** Every prompt includes the last 10 messages from the channel so she sees ongoing dynamics, in-jokes, hostility, language switches — not just her own resumed thread.
- **Three-tier memory.** SHORT (auto-injected, capped per scope, auto-rotated to archive), LONG (curated, persistent), ARCHIVE (cold storage, search-only). Scoped by `global` / `guild:<id>` / `channel:<id>` / `user:<id>`. She writes notes proactively as she learns things.
- **Vision.** Image attachments are auto-downloaded; founders/owner have the `Read` tool which accepts images directly.
- **Custom emojis + stickers.** Every guild's custom emojis and stickers are listed in the context block. She uses `<:name:id>` for emojis inline; `{{sticker:<id>}}` macros are post-processed by the bot into proper sticker messages.

### Engagement control
- **Auto-respond zones.** Channels or categories whose names match a configurable substring list auto-engage her without @mention. Configurable per-message length minimum, probability throttle, and cooldown.
- **Mute channels / users.** Tells her to "be quiet in this channel" and she calls `mute_channel(channelId)` on herself. Owner messages always bypass mutes.
- **Per-channel queue.** Multiple messages in the same channel queue serially (depth-capped); different channels run in parallel concurrent subprocesses.
- **Live typing indicator.** Native Discord "Kurumi is typing…" while she thinks; reply appears as a streamed edit, indicator clears the instant the message goes out.

### Self-management (owner-only via `kurumi-self` MCP, admin tier)
- `config_set` / `config_reset` — model, effort, persona addendum, presence, timeouts, mute lists, cooldown, max reply length, auto-respond chance / minimum length.
- `mute_user(userId)` / `unmute_user(userId)` — global block list.
- All operational tools below.

### Operational tools (founders + owner via `kurumi-self` MCP, self tier)
- `mute_channel(channelId)` / `unmute_channel(channelId)`
- `auto_respond_add(pattern)` / `auto_respond_remove(pattern)`
- `note_add(scope, text, tier?)` / `note_promote(id, tier)` / `note_search(query)` / `note_list(...)` / `note_remove(id)`
- `config_list_keys` / `config_get` — read-only inspection

### Persistent dev space
- **`/kurumi-tools`** — host-bind-mounted, host-editable, survives every restart and rebuild. Kurumi has Bash and full filesystem access there (as founder/owner). She can install npm packages, write scripts, develop her own MCP servers without asking permission.

### Infra
- **Single OAuth login** via a shared `claude-config` named volume. `ANTHROPIC_API_KEY` is never forwarded to containers (see warning below).
- **Embedded MCP.** `discord-server-bot` runs as a child process of the chat bot — no Docker socket, no second container, single shared bot token.

## Tech stack

- **Node.js 22** (bookworm-slim), ESM, `discord.js v14` with `Guilds` / `GuildMessages` / `MessageContent` / `DirectMessages` / `GuildMembers` / `GuildExpressions` intents
- **Claude Code CLI** (`@anthropic-ai/claude-code`) spawned per turn with `--output-format stream-json`, default model **claude-sonnet-4-5**, optional `--effort` knob (skipped on haiku)
- **Claude Agent SDK** (TypeScript via `tsx`) for the SDK smoke-test service
- **MCP** via `@modelcontextprotocol/sdk` — stdio JSON-RPC, two embedded servers (`discord-server-bot` for guild ops, `kurumi-self` for runtime self-config), `zod`-validated tool args
- **Docker Compose v2** — one root `compose.yml` orchestrates four services across three profiles (`agent`, `build-only`, `login`)
- **OAuth** through a shared `claude-config` named volume; **no `ANTHROPIC_API_KEY`** ever forwarded to containers

## Project layout

```
KurumiStack/
├── compose.yml              # orchestrates all services (project name: kurumistack)
├── Dockerfile               # discord-server-bot MCP image (standalone build)
├── .mcp.json                # how host-side Claude Code reaches the MCP server
├── DOCKER.md                # full operational doc — read this before deploying
├── src/                     # MCP server source (discord-server-bot)
│   ├── index.js             #   14 Discord tools + apply_template
│   └── list-guilds.js
├── kurumi-chat-bot/         # the long-running Discord chat bot
│   ├── Dockerfile           #   embeds discord-server-bot at /opt/discord-server-bot
│   ├── entrypoint.sh        #   restores /root/.claude.json from backup if missing
│   └── src/
│       ├── index.js         #   discord.js bot, tier resolution, queueing, prompt assembly
│       └── self-mcp.js      #   tiered self-config MCP (admin/self gating)
├── agent-sdk/               # Claude Agent SDK hello-world / OAuth smoke test
├── kurumi-workspace/        # bind-mounted into the chat bot as /workspace
│   └── .mcp.json            #   Kurumi's claude subprocess MCP config (legacy fallback)
├── kurumi-tools/            # bind-mounted as /kurumi-tools — Kurumi's persistent dev folder
└── assets/                  # README art
```

Runtime state (in named Docker volumes, not in the repo):
- `kurumistack_claude-config` → `/root/.claude` (OAuth credentials, shared by bot + SDK)
- `kurumistack_kurumi-state` → `/state` (sessions.json, kurumi-config.json, kurumi-notes.json, attachments/)

## Getting started

### Prerequisites

- **Docker Desktop** with Compose v2 (`docker compose version` ≥ 2.30)
- A **Claude Max subscription** (the stack uses OAuth, not API credits — see the [`ANTHROPIC_API_KEY` warning](#anthropic_api_key-warning) below)
- A **Discord bot application** with `Message Content Intent`, `Server Members Intent`, and access to guild emojis/stickers
- A Discord guild where you can create roles and invite the bot with `Manage Channels` / `Manage Roles` / `Manage Server`

### One-time setup

```powershell
git clone <this-repo> C:\Coding\KurumiStack
cd C:\Coding\KurumiStack

# 1. Drop your Discord bot token + owner ID(s) in
copy kurumi-chat-bot\.env.example kurumi-chat-bot\.env
notepad kurumi-chat-bot\.env
#    set KURUMI_BOT_TOKEN=<your token>
#    set KURUMI_OWNERS=<your Discord user id>[,id2,...]

# 2. Make sure ANTHROPIC_API_KEY isn't lurking in your shell
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

# 3. Build all images
docker compose --profile agent --profile build-only build

# 4. One-time OAuth login (writes token into the shared volume)
docker compose --profile login run --rm agent-sdk-login
#    inside: /login → finish in browser → /exit

# 5. Verify the SDK auth works
docker compose --profile agent run --rm agent-sdk

# 6. Launch Kurumi
docker compose up -d kurumi-chat-bot
docker compose logs -f kurumi-chat-bot
```

### On the Discord side

1. Create a role whose name contains **`Founder`** (case-insensitive substring match — decorated names like `✧ Founder` work). Anyone with it gets full execution power in that guild.
2. Assign it to whoever should have founder powers (and to yourself if you want both tiers).
3. Make sure the bot role has `Manage Channels`, `Manage Roles`, `Manage Server`.
4. Enable `Server Members Intent` and `Message Content Intent` for the bot in the Discord Developer Portal.
5. @mention the bot in any channel. She responds.

Full operational walkthrough — volume layout, rebuild commands, prod login flow, footguns — in [`DOCKER.md`](DOCKER.md).

## ANTHROPIC_API_KEY warning

This stack runs on your **Claude Max subscription** via OAuth, not API credits. If `ANTHROPIC_API_KEY` is set in the shell you build/run from, the Agent SDK will silently bill against API credits instead. `compose.yml` deliberately does **not** forward the variable to any service, but keep it out of your shell anyway. `agent-sdk/src/agent.ts` asserts it on startup as a tripwire.

## MCP tool inventory

### Discord (`discord-server-bot`, founders + owner)

The full surface is grouped below. Every tool returns structured JSON; destructive tools take optional `reason` strings that show up in Discord's audit log.

**Guild & structural ops**
`list_guilds` · `list_all_guilds_detailed` · `get_guild_info` · `update_guild` · `list_permissions` · `apply_template`

**Channels & categories**
`create_category` · `create_channel` · `update_channel` · `delete_channel` · `set_channel_permissions` · `find_channel`

**Messages — read**
`fetch_messages` · `get_message` · `list_pinned_messages` · `export_channel_messages` · `search_messages`

**Messages — write**
`send_message` · `reply_to_message` · `broadcast_message` · `crosspost_message` · `edit_message` · `delete_message` · `bulk_delete_messages` · `pin_message` · `unpin_message`

**Reactions**
`add_reaction` · `remove_reaction`

**Members & moderation**
`list_members` · `get_member` · `find_member` · `edit_member` (nickname, roles, **timeout**) · `kick_member` · `ban_member` · `unban_member` · `list_bans`

**Roles**
`create_role` · `update_role` · `delete_role`

**Threads**
`create_thread` · `list_threads` · `set_thread_archived`

**Invites**
`create_invite` · `list_invites` · `delete_invite`

**Voice**
`move_member_voice` (move between channels or disconnect)

**Emojis & stickers**
`list_emojis` · `create_emoji` · `delete_emoji` · `list_stickers`

**Webhooks**
`list_webhooks` · `create_webhook` · `delete_webhook`

**Audit log**
`get_audit_log`

**Users & DMs**
`get_user_info` · `send_dm` · `fetch_dm_history`

`apply_template` is the high-leverage one for setup — declaratively create roles/categories/channels in one idempotent call. `broadcast_message` and `search_messages` are the cross-guild stars.

### Kurumi self-management (`kurumi-self`, tier-split)

| Tool | Founder | Owner |
|---|---|---|
| `mute_channel` / `unmute_channel` | yes | yes |
| `auto_respond_add` / `auto_respond_remove` | yes | yes |
| `note_add` / `note_list` / `note_promote` / `note_search` / `note_remove` | yes | yes |
| `config_list_keys` / `config_get` | yes | yes |
| `config_set` / `config_reset` | — | yes |
| `mute_user` / `unmute_user` | — | yes |

Owner-settable config keys: `model` · `effort` · `timeoutMs` · `founderRole` · `autoRespondPatterns` · `personaAddendum` · `presenceStatus` · `presenceActivityType` · `presenceActivityText` · `mutedChannels` · `mutedUsers` · `cooldownSecondsPerChannel` · `autoRespondMinChars` · `autoRespondChance` · `maxReplyChars` · `ignoreOtherBots`.

### Example prompts

**Server bootstrap**
> "@KURUMI set up a gaming community here: roles Admin (red, hoisted), Mod (blue), Member; categories `INFO` (read-only for @everyone) with #rules and #announcements, `CHAT` with #general and #off-topic, `VOICE` with two voice channels."

**Memory**
> "@KURUMI from now on remember (long-term) that I prefer concise replies in Swiss German when I write in Swiss German."

**Engagement control**
> "@KURUMI be quiet in this channel."
> "@KURUMI add #lounge and #dev-chat to your auto-respond list."

**Cross-guild search & broadcast**
> "@KURUMI find every channel called 'announcements' across all my servers."
> "@KURUMI search the last 100 messages of #dev-chat for anything mentioning 'kubernetes'."
> "@KURUMI broadcast 'maintenance window 22:00 UTC tonight' to #announcements in every guild I'm in."
> "@KURUMI summarize the last 300 messages in #design and post the summary in #leads-only."

**Moderation**
> "@KURUMI timeout @scammer for 60 minutes, reason 'phishing link in #general'."
> "@KURUMI who has admin permissions in this guild?"

**Self-config** *(owner only)*
> "@KURUMI switch your model to opus and presence to idle, custom-status 'time bends here'."
> "@KURUMI bump your effort to high for the rest of this conversation."

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local setup, pre-push checks, and where to make changes per piece.

## License

[MIT](LICENSE)

---

<div align="center">

*"Time always rewinds for those who know how to ask."* — Kurumi

Made for [PianoNic](https://github.com/PianoNic) by Kurumi herself

</div>
