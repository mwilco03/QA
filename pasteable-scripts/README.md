# Copy-Pasteable LMS Extraction Scripts

Self-contained JavaScript files for browser console execution.
For environments where browser extensions are controlled/restricted.

## Quick Start

1. Open your LMS course in browser
2. Press `F12` → Console tab
3. Copy entire contents of desired script
4. Paste into console and press Enter
5. Run commands as documented

---

## Scripts

### 1. lms-extractor-complete.js (All-in-One)

Universal extractor supporting SCORM, TLA/xAPI, and Storyline.

```javascript
// After pasting:
await LMSExtractor.extract()          // Extract all Q&A
LMSExtractor.getCorrectAnswers()      // View correct only
await LMSExtractor.complete(100)      // Mark complete (score=100)
LMSExtractor.download('json')         // Download results
```

### 2. UKI.js (Storyline Specific)

Specialized Storyline extractor v2.1 with improved filtering.

```javascript
// Script runs automatically after paste
// Results saved to:
window.allQA                          // All questions/answers
window.courseData                     // Full course data
exportQA('json')                      // Download JSON
exportQA('txt')                       // Download text
```

### 3. tla-completion-helper.js (TLA/xAPI)

TLA platform helper for extraction and completion.

```javascript
// Get session info from URL first:
const sessionId = location.pathname.match(/sessions\/([^\/]+)/)?.[1];
const contentUrl = new URLSearchParams(location.search).get('contentUrl');

// Extract questions:
const tasks = await TLAHelper.getTasks(contentUrl);
const questions = TLAHelper.extractFromTasksJson(tasks);
console.log(TLAHelper.exportQuestions(questions, 'text'));

// Auto-complete:
await TLAHelper.autoComplete(sessionId, contentUrl);
```

### 4. unified-qa-extractor.js (Multi-Format)

Supports multiple data formats with auto-detection.

```javascript
// Extract from any supported format:
const results = UnifiedQAExtractor.extract(data);
console.log(UnifiedQAExtractor.export(results, 'text'));

// Get correct answers:
const correct = UnifiedQAExtractor.getCorrectAnswers(results);
console.log(correct);
```

### 5. storyline-data-extractor.js (CLI + Browser)

Works in Node.js CLI or browser console.

```bash
# CLI:
node storyline-data-extractor.js _data.js
node storyline-data-extractor.js _data.js "search term"
node storyline-data-extractor.js _data.js --format=text
```

```javascript
// Browser:
const questions = StorylineExtractor.extractFromDataJS(dataJsContent);
console.log(StorylineExtractor.format(questions, 'text'));
```

---

## Magic Strings Reference

### TLA/xAPI API Endpoints
```
/api/assets/tasks.json?contentUrl={url}
/api/sessions/{sessionId}/lrs/state
/api/sessions/{sessionId}/score
/api/sessions/{sessionId}
/api/sessions (POST)
```

### Pattern Delimiters
| Delimiter | Purpose | Example |
|-----------|---------|---------|
| `[,]` | Separate multiple choices/items | `choice_a[,]choice_b` |
| `[.]` | Source-target in matching | `A[.]1` |
| `{case_matters=bool}` | Fill-in case sensitivity | `{case_matters=true}answer` |

### Question Types
```
CHOICE       - Single/multiple choice
FILL_IN      - Short text entry
LONG_FILL_IN - Long text entry
MATCHING     - Match source to target
SEQUENCING   - Order items correctly
TRUE_FALSE   - Boolean selection
```

### Storyline Paths
```
/html5/data/js/data.js       - Main course data
/html5/data/js/{slideId}.js  - Individual slide data
/story_content/              - Asset content
```

### SCORM APIs
```javascript
// SCORM 1.2
window.API.LMSGetValue(key)
window.API.LMSSetValue(key, value)
window.API.LMSCommit('')

// SCORM 2004
window.API_1484_11.GetValue(key)
window.API_1484_11.SetValue(key, value)
window.API_1484_11.Commit()
```

### SCORM Data Model Keys
```
// SCORM 2004
cmi.score.raw, cmi.score.scaled, cmi.score.min, cmi.score.max
cmi.success_status (passed|failed)
cmi.completion_status (completed|incomplete|not_attempted)
cmi.interactions._count
cmi.interactions.n.id, .type, .description
cmi.interactions.n.correct_responses.0.pattern
cmi.interactions.n.learner_response

// SCORM 1.2
cmi.core.score.raw
cmi.core.lesson_status (passed|completed|failed|incomplete|browsed|not_attempted)
```

### xAPI Verbs
```
http://adlnet.gov/expapi/verbs/answered
http://adlnet.gov/expapi/verbs/completed
http://adlnet.gov/expapi/verbs/passed
http://adlnet.gov/expapi/verbs/failed
```

### Storyline Accessibility Types
```
checkbox, radiobutton, button, hotspot
dragitem, dropzone, droptarget
textentry, textinput, input
clickable, selectable, text
```

### Storyline Correct State Indicators
```
_Review, _Selected_Review, Correct, Right, True
Yes, Selected_Correct, Drop_Correct, Drag_Correct
Match_Correct, Answer_Correct
```

---

## Sample Data

The `lib/javascript.zip` contains sample Storyline course files for testing:
- `_data.js` - Main course data (342KB)
- `_frame.js` - Frame configuration (98KB)
- `_paths.js` - Asset paths (503KB)
- `_6WFRxkA44Sj.js` - Sample slide (39KB)

Extract and use with:
```bash
unzip lib/javascript.zip -d sample_course
node lib/storyline-data-extractor.js sample_course/_data.js
```

---

## Troubleshooting

### "No SCORM API found"
Course may use non-standard location. Try:
```javascript
window.parent.API
window.parent.API_1484_11
// Or search all frames
```

### "Could not find course URL"
Set manually before re-running:
```javascript
window.baseUrl = "https://your-lms.com/courses/123";
```

### Cross-origin errors
Access from within the correct frame context:
```javascript
// Find content frame
document.querySelectorAll('iframe').forEach((f, i) => {
    try {
        console.log(i, f.contentWindow.location.href);
    } catch(e) {
        console.log(i, 'cross-origin');
    }
});
```

### Questions not extracting
- Check network tab for API calls
- Course may use obfuscated data
- Try multiple extraction methods

---

## For QA Testing Only

These scripts are for authorized QA testing, content validation,
and accessibility review purposes only.
