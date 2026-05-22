#!/bin/bash
# share-image.sh — Upload images to temporary hosting and return URLs
# Usage: ./share-image.sh image1.png image2.jpg ...
# Returns JSON with URLs that can be embedded in Discord messages

if [ $# -eq 0 ]; then
    echo '{"error": "No images provided"}'
    exit 1
fi

declare -a URLS
declare -a FAILED

for IMAGE in "$@"; do
    if [ ! -f "$IMAGE" ]; then
        FAILED+=("$IMAGE (not found)")
        continue
    fi

    # Upload to tmpfiles.org (no auth needed)
    RESPONSE=$(curl -s -F "file=@$IMAGE" https://tmpfiles.org/api/v1/upload)

    # Extract URL from response
    URL=$(echo "$RESPONSE" | grep -o 'https://tmpfiles.org/[^"]*' | head -1)

    if [ -z "$URL" ]; then
        FAILED+=("$IMAGE (upload failed)")
    else
        URLS+=("$URL")
        echo "[+] $IMAGE → $URL"
    fi
done

# Output JSON with all URLs for programmatic use
echo ""
echo "Shareable URLs (use these in Discord):"
for URL in "${URLS[@]}"; do
    echo "  $URL"
done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo ""
    echo "Failed uploads:"
    for FAIL in "${FAILED[@]}"; do
        echo "  ✗ $FAIL"
    done
fi

# JSON output for script integration
echo ""
echo "JSON:"
printf '{"urls": [%s], "failed": [%s]}\n' \
    "$(printf '"%s",' "${URLS[@]}" | sed 's/,$//')" \
    "$(printf '"%s",' "${FAILED[@]}" | sed 's/,$//')"
