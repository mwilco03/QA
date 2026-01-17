/**
 * LMS QA Validator - Type Definitions & Contracts
 *
 * Defines the hard contract for extracted data (Directive #3)
 * All extraction paths MUST produce results conforming to these shapes.
 *
 * @fileoverview Type definitions and result contracts
 */

'use strict';

/**
 * Extraction result status
 * @enum {string}
 */
const ExtractionStatus = Object.freeze({
    SUCCESS: 'success',
    PARTIAL: 'partial',      // Some data extracted, some failed
    NO_CONTENT: 'no_content', // Valid outcome - page has no Q&A (Directive #12)
    ERROR: 'error'
});

/**
 * Question types (aligned with SCORM/xAPI interaction types)
 * @enum {string}
 */
const QuestionType = Object.freeze({
    CHOICE: 'choice',                    // Single choice
    MULTIPLE_CHOICE: 'multiple-choice',  // Multiple correct answers
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

/**
 * Authoring tool identifiers
 * @enum {string}
 */
const AuthoringTool = Object.freeze({
    STORYLINE: 'storyline',
    RISE: 'rise',
    CAPTIVATE: 'captivate',
    LECTORA: 'lectora',
    ISPRING: 'ispring',
    CAMTASIA: 'camtasia',
    GENERIC: 'generic',
    UNKNOWN: 'unknown'
});

/**
 * LMS standard identifiers
 * @enum {string}
 */
const LMSStandard = Object.freeze({
    SCORM_12: 'scorm12',
    SCORM_2004: 'scorm2004',
    XAPI: 'xapi',
    CMI5: 'cmi5',
    AICC: 'aicc',
    CUSTOM: 'custom'
});

/**
 * Confidence levels for extracted data
 * @enum {number}
 */
const Confidence = Object.freeze({
    VERY_HIGH: 95,
    HIGH: 90,
    MEDIUM: 70,
    LOW: 50,
    VERY_LOW: 30
});

/**
 * Extraction source (for traceability)
 * @enum {string}
 */
const ExtractionSource = Object.freeze({
    DOM: 'dom',              // Direct DOM extraction
    PATTERN: 'pattern',      // Pattern/regex matching
    NETWORK: 'network',      // Network interception (xAPI, tasks.json)
    HEURISTIC: 'heuristic',  // Heuristic/fallback
    USER_SELECTION: 'user_selection'  // User-guided selector
});

// ═══════════════════════════════════════════════════════════════════════════
// RESULT CONTRACTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Question object contract
 * @typedef {Object} Question
 * @property {string} id - Unique identifier
 * @property {string} text - Question text
 * @property {QuestionType} type - Question type
 * @property {Answer[]} answers - Available answers
 * @property {string|null} correctAnswerId - ID of correct answer if known
 * @property {number} confidence - Confidence score (0-100)
 * @property {ExtractionSource} source - How this was extracted
 * @property {Object} metadata - Additional metadata
 */

/**
 * Answer object contract
 * @typedef {Object} Answer
 * @property {string} id - Unique identifier
 * @property {string} text - Answer text
 * @property {boolean} isCorrect - Whether this is the correct answer
 * @property {number} confidence - Confidence score (0-100)
 * @property {ExtractionSource} source - How this was extracted
 */

/**
 * API detection result contract
 * @typedef {Object} DetectedAPI
 * @property {LMSStandard} standard - LMS standard type
 * @property {string} location - Where API was found (window, parent, etc.)
 * @property {boolean} functional - Whether API is functional
 * @property {string[]} methods - Available methods
 * @property {Object} apiRef - Reference to actual API object
 */

/**
 * Extraction metadata contract
 * @typedef {Object} ExtractionMetadata
 * @property {string} url - Page URL
 * @property {AuthoringTool} tool - Detected authoring tool
 * @property {LMSStandard|null} lmsStandard - Detected LMS standard
 * @property {string} timestamp - ISO timestamp
 * @property {number} duration - Extraction duration in ms
 * @property {string} sessionId - Session identifier
 * @property {ExtractionDecision[]} decisions - Decision log (Directive #14)
 */

/**
 * Extraction decision log entry (Directive #14)
 * @typedef {Object} ExtractionDecision
 * @property {string} step - Pipeline step name
 * @property {string} decision - What was decided
 * @property {string} reason - Why this decision was made
 * @property {number} timestamp - When decision was made
 */

/**
 * HARD CONTRACT: ExtractionResult
 * This is the single result shape all extraction paths MUST produce (Directive #3)
 *
 * @typedef {Object} ExtractionResult
 * @property {ExtractionStatus} status - Overall status
 * @property {Question[]} questions - Extracted questions
 * @property {Answer[]} answers - All answers (denormalized for easy access)
 * @property {ExtractionMetadata} metadata - Extraction metadata
 * @property {DetectedAPI[]} apis - Detected LMS APIs
 * @property {Error|null} error - Error if status is ERROR
 */

/**
 * Create a valid ExtractionResult object
 * @param {Partial<ExtractionResult>} partial - Partial result data
 * @returns {ExtractionResult}
 */
function createExtractionResult(partial = {}) {
    return {
        status: partial.status || ExtractionStatus.NO_CONTENT,
        questions: Array.isArray(partial.questions) ? partial.questions : [],
        answers: Array.isArray(partial.answers) ? partial.answers : [],
        metadata: {
            url: partial.metadata?.url || '',
            tool: partial.metadata?.tool || AuthoringTool.UNKNOWN,
            lmsStandard: partial.metadata?.lmsStandard || null,
            timestamp: partial.metadata?.timestamp || new Date().toISOString(),
            duration: partial.metadata?.duration || 0,
            sessionId: partial.metadata?.sessionId || '',
            decisions: Array.isArray(partial.metadata?.decisions) ? partial.metadata.decisions : []
        },
        apis: Array.isArray(partial.apis) ? partial.apis : [],
        error: partial.error || null
    };
}

/**
 * Create a Question object
 * @param {Partial<Question>} partial - Partial question data
 * @returns {Question}
 */
function createQuestion(partial = {}) {
    const id = partial.id || generateId('q');
    return {
        id,
        text: partial.text || '',
        type: partial.type || QuestionType.OTHER,
        answers: Array.isArray(partial.answers) ? partial.answers : [],
        correctAnswerId: partial.correctAnswerId || null,
        confidence: typeof partial.confidence === 'number' ? partial.confidence : Confidence.MEDIUM,
        source: partial.source || ExtractionSource.DOM,
        metadata: partial.metadata || {}
    };
}

/**
 * Create an Answer object
 * @param {Partial<Answer>} partial - Partial answer data
 * @returns {Answer}
 */
function createAnswer(partial = {}) {
    return {
        id: partial.id || generateId('a'),
        text: partial.text || '',
        isCorrect: partial.isCorrect === true,
        confidence: typeof partial.confidence === 'number' ? partial.confidence : Confidence.MEDIUM,
        source: partial.source || ExtractionSource.DOM
    };
}

/**
 * Generate a unique identifier
 * @param {string} prefix - Prefix for the ID
 * @returns {string}
 */
function generateId(prefix = '') {
    const random = Math.random().toString(36).substring(2, 10);
    const timestamp = Date.now().toString(36);
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Validate an ExtractionResult against the contract
 * @param {any} result - Result to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateExtractionResult(result) {
    const errors = [];

    if (!result || typeof result !== 'object') {
        return { valid: false, errors: ['Result must be an object'] };
    }

    // Check status
    if (!Object.values(ExtractionStatus).includes(result.status)) {
        errors.push(`Invalid status: ${result.status}`);
    }

    // Check questions
    if (!Array.isArray(result.questions)) {
        errors.push('questions must be an array');
    } else {
        result.questions.forEach((q, i) => {
            if (!q.id) errors.push(`Question ${i} missing id`);
            if (typeof q.text !== 'string') errors.push(`Question ${i} missing text`);
            if (!Array.isArray(q.answers)) errors.push(`Question ${i} answers must be array`);
        });
    }

    // Check answers
    if (!Array.isArray(result.answers)) {
        errors.push('answers must be an array');
    }

    // Check metadata
    if (!result.metadata || typeof result.metadata !== 'object') {
        errors.push('metadata must be an object');
    } else {
        if (typeof result.metadata.timestamp !== 'string') {
            errors.push('metadata.timestamp must be a string');
        }
        if (!Array.isArray(result.metadata.decisions)) {
            errors.push('metadata.decisions must be an array');
        }
    }

    // Check apis
    if (!Array.isArray(result.apis)) {
        errors.push('apis must be an array');
    }

    return { valid: errors.length === 0, errors };
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ExtractionStatus,
        QuestionType,
        AuthoringTool,
        LMSStandard,
        Confidence,
        ExtractionSource,
        createExtractionResult,
        createQuestion,
        createAnswer,
        generateId,
        validateExtractionResult
    };
}

// Browser global export
if (typeof window !== 'undefined') {
    window.LMSQATypes = {
        ExtractionStatus,
        QuestionType,
        AuthoringTool,
        LMSStandard,
        Confidence,
        ExtractionSource,
        createExtractionResult,
        createQuestion,
        createAnswer,
        generateId,
        validateExtractionResult
    };
}
