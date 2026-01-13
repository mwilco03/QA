# Browser Setup Guide

This guide explains how to set up the LMS Q&A scripts in your browser for persistent, reusable access.

## Table of Contents

- [Method 1: DevTools Snippets (Recommended)](#method-1-devtools-snippets-recommended)
- [Method 2: Direct Console Paste](#method-2-direct-console-paste)
- [Method 3: Bookmarklets](#method-3-bookmarklets)
- [Browser-Specific Instructions](#browser-specific-instructions)
- [Troubleshooting](#troubleshooting)

---

## Method 1: DevTools Snippets (Recommended)

Snippets are saved JavaScript files within your browser's Developer Tools. They persist across sessions and can be run on-demand.

### Why Snippets?

| Feature | Snippets | Console Paste | Bookmarklets |
|---------|----------|---------------|--------------|
| Persists across sessions | Yes | No | Yes |
| Easy to update | Yes | N/A | No (URL encoded) |
| Handles large scripts | Yes | Yes | No (~2KB limit) |
| Run on-demand | Yes | Yes | Yes |
| Works offline | Yes | Yes | Yes |

### Step-by-Step Setup (Chrome/Edge/Brave)

#### 1. Open Developer Tools
- Press `F12`, or
- Press `Ctrl+Shift+I` (Windows/Linux) / `Cmd+Option+I` (Mac), or
- Right-click page → "Inspect"

#### 2. Navigate to Snippets
```
Sources tab → Left sidebar → Snippets
```

If you don't see "Snippets":
1. Click the `>>` chevron in the sidebar
2. Select "Snippets" from the dropdown

#### 3. Create a New Snippet
1. Right-click in the Snippets panel
2. Select "New snippet"
3. Name it (e.g., `lms-extractor`)

#### 4. Add Script Content
1. Copy the contents of the desired script from `lib/`
2. Paste into the snippet editor
3. Press `Ctrl+S` to save

#### 5. Run the Snippet

**Option A: Right-click menu**
- Right-click snippet name → "Run"

**Option B: Keyboard shortcut**
- Click into snippet editor
- Press `Ctrl+Enter` (Windows/Linux) / `Cmd+Enter` (Mac)

**Option C: Command Palette**
1. Press `Ctrl+P` (or `Cmd+P`)
2. Type `!` followed by snippet name
3. Press Enter

Example: `!lms-extractor` → runs the lms-extractor snippet

### Recommended Snippet Configuration

Create these snippets for common workflows:

| Snippet Name | Script File | Use Case |
|--------------|-------------|----------|
| `lms-extractor` | `lms-extractor-complete.js` | Universal - works on most LMS |
| `storyline` | `storyline-console-extractor.js` | Articulate Storyline courses |
| `tla-helper` | `tla-completion-helper.js` | TLA/xAPI platforms |
| `qa-extractor` | `unified-qa-extractor.js` | Multi-format parsing |

---

## Method 2: Direct Console Paste

For one-off usage without setup.

### Steps

1. Open Developer Tools (`F12`)
2. Go to **Console** tab
3. Copy entire script content
4. Paste into console
5. Press `Enter`

### Handling "Paste is blocked" Warning

Some browsers block paste in console for security. Type:
```
allow pasting
```
Then paste your script.

---

## Method 3: Bookmarklets

Bookmarklets are JavaScript URLs saved as bookmarks. Good for small scripts or loaders.

### Creating a Loader Bookmarklet

Since the full scripts are too large for bookmarklets (~2KB limit), use a loader:

1. Create a new bookmark
2. Set the URL to:

```javascript
javascript:(function(){var s=document.createElement('script');s.src='https://raw.githubusercontent.com/YOUR-REPO/main/lib/lms-extractor-complete.js';document.head.appendChild(s);})();
```

**Note:** Replace `YOUR-REPO` with your actual repository URL.

### Running a Bookmarklet
1. Navigate to the LMS course page
2. Click the bookmarklet in your bookmarks bar

---

## Browser-Specific Instructions

### Chrome / Chromium

**Snippets Location:** `Sources → Snippets`

**Running Snippets:**
- `Ctrl+Enter` while in snippet
- `Ctrl+P` then `!snippet-name`
- Right-click → Run

### Microsoft Edge

Identical to Chrome (same Chromium base).

### Brave

Identical to Chrome, but may need to:
1. Disable Shields for the LMS domain
2. Allow scripts in Brave settings

### Firefox

**Note:** Firefox removed Scratchpad in v72. Use Multi-line Editor instead.

1. Open DevTools (`F12`)
2. Go to **Console** tab
3. Click the editor icon (bottom-right) or press `Ctrl+B`
4. Paste script in multi-line editor
5. Press `Ctrl+Enter` to run

**To save for reuse:**
- `Ctrl+S` saves to file
- `Ctrl+O` opens saved files

### Safari

1. Enable Developer Menu:
   - Safari → Preferences → Advanced
   - Check "Show Develop menu in menu bar"
2. Open Web Inspector: `Cmd+Option+I`
3. Go to **Sources** tab
4. Click `+` to add snippet
5. Paste and run with `Cmd+Enter`

---

## Workflow Example

### Complete LMS Course Extraction

```javascript
// 1. Run lms-extractor snippet (Ctrl+Enter)
// 2. In console, extract content:
await LMSExtractor.extract()

// 3. View correct answers:
LMSExtractor.getCorrectAnswers()

// 4. Download results:
LMSExtractor.download('json')

// 5. (Optional) Complete course:
await LMSExtractor.complete(100)
```

### Storyline Course Extraction

```javascript
// 1. Run storyline snippet (Ctrl+Enter)
// 2. Results auto-populate:
window.allQA           // All questions/answers
window.courseData      // Full course data

// 3. Export:
window.exportQA('json')
window.exportQA('txt')
```

### TLA/xAPI Course

```javascript
// 1. Run tla-helper snippet (Ctrl+Enter)
// 2. Get session info:
const contentUrl = new URLSearchParams(location.search).get('contentUrl');
const sessionId = location.pathname.match(/sessions\/([^\/]+)/)?.[1];

// 3. Extract questions:
const resp = await fetch(`/api/assets/tasks.json?contentUrl=${contentUrl}`);
const tasks = await resp.json();
const questions = TLAHelper.extractFromTasksJson(tasks);

// 4. View results:
console.log(TLAHelper.exportQuestions(questions, 'text'));

// 5. (Optional) Auto-complete:
await TLAHelper.autoComplete(sessionId, contentUrl);
```

---

## Troubleshooting

### Snippet Not Running

**Symptom:** Nothing happens when running snippet

**Solutions:**
1. Check console for errors
2. Ensure script saved (`Ctrl+S`)
3. Try refreshing DevTools (`F5` while focused on DevTools)

### "Paste is blocked"

**Symptom:** Console shows warning about pasting

**Solution:** Type `allow pasting` and press Enter, then paste again

### Script Not Finding SCORM API

**Symptom:** "No SCORM API found" error

**Solutions:**
1. Check if course is in iframe - switch to frame context
2. Try: `window.parent.API` or `window.top.API`
3. Course may use non-standard API location

### Cross-Origin Errors

**Symptom:** "Blocked by CORS policy" errors

**Solutions:**
1. Switch to correct frame context in console
2. Some courses prevent cross-origin access - try from within iframe

### Snippets Disappeared After Browser Update

**Symptom:** Previously saved snippets are gone

**Cause:** Browser profile reset or DevTools storage cleared

**Prevention:** Keep script files in this repository as backup

---

## Tips & Best Practices

### Organize Your Snippets

Use consistent naming:
```
lms-extractor      (main tool)
storyline          (storyline-specific)
tla-helper         (TLA/xAPI)
qa-utils           (utilities)
```

### Quick Access via Command Palette

1. Press `Ctrl+P` (opens command palette)
2. Type `!` to filter snippets
3. Type snippet name
4. Press Enter to run

Example: `Ctrl+P` → `!lms` → Enter

### Update Scripts Easily

When scripts update:
1. Open snippet in DevTools
2. Select all (`Ctrl+A`)
3. Paste new version
4. Save (`Ctrl+S`)

### Multiple Browser Profiles

For different LMS environments, consider separate browser profiles with different snippet configurations.
