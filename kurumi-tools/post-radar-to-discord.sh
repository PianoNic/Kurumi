#!/bin/bash
# post-radar-to-discord.sh — Capture Landi radar and post to Discord
# Usage: ./post-radar-to-discord.sh [region] [channel-id] [guild-id]

REGION="${1:-Baden}"
CHANNEL_ID="${2:-1155816490298253396}"
GUILD_ID="${3:-1141725407498997881}"

echo "🌧️ Capturing Landi radar for $REGION..."

# Capture fresh radar (2 snapshots for timeline)
cd /kurumi-tools
RADAR_OUTPUT=$(timeout 120 node landi-radar-discord.js "$REGION" 2 2>&1)

# Check if capture succeeded
if ! echo "$RADAR_OUTPUT" | tail -1 | grep -q "region"; then
    echo "❌ Radar capture failed"
    exit 1
fi

# Extract image paths and metadata
IMAGES=$(echo "$RADAR_OUTPUT" | tail -1 | jq -r '.images[]' 2>/dev/null)
TIMESTAMP=$(echo "$RADAR_OUTPUT" | tail -1 | jq -r '.timestamp' 2>/dev/null)

if [ -z "$IMAGES" ]; then
    echo "❌ No images captured"
    exit 1
fi

echo "📤 Uploading images to temporary hosting..."

# Upload images and collect URLs
declare -a URLS
for IMAGE in $IMAGES; do
    URL=$(bash /kurumi-tools/share-image.sh "$IMAGE" 2>&1 | grep "https://tmpfiles.org" | head -1)
    if [ -n "$URL" ]; then
        URLS+=("$URL")
        echo "   ✓ $IMAGE"
    fi
done

if [ ${#URLS[@]} -eq 0 ]; then
    echo "❌ Image upload failed"
    exit 1
fi

echo ""
echo "✅ Ready to post. Image URLs:"
for URL in "${URLS[@]}"; do
    echo "   $URL"
done

echo ""
echo "To post to Discord, use these URLs in an embed or message."
echo "Example Discord message:"
echo "🌧️ **LANDI Weather Radar — $REGION** ($TIMESTAMP)"
for i in "${!URLS[@]}"; do
    echo "📊 Snapshot $((i+1)): ${URLS[$i]}"
done
