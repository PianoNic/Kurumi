# KurumiStack

Three glued-together pieces for running **Claude Code** against **Discord**, all in Docker:

| Piece | What it does |
|---|---|
| [`src/`](src/) — `discord-server-bot` | An **MCP server** that gives Claude Code tools to provision Discord servers: create categories, channels, roles, permission overwrites, apply declarative server templates. Claude Code launches it on demand via [`.mcp.json`](.mcp.json). |
| [`kurumi-chat-bot/`](kurumi-chat-bot/) | A long-running Discord bot themed as Kurumi Tokisaki. @mention it (or reply to it) and it spawns the Claude Code CLI to answer, streaming the response back into the channel. Each channel keeps its own persistent session. See [`kurumi-chat-bot/README.md`](kurumi-chat-bot/README.md). |
| [`agent-sdk/`](agent-sdk/) | Minimal **Claude Agent SDK** hello-world, authenticated via your Claude Max subscription (OAuth), running in Docker. Doubles as the smoke-test for the shared OAuth volume. See [`agent-sdk/README.md`](agent-sdk/README.md). |

All three share one OAuth login (the `kurumistack_claude-config` Docker volume), so `claude /login` once and both the chat bot and the agent-sdk demo can use your subscription.

## Quick start

Full walk-through is in [`DOCKER.md`](DOCKER.md). The short version:

```powershell
git clone <this-repo> C:\Coding\KurumiStack
cd C:\Coding\KurumiStack

# 1. Create the two .env files from examples
copy .env.example .env                                  # paste DISCORD_BOT_TOKEN
copy kurumi-chat-bot\.env.example kurumi-chat-bot\.env  # paste KURUMI_BOT_TOKEN
notepad .env
notepad kurumi-chat-bot\.env

# 2. Build everything
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
docker compose --profile agent --profile build-only build

# 3. One-time Claude Code OAuth (writes token into the shared volume)
docker compose --profile login run --rm agent-sdk-login
#   inside the container:  /login → finish in browser → /exit

# 4. Smoke-test the SDK
docker compose --profile agent run --rm agent-sdk

# 5. Start the chat bot
docker compose up -d kurumi-chat-bot
docker compose logs -f kurumi-chat-bot
```

The MCP server (`discord-server-bot`) is built by step 2 but **not** started by `up` — Claude Code launches it on demand via `docker run -i` whenever a tool call is needed. Just (re)start Claude Code in this directory and it'll pick up the MCP server from `.mcp.json`.

## Discord bots — you need two

- **`DISCORD_BOT_TOKEN`** (root `.env`) — used by the MCP server to act on guilds. Invite this bot with `Administrator` (or at minimum `Manage Channels` + `Manage Roles` + `Manage Server`).
- **`KURUMI_BOT_TOKEN`** (`kurumi-chat-bot/.env`) — used by the chat bot. Requires the **Message Content Intent** enabled in the Developer Portal. Invite with `Read Messages`, `Send Messages`, `Read Message History`, `Embed Links`.

Two separate Discord applications. Don't share the token.

## ANTHROPIC_API_KEY warning

This stack uses your **Claude Max subscription** via OAuth, not API credits. If `ANTHROPIC_API_KEY` is set in the shell you build/run from, the Agent SDK will silently bill against API credits instead. The compose file does not forward it, but keep it out of your shell anyway. `agent-sdk/src/agent.ts` asserts it on startup.

## Repo layout

```
KurumiStack/
├── compose.yml              # orchestrates all services, project name = kurumistack
├── Dockerfile               # discord-server-bot image
├── .mcp.json                # how Claude Code launches the MCP server
├── .env.example             # DISCORD_BOT_TOKEN
├── DOCKER.md                # the actual operational doc
├── src/                     # MCP server source (discord-server-bot)
│   ├── index.js
│   └── list-guilds.js
├── kurumi-chat-bot/         # Discord chat bot
│   ├── Dockerfile
│   ├── src/index.js
│   └── .env.example         # KURUMI_BOT_TOKEN
├── agent-sdk/               # Agent SDK hello-world
│   ├── Dockerfile
│   ├── src/agent.ts
│   └── tsconfig.json
└── kurumi-workspace/        # bind-mounted into kurumi-chat-bot at /workspace
```

## MCP tools surfaced to Claude Code

Once the `discord-server-bot` image is built and Claude Code is restarted in this directory, the following tools become available:

- `mcp__discord-server-bot__list_guilds`
- `mcp__discord-server-bot__get_guild_info`
- `mcp__discord-server-bot__list_permissions`
- `mcp__discord-server-bot__create_category`
- `mcp__discord-server-bot__create_channel`
- `mcp__discord-server-bot__update_channel`
- `mcp__discord-server-bot__delete_channel`
- `mcp__discord-server-bot__set_channel_permissions`
- `mcp__discord-server-bot__create_role`
- `mcp__discord-server-bot__update_role`
- `mcp__discord-server-bot__delete_role`
- `mcp__discord-server-bot__update_guild`
- `mcp__discord-server-bot__send_message`
- `mcp__discord-server-bot__apply_template`

`apply_template` is the high-leverage one — declaratively create roles/categories/channels in one call, idempotent on name.

### Example prompt

> "Set up a gaming community server in guild `123456789012345678`: roles Admin (red, hoisted), Mod (blue), Member; categories `INFO` (read-only for @everyone) with #rules and #announcements, `CHAT` with #general and #off-topic, `VOICE` with two voice channels."

Claude will call `apply_template` with a structured config and create everything in one shot.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local setup, pre-push checks, and where to make changes.

## License

[MIT](LICENSE) — see `LICENSE` for the full text. Replace the copyright holder line with your name/handle before publishing if you want.
