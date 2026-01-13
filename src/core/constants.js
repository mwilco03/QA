/**
 * Constants - Single source of truth for all configuration values
 *
 * IMPORTANT: This is the ONE place where these values are defined.
 * All modules import from here. No copy-paste. No drift.
 */

export const VERSION = '6.1.0';

// Runtime configuration
export const CONFIG = Object.freeze({
    MAX_RECURSION_DEPTH: 20,
    MAX_API_SEARCH_DEPTH: 5,
    MAX_FETCH_TIMEOUT: 5000,
    MAX_RESOURCES: 100,
    MAX_LOGS: 500,
    DEBOUNCE_DELAY: 150
});

// Path patterns - Centralized configuration for authoring tool detection
// These patterns may vary by tool version; update HERE when new patterns are found
export const PATHS = Object.freeze({
    STORYLINE: {
        DETECT_PATTERNS: [
            /\/html5\/data\/js\//,
            /\/story_content\//,
            /\/mobile\/data\//
        ],
        DATA_FILES: ['data.js', 'frame.js', 'paths.js', 'text.js', 'textdata.js'],
        DATA_JS_PATH: '/html5/data/js',
        SLIDE_ID_PATTERN: /^[0-9a-zA-Z]{11}$/
    },
    TLA: {
        TASKS_ENDPOINT: '/api/assets/tasks.json',
        STATE_ENDPOINT: '/api/sessions/{sessionId}/lrs/state',
        SCORE_ENDPOINT: '/api/sessions/{sessionId}/score',
        SESSION_ID_PATTERN: /sessions?\/([a-z]{2}-[0-9a-f-]+)/i
    },
    ISPRING: {
        DATA_FILES: ['data.js', 'slides.js', 'quiz.js']
    },
    CAPTIVATE: {
        DATA_FILES: ['quiz.js', 'project.js']
    },
    LECTORA: {
        DATA_FILES: ['a001index.html', 'trivantis.js']
    }
});

// Item types for extracted content
export const ITEM_TYPE = Object.freeze({
    QUESTION: 'question',
    ANSWER: 'answer',
    SEQUENCE: 'sequence_item',
    DRAG: 'drag_item',
    DROP: 'drop_target',
    MATCH_SOURCE: 'match_source',
    MATCH_TARGET: 'match_target'
});

// Question interaction types (aligned with SCORM/xAPI spec)
export const QUESTION_TYPE = Object.freeze({
    MULTIPLE_CHOICE: 'choice',
    MULTIPLE_RESPONSE: 'multiple-choice',
    TRUE_FALSE: 'true-false',
    FILL_IN: 'fill-in',
    MATCHING: 'matching',
    SEQUENCING: 'sequencing',
    HOTSPOT: 'hotspot',
    DRAG_DROP: 'drag-drop',
    NUMERIC: 'numeric',
    LIKERT: 'likert',
    ESSAY: 'long-fill-in',
    OTHER: 'other'
});

// Authoring tool identifiers
export const AUTHORING_TOOL = Object.freeze({
    STORYLINE: 'storyline',
    RISE: 'rise',
    CAPTIVATE: 'captivate',
    LECTORA: 'lectora',
    ISPRING: 'ispring',
    CAMTASIA: 'camtasia',
    GENERIC: 'generic'
});

// Confidence levels for detection
export const CONFIDENCE = Object.freeze({
    VERY_HIGH: 95,
    HIGH: 90,
    MEDIUM: 70,
    LOW: 50,
    VERY_LOW: 30
});

// LMS standards
export const LMS_STANDARD = Object.freeze({
    SCORM_12: 'scorm12',
    SCORM_2004: 'scorm2004',
    XAPI: 'xapi',
    AICC: 'aicc',
    CMI5: 'cmi5',
    CUSTOM: 'custom'
});

// Priority levels
export const PRIORITY = Object.freeze({
    HIGH: 'high',
    NORMAL: 'normal',
    LOW: 'low'
});

// Correct answer indicators
export const CORRECT_INDICATORS = Object.freeze({
    VALUES: ['true', 'correct', '1'],
    DATA_ATTRS: ['correct', 'answer', 'right'],
    CLASSES: ['correct', 'right-answer', 'is-correct']
});

// Placeholder text to ignore
export const PLACEHOLDER_TEXT = Object.freeze([
    'choose...', 'select...', 'select one', 'select an option',
    '---', '- select -', ''
]);

// Message types for extension communication
export const MSG = Object.freeze({
    PREFIX: 'LMS_QA_',
    READY: 'READY',
    SCAN_STARTED: 'SCAN_STARTED',
    SCAN_COMPLETE: 'SCAN_COMPLETE',
    SCAN_ERROR: 'SCAN_ERROR',
    PROGRESS: 'PROGRESS',
    STATE: 'STATE',
    CMI_DATA: 'CMI_DATA',
    TEST_RESULT: 'TEST_RESULT',
    SET_COMPLETION_RESULT: 'SET_COMPLETION_RESULT',
    FORCE_COMPLETION_RESULT: 'FORCE_COMPLETION_RESULT',
    AUTO_SELECT_RESULT: 'AUTO_SELECT_RESULT',
    OBJECTIVES_COMPLETE: 'OBJECTIVES_COMPLETE',
    SLIDES_MARKED: 'SLIDES_MARKED',
    FULL_COMPLETION_RESULT: 'FULL_COMPLETION_RESULT',
    DURATION_ESTIMATE: 'DURATION_ESTIMATE',
    COMPLETION_REQUEST_DETECTED: 'COMPLETION_REQUEST_DETECTED',
    NETWORK_ANALYSIS: 'NETWORK_ANALYSIS',
    REPLAY_RESULT: 'REPLAY_RESULT',
    // Commands
    CMD_SCAN: 'LMS_QA_CMD_SCAN',
    CMD_TEST_API: 'LMS_QA_CMD_TEST_API',
    CMD_SET_COMPLETION: 'LMS_QA_CMD_SET_COMPLETION',
    CMD_FORCE_COMPLETION: 'LMS_QA_CMD_FORCE_COMPLETION',
    CMD_COMPLETE_OBJECTIVES: 'LMS_QA_CMD_COMPLETE_OBJECTIVES',
    CMD_MARK_SLIDES: 'LMS_QA_CMD_MARK_SLIDES',
    CMD_FULL_COMPLETION: 'LMS_QA_CMD_FULL_COMPLETION',
    CMD_ESTIMATE_DURATION: 'LMS_QA_CMD_ESTIMATE_DURATION',
    CMD_START_NETWORK_MONITOR: 'LMS_QA_CMD_START_NETWORK_MONITOR',
    CMD_STOP_NETWORK_MONITOR: 'LMS_QA_CMD_STOP_NETWORK_MONITOR',
    CMD_GET_NETWORK_ANALYSIS: 'LMS_QA_CMD_GET_NETWORK_ANALYSIS',
    CMD_REPLAY_COMPLETION: 'LMS_QA_CMD_REPLAY_COMPLETION',
    CMD_GET_STATE: 'LMS_QA_CMD_GET_STATE',
    CMD_GET_CMI_DATA: 'LMS_QA_CMD_GET_CMI_DATA',
    CMD_AUTO_SELECT: 'LMS_QA_CMD_AUTO_SELECT',
    CMD_EXPORT: 'LMS_QA_CMD_EXPORT',
    CMD_DETECT_APIS: 'LMS_QA_CMD_DETECT_APIS',
    CMD_SEED_EXTRACT: 'LMS_QA_CMD_SEED_EXTRACT',
    APIS_DETECTED: 'APIS_DETECTED',
    SEED_EXTRACT_RESULT: 'SEED_EXTRACT_RESULT'
});

// Code detection patterns - used to filter out code from content extraction
export const CODE_INDICATORS = Object.freeze([
    /[{}\[\]();].*[{}\[\]();]/,
    /\bfunction\s*\(/,
    /\bvar\s+\w+\s*=/,
    /\bconst\s+\w+\s*=/,
    /\blet\s+\w+\s*=/,
    /\breturn\s+[\w.]+[({]/,
    /\bif\s*\([^)]+\)\s*{/,
    /\bfor\s*\([^)]+\)/,
    /\bwhile\s*\(/,
    /\bthis\.\w+\(/,
    /\w+\.\w+\.\w+\(/,
    /=>\s*{/,
    /\w+\s*===?\s*\w+/,
    /\w+\s*!==?\s*\w+/,
    /\|\||&&/,
    /\+\+|--/,
    /\w+\[\w+\]/,
    /parseInt|parseFloat|toString/,
    /null|undefined|NaN/,
    /\.length\s*[><=]/,
    /\.push\(|\.pop\(|\.shift\(/,
    /\.map\(|\.filter\(|\.reduce\(/,
    /\.substr\(|\.substring\(/,
    /console\.|window\.|document\./,
    /[a-z]+[A-Z][a-z]+[A-Z]/,
    /^[a-z]+[A-Z]/,
    /\b(str|int|bln|ary|obj)[A-Z]/
]);

// Content patterns for natural language detection
export const CONTENT_PATTERNS = Object.freeze({
    questions: [
        /["']?question["']?\s*(?:\d+)?\s*:\s*["']([^"']{20,200})["']/gi,
        /(?:^|\n)\s*(?:\d+[\.\)]\s+)?([A-Z][^?\n]{20,150}\?)\s*$/gm
    ],
    answers: [
        /["']answer["']\s*:\s*["']([^"']{5,200})["']/gi,
        /(?:^|\n)\s*[a-d][\.\)]\s+([A-Z][^\n]{5,150})/gm
    ],
    correct: [
        /["']correct(?:Answer|Response|Option)["']\s*:\s*["']([^"']{5,200})["']/gi
    ]
});

// TLA/xAPI answer format delimiters
export const TLA_DELIMITERS = Object.freeze({
    CHOICE: '[,]',
    MATCH: '[.]'
});
