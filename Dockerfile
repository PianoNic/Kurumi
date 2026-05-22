FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# The MCP server speaks JSON-RPC on stdio. Claude Code spawns it with `docker run -i`.
CMD ["node", "src/index.js"]
