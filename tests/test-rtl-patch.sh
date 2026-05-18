#!/usr/bin/env bash
# Tests for apply_rtl_patch() in patches/apply-rtl-patch.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/patches/apply-rtl-patch.sh"

pass=0
fail=0

check() {
    local desc="$1" result="$2" expected="$3"
    if [ "$result" = "$expected" ]; then
        echo "  ✓ $desc"
        pass=$((pass + 1))
    else
        echo "  ✗ $desc  (expected '$expected', got '$result')"
        fail=$((fail + 1))
    fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/.vite/build"
echo 'console.log("hello");' > "$TMP/.vite/build/index.js"
echo 'console.log("chunk");' > "$TMP/.vite/build/chunk-abc.js"

echo "--- Test 1: Patch is applied to all .js files ---"
apply_rtl_patch "$TMP"
check "marker in index.js" \
    "$(grep -c 'CLAUDE RTL PATCH START' "$TMP/.vite/build/index.js")" "1"
check "marker in chunk-abc.js" \
    "$(grep -c 'CLAUDE RTL PATCH START' "$TMP/.vite/build/chunk-abc.js")" "1"

echo "--- Test 2: Original content is preserved ---"
check "original code still in index.js" \
    "$(grep -c 'console.log("hello")' "$TMP/.vite/build/index.js")" "1"

echo "--- Test 3: Idempotency — second run adds no duplicate ---"
apply_rtl_patch "$TMP"
check "marker not duplicated in index.js" \
    "$(grep -c 'CLAUDE RTL PATCH START' "$TMP/.vite/build/index.js")" "1"

echo "--- Test 4: Payload precedes original code (prepend, not append) ---"
marker_line="$(grep -n 'CLAUDE RTL PATCH START' "$TMP/.vite/build/index.js" | head -1 | cut -d: -f1)"
hello_line="$(grep -n 'console.log("hello")' "$TMP/.vite/build/index.js" | head -1 | cut -d: -f1)"
if [ "$marker_line" -lt "$hello_line" ]; then
    check "RTL code precedes original code" "true" "true"
else
    check "RTL code precedes original code" "false" "true"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
