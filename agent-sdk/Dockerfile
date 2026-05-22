FROM node:22-bookworm-slim

# Claude Code CLI requires bash + git + a few build tools for npm postinstalls.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install the Claude Code CLI globally so `claude /login` works inside the container.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install node deps in a cacheable layer.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Source comes in last so edits don't bust the dep cache.
COPY tsconfig.json ./
COPY src ./src

# Default to dropping into a shell so the user can run either `claude /login`
# or `npm run agent` depending on what they need. docker-compose overrides this
# per-service.
CMD ["bash"]
