/**
 * LMS QA Validator - Extraction Pipeline
 *
 * Implements Directive #6: Create a fallback chain, not conditional branches
 * Uses a linear pipeline: pattern -> heuristic -> user-selection
 * Makes it clear which path "won" and why.
 *
 * @fileoverview Extraction pipeline with fallback chain
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE STEP STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pipeline step result status
 * @enum {string}
 */
const StepStatus = Object.freeze({
    SUCCESS: 'success',      // Step completed with results
    PARTIAL: 'partial',      // Step completed with partial results
    SKIP: 'skip',            // Step was skipped (not applicable)
    FAIL: 'fail',            // Step failed (will trigger fallback)
    ERROR: 'error'           // Step errored (will trigger fallback)
});

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE STEP RESULT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result from a pipeline step
 * @typedef {Object} StepResult
 * @property {StepStatus} status - Step execution status
 * @property {any} data - Extracted data (if any)
 * @property {number} confidence - Confidence in results (0-100)
 * @property {string} reason - Explanation of result
 * @property {number} duration - Execution time in ms
 * @property {boolean} shouldContinue - Whether pipeline should continue
 */

/**
 * Create a step result
 * @param {StepStatus} status
 * @param {any} data
 * @param {number} confidence
 * @param {string} reason
 * @param {Object} [extra]
 * @returns {StepResult}
 */
function createStepResult(status, data, confidence, reason, extra = {}) {
    return {
        status,
        data: data || null,
        confidence: Math.max(0, Math.min(100, confidence)),
        reason,
        duration: extra.duration || 0,
        shouldContinue: status === StepStatus.FAIL ||
                        status === StepStatus.SKIP ||
                        status === StepStatus.PARTIAL
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default pipeline configuration
 */
const DEFAULT_CONFIG = {
    // Minimum confidence threshold to accept results
    minConfidence: 50,

    // Maximum time per step (ms)
    stepTimeout: 10000,

    // Whether to continue after first success
    stopOnFirstSuccess: true,

    // Whether to aggregate partial results
    aggregatePartials: true,

    // Minimum questions to consider extraction successful
    minQuestions: 1
};

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE STEP DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pipeline step definition
 * @typedef {Object} PipelineStep
 * @property {string} name - Step identifier
 * @property {string} description - Human-readable description
 * @property {Function} execute - Async function(session, logger) => StepResult
 * @property {Function} [canExecute] - Optional check if step applies
 * @property {number} [priority] - Execution priority (lower = earlier)
 */

/**
 * Create a pipeline step
 * @param {Object} config - Step configuration
 * @returns {PipelineStep}
 */
function createPipelineStep(config) {
    if (!config.name) throw new Error('Step must have a name');
    if (typeof config.execute !== 'function') throw new Error('Step must have execute function');

    return {
        name: config.name,
        description: config.description || config.name,
        execute: config.execute,
        canExecute: config.canExecute || (() => true),
        priority: config.priority ?? 100
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a single pipeline step with timeout and error handling
 *
 * @param {PipelineStep} step - Step to execute
 * @param {Object} session - Current session state
 * @param {Object} logger - Logger instance
 * @param {Object} config - Pipeline configuration
 * @returns {Promise<StepResult>}
 */
async function executeStep(step, session, logger, config) {
    const startTime = performance.now();

    // Check if step can execute
    try {
        const canExecute = await step.canExecute(session, logger);
        if (!canExecute) {
            logger.pipelineStep(step.name, false, 'Step not applicable');
            return createStepResult(
                StepStatus.SKIP,
                null,
                0,
                'Step not applicable to current context'
            );
        }
    } catch (e) {
        logger.error(`Step ${step.name} canExecute error: ${e.message}`);
        return createStepResult(
            StepStatus.SKIP,
            null,
            0,
            `canExecute error: ${e.message}`
        );
    }

    // Execute with timeout
    try {
        logger.info(`Executing step: ${step.name}`);
        logger.pipelineStep(step.name, true, 'Starting execution');

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Step timeout')), config.stepTimeout);
        });

        const result = await Promise.race([
            step.execute(session, logger),
            timeoutPromise
        ]);

        const duration = performance.now() - startTime;
        result.duration = duration;

        // Log decision
        logger.decision(
            'pipeline',
            step.name,
            result.status,
            result.reason,
            { confidence: result.confidence, duration }
        );

        return result;

    } catch (error) {
        const duration = performance.now() - startTime;

        logger.error(`Step ${step.name} error: ${error.message}`);
        logger.decision(
            'pipeline',
            step.name,
            'ERROR',
            error.message,
            { duration }
        );

        return createStepResult(
            StepStatus.ERROR,
            null,
            0,
            error.message,
            { duration }
        );
    }
}

/**
 * Create a pipeline executor
 *
 * @param {PipelineStep[]} steps - Ordered list of steps
 * @param {Object} [config] - Pipeline configuration
 * @returns {Object} Pipeline executor
 */
function createPipeline(steps, config = {}) {
    const pipelineConfig = { ...DEFAULT_CONFIG, ...config };

    // Sort steps by priority
    const sortedSteps = [...steps].sort((a, b) => a.priority - b.priority);

    return {
        /**
         * Execute the pipeline
         *
         * @param {Object} session - Session state
         * @param {Object} logger - Logger instance
         * @returns {Promise<{results: StepResult[], winner: string|null, aggregated: any}>}
         */
        async execute(session, logger) {
            const results = [];
            let winner = null;
            let aggregatedData = {
                questions: [],
                answers: [],
                apis: []
            };

            logger.info('Starting extraction pipeline');
            logger.decision('pipeline', 'START', 'INITIATED', `${sortedSteps.length} steps configured`);

            for (const step of sortedSteps) {
                const result = await executeStep(step, session, logger, pipelineConfig);
                results.push({
                    step: step.name,
                    ...result
                });

                // Aggregate partial results if configured
                if (pipelineConfig.aggregatePartials && result.data) {
                    if (Array.isArray(result.data.questions)) {
                        aggregatedData.questions.push(...result.data.questions);
                    }
                    if (Array.isArray(result.data.answers)) {
                        aggregatedData.answers.push(...result.data.answers);
                    }
                    if (Array.isArray(result.data.apis)) {
                        aggregatedData.apis.push(...result.data.apis);
                    }
                }

                // Check for success
                if (result.status === StepStatus.SUCCESS) {
                    if (result.confidence >= pipelineConfig.minConfidence) {
                        winner = step.name;

                        logger.decision(
                            'pipeline',
                            step.name,
                            'WINNER',
                            `Confidence ${result.confidence}% >= threshold ${pipelineConfig.minConfidence}%`
                        );

                        if (pipelineConfig.stopOnFirstSuccess) {
                            logger.info(`Pipeline complete - winner: ${step.name}`);
                            break;
                        }
                    } else {
                        logger.decision(
                            'fallback',
                            step.name,
                            'CONTINUE',
                            `Confidence ${result.confidence}% < threshold ${pipelineConfig.minConfidence}%`
                        );
                    }
                }

                // Log fallback activation
                if (result.status === StepStatus.FAIL || result.status === StepStatus.ERROR) {
                    const nextStep = sortedSteps[sortedSteps.indexOf(step) + 1];
                    if (nextStep) {
                        logger.fallbackActivated(step.name, nextStep.name, result.reason);
                    }
                }
            }

            // Determine final status
            const totalQuestions = aggregatedData.questions.length;
            const hasResults = totalQuestions >= pipelineConfig.minQuestions;

            logger.decision(
                'pipeline',
                'COMPLETE',
                hasResults ? 'HAS_RESULTS' : 'NO_RESULTS',
                `Found ${totalQuestions} questions, winner: ${winner || 'none'}`
            );

            return {
                results,
                winner,
                aggregated: aggregatedData,
                hasResults,
                totalQuestions
            };
        },

        /**
         * Get pipeline configuration
         */
        getConfig() {
            return { ...pipelineConfig };
        },

        /**
         * Get step names
         */
        getSteps() {
            return sortedSteps.map(s => ({
                name: s.name,
                description: s.description,
                priority: s.priority
            }));
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// STANDARD EXTRACTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard extraction pipeline order (Directive #6)
 * pattern -> heuristic -> user-selection
 */
const STANDARD_PIPELINE_ORDER = [
    { name: 'tool-detection', priority: 10, description: 'Detect authoring tool' },
    { name: 'api-detection', priority: 20, description: 'Detect SCORM/xAPI APIs' },
    { name: 'tool-specific', priority: 30, description: 'Tool-specific extraction (Storyline, Rise, etc.)' },
    { name: 'network', priority: 40, description: 'Network interception (tasks.json, xAPI)' },
    { name: 'dom-pattern', priority: 50, description: 'DOM pattern matching' },
    { name: 'heuristic', priority: 60, description: 'Heuristic extraction' },
    { name: 'user-selection', priority: 100, description: 'User-guided selection (fallback)' }
];

/**
 * Create the standard extraction pipeline
 * Individual extractors register their steps
 *
 * @param {Object} [config] - Configuration overrides
 * @returns {Object} Pipeline configurator
 */
function createStandardPipeline(config = {}) {
    const steps = [];

    return {
        /**
         * Register a step at standard position
         * @param {string} position - Position name from STANDARD_PIPELINE_ORDER
         * @param {Function} execute - Step execution function
         * @param {Function} [canExecute] - Optional applicability check
         */
        registerStep(position, execute, canExecute) {
            const orderEntry = STANDARD_PIPELINE_ORDER.find(o => o.name === position);
            if (!orderEntry) {
                throw new Error(`Unknown pipeline position: ${position}`);
            }

            steps.push(createPipelineStep({
                name: position,
                description: orderEntry.description,
                priority: orderEntry.priority,
                execute,
                canExecute
            }));

            return this;
        },

        /**
         * Register a custom step
         * @param {PipelineStep} step - Step definition
         */
        registerCustomStep(step) {
            steps.push(createPipelineStep(step));
            return this;
        },

        /**
         * Build the pipeline
         * @returns {Object} Executable pipeline
         */
        build() {
            return createPipeline(steps, config);
        },

        /**
         * Get registered steps
         */
        getRegisteredSteps() {
            return steps.map(s => s.name);
        }
    };
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        StepStatus,
        createStepResult,
        createPipelineStep,
        createPipeline,
        createStandardPipeline,
        STANDARD_PIPELINE_ORDER,
        DEFAULT_CONFIG
    };
}

if (typeof window !== 'undefined') {
    window.LMSQAPipeline = {
        StepStatus,
        createStepResult,
        createPipelineStep,
        createPipeline,
        createStandardPipeline,
        STANDARD_PIPELINE_ORDER,
        DEFAULT_CONFIG
    };
}
