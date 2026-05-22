# /kurumi-tools

Persistent, host-editable dev space for Kurumi. Survives container rebuilds (bind-mounted from the host).

## What belongs here

- Small, self-contained shell or Node scripts that use **only** binaries already in the container image: `bash`, `node`, `npm`, `git`, `curl`, `gh`, `claude`.
- Tools that **don't** need network installs, system packages, or browsers.
- Notes / scratch text for ongoing tasks.

## What does NOT belong here

- ❌ Headless browsers, Chromium / Chrome / Firefox binaries — that's a Dockerfile change, not a script.
- ❌ Scripts that read the bot token (`DISCORD_TOKEN`, `KURUMI_BOT_TOKEN`) or call the Discord REST API directly — always go through the MCP `mcp__discord-server-bot__*` tools so access controls (mute lists, founder gating, casual gate) apply.
- ❌ Scripts that upload arbitrary file paths to third-party hosts (`tmpfiles.org`, transfer.sh, pastebin, etc.) — exfiltration vector for secrets in `/state/`, `/root/.claude.json`, etc.
- ❌ `apt install`, `pip install`, `npm install -g`, binary downloads from the internet — see SCOPE DISCIPLINE in the system prompt.
- ❌ Anything that needs to persist beyond the container restart cycle but isn't worth a real Dockerfile change.

## History

`2026-05-22` — folder reset by owner after audit. Previous contents (radar tools, chromium download attempts, third-party image uploader, ad-hoc Discord REST script) quarantined to `../backups/kurumi-tools-20260522-173846/` for reference. None were malicious; several violated current policy (token reuse, exfiltration risk, scope creep).
