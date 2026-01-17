/**
 * LMS QA Validator - Session State Management
 *
 * Implements Directive #4: Eliminate implicit global state
 * Replaces ad-hoc state spread across background/content/popup
 * with a session object passed explicitly.
 *
 * @fileoverview Explicit session state management
 */

'use strict';

/**
 * Session status
 * @enum {string}
 */
const SessionStatus = Object.freeze({
    IDLE: 'idle',
    EXTRACTING: 'extracting',
    COMPLETE: 'complete',
    ERROR: 'error'
});

/**
 * Generate a unique session ID
 * @returns {string}
 */
function generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `session_${timestamp}_${random}`;
}

/**
 * Create a new extraction session
 * All extraction operations should receive and return session state explicitly.
 *
 * @param {Object} options - Session initialization options
 * @returns {Object} Session object
 */
function createSession(options = {}) {
    const session = {
        // Identity
        id: options.id || generateSessionId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),

        // Context
        url: options.url || '',
        domain: options.domain || '',
        tabId: options.tabId || null,
        frameId: options.frameId || null,
        isTopFrame: options.isTopFrame ?? true,

        // Status
        status: SessionStatus.IDLE,
        progress: {
            step: 0,
            total: 0,
            message: ''
        },

        // Detection results (populated during extraction)
        detection: {
            tool: null,           // AuthoringTool enum
            lmsStandard: null,    // LMSStandard enum
            apis: [],             // DetectedAPI[]
            globals: []           // Detected global objects
        },

        // Extraction configuration
        config: {
            timeout: options.timeout ?? 30000,
            enableNetwork: options.enableNetwork ?? true,
            enableDOM: options.enableDOM ?? true,
            enableHeuristics: options.enableHeuristics ?? true,
            extractorPriority: options.extractorPriority || []  // Optional ordering
        },

        // Results (populated after extraction)
        result: null,  // ExtractionResult

        // Decision log (Directive #14)
        decisions: [],

        // Error tracking
        errors: [],
        warnings: []
    };

    // Freeze identity to prevent accidental modification
    Object.freeze(session.id);

    return session;
}

/**
 * Update session state immutably
 * Returns a new session object with updates applied.
 *
 * @param {Object} session - Current session
 * @param {Object} updates - Updates to apply
 * @returns {Object} New session with updates
 */
function updateSession(session, updates) {
    if (!session) {
        throw new Error('Session is required');
    }

    return {
        ...session,
        ...updates,
        updatedAt: Date.now(),
        // Deep merge nested objects
        detection: updates.detection
            ? { ...session.detection, ...updates.detection }
            : session.detection,
        config: updates.config
            ? { ...session.config, ...updates.config }
            : session.config,
        progress: updates.progress
            ? { ...session.progress, ...updates.progress }
            : session.progress
    };
}

/**
 * Set session status with optional progress
 * @param {Object} session - Current session
 * @param {SessionStatus} status - New status
 * @param {Object} [progress] - Optional progress update
 * @returns {Object} Updated session
 */
function setSessionStatus(session, status, progress) {
    return updateSession(session, {
        status,
        progress: progress || session.progress
    });
}

/**
 * Add a decision to session
 * @param {Object} session - Current session
 * @param {Object} decision - Decision to add
 * @returns {Object} Updated session
 */
function addSessionDecision(session, decision) {
    return updateSession(session, {
        decisions: [...session.decisions, {
            ...decision,
            timestamp: Date.now()
        }]
    });
}

/**
 * Add an error to session
 * @param {Object} session - Current session
 * @param {Error|string} error - Error to add
 * @returns {Object} Updated session
 */
function addSessionError(session, error) {
    const errorObj = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    return updateSession(session, {
        errors: [...session.errors, {
            ...errorObj,
            timestamp: Date.now()
        }]
    });
}

/**
 * Add a warning to session
 * @param {Object} session - Current session
 * @param {string} warning - Warning message
 * @returns {Object} Updated session
 */
function addSessionWarning(session, warning) {
    return updateSession(session, {
        warnings: [...session.warnings, {
            message: warning,
            timestamp: Date.now()
        }]
    });
}

/**
 * Set session result
 * @param {Object} session - Current session
 * @param {Object} result - ExtractionResult
 * @returns {Object} Updated session
 */
function setSessionResult(session, result) {
    return updateSession(session, {
        result,
        status: result.error ? SessionStatus.ERROR : SessionStatus.COMPLETE
    });
}

/**
 * Validate session object
 * @param {any} session - Object to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateSession(session) {
    const errors = [];

    if (!session || typeof session !== 'object') {
        return { valid: false, errors: ['Session must be an object'] };
    }

    if (typeof session.id !== 'string' || !session.id) {
        errors.push('Session must have a valid id');
    }

    if (typeof session.createdAt !== 'number') {
        errors.push('Session must have a createdAt timestamp');
    }

    if (!Object.values(SessionStatus).includes(session.status)) {
        errors.push(`Invalid session status: ${session.status}`);
    }

    if (!session.detection || typeof session.detection !== 'object') {
        errors.push('Session must have a detection object');
    }

    if (!session.config || typeof session.config !== 'object') {
        errors.push('Session must have a config object');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Serialize session for messaging/storage
 * Strips non-serializable data (functions, DOM refs, etc.)
 *
 * @param {Object} session - Session to serialize
 * @returns {Object} Serializable session
 */
function serializeSession(session) {
    const serialized = JSON.parse(JSON.stringify(session));

    // Remove API references (non-serializable)
    if (serialized.detection?.apis) {
        serialized.detection.apis = serialized.detection.apis.map(api => ({
            ...api,
            apiRef: null  // Remove actual API reference
        }));
    }

    return serialized;
}

/**
 * Create a session from URL
 * Helper to initialize session from a page URL
 *
 * @param {string} url - Page URL
 * @param {Object} [options] - Additional options
 * @returns {Object} Session
 */
function createSessionFromUrl(url, options = {}) {
    let domain = '';
    try {
        domain = new URL(url).hostname;
    } catch (e) {
        // Invalid URL
    }

    return createSession({
        url,
        domain,
        ...options
    });
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SessionStatus,
        generateSessionId,
        createSession,
        updateSession,
        setSessionStatus,
        addSessionDecision,
        addSessionError,
        addSessionWarning,
        setSessionResult,
        validateSession,
        serializeSession,
        createSessionFromUrl
    };
}

if (typeof window !== 'undefined') {
    window.LMSQASession = {
        SessionStatus,
        generateSessionId,
        createSession,
        updateSession,
        setSessionStatus,
        addSessionDecision,
        addSessionError,
        addSessionWarning,
        setSessionResult,
        validateSession,
        serializeSession,
        createSessionFromUrl
    };
}
