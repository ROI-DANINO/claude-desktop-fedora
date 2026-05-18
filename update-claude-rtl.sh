#!/usr/bin/env bash
# Update Claude Desktop and re-apply the RTL patch in one step.
# Usage: sudo ./update-claude-rtl.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Updating Claude Desktop ==="
dnf update -y claude-desktop

echo ""
echo "=== Applying RTL patch ==="
"$SCRIPT_DIR/patches/patch-installed-asar.sh"

echo ""
echo "=== Done — restart Claude Desktop ==="
