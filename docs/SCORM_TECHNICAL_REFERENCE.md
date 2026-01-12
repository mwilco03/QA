# SCORM Technical Reference for AI Context

## Purpose
This document captures technical knowledge about SCORM implementations for use in future AI prompts. Not intended for human documentation.

---

## SCORM Data Model Quick Reference

### SCORM 1.2 vs 2004 Key Differences

| Element | SCORM 1.2 | SCORM 2004 |
|---------|-----------|------------|
| Completion | `cmi.core.lesson_status` | `cmi.completion_status` + `cmi.success_status` |
| Score | `cmi.core.score.raw` (0-100) | `cmi.score.scaled` (-1 to 1) |
| Location | `cmi.core.lesson_location` | `cmi.location` |
| Time format | `HHHH:MM:SS.SS` | ISO 8601 `PT#H#M#S` |
| suspend_data limit | 4096 chars | 64000 chars |
| Objectives status | `cmi.objectives.n.status` | `cmi.objectives.n.completion_status` + `success_status` |

### Critical Elements for Completion

```
SCORM 1.2:
- cmi.core.lesson_status: passed|completed|failed|incomplete|browsed|not attempted
- cmi.core.score.raw: 0-100
- cmi.core.score.min: typically 0
- cmi.core.score.max: typically 100
- cmi.suspend_data: freeform string (4096 char limit)
- cmi.core.lesson_location: bookmark string

SCORM 2004:
- cmi.completion_status: completed|incomplete|not attempted|unknown
- cmi.success_status: passed|failed|unknown
- cmi.score.scaled: -1.0 to 1.0
- cmi.progress_measure: 0.0 to 1.0 (CRITICAL - can override completion_status)
- cmi.completion_threshold: if defined, LMS uses progress_measure to auto-set completion
- cmi.suspend_data: freeform string (64000 char limit)
- cmi.location: bookmark string
```

### Objectives Model

```
cmi.objectives._count: READ-ONLY, returns number of objectives
cmi.objectives.n.id: unique identifier
cmi.objectives.n.status (1.2) / completion_status + success_status (2004)
cmi.objectives.n.score.raw|min|max|scaled
cmi.objectives.n.progress_measure (2004 only)
```

---

## Authoring Tool suspend_data Formats

### Articulate Storyline

**CRITICAL**: Storyline COMPRESSES suspend_data using custom LZ compression + Base64.

Detection:
```javascript
// Compressed data starts with these patterns:
data.startsWith('H4sI')  // gzip + base64
data.match(/^[A-Za-z0-9+/=]{50,}$/)  // long base64 string
```

Uncompressed format (older versions):
```
viewed=1,2,3|lastviewedslide=3|2#1##,7,7,11,1,1,1#0,0,0,0,0,0##-1
```

Components:
- `viewed=` - comma-separated slide indices that were visited
- `lastviewedslide=` - last slide when course was exited
- Numbers after `|` - navigation panel state, quiz states

DS Object Variables for slide tracking:
```javascript
window.DS.setVariable('AllSlidesViewed', true);
window.DS.setVariable('SlidesViewedCount', totalSlides);
window.DS.setVariable('Results.ScorePercent', 100);
window.DS.setVariable('Results.PassFail', 'pass');
```

### Articulate Rise 360

**Uses lzwCompress library** (npm: lzwcompress)

Uncompressed JSON structure:
```json
{
  "lessons": [
    {
      "id": "lesson-1",
      "complete": true,
      "progress": 1,
      "blocks": [
        { "id": "block-1", "complete": true, "viewed": true, "progress": 1 }
      ]
    }
  ],
  "currentLesson": 0,
  "currentBlock": 0,
  "progress": { "lesson-1": 1, "block-1": 1 }
}
```

### Adobe Captivate

Pipe-delimited format:
```
slideIndex|slideTime|quizData...
```

Or JSON:
```json
{
  "slideViews": [true, true, true, false],
  "currentSlide": 2,
  "quizState": {...}
}
```

Global objects:
```javascript
window.cp.movie.totalSlides
window.cp.movie.currentSlide
window.cpInfoSlideCount
```

### Lectora (ELB Learning)

Comma-separated page IDs or JSON:
```
1,2,3,4,5
```

Or:
```json
{
  "pagesVisited": { "page1": true, "page2": true },
  "currentPage": "page2"
}
```

Global objects:
```javascript
window.trivantis.pages
window.TrivantisCore.pageCount
```

### iSpring

JSON format:
```json
{
  "viewedSlides": [1, 1, 1, 0, 0],
  "currentSlide": 2,
  "progress": 0.6
}
```

Global objects:
```javascript
window.PresentationSettings.slideCount
window.iSpring.presentation.slideCount
```

---

## SCORM 2004 Sequencing

### Key Concepts

Sequencing rules are defined in the **manifest XML**, not runtime API. Client-side code cannot bypass manifest-defined sequencing.

### Sequencing Elements

```xml
<imsss:sequencing>
  <imsss:controlMode choice="true" flow="true"/>
  <imsss:sequencingRules>
    <imsss:preConditionRule>
      <imsss:ruleConditions>
        <imsss:ruleCondition condition="completed"/>
      </imsss:ruleConditions>
      <imsss:ruleAction action="disabled"/>
    </imsss:preConditionRule>
  </imsss:sequencingRules>
</imsss:sequencing>
```

### Rollup Rules

Course completion is determined by rollup from child activities:
- All children must be satisfied (default)
- Or specific rollup rules in manifest

### Navigation Request Model

```javascript
// SCORM 2004 navigation
adl.nav.request: continue|previous|choice|exit|exitAll|abandon|abandonAll|suspendAll|_none_
```

---

## LMS-Specific Behaviors

### Moodle
- Supports admin manual completion override
- Respects SCORM package sequencing
- Can be configured to ignore client completion

### Cornerstone OnDemand (CSOD)
- Server-side time tracking validation
- May reject completion if time < minimum
- Audit logging of all completion changes

### SAP SuccessFactors
- Known issues with Storyline suspend_data length
- Requires specific lesson_location format

### Workday Learning
- Strict validation of score values
- May require specific decimal precision

---

## Edge Cases and Failure Modes

### suspend_data Issues
1. **Compression** - Cannot modify compressed data without decompression library
2. **Character limits** - SCORM 1.2 = 4096, modifications may exceed
3. **Format validation** - Some LMS validate suspend_data format

### Completion Rejection Scenarios
1. **Sequencing rules** - SCORM 2004 manifest can block completion
2. **Progress threshold** - `cmi.progress_measure < cmi.completion_threshold` = LMS overrides
3. **Time requirements** - Server-side minimum time validation
4. **Quiz requirements** - Must have passing interaction results

### API Access Issues
1. **Cross-origin iframes** - API in different origin iframe
2. **Wrapped APIs** - LMS may proxy/wrap SCORM API
3. **Session expiry** - API calls fail after timeout

---

## Detection Signatures by Tool

```javascript
// Storyline
window.DS || window.g_slideData || window.JSON_PLAYER ||
document.querySelector('#slide-window, .slide-container')

// Rise 360
document.querySelector('[data-ba-component]') ||
window.__RISE_COURSE_DATA__

// Captivate
window.cp || window.cpAPIInterface ||
document.querySelector('#cpMainContainer')

// Lectora
window.trivantis || window.TrivantisCore

// iSpring
window.iSpring || window.PresentationSettings
```

---

## Implementation Priorities

1. **HIGH**: Detect and handle compressed suspend_data
2. **HIGH**: Set cmi.progress_measure for SCORM 2004
3. **MEDIUM**: Check completion_threshold before setting status
4. **MEDIUM**: Enumerate all SCOs in multi-SCO courses
5. **LOW**: Handle global objectives (adl.data model)

---

## Implementation Status

### Completed (lib/lms-qa-validator.js)

#### Compression Utilities (Utils object)
- `detectCompression(data)` - Detects gzip, lzw, base64, storyline-custom
- `isCompressed(data)` - Boolean check for compression
- `base64Decode/Encode(data)` - Standard and URL-safe base64
- `inflateGzip(data)` - Uses DecompressionStream API for gzip
- `deflateGzip(data)` - Uses CompressionStream API for gzip
- `lzwDecompress(codes)` - Standard LZW algorithm for Rise 360
- `lzwCompress(string)` - LZW compression
- `decompressSuspendData(data)` - Auto-detecting decompression
- `recompressSuspendData(data, type)` - Re-compress to original format

#### Slide/Block Marking (SCORMAPI object)
- `_markStorylineSlides(suspendData)` - Async, handles gzip compression
- `_markRiseBlocks(suspendData)` - Async, handles LZW compression
- `_markCaptivateSlides(suspendData)` - Pipe-delimited and JSON
- `_markLectoraPages(suspendData)` - Comma-separated and JSON
- `_markISpringSlides(suspendData)` - JSON format

#### SCORM 2004 Completion
- `cmi.progress_measure` set to 1.0 in `_completeSCORM2004()`
- `cmi.objectives.n.progress_measure` set for each objective

### Known Limitations

1. **Storyline Custom Compression**: Older Storyline versions use proprietary compression that cannot be decompressed without the exact algorithm
2. **Browser Support**: gzip decompression requires `DecompressionStream` API (Chrome 80+, Firefox 113+, Safari 16.4+)
3. **Sequencing Rules**: Cannot bypass SCORM 2004 sequencing rules defined in manifest
4. **Multi-SCO**: Current implementation focuses on single-SCO courses

---

## Time Tracking Deep Dive

### What We Control (Client-Side)

| Element | SCORM 1.2 | SCORM 2004 | Format |
|---------|-----------|------------|--------|
| Session Time | `cmi.core.session_time` | `cmi.session_time` | SCORM 1.2: `HHHH:MM:SS.SS`, SCORM 2004: ISO 8601 `PT#H#M#S` |
| Total Time | `cmi.core.total_time` | `cmi.total_time` | **READ-ONLY** - LMS calculates from session_time sum |
| Exit | `cmi.core.exit` | `cmi.exit` | '', 'logout', 'suspend', 'time-out' |

### Server-Side Tracking Reality

Most enterprise LMS implement **dual tracking**:

```
Client Reports:    Initialize() ──────────────────────> Commit() with session_time=PT5M
                       │                                       │
Server Calculates:     │  timestamp_start                      │  timestamp_end
                       └───────────────────────────────────────┘
                              actual_elapsed_time = timestamp_end - timestamp_start
```

### LMS-Specific Validation Behaviors

| LMS | Time Validation | Rejection Behavior |
|-----|-----------------|-------------------|
| **Cornerstone (CSOD)** | Server-side timestamp tracking | Compares actual vs reported; may flag or reject if mismatch > 30% |
| **SAP SuccessFactors** | Minimum time requirements | Course admin can set min time; completion rejected if below |
| **Workday Learning** | Audit logging | Flags short completions for compliance review; doesn't auto-reject |
| **Moodle** | Usually trusts client | Most permissive; no server-side time check by default |
| **SCORM Cloud** | Tracks both | Reports discrepancies in analytics but usually accepts |
| **Blackboard** | Depends on config | Institution can enable time enforcement |
| **Canvas LMS** | Trust client | No built-in time validation |
| **Absorb LMS** | Server tracking | Uses login timestamps; may require min engagement |
| **TalentLMS** | Basic tracking | Logs session start/end but rarely validates |

### Strategies for Time-Sensitive LMS

1. **Set Realistic Time** - Use course duration estimate (if known) rather than minimum
2. **Exceed Minimum** - If course has 30-min requirement, set 35-40 min
3. **Allow Real Time** - Some users wait for real time to elapse before triggering completion
4. **Check Course Requirements** - Look for `completion_threshold`, `mastery_score`, time requirements in manifest

### Time Format Reference

```javascript
// SCORM 1.2 format: HHHH:MM:SS.SS
"0001:30:00.00"  // 1 hour 30 minutes

// SCORM 2004 format: ISO 8601 duration
"PT1H30M"        // 1 hour 30 minutes
"PT90M"          // Also valid: 90 minutes
"PT5M30S"        // 5 minutes 30 seconds

// AICC format: HH:MM:SS
"01:30:00"       // 1 hour 30 minutes
```

### Implementation Notes

Session time is now configurable in the UI (SCORM Controls > Session Time). The value is:
- Input in minutes (UI)
- Converted to seconds internally
- Formatted per standard when calling SetValue
- Default: 5 minutes (300 seconds)

### Testing Notes

To test compression handling:
```javascript
// Check if data is compressed
Utils.detectCompression(suspendData) // Returns: 'gzip'|'lzw'|'base64'|null

// Decompress and inspect
const result = await Utils.decompressSuspendData(suspendData);
console.log(result.data, result.compressed, result.type);
```
