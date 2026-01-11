# LMS Completion Bypass - Technical Specification

## Project Context

**Purpose**: This document supports the LMS QA Validator Chrome Extension, an internal quality assurance tool for validating Learning Management System (LMS) course deployments. The completion bypass functionality enables QA engineers to rapidly test course completion workflows, navigation gates, certificate generation, and LMS integration without manually completing assessments.

**Legitimate Use Cases**:
- Regression testing after LMS updates
- Validating completion certificates trigger correctly
- Testing post-completion navigation and content unlocking
- Verifying LMS grade passback to SIS/HR systems
- Load testing completion event handlers
- Validating SCORM/xAPI statement transmission

---

## Architecture Overview

### LMS Communication Layer

Articulate Storyline (and similar authoring tools) communicate with LMS platforms through standardized APIs. The course runs in an iframe and discovers the API through parent window traversal.

```
┌─────────────────────────────────────────────────────┐
│  LMS Platform (Cornerstone, Docebo, Moodle, etc.)  │
│  ┌─────────────────────────────────────────────┐   │
│  │  API Object (window.API or API_1484_11)     │   │
│  │  - LMSSetValue() / SetValue()               │   │
│  │  - LMSGetValue() / GetValue()               │   │
│  │  - LMSCommit() / Commit()                   │   │
│  │  - LMSFinish() / Terminate()                │   │
│  └─────────────────────────────────────────────┘   │
│       ▲                                            │
│       │ postMessage / direct call                  │
│  ┌────┴────────────────────────────────────────┐   │
│  │  Course Content (iframe)                    │   │
│  │  - Storyline Runtime (DS object)            │   │
│  │  - SCORM Wrapper                            │   │
│  │  - xAPI Statement Builder                   │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### API Discovery

The SCORM API is discovered by traversing the window hierarchy:

```javascript
function findAPI(win) {
    let attempts = 0;
    while (win && attempts < 10) {
        if (win.API) return { api: win.API, standard: 'SCORM_1.2' };
        if (win.API_1484_11) return { api: win.API_1484_11, standard: 'SCORM_2004' };
        if (win === win.parent) break;
        win = win.parent;
        attempts++;
    }
    return null;
}
```

---

## SCORM 1.2 Implementation

### Data Model Elements for Completion

| Element | Values | Purpose |
|---------|--------|---------|
| `cmi.core.lesson_status` | `passed`, `completed`, `failed`, `incomplete`, `browsed`, `not attempted` | Primary completion indicator |
| `cmi.core.score.raw` | 0-100 (typically) | Numeric score |
| `cmi.core.score.min` | Number | Minimum possible score |
| `cmi.core.score.max` | Number | Maximum possible score |
| `cmi.core.session_time` | `HHHH:MM:SS.SS` | Time spent in session |
| `cmi.core.exit` | `time-out`, `suspend`, `logout`, `` | How learner exited |

### Minimum Viable Completion Sequence

```javascript
const api = window.API;

// Set passing score
api.LMSSetValue("cmi.core.score.raw", "100");
api.LMSSetValue("cmi.core.score.min", "0");
api.LMSSetValue("cmi.core.score.max", "100");

// Set completion status
api.LMSSetValue("cmi.core.lesson_status", "passed");

// Set session time (some LMS require this)
api.LMSSetValue("cmi.core.session_time", "00:05:00");

// Commit to LMS
api.LMSCommit("");

// Optionally terminate session
api.LMSFinish("");
```

### Interaction Data (Optional - Some LMS Require)

Some enterprise LMS platforms validate that interaction data exists before accepting completion:

```javascript
// Set interaction count
api.LMSSetValue("cmi.interactions._count", "1");

// Record a single interaction
api.LMSSetValue("cmi.interactions.0.id", "Q1");
api.LMSSetValue("cmi.interactions.0.type", "choice");
api.LMSSetValue("cmi.interactions.0.result", "correct");
api.LMSSetValue("cmi.interactions.0.student_response", "a");
api.LMSSetValue("cmi.interactions.0.correct_responses.0.pattern", "a");
```

---

## SCORM 2004 Implementation

### Data Model Elements for Completion

| Element | Values | Purpose |
|---------|--------|---------|
| `cmi.completion_status` | `completed`, `incomplete`, `not attempted`, `unknown` | Content completion |
| `cmi.success_status` | `passed`, `failed`, `unknown` | Assessment result |
| `cmi.score.scaled` | -1.0 to 1.0 | Normalized score |
| `cmi.score.raw` | Number | Raw score value |
| `cmi.progress_measure` | 0.0 to 1.0 | Progress percentage |
| `cmi.session_time` | ISO 8601 duration | Time in session |

### Minimum Viable Completion Sequence

```javascript
const api = window.API_1484_11;

// Set score (scaled is -1 to 1, so 1.0 = 100%)
api.SetValue("cmi.score.scaled", "1.0");
api.SetValue("cmi.score.raw", "100");
api.SetValue("cmi.score.min", "0");
api.SetValue("cmi.score.max", "100");

// Set completion and success
api.SetValue("cmi.completion_status", "completed");
api.SetValue("cmi.success_status", "passed");

// Progress measure (1.0 = 100% complete)
api.SetValue("cmi.progress_measure", "1.0");

// Session time in ISO 8601 duration format
api.SetValue("cmi.session_time", "PT5M0S");

// Commit changes
api.Commit("");

// Terminate session
api.Terminate("");
```

---

## xAPI (Tin Can) Implementation

xAPI uses a statement-based model sent to a Learning Record Store (LRS).

### Statement Structure

```javascript
const statement = {
    id: crypto.randomUUID(),
    actor: {
        mbox: "mailto:learner@example.com",
        name: "Test Learner"
    },
    verb: {
        id: "http://adlnet.gov/expapi/verbs/passed",
        display: { "en-US": "passed" }
    },
    object: {
        id: "https://example.com/courses/course-id",
        definition: {
            type: "http://adlnet.gov/expapi/activities/course",
            name: { "en-US": "Course Title" }
        }
    },
    result: {
        completion: true,
        success: true,
        score: {
            scaled: 1.0,
            raw: 100,
            min: 0,
            max: 100
        },
        duration: "PT5M0S"
    },
    context: {
        contextActivities: {
            grouping: [{
                id: "https://example.com/courses/course-id",
                objectType: "Activity"
            }]
        }
    }
};
```

### Sending to LRS

```javascript
// xAPI typically uses TinCanJS library
const lrs = new TinCan.LRS({
    endpoint: "https://lrs.example.com/xapi/",
    username: "<key>",
    password: "<secret>",
    allowFail: false
});

lrs.saveStatement(statement, {
    callback: function(err, xhr) {
        if (err) console.error("Statement failed:", err);
        else console.log("Statement saved");
    }
});
```

---

## Storyline-Specific Considerations

### Runtime Objects

Storyline exposes several runtime objects that can be leveraged:

| Object | Purpose |
|--------|---------|
| `window.DS` | Main Storyline runtime |
| `window.DS.VO` | View Objects (slide content) |
| `window.DS.SM` | State Manager |
| `window.globalProvideData` | Data injection function |
| `window.player` | Player controller |

### Internal Variables

Storyline tracks completion through internal variables that map to LMS calls:

```javascript
// These are internal - setting them may trigger LMS updates
DS.setVariable("Results.ScorePercent", 100);
DS.setVariable("Results.PassPercent", 70);
DS.setVariable("Results.QuizPointsScored", 100);
DS.setVariable("Results.QuizPointsPossible", 100);
```

### Quiz/Assessment Objects

From the xAPI formatter code observed in the bundle:

```javascript
// Quiz completion triggers this internally
{
    type: "http://adlnet.gov/expapi/activities/objective",
    verb: "passed" | "failed" | "completed",
    result: {
        score: {
            scaled: percentScore / 100,
            raw: rawScore,
            min: 0,
            max: maxPoints
        },
        success: isPassed
    }
}
```

---

## Implementation Strategy

### Approach 1: Direct API Manipulation (Recommended)

Directly call the LMS API without going through Storyline:

**Pros**: Simple, reliable, works regardless of course internals
**Cons**: May not trigger course-side events

```javascript
function forceCompletion(options = {}) {
    const { score = 100, status = 'passed' } = options;

    const api = findSCORMAPI();
    if (!api) throw new Error('No SCORM API found');

    if (api.standard === 'SCORM_1.2') {
        api.ref.LMSSetValue("cmi.core.score.raw", String(score));
        api.ref.LMSSetValue("cmi.core.lesson_status", status);
        api.ref.LMSCommit("");
        return api.ref.LMSFinish("");
    }

    if (api.standard === 'SCORM_2004') {
        api.ref.SetValue("cmi.score.scaled", String(score / 100));
        api.ref.SetValue("cmi.completion_status", "completed");
        api.ref.SetValue("cmi.success_status", status);
        api.ref.Commit("");
        return api.ref.Terminate("");
    }
}
```

### Approach 2: Storyline Variable Injection

Manipulate Storyline's internal state to trigger natural completion flow:

**Pros**: Triggers all internal events, more "natural"
**Cons**: Requires understanding course variable names

```javascript
function injectPassingState() {
    if (!window.DS) throw new Error('Not a Storyline course');

    // Common variable patterns
    const vars = [
        'Results.ScorePercent',
        'Results.PassPercent',
        'Results.QuizPointsScored',
        'Results.QuizPointsPossible',
        'Quiz.Score',
        'Quiz.Passed'
    ];

    // Attempt to set known variables
    vars.forEach(v => {
        try {
            if (v.includes('Percent')) DS.setVariable(v, 100);
            else if (v.includes('Passed')) DS.setVariable(v, true);
            else if (v.includes('Scored')) DS.setVariable(v, 100);
            else if (v.includes('Possible')) DS.setVariable(v, 100);
        } catch (e) { /* Variable may not exist */ }
    });
}
```

### Approach 3: Hybrid (Most Robust)

Combine both approaches for maximum compatibility:

```javascript
async function bypassAssessment() {
    // Step 1: Set Storyline variables if available
    if (window.DS) {
        injectPassingState();
        await sleep(500); // Allow state propagation
    }

    // Step 2: Force LMS API completion
    forceCompletion({ score: 100, status: 'passed' });

    // Step 3: Verify
    return verifyCompletion();
}
```

---

## Error Handling & Edge Cases

### Common Failure Modes

1. **API Not Found**: Course not in LMS context (local preview)
2. **API Locked**: Session already terminated
3. **Validation Failure**: LMS requires interaction data
4. **Server Rejection**: LMS validates against course manifest

### Defensive Implementation

```javascript
function safeSetValue(api, element, value) {
    try {
        const result = api.LMSSetValue
            ? api.LMSSetValue(element, value)
            : api.SetValue(element, value);

        if (result === 'false' || result === false) {
            const error = api.LMSGetLastError?.() || api.GetLastError?.();
            console.warn(`Failed to set ${element}: Error ${error}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error(`Exception setting ${element}:`, e);
        return false;
    }
}
```

---

## Testing Checklist

- [ ] SCORM 1.2 completion on target LMS
- [ ] SCORM 2004 completion on target LMS
- [ ] xAPI statement transmission to LRS
- [ ] Completion persists after page refresh
- [ ] Certificate generation triggers (if applicable)
- [ ] Subsequent content unlocks (if gated)
- [ ] Grade passback to external systems
- [ ] Audit trail shows expected completion record

---

## Security Considerations

This functionality exists for QA testing within controlled environments. Production deployments should consider:

- Restricting extension to QA/staging environments
- Audit logging of bypass actions
- Role-based access within the extension
- Network-level restrictions on LMS API access

---

## References

- [SCORM 1.2 Runtime Reference](https://scorm.com/scorm-explained/technical-scorm/run-time/)
- [SCORM 2004 Data Model](https://scorm.com/scorm-explained/technical-scorm/scorm-2004-overview/)
- [xAPI Specification](https://github.com/adlnet/xAPI-Spec)
- [TinCanJS Documentation](https://rusticisoftware.github.io/TinCanJS/)

---

*Document Version: 1.0*
*Last Updated: 2026-01-11*
*Author: Senior Developer - QA Tools Team*
