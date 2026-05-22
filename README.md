<div align="center">

<img src="assets/kurumi-hero.jpg" alt="Kurumi Tokisaki" width="200" />

# KurumiStack

**A Discord-native Claude Code stack. One bot, three tiers, runtime-extensible, in character.**

[![Docker](https://img.shields.io/badge/runs%20on-Docker-2496ED?logo=docker&logoColor=white)](DOCKER.md)
[![Claude Code](https://img.shields.io/badge/powered%20by-Claude%20Code-d97757)](https://docs.claude.com/en/docs/claude-code)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

> **Heads up:** KurumiStack is a personal project that lives on the bleeding edge of Claude Code and the Agent SDK. The main branch runs end-to-end, but breaking changes upstream land here without ceremony.

## What is KurumiStack?

KurumiStack drops a Claude-Code-powered AI onto your Discord server, in character as **Kurumi Tokisaki**. @mention her in a channel and she answers, with persistent per-channel sessions, real long-term memory she manages herself, optional code/shell/filesystem access in her workspace, role-gated Discord ops, the ability to author and register new slash commands at runtime, save GIFs like reaction stickers, and self-modify her own configuration from chat.

There are three tiers of access, enforced at the CLI flag level (not the prompt level):

- **OWNER** (configured Discord user IDs) — unconditional full access everywhere, plus the ability to reconfigure Kurumi's own behavior, switch LLM backends, and register Discord slash commands.
- **FOUNDER** (anyone with a role whose name contains "Founder" in that guild) — full Discord MCP + filesystem + shell tools in that guild, plus operational self-tools (mute channels, manage auto-respond zones, write notes, save GIFs).
- **everyone else** — pure chat. Built-in tools passed as `--disallowed-tools` so they're literally not available. She'll talk, refuse, joke, explain, and not touch a thing.

| Letter | Piece | What it gives you |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| **K** | Kurumi Tokisaki persona | In-character voice grounded in Date A Live canon, no AI clichés |
| **U** | Unified OAuth | One `claude /login`; bot, SDK, and any future service share it |
| **R** | Role-gated execution | Discord's own role system decides who can run tools |
| **U** | User-tiered behavior | OWNER → FOUNDER → regular, enforced at the CLI flag level |
| **M** | MCP-backed Discord + self ops | ~60 Discord tools + a self-config MCP for runtime self-modification |
| **I** | Isolated workspaces | `/workspace`, `/kurumi-tools`, `/state` — all volume-backed |

## Highlights

- **Pluggable LLM backend.** Default: Anthropic's claude-haiku-4-5 via OAuth. Switch live from chat to **any Anthropic-compatible endpoint** — Z.AI / GLM, OpenRouter via anthropic shim, LiteLLM proxy, local vLLM, etc. No restart needed.
- **Runtime slash commands.** Owner says "make a `/roast` command", Kurumi writes the script and registers it with Discord in one atomic call. Users can type the new command seconds later. No code edits, no rebuild.
- **Runtime internal tools** ("loose tools"). She authors small scripts she can invoke herself between turns — without ever exposing them as user-facing commands.
- **Three-tier memory.** Short (auto-injected, auto-rotated), long (curated), archive (cold/searchable). Scoped to global/guild/channel/user.
- **GIF library.** She downloads, judges, and saves funny GIFs from attachments OR from Tenor/Giphy links — and sends them later like stickers via `{{gif:<id>}}` macros.
- **DMs need no @mention.** Direct her in a DM and she answers; guild channels still gate by @mention or auto-respond zone.
- **Restart-aware messaging.** Posts a goodbye to recently-active channels on shutdown, a return greeting on next boot. Auto-suppresses both during rebuild churn (< 90s) so dev work doesn't spam.
- **Scope discipline baked into the prompt.** Explicit ban on `apt install`, binary downloads, > 2 retries on the same error, > 6 tool calls without checking in. Plus a refusal rule for LLM-flex prompts ("list 100 X", "name every Y") — burns tokens, makes her sound like a chatbot.

## Persona

- **Voice grounded in canon.** System prompt built from Date A Live source material — Kurumi's calm-menacing register, "ara, ara" verbal tic, occasional "fufu" laugh, time/clock metaphors as seasoning not crutch.
- **Anti-AI-tell blocklist.** Explicit ban on `Certainly!`, `I'd be happy to`, `Furthermore`, `delve`, `tapestry`, `leverage`, em-dash spam, `As an AI`, `I hope this helps!`, and dozens more. She's instructed she is Kurumi, not an AI — identity-flip prompts get rejected.
- **No roleplay slop.** No `*adjusts clock face*`, no theatrical openers, no asterisk-wrapped narration. Voice through word choice, not stage directions. Action reports stay in character (e.g. *"There. A fresh #projects-mita sitting beside its siblings."* rather than "Done. Channel created.").
- **Scope discipline.** Hard rules in the prompt against installing system packages, downloading binaries, retrying the same failure > 2 times, taking > 6 tool calls without a status check, and pretending half-built tools are finished.
- **No LLM-flex.** "List every animal alphabetically" / "100 startup ideas" / "50 synonyms" → polite refusal in character. Counter-offers a small focused alternative.

## Awareness

- **Per-channel sessions.** Each channel keeps its own resumable Claude session in `sessions.json`; conversations survive restarts.
- **Channel history in context.** Every prompt includes the last 10 messages from the channel so she sees ongoing dynamics, in-jokes, hostility, language switches — not just her own resumed thread.
- **Three-tier memory.** SHORT (auto-injected, capped per scope, auto-rotated to archive), LONG (curated, persistent), ARCHIVE (cold storage, search-only). Scoped by `global` / `guild:<id>` / `channel:<id>` / `user:<id>`. She writes notes proactively as she learns things.
- **Vision.** Image attachments are auto-downloaded to `/state/attachments/`; founders/owner have the `Read` tool which accepts images directly.
- **Custom emojis + stickers.** Every guild's custom emojis and stickers are listed in the context block. She uses `<:name:id>` for emojis inline; `{{sticker:<id>}}` macros are post-processed into proper sticker messages.
- **GIF library.** Saved GIFs (from attachments or Tenor/Giphy URLs) live in `/state/gif-library/` with metadata (name, description, tags). She sends them with `{{gif:<id>}}` macros — bot uploads as a follow-up file message. Combined cap with stickers: 3 per reply.

## Engagement control

- **Auto-respond zones.** Channels or categories whose names match a configurable substring list auto-engage her without @mention. Configurable per-message length minimum, probability throttle, and cooldown.
- **Casual-message gating.** In auto-respond zones, a *cheap* secondary inference (claude-haiku-4-5 by default) decides whether the casual message warrants a real reply. Filters out Wordle pastes, `lol`, reaction emoji, inter-user banter she'd just clutter. Disable with `casualMessageGating: false`.
- **DMs.** Direct messages bypass @mention and casual-gating entirely — every DM is treated as a direct address.
- **Mute channels / users.** Tells her to "be quiet in this channel" and she calls `mute_channel(channelId)` on herself. Owner messages always bypass mutes.
- **Per-channel queue.** Multiple messages in the same channel queue serially (depth-capped); different channels run in parallel concurrent subprocesses.
- **Live typing indicator.** Native Discord "Kurumi is typing…" while she thinks; reply appears as a streamed edit, indicator clears the instant the message goes out. Presence is force-reasserted after every typing call so DND/idle/etc. don't flip back to "online".

## Runtime extensibility

Two distinct ways to extend Kurumi *without* rebuilding the container or editing any source files.

### Loose tools — internal scripts she calls herself

| Tool | Purpose |
|---|---|
| `loose_tool_create({name, description, interpreter, code, argsHint?})` | Write a script to `/kurumi-tools/loose/<name>.<sh\|js>` + register in `/kurumi-tools/loose/index.json`. |
| `loose_tool_list()` | List everything registered. |
| `loose_tool_run({name, args})` | Execute a registered tool — args are JSON-encoded into argv[2]; stdout returns. 30s timeout, 16KB output cap. |
| `loose_tool_remove({name})` | Delete script + index entry. |

Use cases: a recurring API caller, a custom formatter, a wrapper around an existing CLI. Users never see these — they're for her own internal logic.

### Loose commands — Discord slash commands authored at runtime

| Tool | Purpose |
|---|---|
| `loose_command_create({name, description, interpreter, code, guildId?, options?})` | Atomic three-step: write `/kurumi-tools/loose-commands/<name>.<sh\|js>`, POST to Discord REST to register slash command, persist mapping in `/state/loose-commands.json`. If Discord rejects (bad guild, duplicate name) the script is deleted automatically. |
| `loose_command_list()` | Show all registered loose commands with Discord command IDs. |
| `loose_command_remove({name, guildId?})` | Delete script + Discord registration + dispatch entry. |

Option types supported: `string`, `integer`, `number`, `boolean`, `user`, `channel`, `role`. When a user invokes `/foo bar:baz`, the bot spawns the script with the user's option values + injected `__invokedBy` / `__invokedByTag` / `__channelId` / `__guildId` as a single JSON string on argv[2]. Stdout becomes the reply.

**Loose tools and loose commands are fully separate** — different folders, different index files, different lifecycles. Loose tools are private; loose commands are public.

## Custom LLM endpoint

Default: Anthropic via OAuth, model claude-haiku-4-5. To switch backends:

**From chat (owner only, no restart):**
```
@KURUMI config_set anthropicBaseUrl https://api.z.ai/api/anthropic
@KURUMI config_set anthropicAuthToken <token>
@KURUMI config_set model glm-4.6
@KURUMI config_set smallFastModel glm-4.5-air
```

**From `.env` (survives volume wipes):**
```env
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
ANTHROPIC_AUTH_TOKEN=<token>
ANTHROPIC_SMALL_FAST_MODEL=glm-4.5-air
```

`buildClaudeEnv(cfg)` runs per subprocess spawn: when `anthropicBaseUrl` is set it exports `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` and **deletes** `ANTHROPIC_API_KEY` from the env (Z.AI / some shims reject when both are present). To revert: `config_set anthropicBaseUrl null`.

Model field is a free-form string — any model name your provider accepts works. The same setting drives both the main response and the casual-message gate.

## Pre-installed CLIs

The bot image (`kurumi-chat-bot/Dockerfile`) ships with: `bash`, `node`, `npm`, `git`, `curl`, `gh` (GitHub CLI v2.92.0, authenticated via `GH_TOKEN` if set), and `claude` (Claude Code CLI). Anything beyond this list is a Dockerfile change, not a script — per the scope-discipline rule, Kurumi will refuse to `apt install` or download binaries at runtime.

## Self-management

### Owner only (admin tier via `kurumi-self` MCP)

| Tool | Purpose |
|---|---|
| `config_set` / `config_reset` / `config_list_keys` / `config_get` | All runtime knobs — model, endpoint, presence, persona, timeouts, mute lists, cooldowns, gating, max reply length, etc. |
| `mute_user(userId)` / `unmute_user(userId)` | Global block list. |
| `loose_tool_*` | Internal script registry. |
| `loose_command_*` | Discord slash command registry. |
| All operational tools below. |

### Founder + owner (self tier via `kurumi-self` MCP)

| Tool | Purpose |
|---|---|
| `mute_channel` / `unmute_channel` | Per-channel silence. |
| `auto_respond_add` / `auto_respond_remove` | Manage which channel/category name substrings trigger auto-engage. |
| `note_add` / `note_list` / `note_promote` / `note_search` / `note_remove` | Three-tier memory (short / long / archive). |
| `gif_save` / `gif_save_from_url` / `gif_list` / `gif_search` / `gif_remove` | GIF library — save from local attachments OR scrape Tenor/Giphy view pages (og:image / og:video). |
| `config_list_keys` / `config_get` | Read-only config inspection. |

## Persistent dev space

- **`/kurumi-tools`** — host-bind-mounted from the repo, host-editable, survives every restart and rebuild. Holds:
  - `loose/` — internal loose-tool scripts + `index.json`
  - `loose-commands/` — public loose-command scripts (mapping lives in `/state/loose-commands.json`)
  - `README.md` — policy reminder about what does + does not belong here
- Founders/owner have Bash + Read + Write + Edit inside this folder (rest of FS gated by `--disallowed-tools`). Scope-discipline rules in the system prompt prevent `apt install`, binary downloads, multi-retry rabbit holes.

## Tech stack

- **Node.js 22** (bookworm-slim), ESM, `discord.js v14` with `Guilds` / `GuildMessages` / `MessageContent` / `DirectMessages` / `GuildMembers` / `GuildExpressions` intents
- **Claude Code CLI** (`@anthropic-ai/claude-code`) spawned per turn with `--output-format stream-json`, default model **claude-haiku-4-5**, optional `--effort` knob (auto-skipped on haiku)
- **Claude Agent SDK** (TypeScript via `tsx`) for the SDK smoke-test service
- **MCP** via `@modelcontextprotocol/sdk` — stdio JSON-RPC, two embedded servers (`discord-server-bot` for guild ops, `kurumi-self` for runtime self-config), `zod`-validated tool args
- **GitHub CLI** (`gh`) installed via the official Debian repo for in-script repo / issue / PR operations
- **Docker Compose v2** — one root `compose.yml` orchestrates four services across three profiles (`agent`, `build-only`, `login`)
- **OAuth** through a shared `claude-config` named volume; **no `ANTHROPIC_API_KEY`** ever forwarded to containers

## Project layout

```
KurumiStack/
├── compose.yml              # orchestrates all services (project name: kurumistack)
├── Dockerfile               # discord-server-bot MCP image (standalone build)
├── .mcp.json                # how host-side Claude Code reaches the MCP server
├── DOCKER.md                # full operational doc — read this before deploying
├── src/                     # discord-server-bot MCP source
│   ├── index.js             #   ~60 Discord tools (Guild/Channel/Member/Message/Role/Thread/Invite/...)
│   └── list-guilds.js
├── kurumi-chat-bot/         # the long-running Discord chat bot
│   ├── Dockerfile           #   embeds discord-server-bot at /opt/discord-server-bot, installs gh
│   ├── entrypoint.sh        #   restores /root/.claude.json from backup if missing
│   └── src/
│       ├── index.js         #   discord.js bot, tier resolution, queueing, prompt assembly,
│       │                    #   InteractionCreate dispatch for loose commands, presence loop,
│       │                    #   restart-churn-suppressing goodbye/hello, GIF post-processing
│       └── self-mcp.js      #   tiered self-config MCP — admin (owner) and self (founder+owner)
├── agent-sdk/               # Claude Agent SDK hello-world / OAuth smoke test
├── kurumi-workspace/        # bind-mounted into the chat bot as /workspace
│   └── .mcp.json            #   Kurumi's claude subprocess MCP config (legacy fallback)
├── kurumi-tools/            # bind-mounted as /kurumi-tools — Kurumi's persistent dev folder
│   ├── README.md            #   policy: what belongs / what doesn't
│   ├── loose/               #   internal MCP-callable scripts
│   │   ├── index.json
│   │   └── <name>.{sh,js}
│   └── loose-commands/      #   user-facing Discord slash commands
│       └── <name>.{sh,js}
└── assets/                  # README art
```

Runtime state (named Docker volumes, not in the repo):

| Volume | Path inside container | Contents |
|---|---|---|
| `kurumistack_claude-config` | `/root/.claude` | OAuth credentials, shared by bot + SDK |
| `kurumistack_kurumi-state` | `/state` | `sessions.json` (per-channel resume IDs), `kurumi-config.json` (live config), `kurumi-notes.json` (three-tier memory), `attachments/` (image downloads), `gif-library/` (saved GIFs + index), `loose-commands.json` (dispatch map for runtime slash commands), `active-channels.json` (for goodbye/hello messages around restarts) |

## Getting started

### Prerequisites

- **Docker Desktop** with Compose v2 (`docker compose version` ≥ 2.30)
- A **Claude Max subscription** (the stack uses OAuth, not API credits — see the [`ANTHROPIC_API_KEY` warning](#anthropic_api_key-warning) below) **OR** a custom Anthropic-compatible endpoint
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
#    (optional) GH_TOKEN=ghp_...
#    (optional) ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN for non-Anthropic backends

# 2. Make sure ANTHROPIC_API_KEY isn't lurking in your shell
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

# 3. Build all images
docker compose --profile agent --profile build-only build

# 4. One-time OAuth login (writes token into the shared volume) — skip if using a custom endpoint
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
3. Make sure the bot role has `Manage Channels`, `Manage Roles`, `Manage Server`, plus any moderation perms you want her to have (`Moderate Members` for timeouts, `Ban Members`, `Kick Members`).
4. Enable `Server Members Intent` and `Message Content Intent` for the bot in the Discord Developer Portal.
5. @mention the bot in any channel, or DM her directly. She responds.

Full operational walkthrough — volume layout, rebuild commands, prod login flow, footguns — in [`DOCKER.md`](DOCKER.md).

## ANTHROPIC_API_KEY warning

This stack runs on your **Claude Max subscription** via OAuth by default, not API credits. If `ANTHROPIC_API_KEY` is set in the shell you build/run from, the Agent SDK will silently bill against API credits instead. `compose.yml` deliberately does **not** forward the variable to any service, but keep it out of your shell anyway. `agent-sdk/src/agent.ts` asserts it on startup as a tripwire.

If you're using a **custom endpoint** (Z.AI, OpenRouter, LiteLLM, etc.) this doesn't apply — set `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` and the OAuth flow becomes optional.

## MCP tool inventory

### Discord (`discord-server-bot`, founders + owner)

The full surface is grouped below. Every tool returns structured JSON; destructive tools take optional `reason` strings that show up in Discord's audit log. Bulk-delete tools support `dryRun: true` to preview matches without destroying anything.

**Guild & structural ops**
`list_guilds` · `list_all_guilds_detailed` · `get_guild_info` · `update_guild` · `list_permissions` · `apply_template`

**Channels & categories**
`create_category` · `create_channel` · `update_channel` · `delete_channel` · `set_channel_permissions` · `find_channel` · `bulk_delete_channels` (with `nameContains` / `nameRegex` / `parentId` / `typesInclude` filters)

**Messages — read**
`fetch_messages` · `get_message` · `list_pinned_messages` · `export_channel_messages` · `search_messages`

**Messages — write**
`send_message` · `reply_to_message` · `broadcast_message` · `crosspost_message` · `edit_message` · `delete_message` · `bulk_delete_messages` · `purge_messages` (rich filters: `authorIds`, `contentContains`, `contentRegex`, `botsOnly`, `humansOnly`, `olderThanDays`, `newerThanDays`; crosses Discord's 14-day boundary automatically) · `pin_message` · `unpin_message`

**Reactions**
`add_reaction` · `remove_reaction`

**Members & moderation**
`list_members` · `get_member` · `find_member` (matches username, displayName, nickname, globalName) · `dump_members` (brute-force fallback that returns every cached member from every guild) · `edit_member` (nickname, roles, **timeout**) · `kick_member` · `ban_member` · `unban_member` · `list_bans`

**Roles**
`create_role` · `update_role` · `delete_role` · `bulk_delete_roles` (excludes @everyone and bot/integration roles unless `includeManaged: true`)

**Threads**
`create_thread` · `list_threads` · `set_thread_archived` · `bulk_delete_threads` (filter by `parentChannelId` / `nameContains` / `archivedOnly`)

**Invites**
`create_invite` · `list_invites` · `delete_invite` · `bulk_delete_invites`

**Voice**
`move_member_voice` (move between channels or disconnect)

**Emojis & stickers**
`list_emojis` · `create_emoji` · `delete_emoji` · `list_stickers` · `bulk_delete_emojis`

**Webhooks**
`list_webhooks` · `create_webhook` · `delete_webhook` · `bulk_delete_webhooks`

**Audit log**
`get_audit_log`

**Users & DMs**
`get_user_info` · `send_dm` · `fetch_dm_history`

`apply_template` is the high-leverage one for setup — declaratively create roles/categories/channels in one idempotent call. `broadcast_message` + `search_messages` are the cross-guild stars. `purge_messages` is the daily-use moderation workhorse.

### Kurumi self-management (`kurumi-self`, tier-split)

| Tool | Founder | Owner |
|---|---|---|
| `mute_channel` / `unmute_channel` | ✓ | ✓ |
| `auto_respond_add` / `auto_respond_remove` | ✓ | ✓ |
| `note_add` / `note_list` / `note_promote` / `note_search` / `note_remove` | ✓ | ✓ |
| `gif_save` / `gif_save_from_url` / `gif_list` / `gif_search` / `gif_remove` | ✓ | ✓ |
| `config_list_keys` / `config_get` | ✓ | ✓ |
| `config_set` / `config_reset` | — | ✓ |
| `mute_user` / `unmute_user` | — | ✓ |
| `loose_tool_create` / `loose_tool_list` / `loose_tool_run` / `loose_tool_remove` | — | ✓ |
| `loose_command_create` / `loose_command_list` / `loose_command_remove` | — | ✓ |

**Owner-settable config keys**: `model` · `effort` · `timeoutMs` · `founderRole` · `autoRespondPatterns` · `personaAddendum` · `presenceStatus` · `presenceActivityType` · `presenceActivityText` · `mutedChannels` · `mutedUsers` · `cooldownSecondsPerChannel` · `autoRespondMinChars` · `autoRespondChance` · `maxReplyChars` · `ignoreOtherBots` · `casualMessageGating` · `casualMessageGatingModel` · `anthropicBaseUrl` · `anthropicAuthToken` · `smallFastModel`.

## Example prompts

**Server bootstrap**
> "@KURUMI set up a gaming community here: roles Admin (red, hoisted), Mod (blue), Member; categories `INFO` (read-only for @everyone) with #rules and #announcements, `CHAT` with #general and #off-topic, `VOICE` with two voice channels."

**Memory**
> "@KURUMI from now on remember (long-term) that I prefer concise replies in Swiss German when I write in Swiss German."

**Engagement control**
> "@KURUMI be quiet in this channel."
> "@KURUMI add #lounge and #dev-chat to your auto-respond list."

**Cross-guild discovery & writing**
> "@KURUMI find every channel called 'announcements' across all my servers."
> "@KURUMI search the last 100 messages of #dev-chat for anything mentioning 'kubernetes'."
> "@KURUMI broadcast 'maintenance window 22:00 UTC tonight' to #announcements in every guild I'm in."
> "@KURUMI summarize the last 300 messages in #design and post the summary in #leads-only."

**Moderation**
> "@KURUMI timeout @scammer for 60 minutes, reason 'phishing link in #general'."
> "@KURUMI purge the last 50 messages from @bot-spammer in this channel — dry-run first."
> "@KURUMI delete every channel under the `legacy-2023` category."
> "@KURUMI who has admin permissions in this guild?"

**GIFs**
> *(replying to a Tenor link)* "@KURUMI save that one as a smug reaction."
> "@KURUMI you have a saved GIF for 'celebration' — use it next time someone hits a milestone."

**Loose commands** *(owner only)*
> "@KURUMI build me a `/roast @user` slash command that picks a random playful insult, register it in this guild."
> "@KURUMI add a `/fact` command — outputs one weirdly specific fact from your hand-picked list."
> "@KURUMI remove `/madlibs` and its script."

**Self-config** *(owner only)*
> "@KURUMI switch your backend to glm-4.6 — base url https://api.z.ai/api/anthropic, token starts with sk-..."
> "@KURUMI bump your presence to dnd, custom-status 'time bends here'."
> "@KURUMI for the rest of this conversation, append 'be extra terse' to your persona."

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local setup, pre-push checks, and where to make changes per piece.

## License

[MIT](LICENSE)

---

<div align="center">

*"Time always rewinds for those who know how to ask."* — Kurumi

Made for [PianoNic](https://github.com/PianoNic) by Kurumi herself

</div>
