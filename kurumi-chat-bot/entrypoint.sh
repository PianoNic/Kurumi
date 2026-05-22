#!/bin/sh
set -e

# /root/.claude.json lives at the user's HOME root, NOT inside /root/.claude/, so
# it isn't covered by the claude-config volume mount. Claude Code does keep
# timestamped backups inside /root/.claude/backups/ — restore the newest if the
# live file is missing (e.g. after a fresh container from a volume populated by
# the agent-sdk-login container that wrote .claude.json into its ephemeral fs).
if [ ! -f /root/.claude.json ]; then
  latest_backup=$(ls -1t /root/.claude/backups/.claude.json.backup.* 2>/dev/null | head -n1 || true)
  if [ -n "$latest_backup" ]; then
    echo "entrypoint: restoring /root/.claude.json from $latest_backup"
    cp "$latest_backup" /root/.claude.json
  else
    echo "entrypoint: no /root/.claude.json and no backup found — claude CLI will likely fail"
  fi
fi

exec "$@"
