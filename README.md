# LMS QA Validator

Extract Q&A content from Learning Management System (LMS) courses, detect SCORM/xAPI APIs, and validate eLearning content.

**Current Version: v7.0.0**

---

## What is this?

LMS QA Validator helps QA testers and developers extract question/answer content from eLearning courses. It supports multiple authoring tools:

| Authoring Tool | Detection Method | Extraction Sources |
|----------------|------------------|-------------------|
| **Articulate Storyline** | `globalProvideData`, `g_slideData` | Slide data, accessibility DOM, frame analysis |
| **Articulate Rise 360** | `[data-ba-component]`, `.block-knowledge` | Knowledge blocks, quiz components |
| **Adobe Captivate** | `cp.*`, `cpAPIInterface` | Quiz data, DOM patterns, cpInfoQuiz |
| **Lectora** | `trivantis.*`, `TrivantisCore` | Trivantis quiz structures, DOM |
| **iSpring** | `iSpring.*`, `PresentationSettings` | Quiz module, slides, data.js |

---

## Choose Your Method

| Branch | Use Case | Best For |
|--------|----------|----------|
| [`extension`](../../tree/extension) | Chrome browser extension with full UI | Daily use, visual element picker, question banks |
| [`pasteable`](../../tree/pasteable) | Console scripts for restricted environments | Locked-down browsers, quick extraction |

---

## Branch: `extension` (Chrome Extension)

**[View Extension Branch](../../tree/extension)**

Full-featured Chrome extension with visual UI.

### Installation
```bash
git clone -b extension https://github.com/mwilco03/QA.git
# Open chrome://extensions/ → Enable Developer Mode → Load Unpacked
```

### Key Features
- **Question Banks** - Save/share Q&A with team, merge banks, verification tracking
- **Visual Element Picker** - Click to select question/answer elements
- **Auto-Detection** - Identifies authoring tool automatically
- **One-Click Actions** - Auto-fill answers, quick copy correct answers
- **Export** - JSON (structured schema), CSV, TXT

### Extension Files
```
extension/
├── manifest.json              # Extension config (Manifest V3)
├── background/service-worker.js
├── content/content.js
├── lib/
│   ├── lms-qa-validator.js    # Main extraction engine
│   └── tasks-extractor.js     # Network interceptor
└── popup/                     # UI (popup.html, popup.js, popup.css)
```

### Console API (Extension)
```javascript
// After scanning with extension popup:
LMS_QA.getState()              // Current scan state
LMS_QA.getQA()                 // Extracted Q&A
LMS_QA.scan()                  // Run extraction
LMS_QA.autoSelect()            // Auto-fill correct answers
LMS_QA.export('json')          // Export results ('json', 'csv', 'txt')
LMS_QA.setCompletion({ status: 'completed', score: 100 })
```

---

## Branch: `pasteable` (Console Scripts)

**[View Pasteable Branch](../../tree/pasteable)**

Standalone scripts for browser DevTools console. No extension required.

### Quick Start
1. Open LMS course in browser
2. Press `F12` → Console tab
3. Paste script contents from `lib/` or `dist/` (minified)
4. Run commands

**Interactive installer:** Open [`install.html`](../../blob/pasteable/install.html) for copy-to-clipboard setup.

### Available Scripts
| Script | API Object | Purpose |
|--------|------------|---------|
| `lms-extractor-complete.js` | `LMSExtractor` | All-in-one SCORM/TLA/Storyline |
| `storyline-console-extractor.js` | `StorylineExtractor` | Storyline-specific |
| `tla-completion-helper.js` | `TLAHelper` | TLA/xAPI platforms |
| `unified-qa-extractor.js` | `UnifiedQAExtractor` | Multi-format extraction |
| `storyline-data-extractor.js` | `StorylineDataExtractor` | Storyline data parser |

### Pasteable Files
```
pasteable/
├── lib/                       # Source scripts
│   ├── lms-extractor-complete.js
│   ├── storyline-console-extractor.js
│   ├── tla-completion-helper.js
│   ├── unified-qa-extractor.js
│   └── storyline-data-extractor.js
├── dist/                      # Minified (~63% smaller)
│   └── *.min.js
├── install.html               # Browser installation helper
├── docs/
│   ├── BROWSER-SETUP.md       # Snippet setup guide
│   └── ARCHITECTURE.md        # Code architecture
└── scripts/build.js           # Minification script
```

### Console API (Pasteable)
```javascript
// Using lms-extractor-complete.js:
await LMSExtractor.extract()           // Extract all Q&A
LMSExtractor.getCorrectAnswers()       // View correct answers
await LMSExtractor.complete(100)       // Mark complete (score=100)
LMSExtractor.download('json')          // Download results

// Using storyline-console-extractor.js:
StorylineExtractor.run()

// Using storyline-data-extractor.js:
await StorylineDataExtractor.run()     // Results in window.allQA
```

---

## Build System

### Node.js Usage

**Node.js is used ONLY for build tooling.** The actual runtime code is pure browser JavaScript.

| Component | Node Package | Purpose |
|-----------|--------------|---------|
| `pasteable` | `terser` | JS minification |
| `extension` | `terser`, `clean-css-cli` | JS/CSS minification |

**Build priority:** Browser/extension compatibility always wins. If there's a conflict, optimize for browser console and extension.

### GitHub Actions
Both branches have CI/CD workflows (`.github/workflows/build.yml`):
- Runs on push to main or manual trigger
- Outputs minified files to `dist/`
- No runtime Node.js dependencies

---

## Action Items

### Critical Issues

| Branch | Issue | Status | Priority |
|--------|-------|--------|----------|
| `extension` | **`lib/element-selector.js` is MISSING** - Referenced in README but file doesn't exist | MISSING | **HIGH** |
| `extension` | Visual Element Selector feature may be broken without element-selector.js | BLOCKED | **HIGH** |

### Verification Needed

| Branch | Item | Status |
|--------|------|--------|
| `pasteable` | `install.html` - Interactive installer | EXISTS ✓ |
| `pasteable` | `docs/BROWSER-SETUP.md` - Setup guide | EXISTS ✓ |
| `pasteable` | `docs/ARCHITECTURE.md` - Architecture docs | EXISTS ✓ |
| `pasteable` | `dist/*.min.js` - Minified scripts | EXISTS ✓ |

### Branch Cleanup

| Branch | Action Needed |
|--------|---------------|
| `claude/code-review-assessment-*` | Review and archive or delete |
| `claude/restore-copy-pasteable-scripts-*` | Review and merge or delete |

---

## Documentation Links

| Document | Branch | Path |
|----------|--------|------|
| Extension README | `extension` | [README.md](../../blob/extension/README.md) |
| Console Scripts README | `pasteable` | [README.md](../../blob/pasteable/README.md) |
| Browser Setup Guide | `pasteable` | [docs/BROWSER-SETUP.md](../../blob/pasteable/docs/BROWSER-SETUP.md) |
| Architecture Guide | `pasteable` | [docs/ARCHITECTURE.md](../../blob/pasteable/docs/ARCHITECTURE.md) |
| Interactive Installer | `pasteable` | [install.html](../../blob/pasteable/install.html) |
| Usage Guide | `pasteable` | [USAGE.md](../../blob/pasteable/USAGE.md) |

---

## SCORM Direct Access (Advanced)

For direct SCORM API manipulation:

```javascript
// Find API
const api = window.API || window.API_1484_11;

// Get interaction data
const count = parseInt(api.GetValue('cmi.interactions._count'));
for (let i = 0; i < count; i++) {
    console.log({
        id: api.GetValue(`cmi.interactions.${i}.id`),
        type: api.GetValue(`cmi.interactions.${i}.type`),
        correct: api.GetValue(`cmi.interactions.${i}.correct_responses.0.pattern`)
    });
}

// Complete (SCORM 2004)
api.SetValue('cmi.completion_status', 'completed');
api.SetValue('cmi.success_status', 'passed');
api.SetValue('cmi.score.scaled', '1.0');
api.Commit();

// Complete (SCORM 1.2)
api.LMSSetValue('cmi.core.lesson_status', 'passed');
api.LMSSetValue('cmi.core.score.raw', '100');
api.LMSCommit('');
```

---

## Contributing

1. Fork the repository
2. Create feature branch from `extension` or `pasteable`
3. Test in browser (not Node.js)
4. Submit PR to appropriate branch

**Important:** All code must run in browser. Node.js is build-only.

---

## License

MIT License
