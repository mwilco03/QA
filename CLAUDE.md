# CLAUDE.md - Pasteable Console Scripts

## Project Overview

This is the `pasteable` branch of LMS QA Validator - standalone JavaScript scripts for browser DevTools console. Used to extract Q&A content from LMS courses when browser extensions are restricted.

**Target Runtime:** Browser console (NOT Node.js)
**Build Tooling:** Node.js + terser (build only)

## Critical Constraint

**ALL CODE IN `lib/` MUST RUN IN BROWSER CONSOLE**

- NO Node.js APIs (fs, path, require, process)
- NO ES modules (import/export) - use IIFEs
- NO external runtime dependencies
- KEEP console.log statements (useful for users)

## Repository Structure

```
pasteable/
├── lib/                              # SOURCE SCRIPTS (paste these into console)
│   ├── lms-extractor-complete.js        # Primary all-in-one extractor
│   ├── storyline-console-extractor.js   # Storyline-specific
│   ├── storyline-data-extractor.js      # Storyline data.js parser
│   ├── tla-completion-helper.js         # TLA/xAPI platforms
│   └── unified-qa-extractor.js          # Multi-format Q&A parser
├── dist/                             # MINIFIED OUTPUT (npm run build)
│   └── *.min.js                         # ~63% smaller, no comments
├── docs/
│   ├── BROWSER-SETUP.md                 # Save scripts as browser snippets
│   └── ARCHITECTURE.md                  # Code architecture notes
├── scripts/
│   └── build.js                         # Minification script (Node.js)
├── install.html                      # Interactive browser installer
├── package.json                      # Build dependencies only
└── .github/workflows/build.yml       # CI: auto-build minified scripts
```

## Commands

```bash
npm install          # Install terser (dev dependency)
npm run build        # Build dist/*.min.js from lib/*.js
```

## API Objects

These names are preserved in minification and exposed globally:

| Script | Global Object | Primary Method |
|--------|---------------|----------------|
| lms-extractor-complete.js | `LMSExtractor` | `await LMSExtractor.extract()` |
| storyline-console-extractor.js | `StorylineExtractor` | `StorylineExtractor.run()` |
| storyline-data-extractor.js | `StorylineDataExtractor` | `await StorylineDataExtractor.run()` |
| tla-completion-helper.js | `TLAHelper` | `TLAHelper.extractFromTasksJson(data)` |
| unified-qa-extractor.js | `UnifiedQAExtractor` | `UnifiedQAExtractor.extract(data)` |

## Code Patterns

### Script Structure (Required IIFE Pattern)
```javascript
(function() {
    'use strict';

    const MyExtractor = {
        results: [],

        extract() {
            // Browser-only code here
            // Can use: document, window, fetch, console
            // Cannot use: require, fs, process
        },

        download(format) {
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            // ... trigger download
        }
    };

    // MUST expose globally for console access
    window.MyExtractor = MyExtractor;
})();
```

### LMS Detection Patterns
| Platform | Detection | Access |
|----------|-----------|--------|
| Storyline | `window.DS`, `window.player`, `globalProvideData` | Frame scanning, data.js parsing |
| SCORM 1.2 | `window.API` | `API.LMSGetValue('cmi.core.*')` |
| SCORM 2004 | `window.API_1484_11` | `API_1484_11.GetValue('cmi.*')` |
| TLA/xAPI | URL params, `/api/assets/tasks.json` | fetch + parse |

### Export Formats (All extractors should support)
- `json` - Structured data for automation
- `csv` - Spreadsheet import
- `text` - Human-readable

## Build System

### Terser Configuration (scripts/build.js)
```javascript
{
    compress: { drop_console: false },  // KEEP console.log
    mangle: {
        toplevel: false,                // Don't mangle globals
        reserved: ['LMSExtractor', 'TLAHelper', ...]  // Preserve API names
    },
    format: { comments: false }         // Remove all comments
}
```

### Adding New Script
1. Create `lib/new-script.js` using IIFE pattern
2. Add filename to `SCRIPTS` array in `scripts/build.js`
3. Add API name to `reserved` array in terser config
4. Run `npm run build`
5. Update README.md with usage docs

## Testing

**Manual browser testing only** - no automated test runner.

1. Open any LMS course
2. Open DevTools Console (F12)
3. Paste script from `lib/` or `dist/`
4. Call API methods
5. Verify extraction results

## Common Issues

### "require is not defined"
You used Node.js code in a browser script. Remove require() calls.

### API object not found after paste
Script didn't expose to window. Add `window.APIName = APIName;` at end of IIFE.

### Minified script breaks
API name got mangled. Add it to `reserved` array in build.js terser config.

## Files Reference

| File | Purpose | Edit When |
|------|---------|-----------|
| `lib/lms-extractor-complete.js` | Main all-in-one extractor | Adding new LMS support |
| `lib/storyline-*.js` | Storyline-specific extraction | Storyline format changes |
| `lib/tla-completion-helper.js` | TLA platform support | TLA API changes |
| `lib/unified-qa-extractor.js` | Format parsing utilities | Adding export formats |
| `scripts/build.js` | Minification config | Adding new scripts |
| `install.html` | Browser copy-to-clipboard UI | UX improvements |
| `docs/BROWSER-SETUP.md` | Snippet setup guide | Browser changes |

## Do NOT

- Add Node.js runtime code to `lib/` scripts
- Use ES modules (import/export) in `lib/`
- Remove console.log statements from extractors
- Mangle top-level API names in terser config
- Add external runtime dependencies
- Break browser console compatibility for Node.js features
