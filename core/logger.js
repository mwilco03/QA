/**
 * LMS QA Validator - Decision Logger
 *
 * Implements Directive #14: Log extraction decisions, not just results
 * Captures WHY a path was chosen (pattern hit, selector used, fallback)
 * for debugging and confidence in changes.
 *
 * @fileoverview Extraction decision logging
 */

'use strict';

/**
 * Log levels
 * @enum {number}
 */
const LogLevel = Object.freeze({
    DEBUG: 0,
    INFO: 1,
    DECISION: 2,  // Special level for extraction decisions
    WARN: 3,
    ERROR: 4
});

/**
 * Decision categories
 * @enum {string}
 */
const DecisionCategory = Object.freeze({
    PIPELINE: 'pipeline',       // Pipeline step decisions
    EXTRACTOR: 'extractor',     // Extractor selection
    DETECTION: 'detection',     // Tool/API detection
    VALIDATION: 'validation',   // Content validation
    FALLBACK: 'fallback',       // Fallback chain decisions
    NORMALIZATION: 'normalization'  // Input normalization
});

/**
 * Create a Decision Logger instance
 * @param {Object} options - Logger options
 * @returns {Object} Logger instance
 */
function createLogger(options = {}) {
    const config = {
        level: options.level ?? LogLevel.INFO,
        maxEntries: options.maxEntries ?? 500,
        maxDecisions: options.maxDecisions ?? 100,
        consoleOutput: options.consoleOutput ?? true,
        prefix: options.prefix ?? '[LMS-QA]'
    };

    // Internal state
    const logs = [];
    const decisions = [];
    const listeners = new Map();

    /**
     * Format a log entry
     */
    function formatEntry(level, message, data) {
        return {
            level,
            levelName: Object.keys(LogLevel).find(k => LogLevel[k] === level) || 'UNKNOWN',
            message,
            data: data ? JSON.parse(JSON.stringify(data)) : undefined,
            timestamp: Date.now(),
            isoTimestamp: new Date().toISOString()
        };
    }

    /**
     * Format a decision entry (Directive #14)
     */
    function formatDecision(category, step, decision, reason, data) {
        return {
            category,
            step,
            decision,
            reason,
            data: data ? JSON.parse(JSON.stringify(data)) : undefined,
            timestamp: Date.now(),
            isoTimestamp: new Date().toISOString()
        };
    }

    /**
     * Emit to listeners
     */
    function emit(event, payload) {
        const handlers = listeners.get(event) || [];
        handlers.forEach(fn => {
            try {
                fn(payload);
            } catch (e) {
                console.error(`${config.prefix} Logger listener error:`, e);
            }
        });
    }

    /**
     * Write to console with styling
     */
    function consoleWrite(level, message, data) {
        if (!config.consoleOutput) return;

        const styles = {
            [LogLevel.DEBUG]: 'color: #8b5cf6',
            [LogLevel.INFO]: 'color: #3b82f6',
            [LogLevel.DECISION]: 'color: #10b981; font-weight: bold',
            [LogLevel.WARN]: 'color: #f59e0b',
            [LogLevel.ERROR]: 'color: #ef4444'
        };

        const levelNames = {
            [LogLevel.DEBUG]: 'DEBUG',
            [LogLevel.INFO]: 'INFO',
            [LogLevel.DECISION]: 'DECISION',
            [LogLevel.WARN]: 'WARN',
            [LogLevel.ERROR]: 'ERROR'
        };

        const style = styles[level] || 'color: inherit';
        const levelName = levelNames[level] || 'LOG';
        const prefix = `%c${config.prefix}%c [${levelName}]`;

        if (data !== undefined) {
            console.log(prefix + ` ${message}`, style, 'color: inherit', data);
        } else {
            console.log(prefix + ` ${message}`, style, 'color: inherit');
        }
    }

    /**
     * Core log function
     */
    function log(level, message, data) {
        if (level < config.level) return null;

        const entry = formatEntry(level, message, data);
        logs.push(entry);

        // Trim logs if needed
        if (logs.length > config.maxEntries) {
            logs.splice(0, logs.length - config.maxEntries);
        }

        consoleWrite(level, message, data);
        emit('log', entry);

        return entry;
    }

    // Public API
    return {
        // Standard logging methods
        debug(message, data) {
            return log(LogLevel.DEBUG, message, data);
        },

        info(message, data) {
            return log(LogLevel.INFO, message, data);
        },

        warn(message, data) {
            return log(LogLevel.WARN, message, data);
        },

        error(message, data) {
            return log(LogLevel.ERROR, message, data);
        },

        /**
         * Log an extraction decision (Directive #14)
         * This is the key method for understanding WHY extraction paths were chosen
         *
         * @param {DecisionCategory} category - Decision category
         * @param {string} step - Pipeline step name
         * @param {string} decision - What was decided
         * @param {string} reason - Why this decision was made
         * @param {Object} [data] - Additional context data
         */
        decision(category, step, decision, reason, data) {
            const entry = formatDecision(category, step, decision, reason, data);
            decisions.push(entry);

            // Trim decisions if needed
            if (decisions.length > config.maxDecisions) {
                decisions.splice(0, decisions.length - config.maxDecisions);
            }

            // Also log to console at DECISION level
            const message = `[${category}] ${step}: ${decision} - ${reason}`;
            log(LogLevel.DECISION, message, data);

            emit('decision', entry);
            return entry;
        },

        /**
         * Log pipeline step execution
         */
        pipelineStep(stepName, result, reason) {
            return this.decision(
                DecisionCategory.PIPELINE,
                stepName,
                result ? 'EXECUTED' : 'SKIPPED',
                reason
            );
        },

        /**
         * Log extractor selection
         */
        extractorSelected(extractorName, reason, confidence) {
            return this.decision(
                DecisionCategory.EXTRACTOR,
                extractorName,
                'SELECTED',
                reason,
                { confidence }
            );
        },

        /**
         * Log fallback activation
         */
        fallbackActivated(fromStep, toStep, reason) {
            return this.decision(
                DecisionCategory.FALLBACK,
                `${fromStep} -> ${toStep}`,
                'FALLBACK',
                reason
            );
        },

        /**
         * Log detection result
         */
        detected(what, where, confidence) {
            return this.decision(
                DecisionCategory.DETECTION,
                what,
                'DETECTED',
                `Found at ${where}`,
                { confidence }
            );
        },

        /**
         * Log validation result
         */
        validated(what, passed, reason) {
            return this.decision(
                DecisionCategory.VALIDATION,
                what,
                passed ? 'PASSED' : 'FAILED',
                reason
            );
        },

        // Timing helper
        time(label) {
            const start = performance.now();
            return () => {
                const duration = performance.now() - start;
                this.debug(`${label}: ${duration.toFixed(2)}ms`);
                return duration;
            };
        },

        // Get all logs
        getLogs() {
            return [...logs];
        },

        // Get all decisions (Directive #14)
        getDecisions() {
            return [...decisions];
        },

        // Get decisions for specific category
        getDecisionsByCategory(category) {
            return decisions.filter(d => d.category === category);
        },

        // Clear logs
        clear() {
            logs.length = 0;
            decisions.length = 0;
        },

        // Set log level
        setLevel(level) {
            config.level = typeof level === 'number' ? level : LogLevel[level] ?? LogLevel.INFO;
        },

        // Subscribe to events
        on(event, handler) {
            if (!listeners.has(event)) {
                listeners.set(event, []);
            }
            listeners.get(event).push(handler);
            return () => this.off(event, handler);
        },

        off(event, handler) {
            const handlers = listeners.get(event);
            if (handlers) {
                const idx = handlers.indexOf(handler);
                if (idx > -1) handlers.splice(idx, 1);
            }
        },

        // Export decisions for ExtractionResult metadata
        exportDecisions() {
            return decisions.map(d => ({
                step: `${d.category}:${d.step}`,
                decision: d.decision,
                reason: d.reason,
                timestamp: d.timestamp
            }));
        },

        // Constants
        LogLevel,
        DecisionCategory
    };
}

// Create default logger instance
const defaultLogger = createLogger();

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createLogger, defaultLogger, LogLevel, DecisionCategory };
}

if (typeof window !== 'undefined') {
    window.LMSQALogger = { createLogger, defaultLogger, LogLevel, DecisionCategory };
}
