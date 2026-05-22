FROM node:22-bookworm-slim

# claude CLI needs bash + git. Install Claude Code globally so the bot can spawn `claude`.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Embed the discord-server-bot MCP server so Kurumi's claude subprocess can
# spawn it via `node` (see ../kurumi-workspace/.mcp.json). Sources are pulled
# from an additional build context `mcp-src` mapped to the repo root in
# compose.yml. No docker socket / no separate container needed.
COPY --from=mcp-src package.json /opt/discord-server-bot/package.json
COPY --from=mcp-src package-lock.json /opt/discord-server-bot/package-lock.json
COPY --from=mcp-src src /opt/discord-server-bot/src
RUN cd /opt/discord-server-bot && npm install --omit=dev --no-audit --no-fund

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/index.js"]
