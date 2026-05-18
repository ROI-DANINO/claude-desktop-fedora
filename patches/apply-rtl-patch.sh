#!/usr/bin/env bash
# Sourced by build-fedora.sh — provides apply_rtl_patch().
# Do not run directly.

_RTL_PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

apply_rtl_patch() {
    local contents_dir="$1"
    local payload_file="$_RTL_PATCH_DIR/rtl-payload.js"

    if [ ! -s "$payload_file" ]; then
        echo "❌ RTL payload not found: $payload_file"
        return 1
    fi

    local count=0
    local skipped=0

    # In newer Claude Desktop (1.x+), .vite/build/*.js are Electron preload scripts:
    # they run in the claude.ai renderer context where document IS defined.
    # In older Claude Desktop (0.x), .vite/build/*.js were Node.js main-process files.
    # The IIFE's `typeof document === 'undefined'` guard makes it safe for both.
    # Preload scripts are the correct injection point because the actual chat UI
    # is served remotely from claude.ai, not bundled in .vite/renderer/.
    local search_dir="$contents_dir/.vite/build"
    if [ ! -d "$search_dir" ]; then
        echo "❌ Build directory not found: $search_dir — asar structure may have changed"
        return 1
    fi

    while IFS= read -r js_file; do
        if grep -q "CLAUDE RTL PATCH START" "$js_file" 2>/dev/null; then
            skipped=$((skipped + 1))
            continue
        fi
        local tmp="${js_file}.rtl.tmp"
        if cat "$payload_file" > "$tmp" && printf '\n' >> "$tmp" && cat "$js_file" >> "$tmp" && mv "$tmp" "$js_file"; then
            count=$((count + 1))
        else
            rm -f "$tmp"
        fi
    done < <(find "$search_dir" -name "*.js" -type f 2>/dev/null | sort)

    if [ "$count" -eq 0 ] && [ "$skipped" -eq 0 ]; then
        echo "❌ No .js files found in $search_dir — asar structure may have changed"
        return 1
    fi

    echo "✓ RTL patch applied to $count file(s) ($skipped already patched, skipped)"
}
