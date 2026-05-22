#!/bin/bash
# Landi Weather Radar — sends live radar to Discord channel

REGION="${1:-Baden}"
CHANNEL_ID="${2:-1155816490298253396}"  # #bots channel
GUILD_ID="${3:-1141725407498997881}"    # Informatiker Spastis oder so

# Run the radar capture (generates 2 snapshots for timeline)
cd /kurumi-tools
OUTPUT=$(node landi-radar-discord.js "$REGION" 2 2>&1)

# Extract image paths from JSON output
IMAGES=$(echo "$OUTPUT" | tail -1 | jq -r '.images[]' 2>/dev/null)

if [ -z "$IMAGES" ]; then
    echo "Failed to capture radar images"
    exit 1
fi

# Post each image to Discord with a caption
COUNT=0
for IMAGE in $IMAGES; do
    COUNT=$((COUNT + 1))
    TOTAL=$(echo "$OUTPUT" | tail -1 | jq -r '.count')
    TIMESTAMP=$(echo "$OUTPUT" | tail -1 | jq -r '.timestamp')

    # Read image and send via Discord message (would need bot API integration)
    # For now, just list them
    echo "📊 Radar snapshot $COUNT/$TOTAL ($TIMESTAMP): $IMAGE"
done

echo ""
echo "Radar captured at: $(echo "$OUTPUT" | tail -1 | jq -r '.timestamp')"
echo "Region: $REGION"
