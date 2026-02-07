# LMS QA Validator — Functional & Operational Audit

**Date:** 2026-02-07
**Scope:** Spec compliance, functional correctness, code duplication, extension best practices

---

## Executive Summary

The extension is **functionally broken for 3 of 5 LMS standards** it claims to support, has **critical message-routing bugs** that silently break the element selector feature, and contains **significant code duplication** across its monolithic files. SCORM 1.2 and SCORM 2004 are the only working harnesses, and both have spec violations that will cause data loss on certain LMS platforms.

### Functional Status by Standard

| Standard | Detection | Test API | Set Completion | Overall |
|----------|-----------|----------|----------------|---------|
| SCORM 1.2 | Works | Works | **Incomplete** — missing `LMSFinish` | Partially functional |
| SCORM 2004 | Works | Works | **Buggy** — invalid status values | Partially functional |
| xAPI | **Broken** — wrong object paths | Not implemented | Not implemented | Non-functional |
| AICC | **Dead code** — fabricated API names | Not implemented | Not implemented | Non-functional |
| CMI5 | Not implemented | Not implemented | Not implemented | Not implemented |

---

## Part 1: SCORM 1.2 Spec Compliance

### What's Correct
- API method names (`LMSInitialize`, `LMSGetValue`, etc.) are all correctly spelled
- API object name `API` is correct for SCORM 1.2 discovery
- `LMSInitialize('')` call signature is correct (empty string parameter)
- Pragmatic `'true' || true` return value check handles non-conformant LMS implementations
- CMI data model element paths (`cmi.core.student_name`, etc.) are all valid
- `cmi.core.lesson_status` is the correct element for completion

### Critical Issues

**1. `LMSFinish('')` is never called** (`lms-qa-validator.js` setCompletion)
- The spec requires `LMSFinish` as the final API call to close the communication session
- Without it, some LMS platforms will **not persist any data** — they wait for `LMSFinish` to trigger the database write
- The session remains "open" causing lock-out issues, incorrect time tracking, and state corruption
- **This is the single most important SCORM 1.2 API call for session termination**

**2. `cmi.core.exit` is never set**
- Without setting this to `"suspend"` or `""`, the LMS may discard runtime data
- If `cmi.core.exit` is not set to `"suspend"` before `LMSFinish`, the LMS is free to discard `suspend_data`

### Medium Issues

**3. `MAX_API_SEARCH_DEPTH` is 5, spec says 7** (`lms-qa-validator.js:33`)
- The ADL reference algorithm traverses parent frames up to 7 levels
- A deeply nested LMS (6-7 frames) would fail detection

**4. Score handling incomplete** — only `cmi.core.score.raw` is set
- `cmi.core.score.min` and `cmi.core.score.max` are never written during completion
- Without these, the LMS cannot normalize the score

**5. Missing CMI elements in `getCmiData()`**
- Missing: `cmi.core.lesson_location` (bookmarks), `cmi.core.entry` (resume detection), `cmi.core.credit`, `cmi.core.lesson_mode`, `cmi.launch_data`

**6. No error checking after API calls**
- `LMSGetLastError()` is never called after `LMSSetValue` or `LMSCommit` to verify success

**7. No `lesson_status` value validation**
- Valid values: `"passed"`, `"completed"`, `"failed"`, `"incomplete"`, `"browsed"`, `"not attempted"`
- Invalid values are passed through to `LMSSetValue` without checking

### Correct Completion Flow Should Be
```
LMSSetValue('cmi.core.lesson_status', status)
LMSSetValue('cmi.core.score.raw', String(score))
LMSSetValue('cmi.core.score.min', '0')
LMSSetValue('cmi.core.score.max', '100')
LMSSetValue('cmi.core.exit', '')
LMSCommit('')
LMSFinish('')   // <-- MISSING
```

---

## Part 2: SCORM 2004 Spec Compliance

### What's Correct
- API method names (`Initialize`, `GetValue`, `SetValue`, `Commit`, `Terminate`) correct
- `API_1484_11` object name is correct
- `Initialize('')` call signature correct
- Separate `cmi.completion_status` and `cmi.success_status` correctly handled in data model reads
- `cmi.score.scaled` range (0.0 to 1.0) correctly computed via `score / 100`

### Critical Issues

**1. BUG: `'passed'` written to `cmi.completion_status`** (`lms-qa-validator.js:738-739`)
```js
const status2004 = status === 'completed' ? 'completed' :
                   status === 'passed' ? 'passed' : 'incomplete';
```
- `'passed'` is **NOT a valid value** for `cmi.completion_status`
- Valid values: `"completed"`, `"incomplete"`, `"not attempted"`, `"unknown"`
- A conformant LMS will reject this with error code 406 ("Data Model Element Type Mismatch")
- `'passed'` belongs exclusively to `cmi.success_status`

**2. `cmi.success_status` is never set**
- When the user requests "passed", nothing is written to `cmi.success_status`
- The LMS has no record of the learner's mastery

**3. `Terminate('')` is never called**
- Same issue as SCORM 1.2's missing `LMSFinish`
- `Terminate` signals session end and triggers the LMS sequencing engine
- Without it, data may not persist and navigation requests are not processed

### Correct Completion Flow Should Be
```
SetValue('cmi.completion_status', 'completed')       // always 'completed' or 'incomplete'
SetValue('cmi.success_status', 'passed')              // 'passed' or 'failed' — SEPARATE
SetValue('cmi.score.scaled', String(score / 100))
SetValue('cmi.score.raw', String(score))
SetValue('cmi.score.min', '0')
SetValue('cmi.score.max', '100')
SetValue('cmi.exit', 'normal')
Commit('')
Terminate('')   // <-- MISSING
```

---

## Part 3: xAPI (Experience API) — BROKEN

### Detection is Fundamentally Broken

**The most common xAPI library (ADL xAPIWrapper) will not be detected.**

The code searches for `window.ADL` and then checks if `ADL.sendStatement` is a function. But the actual path is `ADL.XAPIWrapper.sendStatement` — the `identifyAPI` function only checks direct properties, not nested namespaces.

| Search Target | Verdict | Reality |
|---|---|---|
| `window.ADL` | Found, but methods not at this level | `ADL.XAPIWrapper.sendStatement()` is the actual path |
| `window.xAPIWrapper` | Almost never exists | ADL creates `ADL.XAPIWrapper`, not `window.xAPIWrapper` |
| `window.TinCanAPI` | Not a standard global | TinCan.js creates `window.TinCan`, not `window.TinCanAPI` |
| `window.TinCan` | **NOT SEARCHED** | This is where TinCan.js actually lives |
| `TinCan.LRS.saveStatement` | Not recognized | TinCan.js uses `saveStatement()`, not `sendStatement()` |

### No Test or Interaction Logic
- `test()` function has no xAPI handler — falls through to `result.success = true` (false positive)
- `setCompletion()` has no xAPI handler — silently does nothing
- No code constructs or sends xAPI statements

### Impact
The extension advertises xAPI support but **cannot detect, test, or interact with any real xAPI implementation**.

---

## Part 4: AICC — DEAD CODE

### API Names Are Fabricated

The code defines: `['AICC_Init', 'AICC_GetParam', 'AICC_PutParam']`

**These function names do not exist in any AICC specification.** AICC uses HTTP HACP (HTTP AICC Communication Protocol), not JavaScript API calls. Communication happens via HTTP POST requests with commands `GetParam`, `PutParam`, `ExitAU`.

### How AICC Actually Works
An AICC course is launched with URL parameters `aicc_sid` (session ID) and `aicc_url` (LMS endpoint):
```
https://content.example.com/start.html?aicc_sid=ABC123&aicc_url=https://lms.example.com/aicc/handler
```
Communication is via HTTP POST, not JavaScript function calls. The entire approach of searching for named objects is wrong for AICC.

### Proper AICC Detection Would Require
1. Parse `window.location.search` for `aicc_sid` and `aicc_url` parameters
2. Optionally monitor XHR/fetch for HACP command patterns

### Impact
The AICC detection signatures will **never match anything** — no course exposes `window.AICC_Init`. This is dead code.

---

## Part 5: CMI5 — NOT IMPLEMENTED

The constant `LMS_STANDARD.CMI5 = 'cmi5'` is defined but no signatures, detection, test, or interaction logic exists. CMI5 is the designated successor to SCORM and is increasingly adopted. Detection requires checking URL parameters (`endpoint`, `fetch`, `actor`, `registration`, `activityId`).

---

## Part 6: Element Selector — MESSAGE ROUTING BUG

### The PREFIX Double-Prefix Bug

**Element-selector messages never reach the popup or service worker.** This silently breaks the entire selector integration.

The chain:
1. `element-selector.js` defines `PREFIX = 'LMS_QA_SELECTOR_'` (line 39)
2. `Selector.sendMessage('SELECTOR_ACTIVATED')` produces `'LMS_QA_SELECTOR_SELECTOR_ACTIVATED'`
3. `content.js` receives this via `window.addEventListener('message')` and strips its own prefix `'LMS_QA_'`
4. This yields `'SELECTOR_SELECTOR_ACTIVATED'` — note the double "SELECTOR_"
5. `service-worker.js` expects `'SELECTOR_ACTIVATED'` — **no match**

### Dead Popup Handlers (never fire)
- `popup.js:962` — `[MSG.SELECTOR_ACTIVATED]`
- `popup.js:967` — `[MSG.SELECTOR_DEACTIVATED]`
- `popup.js:972` — `[MSG.SELECTOR_RULE_CREATED]`
- `popup.js:983` — `[MSG.EXTRACTION_COMPLETE]`
- `popup.js:1000` — `[MSG.EXTRACTION_ERROR]`

### Hybrid Mode API Detection Also Broken
`element-selector.js:1734` sends `'LMS_QA_SELECTOR_CMD_DETECT_APIS'` but the validator expects `'LMS_QA_CMD_DETECT_APIS'`. The `pendingHybridResults` variable is set but never consumed.

---

## Part 7: Code Duplication Audit

### Constants Defined in 3+ Places

| Constant | popup.js | service-worker.js | lms-qa-validator.js | content.js | element-selector.js |
|---|---|---|---|---|---|
| MSG types | Lines 23-38 | Lines 14-30 | Lines 82-103 | Lines 17-32 | — |
| `PREFIX` | — | — | Line 83 | Line 15 | Line 39 |
| `DEBOUNCE_DELAY` | Line 21 | — | Line 37 | — | — |
| `CORRECT_INDICATORS` | — | — | Lines 71-75 | — | Lines 1595-1612 (inline) |
| MIME type maps | Line 615 | Lines 934-938 | Lines 1907-1923 | — | — |
| Timestamp format | Line 557, 815 | Line 927 | Line 1904 | — | — |

### Functions Duplicated Across Files

| Function | Location 1 | Location 2 | Location 3 |
|---|---|---|---|
| `escapeHtml` | popup.js:59-64 | lms-qa-validator.js:397-402 | element-selector.js:1045 (inline variant) |
| `truncate` | popup.js:66-69 | lms-qa-validator.js:409-412 | — |
| URL pattern generation | popup.js:733-743 | element-selector.js:778-791 | — |
| `toCSV` | popup.js:578-589 | lms-qa-validator.js:1928-1941 | — |
| `toTXT` | popup.js:592-611 | lms-qa-validator.js:1944-1984 | — |
| Download helper | popup.js:614-625 | service-worker.js:933-956 | — |
| Logging | content.js:47-51 | service-worker.js:265-270 | lms-qa-validator.js:235-293 + element-selector.js:471-473 |
| Safe JSON parse | — | (ad hoc try/catch) | lms-qa-validator.js:389-394 |
| iframe traversal | — | — | lms-qa-validator.js:828-835 + 1257-1264 + element-selector.js:77-96 |
| Correct-answer detection | — | — | lms-qa-validator.js:358-382 + 1486-1514 + element-selector.js:1583-1614 |
| Text extraction | — | — | 5 independent implementations across 2 files |

### Broken CSS Variables

`popup.css` lines 876-925 (saved-rules section) uses variables that **do not exist** in the `:root` block:

| Used | Defined | Result |
|---|---|---|
| `--spacing-md` | `--space-md` | Styles silently broken |
| `--spacing-sm` | `--space-sm` | Styles silently broken |
| `--color-bg-elevated` | Not defined | Falls back to initial value |
| `--font-mono` | Not defined | Falls back to initial value |
| `--color-accent` | Not defined | Falls back to initial value |

The entire saved-rules section is visually broken.

### Dead Code

| Location | What | Why Dead |
|---|---|---|
| service-worker.js:591-603 | Port-based listener | No file ever calls `chrome.runtime.connect()` |
| popup.js:962-1003 | 5 selector message handlers | PREFIX double-prefix bug prevents messages from arriving |
| service-worker.js:415-445 | Selector event forwarding | Same PREFIX bug |
| element-selector.js:1709 | `pendingHybridResults` | API detection message never matches |
| popup.js:91 | `State.settings.autoScan` | Never read or modified |
| service-worker.js:705 | `existingChildren` variable | Assigned but never used |

### Performance Issues

| Issue | Location | Severity |
|---|---|---|
| O(q * a * n) TreeWalker — `getDocumentPosition` per element | element-selector.js:1620-1637 | High — freezes on large pages |
| O(candidates * log(candidates)) querySelectorAll in sort | element-selector.js:739-766 | Medium |
| Sequential async calls on popup init (should be `Promise.all`) | popup.js:1126-1138 | Medium — startup latency |
| Full innerHTML rebuild on every search keystroke | popup.js:402-424 | Medium |
| Uncached `chrome.storage.local.get` on every rule check | service-worker.js (5 locations) | Medium |
| Content script injected on ALL URLs by manifest + programmatic re-injection | manifest.json:34-42 + service-worker.js:281-293 | High — unnecessary overhead |

---

## Part 8: Extension Best Practices Audit

### Service Worker Volatility (CRITICAL)

All tab state, session tracking, and relationships are stored in in-memory `Map` objects (`service-worker.js:44-47`). When the MV3 service worker terminates (after 30s inactivity or 5min total), **all state is lost**. The `sessionIdCounter` (line 96) resets to 0 causing potential ID collisions. Core tab-tracking functionality depends on state that does not survive restarts.

### onInstalled Destroys Data on Update

`service-worker.js:962-965` unconditionally resets `scanHistory` to `[]` on every install, update, and browser update. Should check `details.reason` to distinguish `'install'` from `'update'`.

### Version Inconsistency

| Location | Version |
|---|---|
| manifest.json:4 | `3.3.0` |
| popup.html:247 | `v3.2` |
| popup.js:810 (exportRules) | `3.2.0` |
| lms-qa-validator.js:29 | `3.3.0` |

### Missing from Manifest
- No `minimum_chrome_version` (should be 102+)
- No Content Security Policy
- No `options_page` or `options_ui`
- No privacy policy reference

### Accessibility Failures
- Tab navigation has no ARIA roles (`role="tablist"`, `role="tab"`, `role="tabpanel"`)
- Form inputs missing labels (`search-input`, `completion-score`, `completion-status`)
- Toast notifications have no `role="alert"` or `aria-live` region
- `--color-text-muted` (#94a3b8) on white fails WCAG AA contrast (3.3:1 vs required 4.5:1)
- QA list items not keyboard-accessible (no `tabindex`, no `keydown` handler)

### Unbounded Storage Growth
`results_${domain}` keys accumulate with no eviction policy. `scanHistory` is capped at 50 but per-domain results are never cleaned up.

### Async sendResponse Missing Error Handling
`service-worker.js` lines 473-549: Promise-based `sendResponse` calls have no `.catch()`. If any async operation rejects, `sendResponse` is never called, leaving the sender hanging indefinitely.

---

## Part 9: Refactoring Priorities

### Priority 1: Fix What's Broken
1. Add `LMSFinish('')` / `Terminate('')` to completion flows
2. Fix SCORM 2004 `'passed'` → `cmi.completion_status` bug (should go to `cmi.success_status`)
3. Fix element-selector PREFIX double-prefix bug
4. Fix xAPI detection to traverse `ADL.XAPIWrapper` and search for `window.TinCan`
5. Fix broken CSS variables in saved-rules section
6. Fix `onInstalled` to check `details.reason`

### Priority 2: Extract Shared Module
Create a `lib/shared.js` containing:
- MSG constants (single source of truth)
- PREFIX constant
- `escapeHtml`, `truncate`, `safeJsonParse`
- URL pattern generation
- CORRECT_INDICATORS
- Export formatters (toCSV, toTXT)
- Timestamp formatting
- MIME type map
- Logging factory

### Priority 3: Split Monoliths
- `lms-qa-validator.js` (2,025 lines) → separate files for Scanner, SCORM API, Exporter, DOMExtractors, StorylineExtractor, ResourceDiscovery
- `element-selector.js` (1,797 lines) → separate files for SelectorGenerator, Panel UI, RuleExtractor, DOMUtils
- Requires a build step (Rollup/esbuild) to bundle back for extension packaging

### Priority 4: Fix Extension Architecture
- Remove declarative `content_scripts` from manifest; inject programmatically only when needed
- Scope `host_permissions` to known LMS domains with `optional_host_permissions` for others
- Persist critical state to `chrome.storage.session` to survive service worker restarts
- Add `.catch()` to all async `sendResponse` chains
- Add `options_page` for user configuration

### Priority 5: Rewrite AICC/xAPI/CMI5
- AICC: Detect via URL parameters (`aicc_sid`, `aicc_url`), implement HACP HTTP communication
- xAPI: Fix detection paths, add `sendStatement` for completion, search for `TinCan` namespace
- CMI5: Detect via URL parameters, implement cmi5 statement profile
