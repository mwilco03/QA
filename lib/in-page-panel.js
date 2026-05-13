/**
 * LMS QA Validator - In-Page Floating Panel
 *
 * Renders a draggable Shadow-DOM toolbar inside the page so the extension's
 * commands stay reachable in chromeless popup windows (the kind Workday
 * Learning and many LMS launchers use, where the browser toolbar is hidden
 * and the user has no way to click the extension icon).
 *
 * Communication: the panel posts the same LMS_QA_CMD_* messages on `window`
 * that the extension popup sends. The validator (lms-qa-validator.js)
 * handles them. Results come back as LMS_QA_* events the panel listens to.
 */

(function() {
    'use strict';

    if (window.__LMS_QA_PANEL_INJECTED__) return;
    window.__LMS_QA_PANEL_INJECTED__ = true;

    const PREFIX = 'LMS_QA_';
    const STORAGE_KEY = '__LMS_QA_PANEL_STATE__';

    const SAVED = (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch { return {}; }
    })();

    function persist(patch) {
        try {
            const next = { ...SAVED, ...patch };
            Object.assign(SAVED, patch);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch { /* ignore */ }
    }

    // ───────── Shadow host ─────────
    const host = document.createElement('div');
    host.id = 'lms-qa-panel-host';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;' +
        ' top: ' + (SAVED.top || '16px') + ';' +
        ' left: ' + (SAVED.left || 'auto') + ';' +
        ' right: ' + (SAVED.right || '16px') + ';';

    const root = host.attachShadow({ mode: 'closed' });

    root.innerHTML = `
<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .panel {
        background: #1f2937; color: #f3f4f6; border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4); width: 260px;
        font-size: 12px; user-select: none;
        border: 1px solid #374151;
    }
    .header {
        display: flex; align-items: center; padding: 6px 8px;
        background: #111827; border-radius: 8px 8px 0 0; cursor: move;
        border-bottom: 1px solid #374151;
    }
    .title { font-weight: 600; flex: 1; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: #9ca3af; }
    .header button {
        background: transparent; border: 0; color: #9ca3af; cursor: pointer;
        font-size: 14px; line-height: 1; padding: 2px 6px; border-radius: 4px;
    }
    .header button:hover { background: #374151; color: #f3f4f6; }
    .body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .body.collapsed { display: none; }
    .row { display: flex; gap: 4px; }
    button.action, select, input {
        background: #374151; color: #f3f4f6; border: 1px solid #4b5563;
        padding: 6px 8px; border-radius: 4px; font-size: 12px;
        cursor: pointer; flex: 1; font-family: inherit;
    }
    button.action:hover { background: #4b5563; }
    button.action:active { background: #1f2937; }
    button.action.primary { background: #2563eb; border-color: #1d4ed8; }
    button.action.primary:hover { background: #1d4ed8; }
    button.action.success { background: #059669; border-color: #047857; }
    button.action.success:hover { background: #047857; }
    button.action.danger { background: #dc2626; border-color: #b91c1c; }
    button.action.danger:hover { background: #b91c1c; }
    input { flex: 0 0 60px; }
    .status {
        font-size: 11px; color: #9ca3af; padding: 4px 6px;
        background: #111827; border-radius: 4px; min-height: 18px;
        word-break: break-word; max-height: 60px; overflow-y: auto;
    }
    .status.success { color: #6ee7b7; }
    .status.error { color: #fca5a5; }
    .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
    .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #6b7280; margin-right: 4px; vertical-align: middle; }
    .dot.active { background: #10b981; box-shadow: 0 0 6px #10b981; }
    .dot.running { background: #f59e0b; animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
</style>
<div class="panel">
    <div class="header" id="header">
        <span class="title"><span class="dot" id="dot"></span>LMS QA</span>
        <button id="btn-min" title="Minimize">−</button>
        <button id="btn-close" title="Close">×</button>
    </div>
    <div class="body" id="body">
        <div class="row">
            <button class="action primary" id="btn-scan">Scan</button>
            <button class="action" id="btn-skip">Skip Video</button>
        </div>
        <div class="row">
            <button class="action" id="btn-fast">Fast ×16</button>
            <button class="action" id="btn-next">Click Next</button>
        </div>
        <div class="label">SCORM completion</div>
        <div class="row">
            <select id="status-sel">
                <option value="completed">Completed</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="incomplete">Incomplete</option>
            </select>
            <input type="number" id="score-in" min="0" max="100" value="100" />
            <button class="action success" id="btn-complete">Set</button>
        </div>
        <div class="row">
            <button class="action success" id="btn-auto">▶ Auto-Run</button>
        </div>
        <div class="status" id="status">Ready. Click Scan to detect LMS APIs.</div>
    </div>
</div>
    `;

    document.documentElement.appendChild(host);

    const $ = (id) => root.getElementById(id);
    const statusEl = $('status');
    const dotEl = $('dot');

    function setStatus(msg, kind = '') {
        statusEl.textContent = msg;
        statusEl.className = 'status ' + kind;
    }

    function setDot(state) {
        dotEl.className = 'dot ' + state;
    }

    // ───────── Drag handle ─────────
    (function makeDraggable() {
        const header = $('header');
        let dragging = false, sx = 0, sy = 0, hx = 0, hy = 0;
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            const rect = host.getBoundingClientRect();
            hx = rect.left; hy = rect.top;
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const nx = hx + (e.clientX - sx);
            const ny = hy + (e.clientY - sy);
            host.style.left = nx + 'px';
            host.style.top = ny + 'px';
            host.style.right = 'auto';
        });
        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            persist({ top: host.style.top, left: host.style.left, right: 'auto' });
        });
    })();

    // ───────── Collapsed state ─────────
    if (SAVED.collapsed) $('body').classList.add('collapsed');
    $('btn-min').addEventListener('click', () => {
        const isCol = $('body').classList.toggle('collapsed');
        persist({ collapsed: isCol });
    });
    $('btn-close').addEventListener('click', () => {
        host.remove();
        window.__LMS_QA_PANEL_INJECTED__ = false;
        // Notify the page-side so re-toggle from the extension works
        window.postMessage({ type: PREFIX + 'PANEL_CLOSED' }, '*');
    });

    // ───────── Send commands to the validator ─────────
    function send(cmd, payload = {}) {
        window.postMessage({ type: PREFIX + cmd, payload }, '*');
    }

    function ensureValidator(then) {
        if (window.__LMS_QA_INJECTED__) { then(); return; }
        // Ask the content script to inject the validator
        window.postMessage({ type: PREFIX + 'PANEL_REQUEST_INJECT' }, '*');
        setTimeout(then, 250);
    }

    // ───────── Buttons ─────────
    $('btn-scan').addEventListener('click', () => {
        setStatus('Scanning...', '');
        setDot('running');
        ensureValidator(() => send('CMD_SCAN'));
    });

    $('btn-skip').addEventListener('click', () => {
        setStatus('Advancing media...', '');
        setDot('running');
        ensureValidator(() => send('CMD_ADVANCE_MEDIA', { mode: 'end' }));
    });

    $('btn-fast').addEventListener('click', () => {
        setStatus('Speeding up media...', '');
        setDot('running');
        ensureValidator(() => send('CMD_ADVANCE_MEDIA', { mode: 'fast' }));
    });

    $('btn-next').addEventListener('click', () => {
        setStatus('Clicking advance...', '');
        setDot('running');
        ensureValidator(() => send('CMD_CLICK_ADVANCE', { allMatching: false }));
    });

    $('btn-complete').addEventListener('click', () => {
        const status = $('status-sel').value;
        const score = parseInt($('score-in').value || '100', 10);
        setStatus(`Setting completion (${status}, ${score})...`, '');
        setDot('running');
        ensureValidator(() => send('CMD_SET_COMPLETION', { status, score, apiIndex: 0 }));
    });

    // ───────── Auto-run loop ─────────
    let autoTimer = null;
    let lastUrl = location.href;
    let stallCount = 0;

    function stopAuto() {
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
        $('btn-auto').textContent = '▶ Auto-Run';
        $('btn-auto').classList.remove('danger');
        $('btn-auto').classList.add('success');
        setDot('active');
    }

    function tick() {
        const before = {
            url: location.href,
            videoCount: document.querySelectorAll('video, audio').length,
            buttonText: (document.querySelector('button:not([disabled])')?.textContent || '').trim()
        };

        // Advance media (best effort, fires regardless)
        send('CMD_ADVANCE_MEDIA', { mode: 'end' });

        // Click next a moment later, give media handlers time to release the gate
        setTimeout(() => send('CMD_CLICK_ADVANCE', { allMatching: false }), 600);

        // Check for progress
        autoTimer = setTimeout(() => {
            const changed = before.url !== location.href ||
                            before.videoCount !== document.querySelectorAll('video, audio').length ||
                            before.buttonText !== (document.querySelector('button:not([disabled])')?.textContent || '').trim();
            if (changed) {
                stallCount = 0;
                setStatus(`Auto: progress detected (cycle ok)`, 'success');
            } else {
                stallCount++;
                setStatus(`Auto: no change (stall ${stallCount}/4)`, '');
            }

            if (stallCount >= 4) {
                setStatus('Auto: stopped (no progress for 4 cycles)', 'error');
                stopAuto();
                return;
            }

            if (autoTimer !== null) tick();
        }, 2500);
    }

    $('btn-auto').addEventListener('click', () => {
        if (autoTimer !== null) { stopAuto(); setStatus('Auto: stopped by user'); return; }
        stallCount = 0;
        $('btn-auto').textContent = '■ Stop';
        $('btn-auto').classList.remove('success');
        $('btn-auto').classList.add('danger');
        setDot('running');
        setStatus('Auto: running. Click Stop to abort.', '');
        ensureValidator(tick);
    });

    // ───────── Result listener ─────────
    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const t = e.data?.type;
        if (!t || !t.startsWith(PREFIX)) return;
        const payload = e.data.payload || {};

        switch (t.replace(PREFIX, '')) {
            case 'SCAN_COMPLETE': {
                const apis = (payload.apis || []).length;
                const qa = payload.qa?.total || 0;
                setStatus(`Scan: ${apis} API(s), ${qa} Q&A item(s)`, apis > 0 ? 'success' : '');
                setDot(apis > 0 ? 'active' : '');
                break;
            }
            case 'SCAN_ERROR':
                setStatus('Scan failed: ' + (payload.error || ''), 'error');
                setDot('');
                break;
            case 'ADVANCE_MEDIA_RESULT':
                if (payload.count > 0) {
                    setStatus(`Advanced ${payload.count} media element(s)`, 'success');
                } else {
                    setStatus('No <video>/<audio> in reachable frames', '');
                }
                if (!autoTimer) setDot(payload.count > 0 ? 'active' : '');
                break;
            case 'CLICK_ADVANCE_RESULT':
                if (payload.clicked > 0) {
                    setStatus(`Clicked "${payload.labels?.[0]}" (${payload.candidates} candidates)`, 'success');
                } else {
                    setStatus('No Next/Continue button found', '');
                }
                if (!autoTimer) setDot(payload.clicked > 0 ? 'active' : '');
                break;
            case 'SET_COMPLETION_RESULT':
                if (payload.success) {
                    setStatus(`Completion set (${payload.apiType || 'api'})`, 'success');
                } else {
                    setStatus('Set failed: ' + (payload.error || 'unknown'), 'error');
                }
                setDot(payload.success ? 'active' : '');
                break;
            case 'TEST_RESULT':
                setStatus(payload.success ? 'API test OK' : ('API test failed: ' + (payload.error || '')),
                          payload.success ? 'success' : 'error');
                break;
        }
    });

    // ───────── Public toggle ─────────
    window.LMS_QA_PANEL = {
        show() { host.style.display = ''; },
        hide() { host.style.display = 'none'; },
        toggle() { host.style.display = host.style.display === 'none' ? '' : 'none'; },
        remove() { host.remove(); window.__LMS_QA_PANEL_INJECTED__ = false; }
    };
})();
