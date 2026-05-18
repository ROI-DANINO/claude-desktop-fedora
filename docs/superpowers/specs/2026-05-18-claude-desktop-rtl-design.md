# Claude Desktop Linux — RTL (Hebrew/Arabic) Support Design

**Date:** 2026-05-18  
**Project:** claude-desktop-fedora  
**Scope:** Integrate battle-tested RTL text support into the Linux build pipeline

---

## Background & Prior Art

The strongest existing solution is **[shraga100/claude-desktop-rtl-patch](https://github.com/shraga100/claude-desktop-rtl-patch)** (MIT, Windows-only PS1 wrapper). Its ~560-line JavaScript payload runs entirely inside Chromium's renderer process — meaning it is 100% platform-agnostic. The PowerShell wrapper is Windows-only, not the fix itself.

Community browser extensions (Claude RTL for Firefox, Smart-RTL-Fixer, Now2ai-RTL-Fixer) confirm the same approaches work on claude.ai web — validating the technique independently.

We adapt shraga100's JS directly. No reinvention.

---

## What the JS Fix Does

### Module 1 — RTL Detection & Direction Setting (core)

**Character detection (Unicode range checks):**
- Hebrew: `0x0590–0x05FF`
- Arabic: `0x0600–0x06FF`
- Arabic Supplement: `0x0750–0x077F`
- Arabic Extended-A: `0x08A0–0x08FF`

**Direction decision — three-layer fallback:**
1. `firstStrong()` on element text excluding `<code>` children
2. Strip leading filenames/URLs/paths, retry `firstStrong()`
3. RTL characters exist anywhere → RTL

**Elements targeted:**
- Semantic text: `p, li, h1–h6, blockquote, td, th, summary, label, dt, dd`
- Leaf containers: `div, span, button, a, label` (no block children, not already handled)
- Lists: `ul, ol` (plus bullet/padding direction flip)

**Multi-script line splitting:**  
When a paragraph has `<br>` or `\n` separators AND mixes Hebrew and Latin, the element is split into per-line `<span dir="...">` wrappers rather than forcing one direction on the whole block. A `data-rtl-split` flag prevents reprocessing.

**Code block protection (explicit LTR forced):**
- `pre`, `.code-block__code`, `.relative.group\/copy` → `dir=ltr; text-align:left; unicode-bidi:embed`
- Inline `code` (not inside pre) → `dir=ltr; unicode-bidi:isolate`

**Input box:**
- `[data-testid="chat-input"]` live-updated on every `input` event
- Direction switches as you type based on first strong character

**MutationObserver (streaming-safe):**
- 50ms throttle (not debounce) — processes during streaming, not only after
- Expands mutation roots to include ancestor `p/li/ul/ol` elements
- Falls back to full `processAll()` if >30 roots detected in one tick

**CSS injected (style tag `#claude-rtl-styles`):**
```css
/* Semantic text elements: auto-direction if no explicit dir */
p:not([dir]), li:not([dir]), h1:not([dir])...{ unicode-bidi:plaintext!important; text-align:start!important }

/* Code blocks: always LTR */
pre, .code-block__code, .relative.group\/copy { unicode-bidi:embed!important; direction:ltr!important; text-align:left!important }
code { unicode-bidi:isolate!important; direction:ltr!important }

/* Explicit dir attributes */
[dir] { text-align:start!important }
[dir="rtl"] { direction:rtl!important }
[dir="ltr"] { direction:ltr!important }

/* Tailwind sidebar gradient fix — Hebrew text was truncating at wrong edge */
[dir="rtl"][class*="mask-image:linear-gradient(to_right"] {
  mask-image: linear-gradient(to left, ...) !important
}
```

### Module 2 — WCO (Window Controls Overlay) Fix

**Linux status: SKIPPED.**  
The `build-fedora.sh` already patches `frame:true` into the BrowserWindow constructor (line 241 sed command), which restores native OS window decorations. The WCO fix is only needed when using Electron's custom titlebar overlay (Windows). Including it on Linux is harmless but wasteful — omitting it keeps the payload clean.

### Module 3 — Welcome Banner

A dismissible banner shown once per Claude Desktop version, confirming the RTL patch is active. Uses `localStorage` keyed to the Claude version from the User-Agent string (`Claude/X.Y.Z`). Self-dismisses on any click. Written in Hebrew. Included as-is — good UX signal for the user.

---

## Integration into `build-fedora.sh`

### Injection approach

The shraga100 patch scans all `.js` files under `.vite/build/` and **prepends** the payload to each one, using `// --- CLAUDE RTL PATCH START ---` as an idempotency guard. We use the same strategy.

**Why prepend to all `.vite/build/` JS files (not just one):**  
Claude's bundler splits the renderer across multiple chunks. Injecting into all of them ensures the RTL module runs regardless of which chunk initializes first. The `if (typeof document === 'undefined') return;` guard at the top of the IIFE makes it safe to inject into the main-process chunk too — it simply exits immediately.

**Why not modify `package.json` main + wrapper:**  
The shraga100 approach (prepend to renderer JS) is proven across many Claude Desktop versions. Modifying `package.json` to add a wrapper entry point risks breaking if the main entry is ever loaded with `nodeIntegration: false` in a renderer context, or if the chunk loader expects a specific shape.

### Where in the script

Injection happens **after** `main_window.tgz` extraction (line 298) and **before** `npx asar pack` (line 300). All other patches are already applied at this point.

### New bash function: `apply_rtl_patch()`

```
apply_rtl_patch(contents_dir):
  1. Create rtl-payload.js at contents_dir root with full JS (Modules 1 + 3)
  2. Find all .js files under contents_dir/.vite/build/
  3. For each file:
     a. Skip if already contains "CLAUDE RTL PATCH START" (idempotency)
     b. Prepend rtl-payload.js content to the file
  4. Remove rtl-payload.js (temp file)
  5. Echo success with file count
```

No asar signature patching needed — the Linux build uses system electron (installed via npm globally), which does not perform ASAR integrity verification. This is different from Windows where Claude ships its own Electron with hash checking.

---

## Files Changed

| File | Change |
|---|---|
| `build-fedora.sh` | Add `apply_rtl_patch()` function + one call after `main_window.tgz` extraction |

No new permanent files. The RTL JS is written to a temp file during the build and cleaned up. The injected JS lives inside the built `app.asar`.

---

## Edge Cases Handled

| Case | Handling |
|---|---|
| English paragraph in Hebrew response | Per-element detection keeps it LTR |
| Hebrew sentence with inline English words | `firstStrong()` + `unicode-bidi:plaintext` handles bidirectional inline |
| Code block inside Hebrew response | Forced `dir=ltr` on `pre`/`code`, `unicode-bidi:embed/isolate` |
| Streaming response mid-render | 50ms throttled MutationObserver fires during streaming |
| Input box language switch | Live `input` event listener per keystroke |
| Hebrew conversation titles in sidebar | `processContainers()` catches leaf `div/span` nodes; sidebar gradient flipped |
| Re-running the build (patch already applied) | `CLAUDE RTL PATCH START` marker skips re-injection |
| Claude Desktop update | Rebuild script re-applies automatically (build-time, not post-install) |
| Mixed Hebrew/English paragraph with line breaks | `splitToDirectionalSpans()` wraps each line in its own `<span dir>` |

---

## What We Are NOT Doing

- **No toggle** — auto-detection handles 95%+ of cases; shraga100 (the most mature solution) has no toggle; adding one would require a tray menu item or keyboard shortcut not in scope
- **No WCO fix** — Linux uses `frame:true` native decorations
- **No auto-update mechanism** — separate concern; leaving for a future session
- **No ChatGPT desktop port** — separate project, different session

---

## Testing Plan

1. Rebuild the RPM: `sudo ./build-fedora.sh`
2. Install the new RPM: `sudo dnf install build/.../claude-desktop-*.rpm`
3. Launch Claude Desktop and verify:
   - [ ] Hebrew message sent → displays RTL, right-aligned
   - [ ] English response → stays LTR
   - [ ] Mixed Hebrew + English paragraph → correct per-sentence direction
   - [ ] Code block inside Hebrew response → stays LTR, syntax intact
   - [ ] Typing Hebrew in input box → input direction flips to RTL
   - [ ] Typing English after Hebrew in input → flips back to LTR
   - [ ] Hebrew conversation title in sidebar → readable, not truncated on wrong edge
   - [ ] Welcome banner appears on first launch, dismisses on click
   - [ ] Re-run build → idempotency check skips re-injection (no doubled banner)
