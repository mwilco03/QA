/**
 * LMS QA Validator - Base Extractor Interface
 *
 * Implements Directive #5: Split selector logic from validation logic
 * Treats element selection as an input generator, not a validator.
 * Selection is user-guided discovery; validation is algorithmic verification.
 *
 * Implements Directive #8: Isolate LMS-Specific Logic
 * LMS extractors extend this base class with a defined interface.
 *
 * @fileoverview Base extractor class for all extraction strategies
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR CAPABILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extractor capability flags
 * @enum {string}
 */
const ExtractorCapability = Object.freeze({
    QUESTIONS: 'questions',           // Can extract questions
    ANSWERS: 'answers',               // Can extract answers
    CORRECT_ANSWERS: 'correct_answers', // Can identify correct answers
    SCORM_API: 'scorm_api',           // Can interact with SCORM API
    XAPI: 'xapi',                     // Can interact with xAPI
    NETWORK: 'network',               // Uses network interception
    DOM: 'dom'                        // Uses DOM extraction
});

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION RESULT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result from extractor detection
 * @typedef {Object} DetectionResult
 * @property {boolean} detected - Whether this extractor applies
 * @property {number} confidence - Detection confidence (0-100)
 * @property {string} reason - Explanation
 * @property {Object} [data] - Detection-specific data
 */

/**
 * Create a detection result
 * @param {boolean} detected
 * @param {number} confidence
 * @param {string} reason
 * @param {Object} [data]
 * @returns {DetectionResult}
 */
function createDetectionResult(detected, confidence, reason, data = null) {
    return {
        detected,
        confidence: Math.max(0, Math.min(100, confidence)),
        reason,
        data
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// BASE EXTRACTOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base extractor class
 * All extractors must implement this interface.
 */
class BaseExtractor {
    /**
     * @param {Object} config - Extractor configuration
     */
    constructor(config = {}) {
        this.name = config.name || 'base';
        this.description = config.description || 'Base extractor';
        this.priority = config.priority ?? 100;
        this.capabilities = config.capabilities || [];

        // Validate that subclass implements required methods
        if (this.constructor === BaseExtractor) {
            throw new Error('BaseExtractor cannot be instantiated directly');
        }
    }

    /**
     * Detect if this extractor can handle the current page
     * MUST BE IMPLEMENTED by subclasses
     *
     * This method should be fast and not modify state.
     * It's called during the detection phase to determine
     * which extractors are applicable.
     *
     * @param {Object} session - Current session state
     * @param {Object} logger - Logger instance
     * @returns {Promise<DetectionResult>}
     */
    async detect(session, logger) {
        throw new Error('detect() must be implemented by subclass');
    }

    /**
     * Extract Q&A data from the page
     * MUST BE IMPLEMENTED by subclasses
     *
     * This method performs the actual extraction.
     * It should use normalized inputs from core/normalize.js
     * and pure rules from core/rules.js for validation.
     *
     * @param {Object} session - Current session state
     * @param {Object} logger - Logger instance
     * @returns {Promise<{questions: Array, answers: Array, apis: Array}>}
     */
    async extract(session, logger) {
        throw new Error('extract() must be implemented by subclass');
    }

    /**
     * Check if extractor has a specific capability
     * @param {ExtractorCapability} capability
     * @returns {boolean}
     */
    hasCapability(capability) {
        return this.capabilities.includes(capability);
    }

    /**
     * Get extractor info
     * @returns {Object}
     */
    getInfo() {
        return {
            name: this.name,
            description: this.description,
            priority: this.priority,
            capabilities: [...this.capabilities]
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM EXTRACTOR BASE CLASS
// For extractors that work with DOM elements
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base class for DOM-based extractors
 */
class DOMExtractor extends BaseExtractor {
    constructor(config = {}) {
        super({
            ...config,
            capabilities: [
                ExtractorCapability.DOM,
                ...(config.capabilities || [])
            ]
        });
    }

    /**
     * Get document reference
     * Can be overridden to work with shadow DOM or iframes
     *
     * @returns {Document}
     */
    getDocument() {
        return document;
    }

    /**
     * Safe query selector
     * @param {string} selector
     * @param {Element} [root]
     * @returns {Element|null}
     */
    querySelector(selector, root) {
        try {
            return (root || this.getDocument()).querySelector(selector);
        } catch (e) {
            return null;
        }
    }

    /**
     * Safe query selector all
     * @param {string} selector
     * @param {Element} [root]
     * @returns {Element[]}
     */
    querySelectorAll(selector, root) {
        try {
            return Array.from((root || this.getDocument()).querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }

    /**
     * Check if global variable exists
     * @param {string} name
     * @returns {boolean}
     */
    hasGlobal(name) {
        try {
            return typeof window[name] !== 'undefined';
        } catch (e) {
            return false;
        }
    }

    /**
     * Get global variable
     * @param {string} name
     * @returns {any}
     */
    getGlobal(name) {
        try {
            return window[name];
        } catch (e) {
            return undefined;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK EXTRACTOR BASE CLASS
// For extractors that use network interception
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base class for network-based extractors
 */
class NetworkExtractor extends BaseExtractor {
    constructor(config = {}) {
        super({
            ...config,
            capabilities: [
                ExtractorCapability.NETWORK,
                ...(config.capabilities || [])
            ]
        });
    }

    /**
     * Get data from network interceptor
     * @returns {Object|null}
     */
    getNetworkData() {
        if (typeof window !== 'undefined' && window.__LMS_QA_EXTRACTOR__) {
            return window.__LMS_QA_EXTRACTOR__.getExtractedData();
        }
        return null;
    }

    /**
     * Check if network interceptor is available
     * @returns {boolean}
     */
    hasNetworkInterceptor() {
        return typeof window !== 'undefined' && !!window.__LMS_QA_EXTRACTOR__;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR REGISTRY
// Manages available extractors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an extractor registry
 * @returns {Object}
 */
function createExtractorRegistry() {
    const extractors = new Map();

    return {
        /**
         * Register an extractor
         * @param {BaseExtractor} extractor
         */
        register(extractor) {
            if (!(extractor instanceof BaseExtractor)) {
                throw new Error('Extractor must extend BaseExtractor');
            }
            extractors.set(extractor.name, extractor);
        },

        /**
         * Get extractor by name
         * @param {string} name
         * @returns {BaseExtractor|null}
         */
        get(name) {
            return extractors.get(name) || null;
        },

        /**
         * Get all extractors sorted by priority
         * @returns {BaseExtractor[]}
         */
        getAll() {
            return Array.from(extractors.values())
                .sort((a, b) => a.priority - b.priority);
        },

        /**
         * Get extractors with specific capability
         * @param {ExtractorCapability} capability
         * @returns {BaseExtractor[]}
         */
        getByCapability(capability) {
            return this.getAll().filter(e => e.hasCapability(capability));
        },

        /**
         * Run detection on all extractors
         * @param {Object} session
         * @param {Object} logger
         * @returns {Promise<Array<{extractor: BaseExtractor, result: DetectionResult}>>}
         */
        async detectAll(session, logger) {
            const results = [];

            for (const extractor of this.getAll()) {
                try {
                    const result = await extractor.detect(session, logger);
                    results.push({ extractor, result });

                    if (result.detected) {
                        logger.detected(
                            extractor.name,
                            extractor.description,
                            result.confidence
                        );
                    }
                } catch (error) {
                    logger.error(`Detection error for ${extractor.name}: ${error.message}`);
                    results.push({
                        extractor,
                        result: createDetectionResult(false, 0, error.message)
                    });
                }
            }

            return results.sort((a, b) => b.result.confidence - a.result.confidence);
        },

        /**
         * Get names of registered extractors
         * @returns {string[]}
         */
        getNames() {
            return Array.from(extractors.keys());
        },

        /**
         * Clear all extractors
         */
        clear() {
            extractors.clear();
        }
    };
}

// Create default registry
const defaultRegistry = createExtractorRegistry();

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ExtractorCapability,
        createDetectionResult,
        BaseExtractor,
        DOMExtractor,
        NetworkExtractor,
        createExtractorRegistry,
        defaultRegistry
    };
}

if (typeof window !== 'undefined') {
    window.LMSQAExtractors = {
        ExtractorCapability,
        createDetectionResult,
        BaseExtractor,
        DOMExtractor,
        NetworkExtractor,
        createExtractorRegistry,
        defaultRegistry
    };
}
