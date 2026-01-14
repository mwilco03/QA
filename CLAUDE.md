# QA Console Scripts - Engineering Specification

## Purpose
Browser console scripts for extracting Q&A data from LMS courses (Storyline, SCORM, TLA/xAPI). Fire-and-forget: paste, get object, done.

## Architecture Principles

### 1. Dynamic Resource Resolution
- **NO hardcoded paths** - Discover URLs via `performance.getEntriesByType('resource')` and `document.querySelectorAll('script[src]')`
- **Pattern-based discovery** - Regex match `/html5/`, `/story_content/`, `/data/js/` from loaded resources
- **Multi-window search** - Check current → parent chain → opener chain → iframes before failing

### 2. Loosely Coupled Detection
- **Config-driven** - All detection patterns in CONFIG objects, not inline
- **Type inference** - Determine question type from `accType` values, not filename/URL patterns
- **Fallback chains** - DS → player → _storylineData → DOM scan → SCORM API → xAPI

### 3. Window/Frame Traversal (COMPLETE)
```
Current Window
    ↓
Parent Chain (window.parent, max 20)
    ↓
Opener Chain (window.opener, max 10)
    ↓
Opener's Parent Chain
    ↓
All iframes/frames (recursive, WeakSet cycle detection)
```

## Data Extraction Targets

### Storyline Objects
| Global | Method | Returns |
|--------|--------|---------|
| `window.DS` | `DS.GetVar(name)` | Variable values |
| `window.player` | `player.GetVar(name)` | Variable values |
| `window._storylineData` | Direct property | Raw slide data |

### SCORM APIs
| Global | Version | Key Methods |
|--------|---------|-------------|
| `window.API_1484_11` | SCORM 2004 | `GetValue`, `SetValue` |
| `window.API` | SCORM 1.2 | `LMSGetValue`, `LMSSetValue` |

### TLA/xAPI
| Endpoint | Purpose |
|----------|---------|
| `/api/assets/tasks.json?contentUrl=` | Questions with correctPattern |
| `/api/sessions/{id}/lrs/state` | GET/PUT learner state |
| `/api/sessions/{id}/score` | POST to trigger completion |

## Correct Pattern Parsing

| Type | Pattern Format | Example |
|------|---------------|---------|
| CHOICE | `id` or `id1[,]id2` | `choice_abc[,]choice_def` |
| FILL_IN | `{case_matters=bool}answer1[,]answer2` | `{case_matters=true}TCP[,]tcp` |
| MATCHING | `src1[.]tgt1[,]src2[.]tgt2` | `A[.]1[,]B[.]2` |
| SEQUENCING | `item1[,]item2[,]item3` (ordered) | `first[,]second[,]third` |
| TRUE_FALSE | `true` or `false` | `true` |

## Text Extraction Priority
```
1. obj.textLib[0].vartext.blocks[].spans[].text  (Storyline rich text)
2. obj.rawText
3. obj.text
4. obj.title
5. obj.label
6. obj.accText
```

## Answer Detection

### Recognized accType Values
`checkbox`, `radiobutton`, `button`, `hotspot`, `dragitem`, `dropzone`, `droptarget`, `textentry`, `textinput`, `input`, `clickable`, `selectable`

### Correct State Indicators
`_Review`, `_Selected_Review`, `Correct`, `Right`, `True`, `Yes`, `Selected_Correct`, `Drop_Correct`, `Drag_Correct`, `Match_Correct`, `Answer_Correct`

### Excluded Navigation Text
`continue`, `next`, `back`, `previous`, `submit`, `exit`, `close`, `menu`, `home`, `restart`, `replay`, `review`, `try again`, `start`, `begin`, `finish`, `done`, `ok`, `cancel`, `skip`

## Code Standards

### Required
- **Return the extracted object** - Script must end with `return { questions, answers, correct }` or equivalent
- **Minimal console output** - Only log on error; success returns silent object
- **Self-contained IIFE** - No external dependencies
- **Cross-origin safe** - Try/catch all window/location access
- **Cycle detection** - WeakSet for frame traversal

### Forbidden
- Stub code, placeholder functions, TODO comments
- Magic strings in function bodies (use CONFIG)
- `console.log` for non-error conditions (use return values)
- Hardcoded slide IDs, variable names, or URLs

## Build Process

Node.js used ONLY at build time:
```bash
npm install    # Terser
npm run build  # Creates dist/*.min.js
```

Runtime is pure browser JavaScript with no dependencies.

## Quick Reference: Fire-and-Forget Script Pattern

```javascript
// Paste in console, returns object immediately
(() => {
    const result = { questions: [], correct: [] };
    // ... extraction logic ...
    return result;  // Object available for inspection
})();
```

## File Map

| Path | Purpose | Runtime |
|------|---------|---------|
| `lib/lms-extractor-complete.js` | Universal extractor (SCORM/TLA/Storyline) | Browser |
| `lib/storyline-console-extractor.js` | Storyline-specific with auto-run | Browser |
| `lib/tla-completion-helper.js` | TLA pattern parsing + completion | Browser/Node |
| `lib/storyline-data-extractor.js` | Parse data.js files | Browser/Node |
| `lib/unified-qa-extractor.js` | Multi-format Q&A parser | Browser/Node |
| `dist/*.min.js` | Minified paste-ready versions | Browser |
| `scripts/build.js` | Terser minification | Node (build only) |
