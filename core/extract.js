/**
 * LMS QA Validator - Core Orchestrator
 *
 * Implements Directive #1: Single Core Orchestrator
 * Creates one entry module that coordinates all extraction paths.
 * One call = one deterministic extraction result.
 *
 * Implements Directive #2: Separate "How Data Is Found" from "When It Is Used"
 * This module is the "when" - triggered by UI or API.
 * Extractors are the "how" - they find the data.
 *
 * @fileoverview Main extraction orchestrator
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// DEPENDENCIES
// ═══════════════════════════════════════════════════════════════════════════

// In browser context, dependencies are on window
// In Node context, use require
const Types = typeof window !== 'undefined' ? window.LMSQATypes : require('./types.js');
const Logger = typeof window !== 'undefined' ? window.LMSQALogger : require('./logger.js');
const Session = typeof window !== 'undefined' ? window.LMSQASession : require('./session.js');
const Pipeline = typeof window !== 'undefined' ? window.LMSQAPipeline : require('./pipeline.js');
const Messages = typeof window !== 'undefined' ? window.LMSQAMessages : require('./messages.js');
const Extractors = typeof window !== 'undefined' ? window.LMSQAExtractors : require('../extractors/base.js');

const {
    ExtractionStatus,
    AuthoringTool,
    createExtractionResult,
    validateExtractionResult
} = Types;

const { createLogger } = Logger;
const { createSession, setSessionResult, SessionStatus } = Session;
const { StepStatus, createStepResult, createStandardPipeline } = Pipeline;
const { Intent, createMessage, provideResults, errorOccurred } = Messages;
const { defaultRegistry, createDetectionResult } = Extractors;

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default orchestrator configuration
 */
const DEFAULT_CONFIG = {
    // Pipeline configuration
    timeout: 30000,               // Overall timeout
    minConfidence: 50,            // Minimum confidence threshold
    minQuestions: 1,              // Minimum questions for success

    // Feature flags
    enableToolDetection: true,    // Detect authoring tools
    enableAPIDetection: true,     // Detect SCORM/xAPI APIs
    enableNetworkData: true,      // Use network interceptor data
    enableDOMExtraction: true,    // Use DOM extraction
    enableHeuristics: true,       // Use heuristic extraction

    // Logging
    logLevel: 'INFO'
};

// ═══════════════════════════════════════════════════════════════════════════
// CORE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create the core extraction orchestrator
 *
 * This is THE entry point for all extraction operations.
 * All extraction paths go through this orchestrator.
 *
 * @param {Object} [config] - Configuration options
 * @returns {Object} Orchestrator instance
 */
function createOrchestrator(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const logger = createLogger({ level: cfg.logLevel });
    const registry = config.registry || defaultRegistry;

    /**
     * Main extraction entry point
     *
     * @param {Object} [options] - Extraction options
     * @param {string} [options.url] - Page URL (auto-detected if not provided)
     * @param {number} [options.tabId] - Tab ID for extension context
     * @param {string} [options.sessionId] - Existing session ID to resume
     * @returns {Promise<Object>} ExtractionResult conforming to contract
     */
    async function extract(options = {}) {
        const startTime = performance.now();

        // Create or resume session (Directive #4: Explicit session)
        const session = createSession({
            url: options.url || (typeof window !== 'undefined' ? window.location.href : ''),
            tabId: options.tabId,
            ...options
        });

        logger.info(`Starting extraction for session ${session.id}`);
        logger.decision('pipeline', 'extract', 'STARTED', `Session: ${session.id}`);

        try {
            // Build and execute pipeline (Directive #6: Fallback chain)
            const pipeline = buildPipeline(session, cfg);
            const pipelineResult = await pipeline.execute(session, logger);

            // Build result conforming to contract (Directive #3)
            const result = buildExtractionResult(session, pipelineResult, startTime);

            // Validate result against contract
            const validation = validateExtractionResult(result);
            if (!validation.valid) {
                logger.error('Result validation failed', validation.errors);
            }

            // Log final decision
            logger.decision(
                'pipeline',
                'extract',
                result.status,
                `Questions: ${result.questions.length}, Winner: ${pipelineResult.winner || 'none'}`,
                { duration: result.metadata.duration }
            );

            return result;

        } catch (error) {
            logger.error(`Extraction failed: ${error.message}`);

            // Return error result conforming to contract
            return createExtractionResult({
                status: ExtractionStatus.ERROR,
                error: error,
                metadata: {
                    url: session.url,
                    timestamp: new Date().toISOString(),
                    duration: performance.now() - startTime,
                    sessionId: session.id,
                    decisions: logger.exportDecisions()
                }
            });
        }
    }

    /**
     * Build the extraction pipeline with registered steps
     */
    function buildPipeline(session, config) {
        const pipelineBuilder = createStandardPipeline({
            minConfidence: config.minConfidence,
            minQuestions: config.minQuestions,
            stepTimeout: config.timeout / 5  // Per-step timeout
        });

        // Step 1: Tool Detection
        if (config.enableToolDetection) {
            pipelineBuilder.registerStep('tool-detection', async (sess, log) => {
                log.info('Detecting authoring tool...');

                const detectionResults = await registry.detectAll(sess, log);
                const detected = detectionResults.filter(r => r.result.detected);

                if (detected.length === 0) {
                    return createStepResult(
                        StepStatus.SKIP,
                        null,
                        0,
                        'No specific authoring tool detected'
                    );
                }

                const topMatch = detected[0];
                return createStepResult(
                    StepStatus.SUCCESS,
                    {
                        tool: topMatch.extractor.name,
                        confidence: topMatch.result.confidence,
                        allDetected: detected.map(d => ({
                            name: d.extractor.name,
                            confidence: d.result.confidence
                        }))
                    },
                    topMatch.result.confidence,
                    `Detected: ${topMatch.extractor.name} (${topMatch.result.confidence}%)`
                );
            });
        }

        // Step 2: API Detection
        if (config.enableAPIDetection) {
            pipelineBuilder.registerStep('api-detection', async (sess, log) => {
                log.info('Detecting SCORM/xAPI APIs...');
                const apis = detectAPIs(log);

                if (apis.length === 0) {
                    return createStepResult(
                        StepStatus.PARTIAL,
                        { apis: [] },
                        50,
                        'No SCORM/xAPI APIs found'
                    );
                }

                return createStepResult(
                    StepStatus.SUCCESS,
                    { apis },
                    80,
                    `Found ${apis.length} API(s)`
                );
            });
        }

        // Step 3: Tool-Specific Extraction
        pipelineBuilder.registerStep('tool-specific', async (sess, log) => {
            log.info('Running tool-specific extraction...');

            // Get detected extractors
            const detectionResults = await registry.detectAll(sess, log);
            const applicable = detectionResults
                .filter(r => r.result.detected && r.result.confidence >= 50)
                .slice(0, 3);  // Top 3 matches

            if (applicable.length === 0) {
                return createStepResult(StepStatus.SKIP, null, 0, 'No applicable extractors');
            }

            // Run each extractor
            const allQuestions = [];
            const allAnswers = [];

            for (const { extractor, result } of applicable) {
                try {
                    log.info(`Running ${extractor.name} extractor...`);
                    const extractResult = await extractor.extract(sess, log);

                    if (extractResult.questions.length > 0) {
                        allQuestions.push(...extractResult.questions);
                        allAnswers.push(...extractResult.answers);

                        log.extractorSelected(
                            extractor.name,
                            `Found ${extractResult.questions.length} questions`,
                            result.confidence
                        );
                    }
                } catch (e) {
                    log.error(`Extractor ${extractor.name} failed: ${e.message}`);
                }
            }

            if (allQuestions.length === 0) {
                return createStepResult(
                    StepStatus.FAIL,
                    null,
                    0,
                    'Tool-specific extractors found no content'
                );
            }

            return createStepResult(
                StepStatus.SUCCESS,
                { questions: allQuestions, answers: allAnswers },
                applicable[0].result.confidence,
                `Extracted ${allQuestions.length} questions`
            );
        });

        // Step 4: Network Data
        if (config.enableNetworkData) {
            pipelineBuilder.registerStep('network', async (sess, log) => {
                log.info('Checking network interceptor data...');

                if (typeof window === 'undefined' || !window.__LMS_QA_EXTRACTOR__) {
                    return createStepResult(StepStatus.SKIP, null, 0, 'Network interceptor not available');
                }

                const networkData = window.__LMS_QA_EXTRACTOR__.getExtractedData();

                if (!networkData || networkData.stats.questionCount === 0) {
                    return createStepResult(
                        StepStatus.PARTIAL,
                        { networkData },
                        30,
                        'No questions from network data'
                    );
                }

                // Convert network questions to standard format
                const questions = networkData.questions.map(nq => Types.createQuestion({
                    id: nq.id,
                    text: nq.prompt || nq.text,
                    type: Types.QuestionType.CHOICE,
                    source: Types.ExtractionSource.NETWORK,
                    confidence: Types.Confidence.HIGH,
                    metadata: { taskId: nq.taskId, groupId: nq.groupId }
                }));

                return createStepResult(
                    StepStatus.SUCCESS,
                    { questions, networkData },
                    85,
                    `${questions.length} questions from network data`
                );
            });
        }

        // Step 5: DOM Pattern Matching
        if (config.enableDOMExtraction) {
            pipelineBuilder.registerStep('dom-pattern', async (sess, log) => {
                log.info('Running DOM pattern extraction...');

                // Use generic extractor
                const genericExtractor = registry.get('generic');
                if (!genericExtractor) {
                    return createStepResult(StepStatus.SKIP, null, 0, 'Generic extractor not registered');
                }

                const result = await genericExtractor.extract(sess, log);

                if (result.questions.length === 0) {
                    return createStepResult(StepStatus.FAIL, null, 0, 'No questions found in DOM');
                }

                return createStepResult(
                    StepStatus.SUCCESS,
                    result,
                    60,
                    `${result.questions.length} questions from DOM`
                );
            });
        }

        // Step 6: Heuristic Extraction (fallback)
        if (config.enableHeuristics) {
            pipelineBuilder.registerStep('heuristic', async (sess, log) => {
                log.info('Running heuristic extraction (fallback)...');

                // Last resort - try to find anything that looks like Q&A
                const questions = [];
                const Normalize = typeof window !== 'undefined' ? window.LMSQANormalize : require('./normalize.js');
                const Rules = typeof window !== 'undefined' ? window.LMSQARules : require('./rules.js');

                // Find any text that looks like a question
                const allText = document.body?.textContent || '';
                const lines = allText.split(/[\n\r]+/).filter(l => l.trim().length > 20);

                for (const line of lines) {
                    const text = Normalize.normalizeText(line);
                    const result = Rules.isQuestion(text);

                    if (result.passed && result.confidence > 60) {
                        questions.push(Types.createQuestion({
                            text,
                            source: Types.ExtractionSource.HEURISTIC,
                            confidence: result.confidence
                        }));
                    }
                }

                if (questions.length === 0) {
                    // Directive #12: "No Results" is valid
                    return createStepResult(
                        StepStatus.SUCCESS,
                        { questions: [], noContent: true },
                        100,  // High confidence that there's no content
                        'No Q&A content found on this page (valid outcome)'
                    );
                }

                return createStepResult(
                    StepStatus.SUCCESS,
                    { questions },
                    40,
                    `${questions.length} questions from heuristics`
                );
            });
        }

        return pipelineBuilder.build();
    }

    /**
     * Detect SCORM/xAPI APIs
     */
    function detectAPIs(log) {
        const apis = [];

        if (typeof window === 'undefined') return apis;

        const locations = [
            { name: 'window', ref: window },
            { name: 'parent', ref: window.parent },
            { name: 'top', ref: window.top }
        ];

        const apiNames = ['API', 'API_1484_11', 'API_ADAPTER'];

        for (const loc of locations) {
            try {
                if (loc.ref === window && loc.name !== 'window') continue;

                for (const apiName of apiNames) {
                    if (loc.ref[apiName]) {
                        const api = loc.ref[apiName];
                        const standard = apiName === 'API_1484_11'
                            ? Types.LMSStandard.SCORM_2004
                            : Types.LMSStandard.SCORM_12;

                        apis.push({
                            standard,
                            location: `${loc.name}.${apiName}`,
                            functional: typeof api.LMSGetValue === 'function' ||
                                       typeof api.GetValue === 'function',
                            methods: Object.keys(api).filter(k => typeof api[k] === 'function'),
                            apiRef: api
                        });

                        log.detected(apiName, loc.name, 90);
                    }
                }

                // Check for xAPI/ADL
                if (loc.ref.ADL) {
                    apis.push({
                        standard: Types.LMSStandard.XAPI,
                        location: `${loc.name}.ADL`,
                        functional: true,
                        methods: Object.keys(loc.ref.ADL),
                        apiRef: loc.ref.ADL
                    });
                    log.detected('ADL (xAPI)', loc.name, 90);
                }
            } catch (e) {
                // Cross-origin access denied
            }
        }

        return apis;
    }

    /**
     * Build the final ExtractionResult from pipeline results
     */
    function buildExtractionResult(session, pipelineResult, startTime) {
        const { results, winner, aggregated, hasResults, totalQuestions } = pipelineResult;
        const duration = performance.now() - startTime;

        // Determine status (Directive #12: "No Results" is valid)
        let status;
        if (hasResults) {
            status = ExtractionStatus.SUCCESS;
        } else {
            // Check if heuristic step found no content (valid outcome)
            const heuristicResult = results.find(r => r.step === 'heuristic');
            if (heuristicResult?.data?.noContent) {
                status = ExtractionStatus.NO_CONTENT;
            } else {
                status = ExtractionStatus.PARTIAL;
            }
        }

        // Determine authoring tool
        const toolResult = results.find(r => r.step === 'tool-detection');
        const tool = toolResult?.data?.tool || AuthoringTool.UNKNOWN;

        // Get APIs
        const apiResult = results.find(r => r.step === 'api-detection');
        const apis = apiResult?.data?.apis || [];

        // Flatten all answers from questions
        const allAnswers = aggregated.questions.flatMap(q => q.answers || []);

        return createExtractionResult({
            status,
            questions: aggregated.questions,
            answers: allAnswers,
            apis,
            metadata: {
                url: session.url,
                tool,
                lmsStandard: apis[0]?.standard || null,
                timestamp: new Date().toISOString(),
                duration,
                sessionId: session.id,
                decisions: logger.exportDecisions()
            }
        });
    }

    // Return orchestrator interface
    return {
        /**
         * Main extraction method
         */
        extract,

        /**
         * Get the logger instance
         */
        getLogger() {
            return logger;
        },

        /**
         * Get the extractor registry
         */
        getRegistry() {
            return registry;
        },

        /**
         * Get configuration
         */
        getConfig() {
            return { ...cfg };
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

// Create default orchestrator instance
let defaultOrchestrator = null;

/**
 * Get or create the default orchestrator
 */
function getOrchestrator(config) {
    if (!defaultOrchestrator || config) {
        defaultOrchestrator = createOrchestrator(config);
    }
    return defaultOrchestrator;
}

/**
 * Simple extraction function using default orchestrator
 * This is the recommended entry point for most use cases.
 *
 * @param {Object} [options] - Extraction options
 * @returns {Promise<Object>} ExtractionResult
 */
async function extract(options) {
    return getOrchestrator().extract(options);
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createOrchestrator,
        getOrchestrator,
        extract,
        DEFAULT_CONFIG
    };
}

if (typeof window !== 'undefined') {
    window.LMSQAOrchestrator = {
        createOrchestrator,
        getOrchestrator,
        extract,
        DEFAULT_CONFIG
    };
}
