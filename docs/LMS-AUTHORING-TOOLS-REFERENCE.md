# LMS Authoring Tools Technical Reference
> AI-optimized reference for Q&A extraction patterns. Token-efficient format.

## Quick Detection Matrix

| Tool | Primary Globals | Secondary Signals | Confidence |
|------|----------------|-------------------|------------|
| Storyline | `DS`, `globalProvideData`, `GetPlayer` | `.slide-object`, `.acc-shadow-dom`, `svg.vector-slide-content` | 95% |
| Rise 360 | `__RISE__`, `Rise` | `[data-ba-component]`, `.block-knowledge`, `.block-quiz` | 90% |
| Captivate | `cp`, `cpAPIInterface`, `cpAPIEventEmitter` | `#cpMainContainer`, `[class*="cp-"]`, `cpCmndResume()` | 95% |
| Lectora | `trivantis`, `TrivantisCore`, `ObL` | `getObjbyID()`, `[class*="lectora"]` | 90% |
| iSpring | `iSpring`, `ispringPresentationConnector`, `PresentationSettings` | `[class*="ispring"]`, `#ispring-player` | 90% |
| Camtasia | `TechSmith`, `Camtasia` | `[class*="techsmith"]` | 85% |

## Storyline Data Architecture

### Critical Objects
```
window.DS                          // Player root
window.DS.VO                       // Visual objects + states
window.DS.resumer.resumeData       // SCORM suspend_data
window.DS.slideNumberManager       // Slide tracking
window.g_listQuizzes               // Quiz array (report context only)
window.g_slideData                 // Current slide data
```

### Slide Data Access
```javascript
// Each slide executes:
globalProvideData('slide', JSON.stringify({
  lmsId: "SlideX",
  // slide properties...
}));

// Access pattern:
window.globalProvideData // function exists = Storyline
```

### Quiz Data Structure (g_listQuizzes)
```javascript
g_listQuizzes[n] = {
  questionId: string,
  questionText: string,
  questionType: string,        // "choice", "truefalse", "matching", etc.
  responses: [{
    responseId: string,
    responseText: string,
    selected: boolean,
    correct: boolean
  }],
  correctResponsePattern: string,  // SCORM format: "1[,]3" or "A[.]1[,]B[.]2"
  score: number,
  maxScore: number
}
```

### State Detection (Correct Answers)
```javascript
// Check DS.VO for object states
DS.VO[objectId].states // Array: ["Normal", "Correct", "Selected Correct", etc.]

// DOM state attributes
element.getAttribute('data-state') // "correct", "incorrect", "review"
element.getAttribute('aria-checked') // "true" = selected
```

### File Structure
```
story_content/
├── story.html / story_html5.html  // Entry point
├── frame.js                        // Frame management
├── data.js                         // Slide data definitions
├── user.js                         // User-defined variables
├── lms/lms.js                      // SCORM wrapper
└── slides/
    └── [slideId]/
        └── slide.js                // Per-slide data
```

## Captivate Data Architecture

### API Objects
```javascript
window.cpAPIInterface              // Main API
window.cpAPIEventEmitter           // Events
window.cpQuizInfoObject            // Quiz metadata (NOT questions)
window.cpInfoQuiz                  // Alternative quiz info
```

### Key Methods
```javascript
cpAPIInterface.getVariableValue(name)
cpAPIInterface.setVariableValue(name, value)
cpAPIInterface.getDurationInSeconds()
cpAPIInterface.play() / pause() / next() / previous()
```

### Quiz Variables (System)
```
cpQuizInfoStudentID
cpQuizInfoStudentName
cpQuizInfoTotalQuizPoints
cpQuizInfoPointsPerQuestionSlide
cpQuizInfoPassPercent
cpQuizInfoAttempts
```

### Limitation
**cpAPIInterface does NOT expose actual question text or answer options.**
Must extract from DOM or cpQuizInfoObject.questionArray (if available).

### DOM Patterns
```css
.cp-quiz-question          /* Question container */
.cp-question-text          /* Question text */
.cp-quiz-option            /* Answer option */
.cp_radio_button           /* Radio choice */
.cp_checkbox               /* Checkbox choice */
[data-correct="true"]      /* Correct indicator */
```

## iSpring Data Architecture

### Published Output
```
output/
├── index.html             // Modifiable entry point
└── data/                  // Generated (don't modify)
    ├── [presentation files]
    └── [quiz data]
```

### JavaScript Access
```javascript
// Quiz completion callback
// Configure: Properties → Result → Reporting → Execute JavaScript

// Variables use % syntax:
%QUIZ_SCORE%
%QUIZ_PASS_PERCENT%
%USER_NAME%
%USER_EMAIL%
%QUESTION_COUNT%
%CORRECT_COUNT%
```

### Detection
```javascript
window.iSpring
window.ispringPresentationConnector
window.PresentationSettings
window.ispringQuiz
window.QuizModule
```

## Lectora/Trivantis Data Architecture

### Global Objects
```javascript
window.trivantis
window.TrivantisCore
window.ObL                 // Object Library
window.getObjbyID(id)      // Element accessor
```

### Quiz Structure
```javascript
trivantis.tests[testId] = {
  questions: [{
    questionText: string,
    choices: [string],
    correctIndex: number,
    correctAnswers: [number]  // For multi-select
  }]
}
```

## SCORM Data Model Reference

### suspend_data
```
SCORM 1.2:  cmi.suspend_data         // 4,096 chars max
SCORM 2004: cmi.suspend_data         // 64,000 chars max
```
Unstructured string. Vendor-specific format. Used for bookmarking.

### interactions (Quiz Responses)
```javascript
cmi.interactions.n.id                           // Question ID
cmi.interactions.n.type                         // choice|true-false|fill-in|matching|sequencing|likert|numeric
cmi.interactions.n.learner_response             // User's answer
cmi.interactions.n.correct_responses.0.pattern  // Correct answer
cmi.interactions.n.result                       // correct|incorrect|neutral
cmi.interactions.n.latency                      // Time spent
cmi.interactions.n.description                  // Question text (optional)
```

### Response Patterns by Type
```
choice:     "a[,]c"              // Selected options a and c
true-false: "true" | "false"
fill-in:    "answer text"
matching:   "a[.]1[,]b[.]2"      // a→1, b→2
sequencing: "3[,]1[,]4[,]2"      // Correct order
numeric:    "4.5[:]0.5"          // Value with tolerance
```

### Completion Model
```
SCORM 1.2:
  cmi.core.lesson_status    // "completed", "passed", "failed", "incomplete"

SCORM 2004:
  cmi.completion_status     // "completed", "incomplete", "not attempted"
  cmi.success_status        // "passed", "failed", "unknown"
```

## Extraction Priority Order

1. **JavaScript Globals** (highest reliability)
   - `g_listQuizzes`, `DS.VO`, `cpQuizInfoObject`, `trivantis.tests`

2. **SCORM Interactions** (ground truth for correct answers)
   - `cmi.interactions.n.correct_responses.0.pattern`

3. **Accessibility DOM** (Storyline-specific)
   - `[data-acc-text]`, `.acc-shadow-dom`, `aria-label`

4. **State Attributes** (correct answer detection)
   - `data-state="correct"`, `aria-checked="true"`, `.correct` class

5. **Structural DOM** (fallback)
   - Repeating sibling patterns, form inputs, label associations

## Structural Pattern Recognition

### Question Container Identification
```
1. Find elements with class containing: question, quiz, assessment
2. Look for repeating structures at same DOM depth
3. First significant text element = question
4. Child inputs/buttons = answers
```

### Answer Detection Heuristics
```
Priority:
1. input[type="radio|checkbox"]
2. [role="radio|checkbox|option"]
3. button/div siblings with similar structure
4. Elements with onclick handlers
```

### Correct Answer Indicators
```
Class patterns:    /correct|right|selected.*correct/i
Data attributes:   data-correct="true", data-answer="true"
ARIA:              aria-checked="true" (when in review mode)
State:             data-state includes "correct"
Storyline:         DS.VO[id].states.includes("Correct")
```

## Token-Efficient Decision Tree

```
IF window.DS OR window.globalProvideData
  → Storyline extraction path
  → Check g_listQuizzes, DS.VO, acc-shadow-dom

ELSE IF window.cp OR window.cpAPIInterface
  → Captivate extraction path
  → DOM-based extraction (API lacks question text)

ELSE IF window.trivantis OR window.TrivantisCore
  → Lectora extraction path
  → Check trivantis.tests object

ELSE IF window.iSpring OR window.PresentationSettings
  → iSpring extraction path
  → Check quiz module, data folder

ELSE IF document.querySelector('[data-ba-component]')
  → Rise 360 extraction path
  → .block-knowledge, .block-quiz elements

ELSE
  → Generic DOM extraction
  → Form inputs, repeating structures
```

## Version Notes

- Storyline Advanced JS API (2025): Element IDs now immutable, proxy-based access
- g_listQuizzes access changed in SL3/360: Only available in report.html context
- SCORM 2004 preferred over 1.2: 15x more suspend_data capacity
