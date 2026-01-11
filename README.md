# LMS QA Validator v3.2.0

A Chrome extension for extracting Q&A content from Learning Management System (LMS) courses, detecting SCORM/xAPI APIs, and validating eLearning content.

## Features

### Visual Element Selector (NEW in v3.2)
- **Pick Q&A Elements**: Click to select question and answer elements visually
- **Smart CSS Selectors**: Automatically generates robust selectors for similar elements
- **URL Pattern Rules**: Rules saved per URL pattern, reused on return visits
- **DOM Proximity Grouping**: Intelligently groups answers with their questions
- **Correct Answer Detection**: Pick elements that indicate correct answers
- **Hybrid Extraction**: Automatically detects SCORM/xAPI APIs alongside Q&A extraction
- **Export/Import Rules**: Share selector rules between team members or LMS instances

### Content Extraction
- **Storyline Support**: Extracts Q&A from Articulate Storyline courses by analyzing slide data
- **DOM Quiz Detection**: Finds form-based quizzes (select, radio, checkbox) with correct answer indicators
- **Visual Selector**: User-guided element picking for any LMS layout

### SCORM/xAPI Integration
- **API Detection**: Finds SCORM 1.2, SCORM 2004, xAPI (TCAPI/Tin Can), and AICC APIs
- **Wrapper Support**: Detects pipwerks, xAPIWrapper, ADL, and TinCanAPI libraries
- **API Testing**: Verify API connectivity and functionality
- **Completion Control**: Set completion status and scores directly

### Productivity Features
- **Auto-Select Answers**: Automatically fills in correct answers for form quizzes
- **Multi-Window Support**: Track and scan related popup windows
- **Export Options**: Export results as JSON, CSV, or TXT

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

### Basic Scanning (Pattern Matching)
1. Navigate to an LMS course page
2. Click the extension icon
3. Click "Scan Page"
4. View extracted Q&A in the results tabs

Note: Pattern matching may produce false positives. Visual selector is preferred.

### Auto-Select Answers
1. Scan the page first (using either method)
2. Click "Auto-Select Answers" in Quick Actions
3. The extension will fill in all detected correct answers

### SCORM Controls
When a SCORM API is detected:
- **Test API**: Verify API communication
- **Set Completion**: Mark course as complete with a score

### Keyboard Shortcuts
- `Ctrl+R`: Scan page
- `Ctrl+F`: Focus search
- `Ctrl+E`: Export as JSON
- `Escape`: Clear search

## Architecture

```
lms-qa-extension/
├── manifest.json           # Extension configuration
├── background/
│   └── service-worker.js   # Tab state, downloads, rule storage
├── content/
│   └── content.js          # Bridge between page and extension contexts
├── lib/
│   ├── lms-qa-validator.js # Pattern-based extraction (legacy)
│   └── element-selector.js # Visual picker & rule-based extraction (new)
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Styles
│   └── popup.js            # Popup logic
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
- Pattern-based extraction (legacy)
- Storyline slide data parsing
- DOM quiz detection
- SCORM/xAPI API discovery

**Popup** (`popup/`)
- User interface
- Rule management
- Results display

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

### Validator API (Pattern Matching)
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
LMS_QA.export('json')
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

### Testing
Open `tests/test-runner.html` in a browser to run unit tests.

## Version History

### v3.2.0
- **Visual Element Selector**: Pick Q&A elements directly on the page
- **URL Pattern Rules**: Save and reuse selectors per LMS
- **DOM Proximity Grouping**: Correlate questions with their answers
- **Hybrid Extraction**: Selector-based Q&A + automatic SCORM/xAPI API detection
- **Export/Import Rules**: Share selector rules as JSON files
- **Enhanced API Detection**: Added TCAPI, TinCanAPI, xAPIWrapper, ADL support
- **Smart CSS Generation**: 6 strategies for robust selectors
- Removed unused constants.js

### v3.1.0
- **Critical Bug Fix**: Added code detection to prevent extracting JavaScript source code as Q&A content
- Added `isCodeLike()` and `isNaturalLanguage()` content validators
- More restrictive pattern matching for resource analysis
- Skip SCORM runtime library files automatically
- Improved confidence scoring (pattern matches now LOW confidence)

### v3.0.0
- Complete architectural refactor
- Modular code organization
- Consistent error handling
- Centralized state management

### v2.2.0
- Added DOM quiz extraction
- Auto-select functionality
- Spawned window tracking
- Related windows UI

### v2.1.0
- Fixed export functionality
- Added search filtering
- Improved UX

### v2.0.0
- Articulate Storyline support
- SCORM API detection
- Initial release

## License

MIT License
