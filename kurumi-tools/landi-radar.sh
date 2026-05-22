#!/bin/bash
# LANDI Weather Radar Fetcher — Headless Chromium version
# Renders live radar using Puppeteer + system Chromium

REGION="${1:-Baden}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec node "$SCRIPT_DIR/landi-radar.js" "$REGION"
