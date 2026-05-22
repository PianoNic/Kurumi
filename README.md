<div align="center">

<img src="assets/kurumi-hero.jpg" alt="Kurumi Tokisaki" width="200" />

# KurumiStack

**A Discord-native Claude Code stack. One bot, one OAuth, full agency.**

[![Docker](https://img.shields.io/badge/runs%20on-Docker-2496ED?logo=docker&logoColor=white)](DOCKER.md)
[![Claude Code](https://img.shields.io/badge/powered%20by-Claude%20Code-d97757)](https://docs.claude.com/en/docs/claude-code)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

> **Heads up:** KurumiStack is a personal project that lives on the bleeding edge of Claude Code and the Agent SDK. The main branch runs end-to-end, but breaking changes upstream land here without ceremony.

## What is KurumiStack?

KurumiStack is a three-piece Docker stack that drops a Claude-Code-powered AI onto your Discord server, in character as **Kurumi Tokisaki**. @mention her in a channel and she answers, with a persistent session per channel, optional code/shell/filesystem access in her workspace, and role-gated tools for managing the Discord server itself.

Founders get the full operator — she can create channels, edit roles, apply server templates. Everyone else gets the same Kurumi, but in chat-only mode: she'll talk, refuse, joke, explain, and not touch a thing.

| Letter | Piece | What it gives you |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| **K** | Kurumi Tokisaki persona | In-character voice grounded in Date A Live canon, no AI clichés |
| **U** | Unified OAuth | One `claude /login`; both the chat bot and the Agent SDK share it |
| **R** | Role-gated execution | Discord's own `Founder` role decides who can run tools |
| **U** | User-tiered behavior | Founders execute, everyone else chats — enforced at the CLI level |
| **M** | MCP-backed Discord ops | 14 server tools (channels, roles, templates) embedded in-process |
| **I** | Isolated workspace | All filesystem/shell work happens in a bind-mounted `/workspace` |

## Features

- **Two-tier permissions, no honor system.** Founders get full MCP + filesystem + shell tools, with permission prompts bypassed. Non-founders get a pure chat session — built-in tools are passed as `--disallowed-tools` to the underlying `claude` CLI, so they're literally not available to be misused.
- **Per-channel memory.** Each Discord channel keeps its own resumable session in `sessions.json`. Conversations survive container restarts; new channel = clean slate.
- **Discord MCP server, embedded.** `discord-server-bot` (14 tools: list/create/update/delete channels, roles, categories, permissions, plus declarative `apply_template`) runs as a child process of the chat bot. No Docker socket, no second container, single shared bot token.
- **In-character voice.** System prompt grounded in Kurumi's actual canon (Date A Live, "Worst Spirit"). Explicit blocklist of AI tells (`Certainly!`, `delve`, `I hope this helps!`, em-dash spam, "As an AI", etc).
- **No roleplay slop.** No `*adjusts clock face*`, no theatrical openers, no asterisk-wrapped narration. Voice through word choice, not stage directions.
- **Live typing indicator.** Native Discord "Kurumi is typing…" while she thinks; reply appears as a streamed edit, indicator clears the instant the message goes out.
- **Single login covers everything.** `claude /login` once → token sits in a shared Docker volume → chat bot, Agent SDK demo, and any future Claude-Code-using service all authenticate from the same OAuth.
- **Founder roster auto-resolved.** No env list to maintain — the bot reads the live Discord role on every message. Decorated names (`✧ Founder`, `Founder ⭐`) match by substring.

## Screenshots

<div align="center">

*(coming soon — channel screenshots, MCP tool flow, server template in action)*

</div>

## Tech stack

- **Node.js 22** (bookworm-slim), ESM, `discord.js v14`
- **Claude Code CLI** (`@anthropic-ai/claude-code`) spawned per turn with `--output-format stream-json`
- **Claude Agent SDK** (TypeScript via `tsx`) for the SDK smoke-test service
- **MCP** via `@modelcontextprotocol/sdk` — stdio JSON-RPC, embedded in the chat-bot image
- **Docker Compose v2** — one root `compose.yml` orchestrates four services across three profiles (`agent`, `build-only`, `login`)
- **OAuth** through a shared `claude-config` named volume; **no `ANTHROPIC_API_KEY`** ever forwarded to containers (Claude Max subscription only)

## Project layout

```
KurumiStack/
├── compose.yml              # orchestrates all services (project name: kurumistack)
├── Dockerfile               # discord-server-bot MCP image (standalone build)
├── .mcp.json                # how host-side Claude Code reaches the MCP server
├── DOCKER.md                # full operational doc — read this before deploying
├── src/                     # MCP server source (discord-server-bot)
│   ├── index.js             #   14 Discord tools + apply_template
│   └── list-guilds.js       #   standalone helper
├── kurumi-chat-bot/         # the long-running Discord chat bot
│   ├── Dockerfile           #   embeds the MCP server at /opt/discord-server-bot
│   ├── entrypoint.sh        #   restores /root/.claude.json from backup if missing
│   └── src/index.js         #   discord.js bot, founder gating, in-character prompt
├── agent-sdk/               # Claude Agent SDK hello-world / OAuth smoke test
│   ├── Dockerfile
│   └── src/agent.ts
├── kurumi-workspace/        # bind-mounted into the chat bot as /workspace
│   └── .mcp.json            #   Kurumi's claude subprocess uses this MCP config
└── assets/                  # README art
```

## Getting started

### Prerequisites

- **Docker Desktop** with Compose v2 (`docker compose version` ≥ 2.30)
- A **Claude Max subscription** (the stack uses OAuth, not API credits — see the [`ANTHROPIC_API_KEY` warning](#anthropic_api_key-warning) below)
- A **Discord bot application** with `Message Content Intent` and `Server Members Intent` enabled
- A Discord guild where you can create roles and invite the bot with `Manage Channels` / `Manage Roles` / `Manage Server`

### One-time setup

```powershell
git clone <this-repo> C:\Coding\KurumiStack
cd C:\Coding\KurumiStack

# 1. Drop your Discord bot token in
copy kurumi-chat-bot\.env.example kurumi-chat-bot\.env
notepad kurumi-chat-bot\.env   # set KURUMI_BOT_TOKEN

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

1. Create a role named **`Founder`** (or any role whose name contains the word — case-insensitive). Anyone with it gets the destructive MCP tools attached to their session.
2. Assign it to yourself.
3. Make sure the KURUMI bot role itself has `Manage Channels`, `Manage Roles`, `Manage Server`.
4. @mention `KURUMI` in any channel. She responds.

Full operational walkthrough — volume layout, rebuild commands, prod login flow, footguns — in [`DOCKER.md`](DOCKER.md).

## ANTHROPIC_API_KEY warning

This stack runs on your **Claude Max subscription** via OAuth, not API credits. If `ANTHROPIC_API_KEY` is set in the shell you build/run from, the Agent SDK will silently bill against API credits instead. `compose.yml` deliberately does **not** forward the variable to any service, but keep it out of your shell anyway. `agent-sdk/src/agent.ts` asserts it on startup as a tripwire.

## MCP tools surfaced to founders

Once Kurumi is running and the requester holds the founder role, her `claude` subprocess loads `kurumi-workspace/.mcp.json` and the following tools become available:

`list_guilds` · `get_guild_info` · `list_permissions` · `create_category` · `create_channel` · `update_channel` · `delete_channel` · `set_channel_permissions` · `create_role` · `update_role` · `delete_role` · `update_guild` · `send_message` · `apply_template`

`apply_template` is the high-leverage one — declaratively create roles/categories/channels in one idempotent call.

### Example prompt

> "@KURUMI set up a gaming community here: roles Admin (red, hoisted), Mod (blue), Member; categories `INFO` (read-only for @everyone) with #rules and #announcements, `CHAT` with #general and #off-topic, `VOICE` with two voice channels."

She'll call `list_guilds` to resolve the current guild, then `apply_template` to materialize the whole thing.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local setup, pre-push checks, and where to make changes per piece.

## License

[MIT](LICENSE)

---

<div align="center">

*"Time always rewinds for those who know how to ask."* — Kurumi

Made for [PianoNic](https://github.com/PianoNic) by Kurumi herself

</div>
