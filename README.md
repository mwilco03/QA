# LMS QA Validator

Extract Q&A content from Learning Management System (LMS) courses, detect SCORM/xAPI APIs, and validate eLearning content.

**Current Version: v7.0.0**

## What is this?

LMS QA Validator helps QA testers and developers extract question/answer content from eLearning courses. It supports multiple authoring tools and delivery methods:

- **Articulate Storyline** - Slide data, accessibility DOM, frame analysis
- **Articulate Rise 360** - Knowledge blocks, quiz components
- **Adobe Captivate** - Quiz data, DOM patterns
- **Lectora** - Trivantis quiz structures
- **iSpring** - Quiz modules, presentation slides

## Choose Your Method

| Branch | Use Case | Installation |
|--------|----------|--------------|
| [`extension`](../../tree/extension) | Chrome browser extension with full UI | Load unpacked in Chrome |
| [`pasteable`](../../tree/pasteable) | Console scripts for restricted environments | Copy-paste into DevTools |

### Browser Extension ([`extension` branch](../../tree/extension))

Full-featured Chrome extension with:
- Visual element picker for custom Q&A extraction
- Question bank collaboration features
- Auto-detection of authoring tools
- One-click answer auto-fill
- Export to JSON/CSV/TXT

**Install:**
```bash
git clone -b extension https://github.com/mwilco03/QA.git
# Then load unpacked in chrome://extensions/
```

### Console Scripts ([`pasteable` branch](../../tree/pasteable))

For environments where browser extensions are controlled/restricted:
- Copy-paste scripts into browser DevTools console
- No installation required
- Minified versions available (~63% smaller)

**Quick start:**
```bash
git clone -b pasteable https://github.com/mwilco03/QA.git
# Open lib/*.js files and paste into browser console
```

---

## Branch Structure

```
main                    # This landing page (documentation only)
├── extension           # Chrome browser extension (full UI)
├── pasteable           # Console scripts (copy-paste)
└── claude/*            # Development/feature branches
```

| Branch | Purpose | Status |
|--------|---------|--------|
| `main` | Landing page and documentation | Stable |
| `extension` | Chrome extension with popup UI, service worker, content scripts | Stable (v7.0.0) |
| `pasteable` | Standalone scripts for browser console | Stable (v7.0.0) |

---

## Build System

### Node.js Usage

Node.js is used **only for build tooling** (minification, CI/CD). The actual scripts are optimized for and run in:

- **Browser console** - All `pasteable` scripts are pure browser JavaScript
- **Chrome extension APIs** - Extension code uses Chrome-specific APIs

**Build priority**: Browser/extension compatibility always wins. If there's ever a conflict between Node.js and browser implementation, browser takes priority.

### GitHub Actions Workflows

Both `extension` and `pasteable` branches have CI/CD workflows:

- **extension**: Minifies JS/CSS, creates release artifacts
- **pasteable**: Builds minified console scripts via `terser`

```yaml
# Example: pasteable branch workflow
- npm install --ignore-scripts
- npm run build  # Creates dist/*.min.js
```

---

## Features Overview

### Q&A Extraction
- Visual element picker (click to select questions/answers)
- Pattern-based extraction for known authoring tools
- SCORM interaction data parsing
- Accessibility DOM extraction (Storyline)

### SCORM/xAPI Support
- Auto-detect SCORM 1.2, SCORM 2004, xAPI, AICC APIs
- Test API connectivity
- Set completion status and scores
- Wrapper library detection (pipwerks, xAPIWrapper, ADL)

### Export Options
- **JSON** - Structured schema for automation pipelines
- **CSV** - For spreadsheets
- **TXT** - Human-readable format

### Question Types Supported
- Multiple Choice / Multiple Select
- True/False
- Sequencing/Ordering
- Matching
- Fill-in-the-Blank

---

## Quick Reference

### Console API (when scripts are loaded)

```javascript
// Extract Q&A
await LMSExtractor.extract()

// Get correct answers
LMSExtractor.getCorrectAnswers()

// Complete course
await LMSExtractor.complete(100)

// Download results
LMSExtractor.download('json')
```

### Extension Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+R` | Scan page |
| `Ctrl+F` | Focus search |
| `Ctrl+E` | Export as JSON |
| `Escape` | Clear search |

---

## Action Items

### Pending Work

| Branch | Issue | Priority |
|--------|-------|----------|
| `extension` | Ensure `lib/element-selector.js` is present | High |
| `pasteable` | Verify `install.html` works correctly | Medium |
| `claude/code-review-assessment-*` | Contains mixed extension/console content - needs cleanup or archival | Low |
| `claude/restore-copy-pasteable-scripts-*` | WIP branch - merge or archive | Low |

### Branch Maintenance

- **`extension`** and **`pasteable`** are the canonical branches
- Development branches prefixed with `claude/` are temporary
- Merge or delete stale `claude/*` branches after review

---

## Contributing

1. Fork the repository
2. Create a feature branch from `extension` or `pasteable`
3. Make changes and test in browser
4. Submit PR to the appropriate branch

**Important**: All code must work in browser environments. Node.js is only for build tooling.

---

## Documentation

| Document | Location |
|----------|----------|
| Extension README | [`extension` branch README](../../tree/extension) |
| Console Scripts README | [`pasteable` branch README](../../tree/pasteable) |
| Browser Setup Guide | [`pasteable` branch `docs/BROWSER-SETUP.md`](../../blob/pasteable/docs/BROWSER-SETUP.md) |
| Architecture Guide | [`pasteable` branch `docs/ARCHITECTURE.md`](../../blob/pasteable/docs/ARCHITECTURE.md) |

---

## License

MIT License
