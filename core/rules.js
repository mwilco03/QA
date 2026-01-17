/**
 * LMS QA Validator - Pure Rule Evaluation
 *
 * Implements Directive #10: Make rule evaluation pure
 * Rule functions accept data and return results - no DOM access inside rules.
 * DOM-dependent rules are brittle and untestable. Rules become reusable and predictable.
 *
 * @fileoverview Pure validation rules for content analysis
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// RULE RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rule evaluation result
 * @typedef {Object} RuleResult
 * @property {boolean} passed - Whether rule passed
 * @property {number} confidence - Confidence score (0-100)
 * @property {string} reason - Explanation of result
 * @property {Object} [data] - Additional data from evaluation
 */

/**
 * Create a rule result
 * @param {boolean} passed
 * @param {number} confidence
 * @param {string} reason
 * @param {Object} [data]
 * @returns {RuleResult}
 */
function createRuleResult(passed, confidence, reason, data = null) {
    return {
        passed,
        confidence: Math.max(0, Math.min(100, confidence)),
        reason,
        data
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CODE DETECTION RULES (Pure functions - no DOM access)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Code indicator patterns
 */
const CODE_PATTERNS = [
    { name: 'brackets', pattern: /[{}\[\]();].*[{}\[\]();]/ },
    { name: 'function', pattern: /\bfunction\s*\(/ },
    { name: 'var_decl', pattern: /\b(?:var|const|let)\s+\w+\s*=/ },
    { name: 'return', pattern: /\breturn\s+[\w.]+[({]/ },
    { name: 'if_stmt', pattern: /\bif\s*\([^)]+\)\s*{/ },
    { name: 'for_loop', pattern: /\bfor\s*\([^)]+\)/ },
    { name: 'while_loop', pattern: /\bwhile\s*\(/ },
    { name: 'method_call', pattern: /\bthis\.\w+\(/ },
    { name: 'chained', pattern: /\w+\.\w+\.\w+\(/ },
    { name: 'arrow_fn', pattern: /=>\s*{/ },
    { name: 'comparison', pattern: /\w+\s*===?\s*\w+/ },
    { name: 'inequality', pattern: /\w+\s*!==?\s*\w+/ },
    { name: 'logical_ops', pattern: /\|\||&&/ },
    { name: 'increment', pattern: /\+\+|--/ },
    { name: 'array_access', pattern: /\w+\[\w+\]/ },
    { name: 'js_methods', pattern: /parseInt|parseFloat|toString/ },
    { name: 'js_literals', pattern: /\bnull\b|\bundefined\b|\bNaN\b/ },
    { name: 'camelCase', pattern: /[a-z]+[A-Z][a-z]+[A-Z]/ },
    { name: 'hungarian', pattern: /\b(?:str|int|bln|ary|obj)[A-Z]/ }
];

/**
 * Rule: Check if text looks like code
 * PURE FUNCTION - operates only on input data
 *
 * @param {string} text - Text to analyze
 * @returns {RuleResult}
 */
function isCodeLike(text) {
    if (!text || typeof text !== 'string') {
        return createRuleResult(false, 100, 'No text to analyze');
    }

    if (text.length < 5) {
        return createRuleResult(true, 80, 'Text too short to be content');
    }

    // Check code patterns
    const matchedPatterns = [];
    for (const { name, pattern } of CODE_PATTERNS) {
        if (pattern.test(text)) {
            matchedPatterns.push(name);
        }
    }

    if (matchedPatterns.length > 0) {
        return createRuleResult(
            true,
            Math.min(95, 70 + matchedPatterns.length * 5),
            `Matched code patterns: ${matchedPatterns.join(', ')}`,
            { patterns: matchedPatterns }
        );
    }

    // Check code character ratio
    const codeChars = (text.match(/[{}\[\]();=<>!&|+\-*\/]/g) || []).length;
    const codeRatio = codeChars / text.length;
    if (codeRatio > 0.15) {
        return createRuleResult(true, 85, `High code character ratio: ${(codeRatio * 100).toFixed(1)}%`);
    }

    // Check word length (code tends to have very short "words")
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 0) {
        const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
        if (avgWordLength < 3 && words.length > 3) {
            return createRuleResult(true, 70, `Short average word length: ${avgWordLength.toFixed(1)}`);
        }
    }

    // Check for camelCase without spaces (likely variable name)
    if (/^[a-z]+[A-Z]/.test(text) && !text.includes(' ')) {
        return createRuleResult(true, 90, 'Looks like camelCase variable');
    }

    return createRuleResult(false, 80, 'No code patterns detected');
}

// ═══════════════════════════════════════════════════════════════════════════
// NATURAL LANGUAGE RULES (Pure functions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rule: Check if text is natural language
 * PURE FUNCTION
 *
 * @param {string} text - Text to analyze
 * @returns {RuleResult}
 */
function isNaturalLanguage(text) {
    if (!text || typeof text !== 'string') {
        return createRuleResult(false, 100, 'No text to analyze');
    }

    if (text.length < 10) {
        return createRuleResult(false, 90, 'Text too short for natural language');
    }

    // Must have spaces (multiple words)
    if (!text.includes(' ')) {
        return createRuleResult(false, 95, 'No spaces - single word or code');
    }

    // Should start with capital letter or number
    if (!/^[A-Z0-9"']/.test(text.trim())) {
        return createRuleResult(false, 70, 'Does not start with capital letter');
    }

    // Check word structure
    const words = text.trim().split(/\s+/);
    if (words.length < 2) {
        return createRuleResult(false, 90, 'Less than 2 words');
    }

    // Average word length should be reasonable (3-12 chars)
    const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
    if (avgLen < 2 || avgLen > 15) {
        return createRuleResult(false, 75, `Unusual word length: ${avgLen.toFixed(1)}`);
    }

    // Check against code patterns
    const codeCheck = isCodeLike(text);
    if (codeCheck.passed) {
        return createRuleResult(false, codeCheck.confidence, `Appears to be code: ${codeCheck.reason}`);
    }

    return createRuleResult(true, 85, 'Appears to be natural language');
}

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION DETECTION RULES (Pure functions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Question indicator patterns
 */
const QUESTION_PATTERNS = [
    { name: 'ends_question', pattern: /\?\s*$/, confidence: 95 },
    { name: 'starts_what', pattern: /^what\s/i, confidence: 85 },
    { name: 'starts_which', pattern: /^which\s/i, confidence: 85 },
    { name: 'starts_who', pattern: /^who\s/i, confidence: 85 },
    { name: 'starts_how', pattern: /^how\s/i, confidence: 85 },
    { name: 'starts_why', pattern: /^why\s/i, confidence: 85 },
    { name: 'starts_when', pattern: /^when\s/i, confidence: 85 },
    { name: 'starts_where', pattern: /^where\s/i, confidence: 85 },
    { name: 'starts_is', pattern: /^is\s/i, confidence: 70 },
    { name: 'starts_are', pattern: /^are\s/i, confidence: 70 },
    { name: 'starts_does', pattern: /^does\s/i, confidence: 70 },
    { name: 'starts_do', pattern: /^do\s/i, confidence: 70 },
    { name: 'starts_can', pattern: /^can\s/i, confidence: 70 },
    { name: 'starts_select', pattern: /^select\s/i, confidence: 90 },
    { name: 'starts_choose', pattern: /^choose\s/i, confidence: 90 },
    { name: 'starts_identify', pattern: /^identify\s/i, confidence: 90 },
    { name: 'starts_true_false', pattern: /^true\s+or\s+false/i, confidence: 95 },
    { name: 'question_number', pattern: /^(?:question|q)\s*\d+[.:]/i, confidence: 95 }
];

/**
 * Rule: Check if text is likely a question
 * PURE FUNCTION
 *
 * @param {string} text - Text to analyze
 * @returns {RuleResult}
 */
function isQuestion(text) {
    if (!text || typeof text !== 'string') {
        return createRuleResult(false, 100, 'No text to analyze');
    }

    const normalized = text.trim();

    // First check if it's natural language
    const langCheck = isNaturalLanguage(normalized);
    if (!langCheck.passed) {
        return createRuleResult(false, langCheck.confidence, `Not natural language: ${langCheck.reason}`);
    }

    // Check question patterns
    const matchedPatterns = [];
    let maxConfidence = 0;

    for (const { name, pattern, confidence } of QUESTION_PATTERNS) {
        if (pattern.test(normalized)) {
            matchedPatterns.push(name);
            maxConfidence = Math.max(maxConfidence, confidence);
        }
    }

    if (matchedPatterns.length > 0) {
        return createRuleResult(
            true,
            maxConfidence,
            `Question patterns: ${matchedPatterns.join(', ')}`,
            { patterns: matchedPatterns }
        );
    }

    // Heuristic: Longer text with proper sentence structure might be a question
    if (normalized.length > 30 && /[.?!]\s*$/.test(normalized)) {
        return createRuleResult(true, 50, 'Longer text with sentence structure');
    }

    return createRuleResult(false, 60, 'No question patterns matched');
}

// ═══════════════════════════════════════════════════════════════════════════
// CORRECT ANSWER RULES (Pure functions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Correct answer indicator values
 */
const CORRECT_VALUES = ['true', 'correct', '1', 'yes', 'right'];

/**
 * Correct answer data attributes
 */
const CORRECT_ATTRS = ['correct', 'answer', 'right', 'iscorrect', 'is-correct'];

/**
 * Correct answer CSS classes
 */
const CORRECT_CLASSES = [
    'correct', 'right-answer', 'is-correct', 'correct-answer',
    'right', 'selected-correct', 'answer-correct'
];

/**
 * Rule: Check if answer data indicates correct answer
 * PURE FUNCTION - operates on normalized data, not DOM elements
 *
 * @param {Object} answerData - Normalized answer data
 * @param {string} [answerData.value] - Answer value attribute
 * @param {Object} [answerData.dataAttrs] - Data attributes (key-value)
 * @param {string[]} [answerData.classes] - CSS class names
 * @param {boolean} [answerData.isSelected] - Whether answer is selected
 * @returns {RuleResult}
 */
function isCorrectAnswer(answerData) {
    if (!answerData || typeof answerData !== 'object') {
        return createRuleResult(false, 100, 'No answer data');
    }

    const indicators = [];

    // Check value attribute
    if (answerData.value) {
        const normalizedValue = String(answerData.value).toLowerCase().trim();
        if (CORRECT_VALUES.includes(normalizedValue)) {
            indicators.push(`value="${normalizedValue}"`);
        }
    }

    // Check data attributes
    if (answerData.dataAttrs && typeof answerData.dataAttrs === 'object') {
        for (const [key, value] of Object.entries(answerData.dataAttrs)) {
            const normalizedKey = key.toLowerCase().replace(/-/g, '');
            const normalizedValue = String(value).toLowerCase().trim();

            if (CORRECT_ATTRS.includes(normalizedKey) &&
                (normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'yes')) {
                indicators.push(`data-${key}="${value}"`);
            }
        }
    }

    // Check CSS classes
    if (Array.isArray(answerData.classes)) {
        const normalizedClasses = answerData.classes.map(c => c.toLowerCase());
        for (const cls of normalizedClasses) {
            if (CORRECT_CLASSES.some(cc => cls.includes(cc))) {
                indicators.push(`class="${cls}"`);
            }
        }
    }

    if (indicators.length > 0) {
        return createRuleResult(
            true,
            Math.min(95, 70 + indicators.length * 10),
            `Correct indicators: ${indicators.join(', ')}`,
            { indicators }
        );
    }

    return createRuleResult(false, 70, 'No correct answer indicators found');
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT VALIDATION RULES (Pure functions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rule: Check if text is a placeholder
 * PURE FUNCTION
 *
 * @param {string} text - Text to check
 * @returns {RuleResult}
 */
function isPlaceholder(text) {
    if (!text || typeof text !== 'string') {
        return createRuleResult(true, 100, 'Empty text is placeholder');
    }

    const normalized = text.toLowerCase().trim();

    if (!normalized) {
        return createRuleResult(true, 100, 'Whitespace-only is placeholder');
    }

    const placeholderPatterns = [
        { pattern: /^choose\.{0,3}$/, name: 'choose...' },
        { pattern: /^select\.{0,3}$/, name: 'select...' },
        { pattern: /^select an? option$/i, name: 'select an option' },
        { pattern: /^select one$/i, name: 'select one' },
        { pattern: /^-{1,5}$/, name: 'dashes' },
        { pattern: /^-+\s*select\s*-+$/, name: '-- select --' },
        { pattern: /^\.{2,}$/, name: 'ellipsis' },
        { pattern: /^n\/a$/i, name: 'n/a' },
        { pattern: /^none$/i, name: 'none' }
    ];

    for (const { pattern, name } of placeholderPatterns) {
        if (pattern.test(normalized)) {
            return createRuleResult(true, 95, `Matches placeholder pattern: ${name}`);
        }
    }

    // Very short text might be placeholder
    if (normalized.length < 2) {
        return createRuleResult(true, 80, 'Text too short');
    }

    return createRuleResult(false, 85, 'Not a placeholder');
}

/**
 * Rule: Check if text has minimum content quality
 * PURE FUNCTION
 *
 * @param {string} text - Text to check
 * @param {Object} [options] - Options
 * @param {number} [options.minLength=5] - Minimum length
 * @param {number} [options.minWords=2] - Minimum words
 * @returns {RuleResult}
 */
function hasMinimumContent(text, options = {}) {
    const { minLength = 5, minWords = 2 } = options;

    if (!text || typeof text !== 'string') {
        return createRuleResult(false, 100, 'No text');
    }

    const trimmed = text.trim();

    if (trimmed.length < minLength) {
        return createRuleResult(false, 90, `Length ${trimmed.length} < ${minLength}`);
    }

    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    if (words.length < minWords) {
        return createRuleResult(false, 85, `Words ${words.length} < ${minWords}`);
    }

    // Check for placeholder
    const placeholderCheck = isPlaceholder(text);
    if (placeholderCheck.passed) {
        return createRuleResult(false, placeholderCheck.confidence, placeholderCheck.reason);
    }

    return createRuleResult(true, 90, 'Meets minimum content requirements');
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE COMPOSITION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Combine multiple rules with AND logic
 * @param {RuleResult[]} results - Rule results to combine
 * @returns {RuleResult}
 */
function combineRulesAnd(results) {
    if (!Array.isArray(results) || results.length === 0) {
        return createRuleResult(false, 0, 'No rules to combine');
    }

    const allPassed = results.every(r => r.passed);
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    const reasons = results.map(r => r.reason).join('; ');

    return createRuleResult(allPassed, avgConfidence, reasons);
}

/**
 * Combine multiple rules with OR logic
 * @param {RuleResult[]} results - Rule results to combine
 * @returns {RuleResult}
 */
function combineRulesOr(results) {
    if (!Array.isArray(results) || results.length === 0) {
        return createRuleResult(false, 0, 'No rules to combine');
    }

    const anyPassed = results.some(r => r.passed);
    const passedResults = results.filter(r => r.passed);
    const maxConfidence = passedResults.length > 0
        ? Math.max(...passedResults.map(r => r.confidence))
        : Math.max(...results.map(r => r.confidence));

    const reasons = anyPassed
        ? passedResults.map(r => r.reason).join('; ')
        : results.map(r => r.reason).join('; ');

    return createRuleResult(anyPassed, maxConfidence, reasons);
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // Result helpers
        createRuleResult,

        // Code detection
        isCodeLike,
        CODE_PATTERNS,

        // Natural language
        isNaturalLanguage,

        // Question detection
        isQuestion,
        QUESTION_PATTERNS,

        // Correct answer
        isCorrectAnswer,
        CORRECT_VALUES,
        CORRECT_ATTRS,
        CORRECT_CLASSES,

        // Content validation
        isPlaceholder,
        hasMinimumContent,

        // Composition
        combineRulesAnd,
        combineRulesOr
    };
}

if (typeof window !== 'undefined') {
    window.LMSQARules = {
        createRuleResult,
        isCodeLike,
        CODE_PATTERNS,
        isNaturalLanguage,
        isQuestion,
        QUESTION_PATTERNS,
        isCorrectAnswer,
        CORRECT_VALUES,
        CORRECT_ATTRS,
        CORRECT_CLASSES,
        isPlaceholder,
        hasMinimumContent,
        combineRulesAnd,
        combineRulesOr
    };
}
