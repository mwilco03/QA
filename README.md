# LMS QA Validator v3.0

A Chrome extension for extracting Q&A content from Learning Management System (LMS) courses, detecting SCORM/xAPI APIs, and validating eLearning content.

## Features

### Content Extraction
- **Storyline Support**: Extracts Q&A from Articulate Storyline courses by analyzing slide data
- **DOM Quiz Detection**: Finds form-based quizzes (select, radio, checkbox) with correct answer indicators
- **Pattern Matching**: Scans JavaScript/JSON resources for question/answer patterns

### SCORM/xAPI Integration
- **API Detection**: Finds SCORM 1.2, SCORM 2004, xAPI, and AICC APIs
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

### Basic Scanning
1. Navigate to an LMS course page
2. Click the extension icon
3. Click "Scan Page"
4. View extracted Q&A in the results tabs

### Auto-Select Answers
1. Scan the page first
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
│   └── service-worker.js   # Tab state, downloads, cross-tab communication
├── content/
│   └── content.js          # Bridge between page and extension contexts
├── lib/
│   ├── lms-qa-validator.js # Main extraction logic (injected into page)
│   └── constants.js        # Shared constants
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Styles
│   └── popup.js            # Popup logic
└── icons/                  # Extension icons
```

### Component Responsibilities

**Service Worker** (`background/service-worker.js`)
- Manages tab state across navigation
- Tracks parent/child window relationships
- Handles file downloads
- Stores scan history

**Content Script** (`content/content.js`)
- Bridges page context and extension context
- Injects validator script
- Forwards messages between contexts

**Validator** (`lib/lms-qa-validator.js`)
- Runs in page context (full DOM access)
- Discovers SCORM/xAPI APIs
- Extracts Storyline content
- Scans DOM for form quizzes
- Analyzes JavaScript resources

**Popup** (`popup/`)
- User interface
- Displays results
- Triggers actions

## Detected Patterns

### DOM Quiz Elements
The extension detects form elements with these correct-answer indicators:

**Value Attributes**
- `value="true"`
- `value="correct"`
- `value="1"`

**Data Attributes**
- `data-correct="true"`
- `data-answer="true"`

**CSS Classes**
- `.correct`
- `.right-answer`
- `.is-correct`

### SCORM APIs
Searches for:
- `window.API` (SCORM 1.2)
- `window.API_1484_11` (SCORM 2004)
- `window.SCORM_API`
- Parent/opener window APIs

## Console API

When the validator is loaded, you can access it via the console:

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

## Development

### Code Quality Principles
- Single source of truth for constants
- Consistent error handling
- Modular architecture with clear boundaries
- No external dependencies in validator
- Debounced UI operations

### File Sizes (Refactored)
- `lms-qa-validator.js`: ~800 lines (was ~2000)
- `popup.js`: ~450 lines (was ~1100)
- `popup.css`: ~450 lines (was ~1100)
- `service-worker.js`: ~300 lines

### Testing
Open `tests/test-runner.html` in a browser to run unit tests.

## Version History

### v3.0.0
- Complete architectural refactor
- Modular code organization
- Reduced file sizes by 50-60%
- Consistent error handling
- Centralized state management
- Improved maintainability

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
