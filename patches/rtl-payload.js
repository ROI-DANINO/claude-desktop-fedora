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
            // Intentional: RTL chars exist but hide behind filenames/code/LTR prefix.
            // Treat the element as RTL rather than misrender Hebrew buried in LTR text.
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
            var _rtlT = null;
            var obs = new MutationObserver(function(muts) {
                var dominated = false;
                for (var i = 0; i < muts.length; i++) {
                    if (muts[i].addedNodes.length > 0 || muts[i].type === 'characterData') { dominated = true; break; }
                }
                if (!dominated) return;
                if (pendingMuts.length < 500) {
                    for (var j = 0; j < muts.length; j++) pendingMuts.push(muts[j]);
                }
                if (_rtlT) return;
                _rtlT = setTimeout(function() {
                    _rtlT = null;
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
