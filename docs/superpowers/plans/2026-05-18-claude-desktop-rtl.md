# Claude Desktop RTL (Hebrew/Arabic) Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bake RTL (Hebrew/Arabic) text support into the Linux Claude Desktop build so every rebuilt RPM automatically includes it, with no post-install steps.

**Architecture:** A bash function `apply_rtl_patch()` is sourced into `build-fedora.sh` and called once, after the asar is extracted and all other patches are applied, before it is repacked. The function prepends a JS payload to every `.js` file in `.vite/build/` inside the extracted asar. The JS runs in Chromium's renderer process and is 100% platform-agnostic — it is adapted directly from `shraga100/claude-desktop-rtl-patch` (MIT). The WCO (Window Controls Overlay) module from that project is omitted because the Linux build already uses `frame:true` native decorations.

**Tech Stack:** Bash, JavaScript (ES5, no dependencies), Electron renderer process, asar

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `patches/rtl-payload.js` | **Create** | The JS injected into renderer — RTL detection, per-element direction, code block protection, welcome banner |
| `patches/apply-rtl-patch.sh` | **Create** | Bash function `apply_rtl_patch(contents_dir)` — prepends payload to all `.vite/build/*.js`, idempotent |
| `tests/test-rtl-patch.sh` | **Create** | Bash test harness — verifies injection, idempotency, code ordering |
| `build-fedora.sh` | **Modify** | Source `apply-rtl-patch.sh`; call `apply_rtl_patch "app.asar.contents"` after `main_window.tgz` extraction |

---

## Task 1: Write the test harness

**Files:**
- Create: `tests/test-rtl-patch.sh`

- [ ] **Step 1.1 — Write `tests/test-rtl-patch.sh`**

```bash
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
```

- [ ] **Step 1.2 — Make it executable**

```bash
chmod +x tests/test-rtl-patch.sh
```

---

## Task 2: Run the test — confirm it fails

- [ ] **Step 2.1 — Run from project root**

```bash
cd /home/roking/Desktop/Projects/claude-desktop-fedora
bash tests/test-rtl-patch.sh
```

Expected output:
```
tests/test-rtl-patch.sh: line 5: /home/roking/Desktop/Projects/claude-desktop-fedora/patches/apply-rtl-patch.sh: No such file or directory
```

The test must fail here. If it passes, `apply-rtl-patch.sh` already exists from a previous run — delete it and re-run before continuing.

---

## Task 3: Create the RTL JS payload

**Files:**
- Create: `patches/rtl-payload.js`

- [ ] **Step 3.1 — Write `patches/rtl-payload.js`**

This is adapted from `shraga100/claude-desktop-rtl-patch` (MIT). Module 2 (WCO) is omitted — Linux uses `frame:true`.

```javascript
// --- CLAUDE RTL PATCH START ---
;(function() {
    'use strict';
    if (typeof document === 'undefined') return;
    try {
        var WRITING_SEL = '[data-testid="chat-input"]';

        function isRTL(c) {
            var code = c.charCodeAt(0);
            return (code >= 0x0590 && code <= 0x05FF) ||
                   (code >= 0x0600 && code <= 0x06FF) ||
                   (code >= 0x0750 && code <= 0x077F) ||
                   (code >= 0x08A0 && code <= 0x08FF);
        }

        function hasRTL(text) {
            if (!text) return false;
            for (var i = 0; i < text.length; i++) { if (isRTL(text[i])) return true; }
            return false;
        }

        function firstStrong(text) {
            if (!text) return null;
            for (var i = 0; i < text.length; i++) {
                if (isRTL(text[i])) return 'rtl';
                if (/[a-zA-Z]/.test(text[i])) return 'ltr';
            }
            return null;
        }

        function textWithoutCode(el) {
            var out = '';
            var nodes = el.childNodes;
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (n.nodeType === 3) { out += n.textContent; }
                else if (n.nodeType === 1 && n.tagName !== 'CODE' && n.tagName !== 'PRE') {
                    out += textWithoutCode(n);
                }
            }
            return out;
        }

        function stripLeadingLTR(text) {
            return text
                .replace(/^[\s]*(?:[\w.\-]+\.[\w]{1,5})\s*/g, '')
                .replace(/https?:\/\/\S+/g, '')
                .replace(/[\w.\-]+[\/\\][\w.\-\/\\]+/g, '')
                .replace(/`[^`]+`/g, '');
        }

        var RTL_SPLIT_FLAG = 'data-rtl-split';
        var BR_OR_NL_SPLIT = /(<br\s*\/?>|\n)/i;

        function hasMultiScriptLines(el) {
            var src = el.textContent;
            if (!src) return false;
            if (!/[a-zA-Z]{2,}/.test(src)) return false;
            if (!hasRTL(src)) return false;
            return BR_OR_NL_SPLIT.test(el.innerHTML) || src.indexOf('\n') !== -1;
        }

        function splitToDirectionalSpans(el) {
            if (el.hasAttribute(RTL_SPLIT_FLAG)) return;
            var segments = el.innerHTML.split(BR_OR_NL_SPLIT);
            var pieces = [];
            for (var idx = 0; idx < segments.length; idx += 2) {
                pieces.push(segments[idx]);
            }
            if (pieces.length < 2) return;
            var built = [];
            for (var p = 0; p < pieces.length; p++) {
                var chunk = pieces[p];
                var bare = chunk.replace(/<[^>]+>/g, '').trim();
                if (bare.length === 0) {
                    built.push('<span style="display:block;min-height:1em"></span>');
                    continue;
                }
                var pickedDir = detectTextDir(bare);
                var dirAttr = pickedDir ? ' dir="' + pickedDir + '"' : '';
                built.push('<span' + dirAttr + ' style="display:block;text-align:start">' + chunk + '</span>');
            }
            el.setAttribute(RTL_SPLIT_FLAG, '1');
            if (el.hasAttribute('dir')) el.removeAttribute('dir');
            el.style.direction = '';
            el.style.textAlign = '';
            el.innerHTML = built.join('');
        }

        function resetDirOrPinLTR(el) {
            if (window.getComputedStyle(el).direction === 'rtl') {
                el.dir = 'ltr';
                el.style.direction = 'ltr';
                return;
            }
            if (el.hasAttribute('dir')) el.removeAttribute('dir');
            el.style.direction = '';
        }

        function detectElDir(el) {
            var full = el.textContent || '';
            if (!hasRTL(full)) return null;
            var noCode = textWithoutCode(el);
            var d = firstStrong(noCode);
            if (d === 'rtl') return 'rtl';
            var stripped = stripLeadingLTR(noCode);
            d = firstStrong(stripped);
            if (d === 'rtl') return 'rtl';
            return 'rtl';
        }

        function detectTextDir(text) {
            if (!text || !text.trim()) return null;
            var d = firstStrong(text);
            if (d === 'rtl') return 'rtl';
            if (!hasRTL(text)) return 'ltr';
            var stripped = stripLeadingLTR(text);
            d = firstStrong(stripped);
            if (d === 'rtl') return 'rtl';
            return 'rtl';
        }

        function qsa(root, sel) {
            var base = root.querySelectorAll ? root : document;
            var els = Array.from(base.querySelectorAll(sel));
            if (root.matches && root.matches(sel)) els.unshift(root);
            return els;
        }

        function forceCodeLTR(root) {
            qsa(root, 'pre, .code-block__code, .relative.group\\/copy').forEach(function(b) {
                b.dir = 'ltr'; b.style.textAlign = 'left'; b.style.unicodeBidi = 'embed';
            });
            qsa(root, 'code').forEach(function(c) {
                if (!c.closest('pre') && !c.closest('.code-block__code')) c.dir = 'ltr';
            });
        }

        function processText(root) {
            qsa(root, 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, label, dt, dd').forEach(function(el) {
                if (el.closest(WRITING_SEL) || el.closest('pre') || el.closest('.code-block__code')) return;
                if (el.hasAttribute(RTL_SPLIT_FLAG)) return;
                var dir = detectElDir(el);
                if (dir) {
                    if (dir === 'rtl' && hasMultiScriptLines(el)) {
                        splitToDirectionalSpans(el);
                        return;
                    }
                    el.dir = dir;
                    el.style.direction = dir;
                    if (el.tagName === 'LI') {
                        el.style.listStylePosition = (dir === 'rtl') ? 'inside' : '';
                        var parentList = el.closest('ul, ol');
                        if (parentList && dir === 'rtl' && !parentList.hasAttribute('dir')) {
                            parentList.dir = 'rtl';
                            parentList.style.direction = 'rtl';
                            var pl = getComputedStyle(parentList).paddingLeft;
                            if (parseFloat(pl) > 0) { parentList.style.paddingRight = pl; parentList.style.paddingLeft = '0'; }
                        }
                    }
                } else {
                    resetDirOrPinLTR(el);
                    if (el.tagName === 'LI') el.style.listStylePosition = '';
                }
            });

            qsa(root, 'ul, ol').forEach(function(el) {
                if (el.closest(WRITING_SEL) || el.closest('pre')) return;
                var dir = detectElDir(el);
                if (dir === 'rtl') {
                    el.dir = 'rtl';
                    el.style.direction = 'rtl';
                    var pl = getComputedStyle(el).paddingLeft;
                    if (parseFloat(pl) > 0) { el.style.paddingRight = pl; el.style.paddingLeft = '0'; }
                } else {
                    resetDirOrPinLTR(el);
                    el.style.paddingRight = ''; el.style.paddingLeft = '';
                }
            });
        }

        function processContainers(root) {
            qsa(root, 'div, span, button, a, label').forEach(function(el) {
                if (el.closest('pre') || el.closest('code') || el.closest(WRITING_SEL)) return;
                if (el.hasAttribute(RTL_SPLIT_FLAG)) return;
                var parent = el.parentElement;
                if (parent && parent.hasAttribute(RTL_SPLIT_FLAG)) return;
                if (el.querySelector('p, div, ul, ol, h1, h2, h3, h4, h5, h6, pre, table')) return;
                if (/^(P|LI|H[1-6]|BLOCKQUOTE|TD|TH|UL|OL)$/.test(el.tagName)) return;
                var text = (el.textContent || '').trim();
                if (text.length < 2) return;
                if (hasRTL(text)) {
                    if (hasMultiScriptLines(el)) {
                        splitToDirectionalSpans(el);
                    } else {
                        el.dir = detectTextDir(text) || 'rtl';
                        el.style.textAlign = 'start';
                    }
                } else if (el.hasAttribute('dir')) {
                    el.removeAttribute('dir');
                    el.style.textAlign = '';
                }
            });
        }

        function processInput() {
            document.querySelectorAll(WRITING_SEL).forEach(function(input) {
                var text = input.textContent || input.innerText || '';
                var dir = detectTextDir(text);
                if (dir === 'rtl') {
                    input.style.direction = 'rtl'; input.style.textAlign = 'right'; input.style.paddingRight = '25px';
                } else {
                    input.style.direction = 'ltr'; input.style.textAlign = 'left'; input.style.paddingRight = '';
                }
            });
        }

        function processAll() {
            processText(document);
            processContainers(document.body);
            processInput();
            forceCodeLTR(document.body);
        }

        function injectStyles() {
            if (document.getElementById('claude-rtl-styles')) return;
            var s = document.createElement('style');
            s.id = 'claude-rtl-styles';
            s.textContent = [
                'p:not([dir]),li:not([dir]),h1:not([dir]),h2:not([dir]),h3:not([dir]),h4:not([dir]),h5:not([dir]),h6:not([dir]),blockquote:not([dir]),td:not([dir]),th:not([dir]),summary:not([dir]),label:not([dir]),legend:not([dir]),dt:not([dir]),dd:not([dir]),figcaption:not([dir]),caption:not([dir]){unicode-bidi:plaintext!important;text-align:start!important}',
                'pre,.code-block__code,.relative.group\\/copy{unicode-bidi:embed!important;direction:ltr!important;text-align:left!important}',
                'code{unicode-bidi:isolate!important;direction:ltr!important}',
                '[dir]{text-align:start!important}[dir="rtl"]{direction:rtl!important}[dir="ltr"]{direction:ltr!important}',
                '[dir]>*:not([dir]):not(pre):not(code):not(.code-block__code){unicode-bidi:plaintext;text-align:start}',
                '[dir="rtl"][class*="mask-image:linear-gradient(to_right"]{-webkit-mask-image:linear-gradient(to left,hsl(var(--always-black)) 85%,transparent 99%)!important;mask-image:linear-gradient(to left,hsl(var(--always-black)) 85%,transparent 99%)!important}',
                '.group:hover [dir="rtl"][class*="mask-image:linear-gradient(to_right"],.group:focus-within [dir="rtl"][class*="mask-image:linear-gradient(to_right"],[data-menu-open="true"] [dir="rtl"][class*="mask-image:linear-gradient(to_right"]{-webkit-mask-image:linear-gradient(to left,hsl(var(--always-black)) 60%,transparent 78%)!important;mask-image:linear-gradient(to left,hsl(var(--always-black)) 60%,transparent 78%)!important}'
            ].join('');
            document.head.appendChild(s);
        }

        function init() {
            injectStyles();
            processAll();

            document.addEventListener('input', function(e) {
                var t = e.target;
                if (!t || !(t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
                var text = t.textContent || t.innerText || t.value || '';
                var dir = detectTextDir(text);
                if (dir === 'rtl') {
                    t.style.direction = 'rtl'; t.style.textAlign = 'right'; t.style.paddingRight = '25px';
                } else {
                    t.style.direction = 'ltr'; t.style.textAlign = 'left'; t.style.paddingRight = '';
                }
            }, true);

            var pendingMuts = [];
            var obs = new MutationObserver(function(muts) {
                var dominated = false;
                for (var i = 0; i < muts.length; i++) {
                    if (muts[i].addedNodes.length > 0 || muts[i].type === 'characterData') { dominated = true; break; }
                }
                if (!dominated) return;
                for (var j = 0; j < muts.length; j++) pendingMuts.push(muts[j]);
                if (window._rtlT) return;
                window._rtlT = setTimeout(function() {
                    window._rtlT = null;
                    var toProcess = pendingMuts;
                    pendingMuts = [];
                    var roots = new Set();
                    toProcess.forEach(function(m) {
                        m.addedNodes.forEach(function(n) { if (n.nodeType === 1) roots.add(n); });
                        if (m.type === 'characterData' && m.target.parentElement) roots.add(m.target.parentElement);
                    });
                    var expanded = new Set(roots);
                    roots.forEach(function(r) {
                        if (!r.closest) return;
                        var txt = r.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, label, dt, dd');
                        if (txt) expanded.add(txt);
                        var list = r.closest('ul, ol');
                        if (list) expanded.add(list);
                    });
                    roots = expanded;
                    if (roots.size > 0 && roots.size <= 30) {
                        roots.forEach(function(r) {
                            processText(r);
                            processContainers(r);
                            forceCodeLTR(r);
                        });
                        processInput();
                    } else {
                        processAll();
                    }
                }, 50);
            });
            obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else { init(); }
    } catch(e) { console.error('[Claude RTL]', e); }
})();
// --- CLAUDE RTL PATCH END ---

// --- CLAUDE PATCH WELCOME BANNER START ---
;(function() {
    'use strict';
    try {
        if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;
        var FLAG_KEY = 'claude-rtl-patch-welcomed';
        var versionMatch = (navigator.userAgent || '').match(/Claude\/([\d.]+)/);
        var VERSION = versionMatch ? versionMatch[1] : '0';
        if (localStorage.getItem(FLAG_KEY) === VERSION) return;

        function show() {
            if (!document.body || document.getElementById('claude-rtl-welcome-banner')) return;
            var bar = document.createElement('div');
            bar.id = 'claude-rtl-welcome-banner';
            bar.dir = 'rtl';
            bar.style.cssText = [
                'position:fixed', 'top:12px', 'left:50%',
                'transform:translateX(-50%)',
                'z-index:2147483647',
                'background:#1f1f1f', 'color:#fff',
                'border:1px solid #3a3a3a', 'border-radius:10px',
                'padding:10px 14px', 'font:14px/1.4 system-ui,sans-serif',
                'box-shadow:0 6px 20px rgba(0,0,0,.4)',
                'display:flex', 'gap:12px', 'align-items:center',
                'max-width:560px'
            ].join(';');
            bar.innerHTML =
                '<span style="font-size:18px">✓</span>' +
                '<span style="flex:1">הפאטץ\' הוחל בהצלחה — תמיכת RTL ותיקון כפתורי החלון פעילים.</span>' +
                '<button id="claude-rtl-banner-close" style="background:transparent;color:#aaa;border:0;font-size:20px;cursor:pointer;padding:0 4px" aria-label="close">×</button>';
            document.body.appendChild(bar);
            function dismiss() {
                localStorage.setItem(FLAG_KEY, VERSION);
                bar.remove();
                document.removeEventListener('click', dismiss, true);
            }
            document.addEventListener('click', dismiss, true);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', show);
        } else { show(); }
    } catch(e) { console.error('[Claude Welcome Banner]', e); }
})();
// --- CLAUDE PATCH WELCOME BANNER END ---
```

---

## Task 4: Create the bash injection function

**Files:**
- Create: `patches/apply-rtl-patch.sh`

- [ ] **Step 4.1 — Write `patches/apply-rtl-patch.sh`**

```bash
#!/usr/bin/env bash
# Sourced by build-fedora.sh — provides apply_rtl_patch().
# Do not run directly.

_RTL_PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

apply_rtl_patch() {
    local contents_dir="$1"
    local payload_file="$_RTL_PATCH_DIR/rtl-payload.js"

    if [ ! -f "$payload_file" ]; then
        echo "❌ RTL payload not found: $payload_file"
        return 1
    fi

    local count=0
    local skipped=0

    while IFS= read -r js_file; do
        if grep -q "CLAUDE RTL PATCH START" "$js_file" 2>/dev/null; then
            skipped=$((skipped + 1))
            continue
        fi
        local tmp="${js_file}.rtl.tmp"
        cat "$payload_file" > "$tmp"
        printf '\n' >> "$tmp"
        cat "$js_file" >> "$tmp"
        mv "$tmp" "$js_file"
        count=$((count + 1))
    done < <(find "$contents_dir/.vite/build" -name "*.js" -type f 2>/dev/null | sort)

    if [ "$count" -eq 0 ] && [ "$skipped" -eq 0 ]; then
        echo "❌ No .js files found in $contents_dir/.vite/build/ — asar structure may have changed"
        return 1
    fi

    echo "✓ RTL patch applied to $count file(s) ($skipped already patched, skipped)"
}
```

- [ ] **Step 4.2 — Make executable**

```bash
chmod +x patches/apply-rtl-patch.sh
```

---

## Task 5: Run the test — confirm it passes

- [ ] **Step 5.1 — Run from project root**

```bash
cd /home/roking/Desktop/Projects/claude-desktop-fedora
bash tests/test-rtl-patch.sh
```

Expected output:
```
--- Test 1: Patch is applied to all .js files ---
  ✓ marker in index.js
  ✓ marker in chunk-abc.js
--- Test 2: Original content is preserved ---
  ✓ original code still in index.js
--- Test 3: Idempotency — second run adds no duplicate ---
  ✓ marker not duplicated in index.js
--- Test 4: Payload precedes original code (prepend, not append) ---
  ✓ RTL code precedes original code

Results: 5 passed, 0 failed
```

If any test fails, fix `patches/apply-rtl-patch.sh` or `patches/rtl-payload.js` before continuing.

---

## Task 6: Wire into `build-fedora.sh`

**Files:**
- Modify: `build-fedora.sh`

Two edits are needed: source the helper near the top, and call it at the right point in the build sequence.

- [ ] **Step 6.1 — Add `SCRIPT_DIR` and source line after the `is_fedora_based` check block (after line 24)**

Find this line in `build-fedora.sh`:
```bash
if ! is_fedora_based; then
    echo "❌ This script requires a Fedora-based Linux distribution"
    exit 1
fi
```

Add immediately after it:
```bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=patches/apply-rtl-patch.sh
source "$SCRIPT_DIR/patches/apply-rtl-patch.sh"
```

- [ ] **Step 6.2 — Add the `apply_rtl_patch` call**

Find this block in `build-fedora.sh` (currently around line 295–300):
```bash
echo "Downloading Main Window Fix Assets"
cd app.asar.contents
wget -O- https://github.com/emsi/claude-desktop/raw/refs/heads/main/assets/main_window.tgz | tar -zxvf -
cd ..

npx asar pack app.asar.contents app.asar || { echo "asar pack failed"; exit 1; }
```

Insert between `cd ..` and `npx asar pack`:
```bash

echo "🔤 Applying RTL (Hebrew/BiDi) fix..."
apply_rtl_patch "app.asar.contents"
```

So the final block reads:
```bash
echo "Downloading Main Window Fix Assets"
cd app.asar.contents
wget -O- https://github.com/emsi/claude-desktop/raw/refs/heads/main/assets/main_window.tgz | tar -zxvf -
cd ..

echo "🔤 Applying RTL (Hebrew/BiDi) fix..."
apply_rtl_patch "app.asar.contents"

npx asar pack app.asar.contents app.asar || { echo "asar pack failed"; exit 1; }
```

---

## Task 7: Commit

- [ ] **Step 7.1 — Stage and commit**

```bash
cd /home/roking/Desktop/Projects/claude-desktop-fedora
git init 2>/dev/null || true   # in case repo doesn't exist yet
git add patches/rtl-payload.js patches/apply-rtl-patch.sh tests/test-rtl-patch.sh build-fedora.sh docs/
git commit -m "feat: bake RTL (Hebrew/Arabic) support into build pipeline

Adapts shraga100/claude-desktop-rtl-patch (MIT) to run as a
build-time step instead of a post-install patch. The JS payload
is prepended to all .vite/build/*.js files in the extracted asar
before repacking, so every rebuilt RPM includes it automatically.

- patches/rtl-payload.js: renderer JS (RTL detection + welcome banner)
- patches/apply-rtl-patch.sh: idempotent bash injector
- tests/test-rtl-patch.sh: verifies injection, idempotency, ordering
- build-fedora.sh: sourced + called after main_window.tgz extraction"
```

---

## Task 8: Full rebuild and manual verification

- [ ] **Step 8.1 — Rebuild the RPM**

```bash
cd /home/roking/Desktop/Projects/claude-desktop-fedora
sudo ./build-fedora.sh 2>&1 | tee /tmp/build-rtl.log | grep -E "✓|❌|⚠️|RTL|version|Done|Error"
```

Watch for:
```
✓ RTL patch applied to N file(s) (0 already patched, skipped)
```
If you see `❌ No .js files found` the asar structure changed upstream — check `app.asar.contents/.vite/build/` manually.

- [ ] **Step 8.2 — Install the new RPM**

```bash
RPM=$(find /home/roking/Desktop/Projects/claude-desktop-fedora/build -name "claude-desktop-*.rpm" | tail -1)
echo "Installing: $RPM"
sudo dnf install -y "$RPM"
```

- [ ] **Step 8.3 — Manual verification checklist**

Launch Claude Desktop and run through each case:

```
[ ] Hebrew message sent → displays RTL, text flows right-to-left, right-aligned
[ ] English response → stays LTR, unaffected
[ ] Mixed paragraph (Hebrew sentence, English word inside) → correct per-direction
[ ] Claude response with code block inside Hebrew text → code stays LTR, syntax intact
[ ] Type Hebrew in input box → input flips to RTL as you type
[ ] Type English after Hebrew in input box → flips back to LTR
[ ] Hebrew conversation title in sidebar → readable, not cut off at wrong edge
[ ] Welcome banner appears on first launch (Hebrew text, ✓ icon), dismisses on click
[ ] Restart Claude Desktop → banner does NOT appear again (localStorage flag set)
[ ] Rebuild a second time → build log shows "N already patched, skipped" (idempotency)
```
