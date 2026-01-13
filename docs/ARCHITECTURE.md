# Architecture: Code Sharing Between Console Scripts and Extension

This document explains the code structure and how to share logic between the console scripts and the browser extension.

## Current Structure

```
QA/
├── lib/                              # Console scripts (copy-pasteable)
│   ├── lms-extractor-complete.js     # All-in-one extractor
│   ├── storyline-console-extractor.js
│   ├── tla-completion-helper.js
│   ├── unified-qa-extractor.js
│   └── storyline-data-extractor.js
└── [extension branch]                # Browser extension (separate branch)
```

## The Sharing Question

**Can console scripts and extension share code?**

Yes, but with tradeoffs. Here's the analysis:

### Option A: Keep Separate (Current Approach)

```
Console Scripts: Self-contained, copy-pasteable files
Extension:       Modular, uses ES6 imports/exports
```

**Pros:**
- Console scripts remain 100% pasteable (no build step)
- Each script is self-contained with no dependencies
- Simpler maintenance for console scripts
- No risk of breaking one when updating the other

**Cons:**
- Code duplication between scripts and extension
- Bug fixes must be applied in multiple places
- Divergence risk over time

**Best for:** Small-to-medium codebase, infrequent updates

---

### Option B: Shared Core with Different Entry Points

```
QA/
├── core/                             # Shared extraction logic
│   ├── parsers/
│   │   ├── storyline.js
│   │   ├── scorm.js
│   │   └── tla.js
│   ├── formatters/
│   │   ├── json.js
│   │   ├── csv.js
│   │   └── text.js
│   └── utils/
│       └── dom.js
├── lib/                              # Console scripts (built from core)
│   └── [bundled single-file scripts]
├── extension/                        # Browser extension
│   └── [imports from core/]
└── build/
    └── bundle-console.js             # Build script
```

**Pros:**
- Single source of truth for extraction logic
- Bug fixes propagate to both console + extension
- Consistent behavior guaranteed

**Cons:**
- Requires build step for console scripts
- More complex development workflow
- Build tooling adds maintenance burden

**Best for:** Large codebase, frequent updates, team development

---

### Option C: Hybrid Approach (Recommended)

```
QA/
├── core/                             # Shared pure logic (no DOM)
│   ├── parsers.js                    # Question/answer parsing
│   ├── formatters.js                 # Export formatting
│   └── patterns.js                   # Regex patterns, constants
├── lib/                              # Console scripts
│   └── lms-extractor-complete.js     # Includes core + DOM glue
├── extension/
│   ├── background.js
│   ├── content.js                    # Imports from core/
│   └── popup.js
└── scripts/
    └── build-console.js              # Simple concatenation build
```

**How it works:**

1. **Core modules** contain pure JavaScript logic:
   - Parsing algorithms
   - Data transformation
   - Export formatting
   - No DOM manipulation, no `window` access

2. **Console scripts** are built by:
   - Concatenating core modules
   - Adding IIFE wrapper
   - Adding DOM glue code (API detection, etc.)

3. **Extension** imports core modules directly using ES6 imports

**Example core module (`core/parsers.js`):**

```javascript
// Pure function - no DOM, no globals
function parseStorylineData(data) {
    const questions = [];
    for (const scene of data.scenes || []) {
        for (const slide of scene.slides || []) {
            // ... extraction logic
        }
    }
    return questions;
}

function parseCorrectPattern(pattern, type) {
    // ... pattern parsing logic
}

// Export for both module systems
if (typeof module !== 'undefined') {
    module.exports = { parseStorylineData, parseCorrectPattern };
}
```

**Console script wrapper:**

```javascript
(function() {
    // === CORE: parsers.js ===
    function parseStorylineData(data) { /* ... */ }
    function parseCorrectPattern(pattern, type) { /* ... */ }

    // === CONSOLE GLUE ===
    window.LMSExtractor = {
        extract: async function() {
            const api = window.API || window.API_1484_11;
            // ... DOM-specific code
            return parseStorylineData(data);
        }
    };
})();
```

---

## Recommendation

For your use case, I recommend **Option C (Hybrid)** because:

1. **Console scripts remain pasteable** - just single files
2. **Core logic is shared** - fixes apply everywhere
3. **Build step is simple** - just concatenation, no webpack/rollup complexity
4. **Gradual migration** - you can move logic to `core/` incrementally

### Migration Path

1. **Phase 1:** Identify pure functions in current scripts
2. **Phase 2:** Extract to `core/` modules
3. **Phase 3:** Create simple build script
4. **Phase 4:** Extension imports from `core/`

---

## Build Script Example

A simple build script to create pasteable console scripts:

```javascript
// scripts/build-console.js
const fs = require('fs');
const path = require('path');

const CORE_FILES = [
    'core/patterns.js',
    'core/parsers.js',
    'core/formatters.js'
];

const CONSOLE_GLUE = 'src/console-glue.js';
const OUTPUT = 'lib/lms-extractor-complete.js';

// Read and concatenate
let output = '(function() {\n"use strict";\n\n';

for (const file of CORE_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    // Strip module.exports lines
    const stripped = content.replace(/if \(typeof module.*\n.*\n}/g, '');
    output += `// === ${path.basename(file)} ===\n${stripped}\n\n`;
}

output += fs.readFileSync(CONSOLE_GLUE, 'utf8');
output += '\n})();';

fs.writeFileSync(OUTPUT, output);
console.log(`Built ${OUTPUT}`);
```

---

## On Minification

**Keep scripts readable.** For console scripts:

- **Don't rename variables** - makes debugging impossible
- **Remove comments** - acceptable for size reduction
- **Remove whitespace** - acceptable but less important
- **Keep structure** - users may want to modify

A "compact" version could strip comments only:

```bash
# Simple comment stripping (preserves readability)
sed '/^\s*\/\//d; /^\s*\/\*/,/\*\//d' script.js > script.compact.js
```

For the extension, standard minification is fine since users won't paste it.
