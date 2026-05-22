# /kurumi-tools

Persistent, host-editable dev space for Kurumi. Bind-mounted from the host into the bot container at `/kurumi-tools`, so anything in here survives every container rebuild, volume wipe, and OAuth refresh.

The folder is split into three zones with different rules.

```
kurumi-tools/
├── README.md            # this file
├── loose/               # internal scripts Kurumi calls herself (loose tools)
│   ├── index.json       #   metadata + dispatch info, written by loose_tool_create
│   └── <name>.{sh,js}   #   one script per registered loose tool
└── loose-commands/      # public Discord slash commands (loose commands)
    └── <name>.{sh,js}   #   one script per registered loose command
                         #   (dispatch mapping lives in /state/loose-commands.json,
                         #    Discord-side registration is via REST API)
```

## What belongs here

- Small, self-contained shell or Node scripts that use **only** binaries already in the container image: `bash`, `node`, `npm`, `git`, `curl`, `gh`, `claude`, plus standard Unix utilities.
- Tools that **don't** need network installs, system packages, or browsers.
- Notes / scratch text for ongoing tasks Kurumi is working on across multiple turns.

## What does NOT belong here

- ❌ **Headless browsers** — Chromium, Chrome, Firefox binaries. That's a Dockerfile change (add the package + dependencies to `kurumi-chat-bot/Dockerfile`), not a runtime script.
- ❌ **Scripts that read the bot token** (`DISCORD_BOT_TOKEN`, `KURUMI_BOT_TOKEN`) or call the Discord REST API directly with the bot's identity — always go through the MCP `mcp__discord-server-bot__*` tools so access controls (mute lists, founder gating, casual gate) apply consistently. Direct token use bypasses every safeguard.
- ❌ **Scripts that upload arbitrary file paths to third-party hosts** (`tmpfiles.org`, `transfer.sh`, pastebin, imgur, etc.) — these are silent exfiltration vectors for secrets in `/state/`, `/root/.claude.json`, env files. If you genuinely need image hosting, host it on a service Kurumi controls.
- ❌ **`apt install`, `pip install`, `npm install -g`, binary downloads from the internet** — see the SCOPE DISCIPLINE section in Kurumi's system prompt. The container is ephemeral; runtime-installed packages die on the next rebuild and the install attempts themselves clog the channel with 30+ failed tool calls. If you need a new CLI, add it to the Dockerfile.
- ❌ **Anything that needs to persist real data beyond a single command's lifetime** — use `/state/` (managed via `note_add` for memory, `gif_save` for media, `config_set` for settings) instead of writing JSON sidecar files here.

## Loose tools vs loose commands

| | **Loose tool** | **Loose command** |
|---|---|---|
| **Folder** | `/kurumi-tools/loose/` | `/kurumi-tools/loose-commands/` |
| **Index** | `/kurumi-tools/loose/index.json` (this folder) | `/state/loose-commands.json` (state volume) |
| **Visible in Discord** | No — internal only | Yes — appears in the `/` slash menu |
| **Who invokes it** | Kurumi, via MCP `loose_tool_run` | Any user, by typing `/<name>` |
| **Created by** | `loose_tool_create` (owner only) | `loose_command_create` (owner only) — atomically writes script + POSTs to Discord REST |
| **Removed by** | `loose_tool_remove` | `loose_command_remove` — atomically deletes script + Discord registration |
| **Use case** | Internal helpers: API wrappers, formatters, recurring computations Kurumi triggers between turns. | User-facing commands: games, reaction generators, server utilities anyone can fire. |

Both share the same script contract:

- Stored as a real executable script (`.sh` for bash, `.js` for node), shebang auto-prepended.
- Receives a single JSON-encoded string on `argv[2]`. Parse with `JSON.parse(process.argv[2] || "{}")` in node or `jq -r '.foo' <<< "$1"` in bash.
- Stdout becomes the result (loose tool) or the slash command reply (loose command).
- 30-second hard timeout, 16 KB stdout cap.
- Non-zero exit code returns stderr + the cap'd stdout as an error message.

Loose commands additionally get four injected metadata fields in the JSON args (so the script knows who called it where):

```
__invokedBy      → user ID
__invokedByTag   → user#discriminator
__channelId      → channel ID
__guildId        → guild ID (null in DMs)
```

## Examples

### A loose tool that fetches GitHub stars

Created via:

```
loose_tool_create({
  name: "github-stars",
  description: "Get star count for a GitHub repo",
  interpreter: "bash",
  code: "REPO=$(jq -r .repo <<< \"$1\")\ngh api \"/repos/$REPO\" | jq .stargazers_count",
  argsHint: '{repo: "owner/name"}'
})
```

Invoked via:

```
loose_tool_run({name: "github-stars", args: {repo: "PianoNic/KRINT"}})
```

### A loose command — `/roast @target`

Created via:

```
loose_command_create({
  name: "roast",
  description: "Pick a playful roast for the target",
  interpreter: "node",
  code: "const {target} = JSON.parse(process.argv[2]); const lines = [...]; console.log(lines[Math.floor(Math.random()*lines.length)].replace('{T}', `<@${target}>`));",
  guildId: "1141725407498997881",
  options: [{name: "target", description: "victim", type: "user", required: true}]
})
```

Once registered, any user in that guild types `/roast @nic` and the reply appears in chat. The script gets `{"target":"<userId>","__invokedBy":"...","__channelId":"...","__guildId":"..."}` as its JSON arg.

## History

`2026-05-22` — folder reset by owner after audit. Previous contents (radar tools, chromium download attempts, third-party image uploader, ad-hoc Discord REST script) were quarantined and then deleted. None were malicious; several violated current policy (token reuse, exfiltration risk, scope creep, headless-browser install loops). The audit-and-reset documented the rules above as policy rather than convention.
