/**
 * LMS QA Validator - Shared Constants v3.0
 * 
 * This file defines constants used across the extension.
 * It uses a pattern that works in both module and non-module contexts.
 */

const LMS_QA_CONSTANTS = {
    VERSION: '3.0.0',

    MESSAGE_TYPES: {
        // Outgoing (from validator)
        READY: 'READY',
        SCAN_STARTED: 'SCAN_STARTED',
        SCAN_COMPLETE: 'SCAN_COMPLETE',
        SCAN_ERROR: 'SCAN_ERROR',
        PROGRESS: 'PROGRESS',
        STATE: 'STATE',
        CMI_DATA: 'CMI_DATA',
        TEST_RESULT: 'TEST_RESULT',
        SET_COMPLETION_RESULT: 'SET_COMPLETION_RESULT',
        AUTO_SELECT_RESULT: 'AUTO_SELECT_RESULT',
        
        // Incoming (commands)
        CMD_SCAN: 'CMD_SCAN',
        CMD_TEST_API: 'CMD_TEST_API',
        CMD_SET_COMPLETION: 'CMD_SET_COMPLETION',
        CMD_GET_STATE: 'CMD_GET_STATE',
        CMD_GET_CMI_DATA: 'CMD_GET_CMI_DATA',
        CMD_AUTO_SELECT: 'CMD_AUTO_SELECT',
        CMD_EXPORT: 'CMD_EXPORT'
    },

    ITEM_TYPES: {
        QUESTION: 'question',
        ANSWER: 'answer',
        SEQUENCE_ITEM: 'sequence_item',
        DRAG_ITEM: 'drag_item',
        DROP_TARGET: 'drop_target'
    },

    CONFIDENCE: {
        VERY_HIGH: 95,
        HIGH: 90,
        MEDIUM: 70,
        LOW: 50,
        VERY_LOW: 30
    },

    STANDARDS: {
        SCORM_12: 'scorm12',
        SCORM_2004: 'scorm2004',
        XAPI: 'xapi',
        AICC: 'aicc',
        CMI5: 'cmi5'
    },

    EXPORT_FORMATS: {
        JSON: 'json',
        CSV: 'csv',
        TXT: 'txt'
    },

    LIMITS: {
        MAX_RECURSION_DEPTH: 20,
        MAX_API_SEARCH_DEPTH: 5,
        MAX_FETCH_TIMEOUT: 5000,
        MAX_RESOURCES: 100,
        MAX_LOGS: 500,
        MAX_SCAN_HISTORY: 50
    },

    CORRECT_INDICATORS: {
        VALUES: ['true', 'correct', '1'],
        DATA_ATTRS: ['correct', 'answer', 'right'],
        CLASSES: ['correct', 'right-answer', 'is-correct']
    }
};

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LMS_QA_CONSTANTS;
}

// Export individual items for ES module import
if (typeof window === 'undefined') {
    // Service worker context
    var MESSAGE_TYPES = LMS_QA_CONSTANTS.MESSAGE_TYPES;
    var EXPORT_FORMATS = LMS_QA_CONSTANTS.EXPORT_FORMATS;
    var LIMITS = LMS_QA_CONSTANTS.LIMITS;
}
