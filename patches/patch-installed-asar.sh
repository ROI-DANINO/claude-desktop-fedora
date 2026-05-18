#!/usr/bin/env bash
# Apply the RTL patch directly to the currently installed Claude Desktop asar.
# Run with sudo after installing/updating Claude Desktop.
#
# Usage: sudo ./patches/patch-installed-asar.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_FILE="$SCRIPT_DIR/rtl-payload.js"

if [ ! -s "$PAYLOAD_FILE" ]; then
    echo "❌ RTL payload not found: $PAYLOAD_FILE"
    exit 1
fi

# Find the installed asar (path changed between versions)
find_asar() {
    local candidates=(
        "/usr/lib/claude-desktop/node_modules/electron/dist/resources/app.asar"
        "/usr/lib64/claude-desktop/app.asar"
        "/usr/lib/claude-desktop/app.asar"
    )
    for path in "${candidates[@]}"; do
        if [ -f "$path" ]; then
            echo "$path"
            return 0
        fi
    done
    return 1
}

if ! asar_path=$(find_asar); then
    echo "❌ Claude Desktop asar not found — is it installed?"
    exit 1
fi

echo "Found asar: $asar_path"

if ! command -v npx &>/dev/null; then
    echo "❌ npx not found — run: sudo npm install -g asar"
    exit 1
fi

if ! python3 -c '' 2>/dev/null; then
    echo "❌ python3 not found — install it first"
    exit 1
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

echo "Extracting asar..."
npx asar extract "$asar_path" "$tmpdir/contents"

echo "Applying RTL patch to preload scripts (.vite/build/)..."

count=0; skipped=0; cleaned=0
while IFS= read -r js_file; do
    # Remove any previously applied RTL patches (both the direct payload and the
    # webFrame.executeJavaScript wrapper approach) so we always get a clean base.
    had_old=$(python3 - "$js_file" <<'PYEOF'
import sys, re

fn = sys.argv[1]
with open(fn, encoding='utf-8', errors='replace') as f:
    content = f.read()

orig = content

# Remove direct payload block (prepend style)
content = re.sub(
    r'// --- CLAUDE RTL PATCH START ---.*?// --- CLAUDE RTL PATCH END ---\s*',
    '', content, flags=re.DOTALL)

# Remove welcome banner block
content = re.sub(
    r'// --- CLAUDE PATCH WELCOME BANNER START ---.*?// --- CLAUDE PATCH WELCOME BANNER END ---\s*',
    '', content, flags=re.DOTALL)

# Remove webFrame.executeJavaScript wrapper (append style, both comment variants)
content = re.sub(
    r'[;\s]*/[/*]\s*---\s*CLAUDE RTL INJECT START\s*---.*?---\s*CLAUDE RTL INJECT END\s*---.*?(?:\*/|)\s*',
    '', content, flags=re.DOTALL)
content = re.sub(
    r'// --- CLAUDE RTL INJECT START ---.*?// --- CLAUDE RTL INJECT END ---\s*',
    '', content, flags=re.DOTALL)

changed = content != orig
with open(fn, 'w', encoding='utf-8') as f:
    f.write(content)

print('1' if changed else '0')
PYEOF
)

    if [ "$had_old" = "1" ]; then
        cleaned=$((cleaned + 1))
    fi

    # Prepend payload directly — runs in the preload isolated world where
    # document IS the claude.ai page DOM. DOM mutations cross the isolation
    # boundary, so setAttribute/style changes are visible to the page.
    tmp="${js_file}.rtl.tmp"
    if cat "$PAYLOAD_FILE" > "$tmp" && printf '\n' >> "$tmp" && cat "$js_file" >> "$tmp" && mv "$tmp" "$js_file"; then
        count=$((count + 1))
    else
        rm -f "$tmp"
    fi
done < <(find "$tmpdir/contents/.vite/build" -name "*.js" -type f 2>/dev/null | sort)

[ "$cleaned" -gt 0 ] && echo "  Removed old RTL patch from $cleaned file(s)"
echo "✓ RTL patch applied to $count file(s)"

echo "Repacking asar..."
npx asar pack "$tmpdir/contents" "$tmpdir/app.asar"

echo "Installing patched asar to $asar_path..."
cp "$tmpdir/app.asar" "$asar_path"

echo "✓ Done. Restart Claude Desktop to see the RTL fix."
