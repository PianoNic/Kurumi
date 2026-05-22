# kurumi-chat-bot

A Discord bot that bridges chat into the **Claude Code CLI**, themed as Kurumi Tokisaki. Users @mention the bot or reply to it; the bot spawns `claude -p ... --model claude-haiku-4-5 --resume <session>` inside its container and streams the output back into the channel. Each Discord channel gets its own persistent Claude Code session.

This service runs in Docker — orchestrated by the top-level `compose.yml`. For the full stack picture (login flow, shared OAuth volume, MCP server, agent-sdk), see [`../DOCKER.md`](../DOCKER.md).

## 1. Create the Discord bot

Don't reuse the `discord-server-bot` MCP token — keep concerns separate.

1. https://discord.com/developers/applications → **New Application** → name it `KURUMI`.
2. **Bot** tab → Reset Token, copy.
3. **Bot** → enable **MESSAGE CONTENT INTENT** (this bot needs to read message text to know what to respond to).
4. **OAuth2 → URL Generator** → scopes: `bot`. Permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`, `Embed Links`. Open the URL and invite the bot to your guild.

## 2. Configure

```powershell
cd C:\Coding\KurumiStack\kurumi-chat-bot
copy .env.example .env
notepad .env
```

Paste the bot token into `KURUMI_BOT_TOKEN`.

## 3. Run

Assumes you've already done the one-time `/login` flow described in [`../DOCKER.md`](../DOCKER.md) so the shared `kurumistack_claude-config` volume has an OAuth token in it.

```powershell
cd C:\Coding\KurumiStack
docker compose up -d kurumi-chat-bot
docker compose logs -f kurumi-chat-bot
```

You should see `Kurumi online as ...`. In Discord, in any channel the bot can see, try:

> @KURUMI what files are in this workspace?

The bot replies with `🕰 consulting the clock...`, then streams Claude's response, editing the message live.

## How conversations work

- Each **Discord channel** gets its own Claude Code session ID, persisted in `sessions.json` inside the `kurumistack_kurumi-state` volume.
- First message in a channel: starts a new Claude Code session.
- Follow-up messages (@mention or reply to the bot): resume that channel's session with `--resume <id>`.
- Reset a channel's memory: `docker compose exec kurumi-chat-bot rm /state/sessions.json` and restart the container.

## Working directory

Claude Code runs inside `/workspace`, which is bind-mounted from `./kurumi-workspace/` on the host. Files created by one channel are visible to the next. The bot uses `--permission-mode bypassPermissions`, so Claude can freely read/write/run-bash within that folder — **don't bind-mount your real source tree here.**

## Triggers

- @mention the bot
- Reply to one of the bot's messages

It ignores all other messages, including its own and other bots'.

## Tuning

Set these in `kurumi-chat-bot/.env`:

| Env var | Default | What it does |
|---|---|---|
| `KURUMI_BOT_TOKEN` | — | Required. Discord token for the chat bot. |
| `KURUMI_WORKSPACE` | `/workspace` | Project dir inside the container Claude Code runs in. Bind-mounted from `./kurumi-workspace/` on host. |
| `KURUMI_SESSIONS_FILE` | `/state/sessions.json` | Where the channel→session map is persisted. |
| `KURUMI_MODEL` | `claude-haiku-4-5` | Anthropic model. Don't change to Opus unless you mean it. |
| `CLAUDE_BIN` | `claude` | Path to claude CLI binary (installed globally in the image). |
| `KURUMI_TIMEOUT_MS` | `300000` | Kill a hung run after 5 min. |

## Troubleshooting

- **Container exits with `KURUMI_BOT_TOKEN missing`** — `kurumi-chat-bot/.env` doesn't exist or doesn't contain the token. Copy from `.env.example`.
- **`spawn claude ENOENT`** — Should never happen inside the container, but if it does, the image build skipped installing `@anthropic-ai/claude-code` globally. Rebuild.
- **Auth error / "not logged in"** — the shared `kurumistack_claude-config` volume is empty or expired. Re-run `docker compose --profile login run --rm agent-sdk-login`.
- **Bot doesn't respond to @mentions** — Message Content Intent isn't enabled, or the bot lacks `Read Messages` perm in that channel.
- **Replies hit "already thinking"** — only one in-flight conversation per channel. Wait for it to finish.
