# LMS QA Validator v4.0.0

A Chrome extension for extracting Q&A content from Learning Management System (LMS) courses, detecting SCORM/xAPI APIs, and validating eLearning content with team collaboration features.

## Features

### Question Banks - Team Collaboration (NEW in v4.0)
- **Save Scan Results**: Save extracted Q&A to named question banks
- **Verification System**: Mark questions as verified with tester name
- **Export/Import**: Share banks between team members as JSON files
- **Merge Banks**: Combine banks from different testers/courses
- **Non-Linear Workflows**: Tester A creates bank, Tester B continues on different course

### Multi-Tool Extractor Support (v3.9)
- **Articulate Storyline**: Full extraction from slide data, accessibility DOM, and frame analysis
- **Articulate Rise 360**: Knowledge blocks and quiz components
- **Adobe Captivate**: Quiz data, DOM patterns, and cpInfoQuiz extraction
- **Lectora**: Trivantis quiz structures and DOM extraction
- **iSpring**: Quiz module, presentation slides, and data.js parsing
- **Automatic Detection**: Tool badge shows which authoring tool was detected

### Question Type Support (NEW in v3.7+)
- **Multiple Choice**: Standard single/multi-select questions
- **Sequence/Ordering**: Questions requiring correct order (e.g., "Arrange steps 1-4")
- **Matching**: Pair source items with target items
- **True/False**: Binary choice questions
- **Fill-in-the-Blank**: Text entry questions

### Visual Element Selector
- **Pick Q&A Elements**: Click to select question and answer elements visually
- **Smart CSS Selectors**: Automatically generates robust selectors for similar elements
- **URL Pattern Rules**: Rules saved per URL pattern, reused on return visits
- **DOM Proximity Grouping**: Intelligently groups answers with their questions
- **Correct Answer Detection**: Pick elements that indicate correct answers
- **Hybrid Extraction**: Automatically detects SCORM/xAPI APIs alongside Q&A extraction
- **Export/Import Rules**: Share selector rules between team members or LMS instances

### Enhanced UI (NEW in v3.8+)
- **Grouped Q&A Display**: Questions shown with nested answers underneath
- **Tool Detection Badge**: Shows "Storyline", "Rise 360", "Captivate", etc.
- **Scan Summary**: Quick stats showing question/answer/correct counts
- **Question Type Breakdown**: See distribution of question types
- **Quick Copy Button**: Copy all correct answers to clipboard with one click
- **Responsive Design**: Adapts to narrower popup widths (320px-500px)

### Content Extraction
- **Storyline Support**: Extracts Q&A from Articulate Storyline courses by analyzing slide data
- **Accessibility DOM**: Extracts from Storyline's `.acc-shadow-dom` accessibility layer
- **DOM Quiz Detection**: Finds form-based quizzes (select, radio, checkbox) with correct answer indicators
- **Visual Selector**: User-guided element picking for any LMS layout

### SCORM/xAPI Integration
- **API Detection**: Finds SCORM 1.2, SCORM 2004, xAPI (TCAPI/Tin Can), and AICC APIs
- **Wrapper Support**: Detects pipwerks, xAPIWrapper, ADL, and TinCanAPI libraries
- **API Testing**: Verify API connectivity and functionality
- **Completion Control**: Set completion status and scores directly

### Export Options (Enhanced in v3.9)
- **JSON**: Structured schema for test automation pipelines
  - Question IDs, answer IDs, correctAnswerIds/Texts
  - Summary with counts and question type breakdown
  - Flat answerKey for simple iteration
- **CSV**: Includes question numbering column
- **TXT**: Full Q&A breakdown with `[CORRECT]` markers

### Productivity Features
- **Auto-Select Answers**: Automatically fills in correct answers for form quizzes
- **Multi-Window Support**: Track and scan related popup windows
- **Quick Copy**: Copy all correct answers to clipboard instantly

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension directory

## Usage

### Visual Element Selector (Recommended)

The most accurate way to extract Q&A from any LMS:

1. Navigate to an LMS course page with quiz content
2. Click the extension icon
3. Click **"Pick Q&A Elements"**
4. **Step 1**: Click on any question text element (highlights in green)
5. **Step 2**: Click on any answer choice element (highlights in blue)
6. **Step 3**: Optionally click a "correct answer" indicator (or skip)
7. Review the preview and click **"Save Rule"**

On return visits to the same LMS:
- The saved rule appears automatically
- Click **"Apply Rule"** to extract Q&A instantly

### Basic Scanning (Auto-Detection)
1. Navigate to an LMS course page
2. Click the extension icon
3. Click "Scan Page"
4. The extension auto-detects the authoring tool and extracts Q&A
5. View results in the Q&A tab with grouped display

### Quick Copy Correct Answers
1. Scan the page first
2. Go to the "Correct" tab
3. Click **"Copy All"** to copy all correct answers to clipboard

### Auto-Select Answers
1. Scan the page first (using either method)
2. Click "Auto-Select Answers" in Quick Actions
3. The extension will fill in all detected correct answers

### Question Banks (Team Collaboration)

**Creating a Bank:**
1. Scan a page with Q&A content
2. In "Question Banks" section, click "Save to Bank"
3. Enter a name (e.g., "Safety Training Module 1")
4. Optionally enter your tester name
5. Click "Save Bank"

**Sharing Banks with Team:**
1. Click "Export Banks" to download all banks as JSON
2. Share the file with team members
3. They click "Import Banks" and select the file

**Merging Banks (Non-Linear Workflow):**
1. Tester A scans Course A, saves to Bank A
2. Tester A exports Bank A
3. Tester B imports Bank A
4. Tester B scans Course B, saves to Bank B
5. Tester B clicks "View Banks" → "Merge Banks"
6. Select Bank A as source, Bank B as target
7. Questions from A are merged into B with verification status preserved

**Verifying Questions:**
1. Click "View Banks" to open banks list
2. Click "View" on a bank
3. Check the "Verified" checkbox for questions you've confirmed
4. Your tester name is recorded with the verification

### SCORM Controls
When a SCORM API is detected:
- **Test API**: Verify API communication
- **Set Completion**: Mark course as complete with a score

### Keyboard Shortcuts
- `Ctrl+R`: Scan page
- `Ctrl+F`: Focus search
- `Ctrl+E`: Export as JSON
- `Escape`: Clear search

## Supported Authoring Tools

| Tool | Detection | Extraction Methods |
|------|-----------|-------------------|
| Articulate Storyline | `globalProvideData`, `g_slideData` | Slide data, accessibility DOM, frame analysis |
| Articulate Rise 360 | `[data-ba-component]`, `.block-knowledge` | Knowledge blocks, quiz blocks |
| Adobe Captivate | `cp.*`, `cpAPIInterface` | Quiz data, DOM patterns, cpInfoQuiz |
| Lectora | `trivantis.*`, `TrivantisCore` | Trivantis quiz structures, DOM |
| iSpring | `iSpring.*`, `PresentationSettings` | Quiz module, slides, data.js |

## JSON Export Schema (v1.0)

```json
{
  "version": "1.0",
  "schema": "lms-qa-validator-v1",
  "source": {
    "url": "https://lms.example.com/course/123",
    "tool": "storyline",
    "extractedAt": "2024-01-15T10:30:00Z"
  },
  "summary": {
    "totalQuestions": 10,
    "totalAnswers": 40,
    "correctAnswers": 10,
    "questionTypes": { "choice": 8, "sequence": 2 }
  },
  "questions": [
    {
      "id": "q1",
      "questionNumber": 1,
      "questionType": "choice",
      "text": "What is the capital of France?",
      "answers": [
        { "id": "q1_a1", "text": "London", "isCorrect": false, "position": 1 },
        { "id": "q1_a2", "text": "Paris", "isCorrect": true, "position": 2 }
      ],
      "correctAnswerIds": ["q1_a2"],
      "correctAnswerTexts": ["Paris"]
    }
  ],
  "answerKey": [
    { "position": 1, "text": "Paris" }
  ]
}
```

## Architecture

```
lms-qa-extension/
├── manifest.json           # Extension configuration
├── background/
│   └── service-worker.js   # Tab state, downloads, rule storage
├── content/
│   └── content.js          # Bridge between page and extension contexts
├── lib/
│   ├── lms-qa-validator.js # Multi-tool extraction engine
│   └── element-selector.js # Visual picker & rule-based extraction
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Styles (responsive)
│   └── popup.js            # Popup logic, Templates, Renderer
├── docs/
│   └── COMPLETION-BYPASS-TECHNICAL-SPEC.md  # QA bypass documentation
└── icons/                  # Extension icons
```

### Component Responsibilities

**Service Worker** (`background/service-worker.js`)
- Manages tab state across navigation
- Stores selector rules per URL pattern
- Tracks parent/child window relationships
- Handles file downloads

**Content Script** (`content/content.js`)
- Bridges page context and extension context
- Injects validator or selector scripts
- Forwards messages between contexts

**Element Selector** (`lib/element-selector.js`)
- Visual overlay for element picking
- CSS selector generation (6 strategies)
- DOM proximity grouping for Q&A correlation
- Rule-based extraction engine

**Validator** (`lib/lms-qa-validator.js`)
- ExtractorRegistry for multi-tool support
- Tool-specific extractors (Storyline, Rise, Captivate, Lectora, iSpring)
- Question type detection (choice, sequence, matching)
- SCORM/xAPI API discovery
- Accessibility DOM extraction

**Popup** (`popup/`)
- Templates object for DOM element creation
- Grouped Q&A rendering
- Tool badge and scan summary
- Quick copy functionality

## Selector Rule Storage

Rules are stored by URL pattern:

```
example.com/course/*/module/* → {
  questionSelector: ".quiz-question",
  answerSelector: ".answer-choice",
  correctSelector: "[data-correct='true']"
}
```

Numeric path segments (like `/course/123/`) are wildcarded to `/*`, so one rule works for all courses on the same LMS.

## Console API

### Validator API
```javascript
// Get current state
LMS_QA.getState()

// Get extracted Q&A
LMS_QA.getQA()

// Get detected APIs
LMS_QA.getAPIs()

// Run a scan
LMS_QA.scan()

// Auto-select correct answers
LMS_QA.autoSelect()

// Export results
LMS_QA.export('json')  // Structured automation format
LMS_QA.export('csv')
LMS_QA.export('txt')

// Get DOM quizzes
LMS_QA.getDOMQuizzes()

// Test SCORM API
LMS_QA.testAPI(0)

// Set completion
LMS_QA.setCompletion({ status: 'completed', score: 100 })
```

### Selector API (Visual Picker)
```javascript
// Activate visual picker
LMS_QA_SELECTOR.activate()

// Deactivate
LMS_QA_SELECTOR.deactivate()

// Get current picker state
LMS_QA_SELECTOR.getState()

// Get URL pattern for current page
LMS_QA_SELECTOR.getURLPattern()

// Apply a rule manually
LMS_QA_SELECTOR.applyRule({
  questionSelector: '.q-text',
  answerSelector: '.a-choice',
  correctSelector: '.correct'
})

// Extract with selectors directly
LMS_QA_SELECTOR.extractWithSelectors('.q', '.a', '.correct')
```

## Development

### Code Quality Principles
- User-guided extraction over pattern guessing
- Consistent error handling
- Modular architecture with clear boundaries
- No external dependencies
- Debounced UI operations
- Centralized Templates for DOM creation

### Testing
Open `tests/test-runner.html` in a browser to run unit tests.

## Version History

### v4.0.0
- **Question Banks**: Save extracted Q&A to named banks for team collaboration
- **Bank Verification**: Mark questions as verified with tester attribution
- **Export/Import Banks**: Share banks between team members as JSON
- **Merge Banks**: Combine banks from multiple testers or courses
- **Non-Linear Workflow Support**: Tester A creates bank, Tester B continues
- **Verification Tags**: Track what's been verified (checkbox, button, dropdown)

### v3.9.0
- **Captivate Extractor**: Adobe Captivate quiz extraction support
- **Lectora Extractor**: ELB Learning Lectora content support
- **iSpring Extractor**: iSpring Suite content support
- **Quick Copy Button**: Copy all correct answers to clipboard instantly
- **Responsive CSS**: Popup adapts to 320px-500px widths
- **Centralized Templates**: Refactored DOM creation for consistency
- **Enhanced JSON Export**: Structured schema for test automation pipelines
- **Improved CSV/TXT Export**: Question numbering, full Q&A breakdown

### v3.8.0
- **Grouped Q&A Display**: Questions shown with nested answers
- **Tool Detection Badge**: Shows detected authoring tool
- **Scan Summary**: Question/answer/correct counts at a glance
- **Question Type Breakdown**: Distribution of question types
- **Progress Messages**: 6-step scan progress indication

### v3.7.0
- **Extractor Abstraction Layer**: ExtractorRegistry for multi-tool support
- **Rise 360 Extractor**: Articulate Rise knowledge/quiz block extraction
- **Sequence Question Support**: Ordering questions with correct position
- **Matching Question Support**: Source-to-target pair questions
- **QUESTION_TYPE Enum**: choice, multiple_choice, sequencing, matching, true_false, fill_in
- **AUTHORING_TOOL Enum**: storyline, rise, captivate, lectora, ispring, camtasia, generic

### v3.6.0
- **Enhanced Slide Discovery**: Multi-source slide detection (data.js, frame.js, performance API)
- **Accessibility DOM Extraction**: Extract from Storyline's `.acc-shadow-dom` layer

### v3.5.0
- **Question/Answer Classification Fix**: Radio buttons correctly identified as answers
- **isQuestionText() Helper**: Improved question detection heuristics
- **hasQuestionPatterns() Helper**: Pattern-based question identification

### v3.3.0
- **Storyline Data Extraction**: Parse `globalProvideData('slide', ...)` structures
- **Confidence Scoring**: HIGH/MEDIUM/LOW confidence levels

### v3.2.0
- **Visual Element Selector**: Pick Q&A elements directly on the page
- **URL Pattern Rules**: Save and reuse selectors per LMS
- **DOM Proximity Grouping**: Correlate questions with their answers
- **Hybrid Extraction**: Selector-based Q&A + automatic SCORM/xAPI API detection
- **Export/Import Rules**: Share selector rules as JSON files
- **Enhanced API Detection**: Added TCAPI, TinCanAPI, xAPIWrapper, ADL support
- **Smart CSS Generation**: 6 strategies for robust selectors

### v3.1.0
- **Critical Bug Fix**: Added code detection to prevent extracting JavaScript source code as Q&A content
- Added `isCodeLike()` and `isNaturalLanguage()` content validators
- More restrictive pattern matching for resource analysis

### v3.0.0
- Complete architectural refactor
- Modular code organization
- Consistent error handling
- Centralized state management

### v2.x
- DOM quiz extraction, auto-select, spawned window tracking
- Export functionality, search filtering
- Articulate Storyline support, SCORM API detection

## License

MIT License
