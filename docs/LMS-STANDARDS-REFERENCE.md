# LMS Standards Technical Reference

> Compiled from official specifications and authoritative sources for the LMS QA Validator project.

## Sources

### Official Specifications
- **SCORM**: [ADL SCORM Documentation](https://www.adlnet.gov/scorm/)
- **SCORM Reference**: [SCORM Run-Time Reference Chart](https://scorm.com/scorm-explained/technical-scorm/run-time/run-time-reference/)
- **SCORM 1.2 Developer Guide**: [scorm.com SCORM 1.2 Overview](https://scorm.com/scorm-explained/technical-scorm/scorm-12-overview-for-developers/)
- **xAPI Specification**: [GitHub adlnet/xAPI-Spec](https://github.com/adlnet/xAPI-Spec)
- **xAPI Data Model**: [xAPI-Data.md](https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md)
- **AICC Archive**: [ADL-AICC Document Archive](https://github.com/ADL-AICC/AICC-Document-Archive/releases)
- **AICC HACP**: [Skillsoft AICC Documentation](https://documentation.skillsoft.com/en_us/ccps/custom_content_authoring_guidelines/aicc_authoring_guide/appendix_2/pub_hacp_commands.htm)

---

## SCORM 1.2

### API Methods (8 Functions)

| Method | Description |
|--------|-------------|
| `LMSInitialize("")` | Initialize communication session |
| `LMSFinish("")` | End communication session |
| `LMSGetValue(element)` | Retrieve data model element value |
| `LMSSetValue(element, value)` | Set data model element value |
| `LMSCommit("")` | Persist data to LMS |
| `LMSGetLastError()` | Get error code from last call |
| `LMSGetErrorString(code)` | Get error description |
| `LMSGetDiagnostic(code)` | Get diagnostic info |

### Data Model Elements

#### Core Elements (`cmi.core.*`)

| Element | Type | Access | Description |
|---------|------|--------|-------------|
| `cmi.core.student_id` | CMIIdentifier | RO | Learner identifier |
| `cmi.core.student_name` | CMIString255 | RO | Learner name |
| `cmi.core.lesson_location` | CMIString255 | RW | Bookmark/position |
| `cmi.core.credit` | CMIVocabulary | RO | `"credit"`, `"no-credit"` |
| `cmi.core.lesson_status` | CMIVocabulary | RW | See values below |
| `cmi.core.entry` | CMIVocabulary | RO | `"ab-initio"`, `"resume"`, `""` |
| `cmi.core.exit` | CMIVocabulary | WO | See values below |
| `cmi.core.lesson_mode` | CMIVocabulary | RO | `"browse"`, `"normal"`, `"review"` |
| `cmi.core.session_time` | CMITimespan | WO | Current session duration |
| `cmi.core.total_time` | CMITimespan | RO | Cumulative time |

#### Score Elements (`cmi.core.score.*`)

| Element | Type | Access | Range |
|---------|------|--------|-------|
| `cmi.core.score.raw` | CMIDecimal | RW | 0-100 (or min-max) |
| `cmi.core.score.min` | CMIDecimal | RW | Minimum possible |
| `cmi.core.score.max` | CMIDecimal | RW | Maximum possible |

### Valid Values

#### `cmi.core.lesson_status`
| Value | Description |
|-------|-------------|
| `"passed"` | Learner passed (met mastery) |
| `"completed"` | Learner completed (no mastery score) |
| `"failed"` | Learner failed |
| `"incomplete"` | Not finished |
| `"browsed"` | Viewed in browse mode |
| `"not attempted"` | Not started |

#### `cmi.core.exit`
| Value | Description | Effect on Next Launch |
|-------|-------------|----------------------|
| `""` | Normal exit (empty string) | New attempt, data reset |
| `"time-out"` | Session timed out | New attempt, data reset |
| `"suspend"` | Learner will resume | **Preserves data** |
| `"logout"` | Completed normally | New attempt, data reset |

**IMPORTANT**: Empty string `""` is the correct default for normal completion per specification.

### Time Formats

#### CMITimespan (session_time, total_time)
Format: `HHHH:MM:SS.SS`
- Hours: 2-4 digits (minimum 2)
- Minutes: exactly 2 digits
- Seconds: 2 digits + optional decimal (1-2 digits)

Examples:
```
0000:05:30      // 5 minutes, 30 seconds
0001:30:00      // 1 hour, 30 minutes
0000:00:45.50   // 45.5 seconds
```

### Error Codes

| Code | Category | Description |
|------|----------|-------------|
| `0` | - | No error |
| `101` | General | General exception |
| `201` | Syntax | Invalid argument |
| `202` | Syntax | Element cannot have children |
| `203` | Syntax | Element not an array |
| `301` | LMS | Not initialized |
| `401` | Data Model | Not implemented |
| `402` | Data Model | Invalid set value (keyword) |
| `403` | Data Model | Element is read only |
| `404` | Data Model | Element is write only |
| `405` | Data Model | Incorrect data type |

---

## SCORM 2004

### API Methods (8 Functions)

| Method | Description |
|--------|-------------|
| `Initialize("")` | Initialize session |
| `Terminate("")` | End session |
| `GetValue(element)` | Retrieve value |
| `SetValue(element, value)` | Set value |
| `Commit("")` | Persist data |
| `GetLastError()` | Get error code |
| `GetErrorString(code)` | Get error text |
| `GetDiagnostic(code)` | Get diagnostic info |

### Key Data Model Elements

#### Status Elements (Separated in 2004)

| Element | Type | Access | Valid Values |
|---------|------|--------|--------------|
| `cmi.completion_status` | Vocabulary | RW | `"completed"`, `"incomplete"`, `"not attempted"`, `"unknown"` |
| `cmi.success_status` | Vocabulary | RW | `"passed"`, `"failed"`, `"unknown"` |
| `cmi.progress_measure` | Real(10,7) | RW | 0.0 to 1.0 |

**Key Difference from SCORM 1.2**: Status is split into two separate elements:
- `cmi.completion_status` = Did they finish?
- `cmi.success_status` = Did they pass?

#### Score Elements

| Element | Type | Access | Description |
|---------|------|--------|-------------|
| `cmi.score.scaled` | Real(10,7) | RW | -1.0 to 1.0 (normalized) |
| `cmi.score.raw` | Real(10,7) | RW | Actual score |
| `cmi.score.min` | Real(10,7) | RW | Minimum possible |
| `cmi.score.max` | Real(10,7) | RW | Maximum possible |

#### Exit Element

| Element | Valid Values |
|---------|--------------|
| `cmi.exit` | `"time-out"`, `"suspend"`, `"logout"`, `"normal"`, `""` |

**Note**: `"logout"` is deprecated in SCORM 2004. Use `"normal"` instead.

### Time Format (ISO 8601 Duration)

Format: `P[n]Y[n]M[n]DT[n]H[n]M[n]S`

| Component | Meaning |
|-----------|---------|
| `P` | Period designator (required) |
| `T` | Time designator (required before H/M/S) |
| `nY` | Years |
| `nM` | Months (before T) or Minutes (after T) |
| `nD` | Days |
| `nH` | Hours |
| `nS` | Seconds (can have decimals) |

Examples:
```
PT5M30S        // 5 minutes, 30 seconds
PT1H30M45S     // 1 hour, 30 minutes, 45 seconds
PT45.5S        // 45.5 seconds
P1DT12H        // 1 day, 12 hours
```

### Error Codes (SCORM 2004)

| Code | Description |
|------|-------------|
| `0` | No error |
| `101` | General exception |
| `102` | General initialization failure |
| `103` | Already initialized |
| `104` | Content instance terminated |
| `111` | General termination failure |
| `112` | Termination before initialization |
| `113` | Termination after termination |
| `122` | Retrieve data before initialization |
| `123` | Retrieve data after termination |
| `132` | Store data before initialization |
| `133` | Store data after termination |
| `142` | Commit before initialization |
| `143` | Commit after termination |
| `201` | General argument error |
| `301` | General get failure |
| `351` | General set failure |
| `391` | General commit failure |
| `401` | Undefined data model element |
| `402` | Unimplemented data model element |
| `403` | Data model element value not initialized |
| `404` | Data model element is read only |
| `405` | Data model element is write only |
| `406` | Data model element type mismatch |
| `407` | Data model element value out of range |
| `408` | Data model dependency not established |

---

## AICC / HACP

### HACP Commands

| Command | Description | Required |
|---------|-------------|----------|
| `GetParam` | Retrieve data from LMS | Yes |
| `PutParam` | Send progress data to LMS | Yes |
| `ExitAU` | End session | Yes |

### HACP Communication Format

#### Request (POST to LMS)
```
command=PutParam
version=4.0
session_id=[session_id_from_launch]
aicc_data=[URL_encoded_INI_data]
```

#### AICC Data Block Format (INI-style)
```ini
[Core]
Lesson_Status=c
Score=85
Time=00:15:30

[Core_Lesson]
```

### Lesson Status Values

| Abbreviation | Full Value | Description |
|--------------|------------|-------------|
| `p` | passed | Learner passed |
| `f` | failed | Learner failed |
| `c` | completed | Learner completed |
| `i` | incomplete | Not finished |
| `n` | not attempted | Not started |
| `b` | browsed | Viewed only |

### Finding HACP Endpoint

Check these locations:
1. URL parameter: `?aicc_url=` or `?AICC_URL=`
2. Hidden form: `<form action="...HACP...">`
3. Window variables: `window.AICC_URL`, `window.hacpUrl`

### HACP Response Format
```
error=0
error_text=Successful
aicc_data=[returned_data]
```

---

## xAPI (Experience API / Tin Can)

### Statement Structure

```json
{
  "id": "UUID",
  "timestamp": "ISO 8601 datetime",
  "actor": { ... },
  "verb": { ... },
  "object": { ... },
  "result": { ... },
  "context": { ... }
}
```

### Required Fields
- `actor` - Who performed the action
- `verb` - What action was performed
- `object` - What was acted upon

### Actor Object

```json
{
  "objectType": "Agent",
  "name": "Learner Name",
  "mbox": "mailto:learner@example.com"
}
```

**Inverse Functional Identifiers** (one required):
- `mbox` - Email as mailto: IRI
- `mbox_sha1sum` - SHA1 hash of email
- `openid` - OpenID URI
- `account` - Account object with homePage and name

### Verb Object

```json
{
  "id": "http://adlnet.gov/expapi/verbs/completed",
  "display": { "en-US": "completed" }
}
```

#### Common Verbs (ADL Registry)

| Verb | IRI |
|------|-----|
| completed | `http://adlnet.gov/expapi/verbs/completed` |
| passed | `http://adlnet.gov/expapi/verbs/passed` |
| failed | `http://adlnet.gov/expapi/verbs/failed` |
| attempted | `http://adlnet.gov/expapi/verbs/attempted` |
| experienced | `http://adlnet.gov/expapi/verbs/experienced` |
| answered | `http://adlnet.gov/expapi/verbs/answered` |

### Object (Activity)

```json
{
  "objectType": "Activity",
  "id": "http://example.com/course/123",
  "definition": {
    "type": "http://adlnet.gov/expapi/activities/course",
    "name": { "en-US": "Course Title" },
    "description": { "en-US": "Course description" }
  }
}
```

### Result Object

```json
{
  "score": {
    "scaled": 0.85,
    "raw": 85,
    "min": 0,
    "max": 100
  },
  "success": true,
  "completion": true,
  "duration": "PT1H30M45S"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `score.scaled` | Number | -1.0 to 1.0 (normalized) |
| `score.raw` | Number | Actual score value |
| `score.min` | Number | Minimum possible |
| `score.max` | Number | Maximum possible |
| `success` | Boolean | Pass/fail indicator |
| `completion` | Boolean | Finished indicator |
| `duration` | String | ISO 8601 duration |
| `response` | String | Learner's response |

### LRS Communication

#### Sending Statement
```http
POST /statements HTTP/1.1
Host: lrs.example.com
Authorization: Basic [credentials]
X-Experience-API-Version: 1.0.3
Content-Type: application/json

{ statement object }
```

#### Response
```http
HTTP/1.1 200 OK
X-Experience-API-Statement-Id: [uuid]
```

### Common xAPI Library Patterns

| Library | Object Path | Send Method |
|---------|-------------|-------------|
| ADL xAPIWrapper | `ADL.XAPIWrapper` | `sendStatement()` |
| TinCanJS | `TinCan.LRS` | `saveStatement()` |
| TCAPI | `TCAPI` | `sendStatement()` |
| pipwerks | `pipwerks.SCORM` | `set()` |

---

## Authoring Tool Detection

### Articulate Storyline

| Indicator | Description |
|-----------|-------------|
| `window.DS` | Storyline runtime object |
| `window.DS.setVariable()` | Set Storyline variable |
| `window.DS.getVariable()` | Get Storyline variable |
| `window.DS.VO` | Variable objects dictionary |
| `window.globalProvideData` | Storyline data function |

#### Common Storyline Variables
```
Results.ScorePercent
Results.PassPercent
Results.QuizPointsScored
Results.QuizPointsPossible
Results.PassFail
Quiz.Score
Quiz.Passed
Quiz.Complete
```

### Adobe Captivate

| Indicator | Description |
|-----------|-------------|
| `window.cpAPIInterface` | Captivate API |
| `window.cpAPIEventEmitter` | Event system |
| `window.cp` | Captivate object |

### Lectora

| Indicator | Description |
|-----------|-------------|
| `window.trivREADY` | Lectora ready flag |
| `window.trivantis` | Trivantis namespace |
| `window.TrivWindow` | Lectora window |

---

## Quick Reference: Status Mapping

| Status | SCORM 1.2 | SCORM 2004 completion | SCORM 2004 success | AICC | xAPI verb |
|--------|-----------|----------------------|-------------------|------|-----------|
| Passed | `"passed"` | `"completed"` | `"passed"` | `p` | `passed` |
| Failed | `"failed"` | `"completed"` | `"failed"` | `f` | `failed` |
| Completed | `"completed"` | `"completed"` | `"unknown"` | `c` | `completed` |
| Incomplete | `"incomplete"` | `"incomplete"` | `"unknown"` | `i` | - |
| Not Attempted | `"not attempted"` | `"not attempted"` | `"unknown"` | `n` | - |

---

## Implementation Checklist

### SCORM 1.2 Completion
- [ ] Set `cmi.core.score.raw` (0-100)
- [ ] Set `cmi.core.score.min` (0)
- [ ] Set `cmi.core.score.max` (100)
- [ ] Set `cmi.core.lesson_status` (`passed`/`completed`/`failed`)
- [ ] Set `cmi.core.session_time` (HHHH:MM:SS.SS)
- [ ] Set `cmi.core.exit` (`""` or `"suspend"`)
- [ ] Call `LMSCommit("")`
- [ ] Optionally call `LMSFinish("")`

### SCORM 2004 Completion
- [ ] Set `cmi.score.scaled` (-1.0 to 1.0)
- [ ] Set `cmi.score.raw`
- [ ] Set `cmi.score.min`
- [ ] Set `cmi.score.max`
- [ ] Set `cmi.completion_status` (`completed`)
- [ ] Set `cmi.success_status` (`passed`/`failed`)
- [ ] Set `cmi.progress_measure` (0.0 to 1.0)
- [ ] Set `cmi.session_time` (ISO 8601)
- [ ] Set `cmi.exit` (`"normal"` or `"suspend"`)
- [ ] Call `Commit("")`
- [ ] Optionally call `Terminate("")`

### xAPI Completion Statement
- [ ] Generate UUID for statement `id`
- [ ] Set `timestamp` (ISO 8601)
- [ ] Set `actor` with valid IFI
- [ ] Set `verb` with IRI and display
- [ ] Set `object` with activity ID
- [ ] Set `result.score` (scaled, raw, min, max)
- [ ] Set `result.success` (boolean)
- [ ] Set `result.completion` (boolean)
- [ ] Set `result.duration` (ISO 8601)
- [ ] Send with `X-Experience-API-Version: 1.0.3`

---

*Last Updated: 2026-01-11*
*Version: 1.0*
