/**
 * LMS QA Validator - Core Module Index
 *
 * Central export point for all core modules.
 * This file is loaded into the page context to make the
 * refactored architecture available.
 *
 * @fileoverview Core module exports
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// MODULE LOADING (Browser Context)
// ═══════════════════════════════════════════════════════════════════════════

// In browser context, individual modules attach to window.*
// This file verifies they're loaded and provides a unified API

(function() {
    'use strict';

    // Check for required modules
    const requiredModules = [
        'LMSQATypes',
        'LMSQALogger',
        'LMSQASession',
        'LMSQANormalize',
        'LMSQARules',
        'LMSQAPipeline',
        'LMSQAMessages',
        'LMSQAStorage',
        'LMSQAExtractors',
        'LMSQAOrchestrator'
    ];

    const missingModules = requiredModules.filter(m => !window[m]);

    if (missingModules.length > 0) {
        console.warn('[LMS-QA Core] Missing modules:', missingModules.join(', '));
        console.warn('[LMS-QA Core] Make sure all core/*.js files are loaded in order');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UNIFIED API
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * LMS QA Core API
     * Unified interface to all core functionality
     */
    const LMSQA = {
        // Version
        VERSION: '8.0.0',

        // ─────────────────────────────────────────────────────────────────────
        // MAIN EXTRACTION API
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Extract Q&A from current page
         * This is the main entry point for extraction.
         *
         * @param {Object} [options] - Extraction options
         * @returns {Promise<Object>} ExtractionResult
         */
        async extract(options) {
            if (!window.LMSQAOrchestrator) {
                throw new Error('Orchestrator module not loaded');
            }
            return window.LMSQAOrchestrator.extract(options);
        },

        /**
         * Get the orchestrator instance
         * @param {Object} [config] - Optional configuration
         * @returns {Object} Orchestrator
         */
        getOrchestrator(config) {
            return window.LMSQAOrchestrator.getOrchestrator(config);
        },

        // ─────────────────────────────────────────────────────────────────────
        // TYPE SYSTEM
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Type definitions and factories
         */
        Types: window.LMSQATypes || {},

        /**
         * Create an ExtractionResult
         */
        createResult: (data) => window.LMSQATypes?.createExtractionResult(data),

        /**
         * Create a Question
         */
        createQuestion: (data) => window.LMSQATypes?.createQuestion(data),

        /**
         * Create an Answer
         */
        createAnswer: (data) => window.LMSQATypes?.createAnswer(data),

        // ─────────────────────────────────────────────────────────────────────
        // SESSION MANAGEMENT
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Session management
         */
        Session: window.LMSQASession || {},

        /**
         * Create a new session
         */
        createSession: (options) => window.LMSQASession?.createSession(options),

        // ─────────────────────────────────────────────────────────────────────
        // LOGGING
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Logger factory
         */
        Logger: window.LMSQALogger || {},

        /**
         * Create a logger instance
         */
        createLogger: (options) => window.LMSQALogger?.createLogger(options),

        /**
         * Get default logger
         */
        get defaultLogger() {
            return window.LMSQALogger?.defaultLogger;
        },

        // ─────────────────────────────────────────────────────────────────────
        // NORMALIZATION
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Normalization utilities
         */
        Normalize: window.LMSQANormalize || {},

        // ─────────────────────────────────────────────────────────────────────
        // RULES
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Pure validation rules
         */
        Rules: window.LMSQARules || {},

        // ─────────────────────────────────────────────────────────────────────
        // PIPELINE
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Pipeline utilities
         */
        Pipeline: window.LMSQAPipeline || {},

        // ─────────────────────────────────────────────────────────────────────
        // MESSAGING
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Intent-based messaging
         */
        Messages: window.LMSQAMessages || {},

        /**
         * Message intents
         */
        Intent: window.LMSQAMessages?.Intent || {},

        // ─────────────────────────────────────────────────────────────────────
        // STORAGE
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Storage utilities
         */
        Storage: window.LMSQAStorage || {},

        // ─────────────────────────────────────────────────────────────────────
        // EXTRACTORS
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Extractor base classes and registry
         */
        Extractors: window.LMSQAExtractors || {},

        /**
         * Get extractor registry
         */
        get registry() {
            return window.LMSQAExtractors?.defaultRegistry;
        },

        /**
         * Register an extractor
         */
        registerExtractor(extractor) {
            if (window.LMSQAExtractors?.defaultRegistry) {
                window.LMSQAExtractors.defaultRegistry.register(extractor);
            }
        },

        // ─────────────────────────────────────────────────────────────────────
        // UTILITIES
        // ─────────────────────────────────────────────────────────────────────

        /**
         * Check if all modules are loaded
         */
        isReady() {
            return requiredModules.every(m => !!window[m]);
        },

        /**
         * Get list of loaded modules
         */
        getLoadedModules() {
            return requiredModules.filter(m => !!window[m]);
        },

        /**
         * Get list of missing modules
         */
        getMissingModules() {
            return requiredModules.filter(m => !window[m]);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // EXTRACTOR REGISTRATION
    // ═══════════════════════════════════════════════════════════════════════

    // Register LMS-specific extractors if available
    function registerExtractors() {
        const registry = window.LMSQAExtractors?.defaultRegistry;
        if (!registry) return;

        // Register Storyline extractor
        if (window.LMSQAStoryline?.StorylineExtractor) {
            try {
                registry.register(new window.LMSQAStoryline.StorylineExtractor());
                console.log('[LMS-QA Core] Registered Storyline extractor');
            } catch (e) {
                console.warn('[LMS-QA Core] Failed to register Storyline extractor:', e);
            }
        }

        // Register Generic extractor
        if (window.LMSQAGeneric?.GenericExtractor) {
            try {
                registry.register(new window.LMSQAGeneric.GenericExtractor());
                console.log('[LMS-QA Core] Registered Generic extractor');
            } catch (e) {
                console.warn('[LMS-QA Core] Failed to register Generic extractor:', e);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════

    // Expose unified API
    window.LMSQA = LMSQA;

    // Also expose as LMS_QA for backwards compatibility
    window.LMS_QA = LMSQA;

    // Register extractors after a brief delay to ensure all scripts are loaded
    setTimeout(registerExtractors, 100);

    // Log initialization
    console.log('%c[LMS-QA Core] v8.0.0 - Refactored Architecture',
        'color: #3b82f6; font-weight: bold; font-size: 14px');
    console.log('[LMS-QA Core] Loaded modules:', LMSQA.getLoadedModules().length);

    if (LMSQA.isReady()) {
        console.log('%c[LMS-QA Core] All modules loaded successfully',
            'color: #22c55e; font-weight: bold');
    } else {
        console.warn('[LMS-QA Core] Missing modules:', LMSQA.getMissingModules());
    }

    console.log('[LMS-QA Core] API available at: window.LMSQA');
    console.log('[LMS-QA Core] Quick extract: LMSQA.extract()');

})();
