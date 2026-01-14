# LMS Q&A Console Scripts v9.1

Copy-pasteable browser console scripts for extracting Q&A content from LMS courses. Fire-and-forget: paste script, get object back, inspect results.

## PowerShell One-Liner (Copy to Clipboard)

```powershell
# Main extractor (recommended)
(irm https://raw.githubusercontent.com/mwilco03/QA/main/dist/lms-extractor-complete.min.js) | Set-Clipboard

# Or use the install script
irm https://raw.githubusercontent.com/mwilco03/QA/main/install.ps1 | iex
# Then: Get-QAScript -Script lms  (copies to clipboard)
```

**Bash/curl alternative:**
```bash
curl -s https://raw.githubusercontent.com/mwilco03/QA/main/dist/lms-extractor-complete.min.js | pbcopy  # macOS
curl -s https://raw.githubusercontent.com/mwilco03/QA/main/dist/lms-extractor-complete.min.js | xclip  # Linux
```

## Quick Start

1. Run the PowerShell one-liner above (or manually copy from `dist/`)
2. Open your LMS course in a browser
3. Press `F12` → **Console** tab
4. Paste and press Enter
5. Inspect the returned object

**Append mode:** Paste again on different slides/pages - results accumulate automatically.

**Minified scripts:** Use `dist/*.min.js` for maximum portability (~63% smaller).

## Available Scripts

| Script | Purpose | API |
|--------|---------|-----|
| `lib/lms-extractor-complete.js` | All-in-one SCORM/TLA/Storyline extractor | `LMSExtractor` |
| `lib/storyline-console-extractor.js` | Articulate Storyline extractor | `StorylineExtractor` |
| `lib/tla-completion-helper.js` | TLA/xAPI platform helper | `TLAHelper` |
| `lib/unified-qa-extractor.js` | Multi-format Q&A extraction | `UnifiedQAExtractor` |
| `lib/storyline-data-extractor.js` | Storyline data parser with dynamic discovery | `StorylineDataExtractor` |

---

## Script Usage

### lms-extractor-complete.js (All-in-One)

The most comprehensive script - handles SCORM, TLA/xAPI, and Storyline content automatically.

```javascript
// Paste script - auto-runs and returns result object:
// { context: {...}, questions: [...] }

// Questions are grouped with their answers:
// {
//   source: 'Storyline',
//   slideId: '5x...',
//   question: 'Which of the following...?',
//   questionType: 'multiple-choice',
//   answers: [
//     { text: 'Option A', correct: false, accType: 'radiobutton' },
//     { text: 'Option B', correct: true, accType: 'radiobutton' }
//   ]
// }

// Get questions with correct answers
LMSExtractor.getCorrectAnswers()

// Get flat list of correct answer texts
LMSExtractor.getCorrectAnswerTexts()

// Mark course as complete
await LMSExtractor.complete(100)

// Clear results and start fresh
LMSExtractor.clear()

// Run again without append
await LMSExtractor.extract({ append: false })
```

---

### storyline-console-extractor.js (Storyline-Specific)

Optimized for Articulate Storyline courses.

```javascript
// Paste lib/storyline-console-extractor.js into console, then:
StorylineExtractor.run()
```

---

### tla-completion-helper.js (TLA/xAPI)

For TLA (Total Learning Architecture) and xAPI-based platforms.

```javascript
// Paste lib/tla-completion-helper.js into console, then:

// Get session and content info from URL
const contentUrl = new URLSearchParams(location.search).get('contentUrl');
const sessionId = location.pathname.match(/sessions\/([^\/]+)/)?.[1];

// Extract questions from tasks.json
const resp = await fetch(`/api/assets/tasks.json?contentUrl=${contentUrl}`);
const tasks = await resp.json();
const questions = TLAHelper.extractFromTasksJson(tasks);

// Export in different formats
console.log(TLAHelper.exportQuestions(questions, 'text'));

// Auto-complete course
await TLAHelper.autoComplete(sessionId, contentUrl);
```

---

### unified-qa-extractor.js (Multi-Format)

Supports multiple data formats and export options.

```javascript
// Paste lib/unified-qa-extractor.js into console, then:

// Parse from various data sources
const parsed = UnifiedQAExtractor.extract(data);
const correct = UnifiedQAExtractor.getCorrectAnswers(parsed);

// Export in different formats
console.log(UnifiedQAExtractor.export(correct, 'text'));
console.log(UnifiedQAExtractor.export(correct, 'json'));
console.log(UnifiedQAExtractor.export(correct, 'csv'));
```

---

### storyline-data-extractor.js (CLI + Browser)

Dynamic discovery and extraction from Storyline courses.

**Browser Console:**
```javascript
// Paste lib/storyline-data-extractor.js into console, then:
await StorylineDataExtractor.run()
// Results in window.allQA
```

**Node.js CLI:**
```bash
# Parse a data file with globalProvideData
node lib/storyline-data-extractor.js ./html5/data/js/data.js

# Search for specific question
node lib/storyline-data-extractor.js ./data.js "HAS-1.2.3"
```

---

## SCORM API Direct Access

For courses using SCORM, you can access the API directly:

```javascript
// Find the SCORM API
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

// Complete course (SCORM 2004)
api.SetValue('cmi.score.raw', '100');
api.SetValue('cmi.score.scaled', '1.0');
api.SetValue('cmi.completion_status', 'completed');
api.SetValue('cmi.success_status', 'passed');
api.Commit();

// Complete course (SCORM 1.2)
api.LMSSetValue('cmi.core.score.raw', '100');
api.LMSSetValue('cmi.core.lesson_status', 'passed');
api.LMSCommit('');
```

---

## Question Answer Patterns

### How Correct Answers Are Stored

| Type | Storage Format | Example |
|------|---------------|---------|
| Multiple Choice | `choice_id` | `choice_abc123` |
| Multiple Select | `id1[,]id2` | `choice_a[,]choice_b` |
| Fill-in | `{case_matters=bool}answer` | `{case_matters=false}Paris` |
| Matching | `src[.]tgt[,]src[.]tgt` | `A[.]1[,]B[.]2` |
| Sequencing | `item1[,]item2[,]item3` | `First[,]Second[,]Third` |
| True/False | `true` or `false` | `true` |

---

## Export Formats

All scripts support multiple export formats:

```javascript
// JSON (structured)
extractor.export(questions, 'json')

// Human-readable text
extractor.export(questions, 'text')

// CSV for spreadsheets
extractor.export(questions, 'csv')
```

---

## Test Data

`test-data/storyline-sample.zip` contains sample Articulate Storyline course files for testing extraction scripts.

---

## Troubleshooting

### "No SCORM API found"
- Course may use non-standard API location
- Try: `window.parent.API` or search frames manually

### "No session ID found" (TLA)
- Check URL for `/sessions/` path segment
- Session may have expired - reload course

### Cross-origin errors
- Content in iframe from different domain
- Need to access from within the correct frame context

### Questions not extracting
- Course may use encrypted/obfuscated data
- Try network tab to intercept API responses

---

## Building Minified Scripts

```bash
npm install        # Install terser
npm run build      # Build dist/*.min.js
```

Minified scripts are ~63% smaller with no comments - ideal for pasting.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Browser Setup Guide](docs/BROWSER-SETUP.md) | How to set up scripts as browser snippets |
| [Architecture Guide](docs/ARCHITECTURE.md) | Code sharing between console scripts and extension |
| [install.html](install.html) | Interactive browser installation helper |

---

## License

MIT License
