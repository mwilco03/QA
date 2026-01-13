# LMS Q&A Extraction & Completion Tools

## Quick Start

### Browser Console Method (Easiest)

For environments where extensions are controlled, use the copy-pasteable scripts:

1. Open your LMS course in a browser
2. Press `F12` to open Developer Tools
3. Go to the **Console** tab
4. Paste the contents of `pasteable-scripts/lms-extractor-complete.js` (or `lib/lms-extractor-complete.js`)
5. Run commands:

> **Tip:** See `pasteable-scripts/README.md` for complete magic strings reference and troubleshooting.

```javascript
// Extract all questions and answers
await LMSExtractor.extract()

// View correct answers only
LMSExtractor.getCorrectAnswers()

// Mark course as complete
await LMSExtractor.complete(100)  // 100 = score

// Download results
LMSExtractor.download('json')
```

---

## Extraction Methods by Content Type

### Articulate Storyline Courses

**Option 1: Browser Console**
```javascript
// Paste lib/UKI.js into console, then:
StorylineExtractor.run()
```

**Option 2: From _data.js file**
```bash
# If you have access to course files:
node lib/storyline-data-extractor.js path/to/_data.js

# Search for specific question:
node lib/storyline-data-extractor.js _data.js "HAS-1.2.3"
```

**Option 3: API**
```javascript
// In Node.js or browser:
const extractor = require('./lib/unified-qa-extractor.js');
const questions = extractor.extractFromDataJS(dataJsContent);
console.log(extractor.export(questions, 'text'));
```

---

### TLA/xAPI Content

**Extract Questions:**
```javascript
// Browser console on TLA course:
const contentUrl = new URLSearchParams(location.search).get('contentUrl');
const resp = await fetch(`/api/assets/tasks.json?contentUrl=${contentUrl}`);
const tasks = await resp.json();

// Parse with helper:
// Paste lib/tla-completion-helper.js first
const questions = TLAHelper.extractFromTasksJson(tasks);
console.log(TLAHelper.exportQuestions(questions, 'text'));
```

**Complete Course:**
```javascript
// Get session ID from URL (format: /sessions/xx-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
const sessionId = location.pathname.match(/sessions\/([^\/]+)/)?.[1];

// Submit answers and complete
await TLAHelper.autoComplete(sessionId, contentUrl);
```

---

### SCORM Content

**Extract Interaction Data:**
```javascript
// Browser console:
const api = window.API || window.API_1484_11;
const count = parseInt(api.GetValue('cmi.interactions._count'));

for (let i = 0; i < count; i++) {
    console.log({
        id: api.GetValue(`cmi.interactions.${i}.id`),
        type: api.GetValue(`cmi.interactions.${i}.type`),
        correct: api.GetValue(`cmi.interactions.${i}.correct_responses.0.pattern`)
    });
}
```

**Complete Course:**
```javascript
// SCORM 2004:
api.SetValue('cmi.score.raw', '100');
api.SetValue('cmi.score.scaled', '1.0');
api.SetValue('cmi.completion_status', 'completed');
api.SetValue('cmi.success_status', 'passed');
api.Commit();

// SCORM 1.2:
api.LMSSetValue('cmi.core.score.raw', '100');
api.LMSSetValue('cmi.core.lesson_status', 'passed');
api.LMSCommit('');
```

---

## Question Types & Patterns

### How Correct Answers Are Stored

| Type | Storage Format | Example |
|------|---------------|---------|
| Multiple Choice | `choice_id` | `choice_abc123` |
| Multiple Select | `id1[,]id2` | `choice_a[,]choice_b` |
| Fill-in | `{case_matters=bool}answer` | `{case_matters=false}Paris` |
| Matching | `src[.]tgt[,]src[.]tgt` | `A[.]1[,]B[.]2` |
| Sequencing | `item1[,]item2[,]item3` | `First[,]Second[,]Third` |
| True/False | `true` or `false` | `true` |

### Parsing Correct Patterns
```javascript
// Use the unified extractor:
const parsed = UnifiedQAExtractor.extract(data);
const correct = UnifiedQAExtractor.getCorrectAnswers(parsed);
console.log(UnifiedQAExtractor.export(correct, 'text'));
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/lms-extractor-complete.js` | All-in-one browser script |
| `lib/unified-qa-extractor.js` | Multi-format Q&A extraction |
| `lib/storyline-data-extractor.js` | Storyline _data.js parser (CLI) |
| `lib/tla-completion-helper.js` | TLA/xAPI API interaction |
| `lib/UKI.js` | Storyline browser console extractor |
| `lib/tasks-extractor.js` | Network interceptor for xAPI |

---

## Output Formats

All tools support multiple export formats:

```javascript
// JSON (default)
extractor.export(questions, 'json')

// Human-readable text
extractor.export(questions, 'text')

// CSV for spreadsheets
extractor.export(questions, 'csv')
```

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
