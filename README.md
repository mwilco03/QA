# LMS QA Validator v3.4.0

A Chrome extension for validating eLearning content delivery. Detects and interacts with **SCORM 1.2**, **SCORM 2004**, **xAPI**, **AICC**, and **CMI5** APIs. Extracts Q&A content, tests API connectivity, and sets completion/scores — all from the browser.

## Quick Start

### Prerequisites
- Google Chrome (v102 or later)
- The extension source code (this repo)

### Install (3 steps)

```bash
# 1. Clone the repo
git clone https://github.com/mwilco03/QA.git

# 2. Open Chrome extensions page
#    Navigate to: chrome://extensions/

# 3. Load the extension
#    - Toggle "Developer mode" ON (top-right switch)
#    - Click "Load unpacked"
#    - Select the QA/ directory you just cloned
```

That's it. The extension icon appears in your toolbar.

### First Use

1. Navigate to any LMS course page
2. Click the extension icon in the toolbar
3. Click **Scan Page** — the extension will:
   - Detect any SCORM/xAPI/AICC/CMI5 APIs on the page
   - Extract Q&A content from quizzes
   - Show results in the popup

### Set a Course Complete

1. Scan the page (APIs must be detected first)
2. In the **SCORM Controls** section:
   - Select a status (`Completed`, `Passed`, `Failed`, `Incomplete`)
   - Set a score (0–100)
   - Click **Set**

The extension handles the full spec-compliant sequence: sets status, score, exit mode, commits, and terminates the session.

### Test an API

Click **Test API** to verify the LMS API is responding. The extension will:
- Call `LMSInitialize` / `Initialize` (SCORM)
- Send `GetParam` (AICC)
- Retrieve an auth token (CMI5)
- Verify the send function exists (xAPI)

## Supported LMS Standards

| Standard | Detection | Test | Set Completion | Data Read |
|----------|-----------|------|----------------|-----------|
| SCORM 1.2 | Window/parent/opener frame traversal for `API` object | `LMSInitialize` + `LMSGetValue` | Full: status, score (raw/min/max), exit, commit, finish | 14 CMI elements |
| SCORM 2004 | Frame traversal for `API_1484_11` object | `Initialize` + `GetValue` | Full: completion + success status, scaled/raw score, exit, commit, terminate | 16 CMI elements |
| xAPI | `ADL.XAPIWrapper`, `TinCan`, `sendStatement`/`saveStatement` | Verifies send function + LRS config | Sends completion/passed/failed statement | Via LRS queries |
| AICC | URL params: `aicc_sid` + `aicc_url` | `GetParam` HACP request | `PutParam` + `ExitAU` HACP requests | `GetParam` response parsing |
| CMI5 | URL params: `endpoint`, `fetch`, `actor`, `registration`, `activityId` | Auth token retrieval from fetch URL | xAPI statement with cmi5 context category | Via LRS queries |

## Features

### LMS API Harness
- Discovers APIs across window, parent, top, and opener frame chains (up to 7 levels per ADL spec)
- Tests API connectivity with error code checking (`LMSGetLastError` / `GetLastError`)
- Sets completion with full spec-compliant sequences (not just `SetValue` — includes commit and terminate)
- Reads CMI data model elements including bookmarks, entry mode, credit, mastery scores

### Content Extraction
- **Storyline Support**: Extracts Q&A from Articulate Storyline data files
- **DOM Quiz Detection**: Finds form-based quizzes (select, radio, checkbox) with correct answer indicators
- **Auto-Select Answers**: Fills in detected correct answers for form quizzes

### Multi-Window Support
- Tracks parent/child/sibling tab relationships
- Cross-domain session linking (LMS portal on one domain, content CDN on another)
- Scan related windows from the popup

### Export
- JSON (full data), CSV (Q&A table), TXT (answer key)
- Keyboard shortcut: `Ctrl+E`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+R` | Scan page |
| `Ctrl+F` | Focus search filter |
| `Ctrl+E` | Export as JSON |
| `Escape` | Clear search |

## Architecture

```
QA/
├── manifest.json              # Extension config (MV3)
├── background/
│   └── service-worker.js      # Tab state, domain sessions, downloads
├── content/
│   └── content.js             # Bridge: page context ↔ extension context
├── lib/
│   └── lms-qa-validator.js    # Core: API detection, testing, completion, extraction
├── popup/
│   ├── popup.html             # Popup markup
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic
├── icons/                     # Extension icons
└── tests/
    ├── validator.test.js      # Unit tests
    └── test-runner.html       # Browser test runner
```

### How It Works

```
┌─────────┐    chrome.runtime     ┌──────────────┐    chrome.tabs     ┌─────────────┐
│  Popup   │ ◄──────────────────► │   Service    │ ◄────────────────► │   Content   │
│ popup.js │    sendMessage        │   Worker     │    sendMessage     │  content.js │
└─────────┘                       │ service-     │                    └──────┬──────┘
                                  │ worker.js    │                           │
                                  └──────────────┘                    postMessage('*')
                                                                            │
                                                                     ┌──────┴──────┐
                                                                     │  Validator   │
                                                                     │ (page ctx)   │
                                                                     │ lms-qa-      │
                                                                     │ validator.js │
                                                                     └─────────────┘
```

1. **Popup** sends commands to the **service worker**, which routes them to the active tab's **content script**
2. **Content script** bridges messages to the **validator** running in the page context (required to access SCORM/xAPI objects on `window`)
3. **Validator** discovers APIs, runs tests, sets completion, and sends results back up the chain

### Component Responsibilities

| Component | Role |
|-----------|------|
| **service-worker.js** | Tab state management, domain session tracking, parent/child tab linking, scan history storage, file downloads |
| **content.js** | Message bridge between extension and page contexts, validator injection |
| **lms-qa-validator.js** | API discovery (SCORM/xAPI/AICC/CMI5), API testing, completion setting, CMI data reads, DOM quiz extraction, Storyline parsing, export formatting |
| **popup.js** | UI rendering, user actions, result display, search/filter |

## Console API

The validator exposes a `window.LMS_QA` object in the page console:

```javascript
LMS_QA.scan()                                          // Run a full scan
LMS_QA.getState()                                      // Current validator state
LMS_QA.getQA()                                         // Extracted Q&A items
LMS_QA.getAPIs()                                       // Detected LMS APIs

LMS_QA.testAPI(0)                                      // Test first detected API
LMS_QA.setCompletion({ status: 'passed', score: 95 })  // Set completion

LMS_QA.autoSelect()                                    // Auto-fill correct answers
LMS_QA.getDOMQuizzes()                                 // Get form-based quizzes

LMS_QA.export('json')                                  // Export results
LMS_QA.export('csv')
LMS_QA.export('txt')
```

## Development

### No Build Required

The extension runs directly from source — no bundler, no transpiler, no `npm install`. Load the directory in Chrome and go.

### Running Tests

Open `tests/test-runner.html` in a browser to run the unit test suite.

### Code Principles
- Zero external dependencies
- Pure vanilla JS (no frameworks)
- Spec-compliant API interactions (validated against ADL/Rustici documentation)
- Consistent error handling with try/catch throughout
- Debounced UI operations

## Version History

### v3.4.0 (Current)
- **SCORM 1.2**: Added `LMSFinish` to completion flow, `cmi.core.exit`, `score.min/max`, error checking
- **SCORM 2004**: Fixed invalid `'passed'` in `completion_status`, added `success_status`, `Terminate`, `cmi.exit`
- **xAPI**: Fixed detection to traverse `ADL.XAPIWrapper`, added `TinCan` namespace, completion statements
- **AICC**: Rewritten from scratch — URL param detection, HACP HTTP communication
- **CMI5**: New — URL param detection, auth token retrieval, xAPI statement with cmi5 profile
- **API search depth**: 5 → 7 per ADL spec
- **onInstalled**: No longer destroys scan history on extension updates
- **Shelved**: Element selector (visual picker) removed from active build pending refactor
- **Popup**: Parallel init loading, cleaned up unused selector UI

### v3.2.0
- Visual element selector for picking Q&A elements
- URL pattern rules with export/import
- DOM proximity grouping
- Hybrid extraction mode

### v3.1.0
- Code detection to prevent extracting JS source as Q&A content
- More restrictive pattern matching

### v3.0.0
- Complete architectural refactor
- Modular code organization
- Centralized state management

### v2.x
- Articulate Storyline support, SCORM API detection, DOM quiz extraction, multi-window tracking

## License

MIT License
