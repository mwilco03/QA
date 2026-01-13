# LMS QA Validator - Usage Guide

## Quick Start

### Chrome Extension (Recommended)

1. Load the extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked)
2. Navigate to any LMS course page
3. Click the extension icon
4. Click **"Scan Page"** to auto-detect and extract Q&A

### Browser Console API

The extension exposes a global `LMS_QA` object in the page context:

```javascript
// Run a scan
await LMS_QA.scan()

// Get extracted Q&A
LMS_QA.getQA()

// Get correct answers only
LMS_QA.getQA().filter(q => q.isCorrect)

// Auto-select correct answers in forms
LMS_QA.autoSelect()

// Export results
LMS_QA.export('json')   // Structured format
LMS_QA.export('csv')    // Spreadsheet format
LMS_QA.export('txt')    // Human-readable

// SCORM API operations
LMS_QA.testAPI(0)
LMS_QA.setCompletion({ status: 'completed', score: 100 })
LMS_QA.forceCompletion({ score: 100 })
```

---

## Extraction by Content Type

### Articulate Storyline

The extension auto-detects Storyline courses and extracts from:
- `globalProvideData('slide', ...)` structures
- Accessibility DOM (`.acc-shadow-dom`)
- Frame analysis

```javascript
// Check if current page is Storyline
LMS_QA.isStorylinePage()

// Get Storyline-specific DOM data
LMS_QA.getStorylineDOM()
```

### Articulate Rise 360

Detected via `[data-ba-component]` attributes. Extracts from:
- Knowledge blocks
- Quiz components

### Adobe Captivate

Detected via `cp.*` globals. Extracts from:
- Quiz data structures
- DOM patterns
- cpInfoQuiz

### Lectora / iSpring

Auto-detected and extracted using tool-specific patterns.

---

## SCORM/xAPI Operations

### Detect APIs
```javascript
// Get all detected APIs
LMS_QA.getAPIs()

// Test specific API
LMS_QA.testAPI(0)  // Test first detected API
```

### Set Completion
```javascript
// Mark course complete with score
LMS_QA.setCompletion({ status: 'completed', score: 100 })

// Force completion (bypasses normal flow)
await LMS_QA.forceCompletion({ score: 100 })
```

### Direct SCORM Access
```javascript
// SCORM 2004
const api = window.API_1484_11;
api.SetValue('cmi.completion_status', 'completed');
api.SetValue('cmi.success_status', 'passed');
api.SetValue('cmi.score.scaled', '1.0');
api.Commit();

// SCORM 1.2
const api = window.API;
api.LMSSetValue('cmi.core.lesson_status', 'passed');
api.LMSSetValue('cmi.core.score.raw', '100');
api.LMSCommit('');
```

---

## Question Types

| Type | Detection | Storage Format |
|------|-----------|----------------|
| Multiple Choice | Radio buttons | `choice_id` |
| Multiple Select | Checkboxes | `id1[,]id2` |
| Fill-in-the-Blank | Text inputs | `{case_matters=bool}answer` |
| Matching | Drag-drop pairs | `src[.]tgt[,]src[.]tgt` |
| Sequencing | Ordered lists | `item1[,]item2[,]item3` |
| True/False | Boolean choice | `true` or `false` |

---

## Export Formats

### JSON (Automation)
```json
{
  "version": "1.0",
  "source": { "url": "...", "tool": "storyline" },
  "summary": { "totalQuestions": 10, "correctAnswers": 10 },
  "questions": [...],
  "answerKey": [...]
}
```

### CSV (Spreadsheets)
```
QuestionNumber,QuestionText,AnswerText,IsCorrect
1,"What is 2+2?","4",true
```

### TXT (Human-readable)
```
Q1: What is 2+2?
  A: 3
  A: 4 [CORRECT]
```

---

## Debugging

```javascript
// View internal state
LMS_QA.getState()

// View logs
LMS_QA.getLogs()

// Access internal modules
LMS_QA._debug.StateManager
LMS_QA._debug.ExtractorRegistry
LMS_QA._debug.SCORMAPI
```

---

## Troubleshooting

### "No SCORM API found"
- Course may use non-standard API location
- Try: `window.parent.API` or search frames

### Cross-origin errors
- Content in iframe from different domain
- Access from within the correct frame context

### Questions not extracting
- Course may use encrypted/obfuscated data
- Try network tab to intercept API responses
- Check `LMS_QA.getLogs()` for extraction errors
