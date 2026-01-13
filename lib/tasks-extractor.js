/**
 * LMS QA Validator - Tasks Extractor v7.0
 * Universal network interceptor for TLA/xAPI content discovery
 *
 * Detects:
 * - tasks.json manifests (by path pattern + schema)
 * - xAPI LRS endpoints (statements, state)
 * - Correct answers from xAPI 'answered' statements with result.success
 * - cmi5 completion patterns
 *
 * Domain-agnostic: matches URL patterns and response schemas, not specific domains
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGGING CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const VERBOSE = false;  // Set to true for detailed debug logging

    const log = {
        info: (category, msg, data) => {
            console.log(`%c[TasksExtractor]%c [${category}] ${msg}`,
                'color: #10b981; font-weight: bold', 'color: inherit', data || '');
        },
        warn: (category, msg, data) => {
            console.warn(`%c[TasksExtractor]%c [${category}] ${msg}`,
                'color: #f59e0b; font-weight: bold', 'color: inherit', data || '');
        },
        error: (category, msg, data) => {
            console.error(`%c[TasksExtractor]%c [${category}] ${msg}`,
                'color: #ef4444; font-weight: bold', 'color: inherit', data || '');
        },
        verbose: (category, msg, data) => {
            if (VERBOSE) {
                console.log(`%c[TasksExtractor]%c [${category}] ${msg}`,
                    'color: #8b5cf6; font-weight: bold', 'color: #888', data || '');
            }
        },
        network: (method, url, status) => {
            if (VERBOSE) {
                const color = status >= 200 && status < 300 ? '#22c55e' : '#ef4444';
                console.log(`%c[TasksExtractor]%c [NET] %c${method}%c ${url} %c${status || ''}`,
                    'color: #10b981; font-weight: bold',
                    'color: inherit',
                    'color: #3b82f6; font-weight: bold',
                    'color: inherit',
                    `color: ${color}`
                );
            }
        },
        table: (category, data) => {
            console.log(`%c[TasksExtractor]%c [${category}]`,
                'color: #10b981; font-weight: bold', 'color: inherit');
            console.table(data);
        }
    };

    const PREFIX = 'LMS_QA_';
    const EXTRACTOR_ID = 'tasks-extractor';

    // ═══════════════════════════════════════════════════════════════════════════
    // URL PATH PATTERNS (Domain-agnostic)
    // ═══════════════════════════════════════════════════════════════════════════

    const URL_PATTERNS = {
        // Content manifests
        tasksJson: /\/(?:api\/)?assets\/tasks\.json/i,
        contentManifest: /\/(?:api\/)?(?:content|course|activity)\/.*\.json$/i,

        // xAPI LRS endpoints
        lrsStatements: /\/(?:lrs\/)?statements/i,
        lrsState: /\/(?:lrs\/)?(?:activities\/)?state/i,
        lrsActivities: /\/(?:lrs\/)?activities/i,

        // Session patterns
        sessionApi: /\/(?:api\/)?sessions\/([a-z]{2}-[0-9a-f-]{36})/i,

        // Content URL parameter
        contentUrlParam: /[?&]contentUrl=([^&]+)/i,

        // cmi5 launch patterns
        cmi5Launch: /[?&](?:endpoint|fetch|actor|registration|activityId)=/i,

        // Common LMS API patterns
        scormApi: /\/(?:api|gateway)\/(?:scorm|aicc|content)/i,
        completionApi: /\/(?:api|gateway)\/(?:complete|finish|commit|terminate)/i
    };

    // xAPI ADL Verbs - including cmi5 verbs
    const XAPI_VERBS = {
        // ADL standard verbs
        ANSWERED: 'http://adlnet.gov/expapi/verbs/answered',
        COMPLETED: 'http://adlnet.gov/expapi/verbs/completed',
        PASSED: 'http://adlnet.gov/expapi/verbs/passed',
        FAILED: 'http://adlnet.gov/expapi/verbs/failed',
        EXPERIENCED: 'http://adlnet.gov/expapi/verbs/experienced',
        ATTEMPTED: 'http://adlnet.gov/expapi/verbs/attempted',
        INTERACTED: 'http://adlnet.gov/expapi/verbs/interacted',
        // cmi5 verbs
        LAUNCHED: 'http://adlnet.gov/expapi/verbs/launched',
        INITIALIZED: 'http://adlnet.gov/expapi/verbs/initialized',
        TERMINATED: 'http://adlnet.gov/expapi/verbs/terminated',
        ABANDONED: 'https://w3id.org/xapi/adl/verbs/abandoned',
        WAIVED: 'https://w3id.org/xapi/adl/verbs/waived',
        SATISFIED: 'https://w3id.org/xapi/adl/verbs/satisfied'
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    const state = {
        // Discovered content
        tasksManifests: new Map(),      // url -> manifest data
        questions: new Map(),            // questionId -> question data
        questionAnswers: new Map(),      // questionId -> { response, success, timestamp }

        // Session tracking
        sessions: new Map(),             // sessionId -> { contentUrl, origin, discovered }

        // xAPI tracking
        statements: [],                  // Recent statements for analysis
        outgoingStatements: [],          // Statements we've seen sent (for replay)

        // cmi5 tracking
        cmi5Context: null,               // Captured cmi5 launch context

        // Endpoints discovered
        endpoints: {
            lrs: new Set(),
            assets: new Set(),
            sessions: new Set(),
            completion: new Set()
        },

        // Network stats
        stats: {
            fetchIntercepted: 0,
            xhrIntercepted: 0,
            jsonParsed: 0,
            patternsMatched: 0
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SCHEMA DETECTION (Response body validation)
    // ═══════════════════════════════════════════════════════════════════════════

    function isTasksManifest(json) {
        if (!json || typeof json !== 'object') return false;

        // Check for TLA tasks.json structure
        const hasTaskGroups = Array.isArray(json.taskGroups);
        const hasTasks = Array.isArray(json.tasks);
        const hasQuestions = hasTaskGroups && json.taskGroups.some(g =>
            g.tasks?.some(t => Array.isArray(t.questions) && t.questions.length > 0)
        );
        const hasCompetencies = json.competencies && typeof json.competencies === 'object';
        const hasScorable = typeof json.scorable === 'boolean';
        const hasSlug = typeof json.slug === 'string';

        const result = (hasTaskGroups || hasTasks) && (hasQuestions || hasCompetencies || hasScorable || hasSlug);

        if (VERBOSE && result) {
            log.info('SCHEMA', `Tasks manifest detected: taskGroups=${hasTaskGroups}, tasks=${hasTasks}, questions=${hasQuestions}`);
        }

        return result;
    }

    function isXAPIStatement(json) {
        if (!json || typeof json !== 'object') return false;

        // Single statement
        if (json.actor && json.verb && json.object) {
            log.verbose('SCHEMA', 'Single xAPI statement detected');
            return true;
        }

        // Array of statements
        if (Array.isArray(json) && json.length > 0) {
            if (json[0].actor && json[0].verb && json[0].object) {
                log.verbose('SCHEMA', `Array of ${json.length} xAPI statements detected`);
                return true;
            }
        }

        // Statements response wrapper
        if (json.statements && Array.isArray(json.statements)) {
            log.verbose('SCHEMA', `Wrapped statements response with ${json.statements.length} statements`);
            return json.statements.length === 0 ||
                   (json.statements[0]?.actor && json.statements[0]?.verb);
        }

        return false;
    }

    function isLRSState(json) {
        if (!json || typeof json !== 'object') return false;
        const result = 'stateId' in json || 'activityId' in json || 'registration' in json;
        if (result) log.verbose('SCHEMA', 'LRS state object detected');
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // QUESTION EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractQuestionsFromManifest(manifest, sourceUrl) {
        const questions = [];

        if (!manifest.taskGroups) {
            log.warn('EXTRACT', 'No taskGroups in manifest');
            return questions;
        }

        log.info('EXTRACT', `Processing ${manifest.taskGroups.length} task groups from manifest`);

        for (const group of manifest.taskGroups) {
            if (!group.tasks) continue;

            log.verbose('EXTRACT', `Group: ${group.title || group.id} has ${group.tasks.length} tasks`);

            for (const task of group.tasks) {
                if (!task.questions) continue;

                log.verbose('EXTRACT', `Task: ${task.title || task.id} has ${task.questions.length} questions`);

                for (const q of task.questions) {
                    const question = {
                        id: q.id,
                        prompt: q.prompt,
                        type: q.type || 'CHOICE',
                        choices: q.choices || [],
                        allowMultiple: q.allowMultiple || false,
                        // Metadata
                        taskId: task.id,
                        taskTitle: task.title,
                        groupId: group.id,
                        groupTitle: group.title,
                        // Source tracking
                        sourceUrl,
                        slug: manifest.slug,
                        version: manifest.version,
                        // Answer tracking (populated from xAPI)
                        correctAnswer: null,
                        userResponse: null,
                        wasCorrect: null
                    };

                    questions.push(question);
                    state.questions.set(q.id, question);

                    log.verbose('EXTRACT', `Question: "${(q.prompt || '').substring(0, 50)}..." (${q.choices?.length || 0} choices)`);
                }
            }
        }

        log.info('EXTRACT', `✓ Extracted ${questions.length} questions from manifest`);
        return questions;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // xAPI STATEMENT PROCESSING
    // ═══════════════════════════════════════════════════════════════════════════

    function processXAPIStatement(statement, direction = 'incoming') {
        if (!statement || !statement.verb) return;

        const verbId = statement.verb.id;
        const verbDisplay = statement.verb.display?.['en-US'] || statement.verb.display?.en || verbId.split('/').pop();
        const result = statement.result;
        const objectId = statement.object?.id;
        const actorName = statement.actor?.name || statement.actor?.mbox || 'unknown';

        log.info('xAPI', `${direction === 'outgoing' ? '→' : '←'} ${verbDisplay.toUpperCase()} | Actor: ${actorName} | Object: ${objectId?.substring(0, 50) || 'N/A'}`);

        if (result) {
            log.verbose('xAPI', `Result: success=${result.success}, completion=${result.completion}, score=${JSON.stringify(result.score)}, response="${result.response?.substring(0, 50) || 'N/A'}"`);
        }

        // Track all statements
        state.statements.push({
            verb: verbId,
            verbDisplay,
            objectId,
            actorName,
            success: result?.success,
            completion: result?.completion,
            response: result?.response,
            score: result?.score,
            timestamp: statement.timestamp || new Date().toISOString(),
            direction
        });

        // Track outgoing statements for potential replay
        if (direction === 'outgoing') {
            state.outgoingStatements.push(statement);
        }

        // Limit stored statements
        if (state.statements.length > 500) {
            state.statements = state.statements.slice(-250);
        }
        if (state.outgoingStatements.length > 100) {
            state.outgoingStatements = state.outgoingStatements.slice(-50);
        }

        // Process answered statements to discover correct answers
        if (verbId === XAPI_VERBS.ANSWERED && result) {
            processAnsweredStatement(statement);
        }

        // Track completion/pass/fail/satisfied
        if (verbId === XAPI_VERBS.COMPLETED ||
            verbId === XAPI_VERBS.PASSED ||
            verbId === XAPI_VERBS.FAILED ||
            verbId === XAPI_VERBS.SATISFIED) {

            log.info('xAPI', `🎯 COMPLETION EVENT: ${verbDisplay} (success=${result?.success}, completion=${result?.completion})`);

            broadcastEvent('COMPLETION_DETECTED', {
                verb: verbId,
                verbDisplay,
                objectId,
                success: result?.success,
                completion: result?.completion,
                score: result?.score
            });
        }

        // Track cmi5 lifecycle
        if (verbId === XAPI_VERBS.INITIALIZED) {
            log.info('xAPI', '🚀 CMI5 Session INITIALIZED');
            state.cmi5Context = {
                initialized: true,
                timestamp: statement.timestamp,
                registration: statement.context?.registration
            };
        }

        if (verbId === XAPI_VERBS.TERMINATED) {
            log.info('xAPI', '🛑 CMI5 Session TERMINATED');
        }
    }

    function processAnsweredStatement(statement) {
        const objectId = statement.object?.id;
        const result = statement.result;

        if (!objectId || !result) return;

        // Extract question ID from object ID (may be UUID at end of URI)
        const questionIdMatch = objectId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        const questionId = questionIdMatch ? questionIdMatch[1] : objectId;

        const answerData = {
            response: result.response,
            success: result.success,
            completion: result.completion,
            score: result.score,
            timestamp: statement.timestamp || new Date().toISOString(),
            objectId
        };

        // Store answer
        state.questionAnswers.set(questionId, answerData);

        // Update question if we have it
        const question = state.questions.get(questionId);
        if (question) {
            question.userResponse = result.response;
            question.wasCorrect = result.success;

            // If success is true, the response is the correct answer
            if (result.success === true && result.response !== undefined) {
                question.correctAnswer = result.response;
                log.info('xAPI', `✓ CORRECT ANSWER discovered for Q ${questionId.substring(0, 8)}...: "${result.response}"`);
            } else {
                log.verbose('xAPI', `Answer recorded for Q ${questionId.substring(0, 8)}...: "${result.response}" (${result.success ? 'correct' : 'incorrect'})`);
            }
        }

        // Broadcast answer event
        broadcastEvent('ANSWER_RECORDED', {
            questionId,
            response: result.response,
            success: result.success,
            score: result.score
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NETWORK INTERCEPTION
    // ═══════════════════════════════════════════════════════════════════════════

    function interceptFetch() {
        const originalFetch = window.fetch;

        window.fetch = async function(...args) {
            const url = args[0]?.url || args[0]?.toString() || args[0];
            const method = args[1]?.method || 'GET';
            const body = args[1]?.body;

            state.stats.fetchIntercepted++;

            // Log the request
            log.network(method, url, '...');

            // Check for outgoing xAPI statements in POST body
            if (body && method === 'POST') {
                try {
                    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
                    if (isXAPIStatement(parsed)) {
                        log.info('NET', `Outgoing xAPI statement(s) in fetch POST`);
                        if (Array.isArray(parsed)) {
                            parsed.forEach(s => processXAPIStatement(s, 'outgoing'));
                        } else {
                            processXAPIStatement(parsed, 'outgoing');
                        }
                    }
                } catch (e) {
                    // Not JSON
                }
            }

            const response = await originalFetch.apply(this, args);

            try {
                log.network(method, url, response.status);
                await processResponse(url, response.clone(), method);
            } catch (e) {
                log.error('NET', `Error processing fetch response: ${e.message}`);
            }

            return response;
        };

        log.info('INIT', '✓ Fetch interceptor installed');
    }

    function interceptXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._interceptedUrl = url;
            this._interceptedMethod = method;
            return originalOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function(body) {
            const self = this;
            const url = this._interceptedUrl;
            const method = this._interceptedMethod;

            state.stats.xhrIntercepted++;

            log.network(method, url, '...');

            this.addEventListener('load', function() {
                try {
                    log.network(method, url, this.status);
                    processXHRResponse(url, this, method);
                } catch (e) {
                    log.error('NET', `Error processing XHR response: ${e.message}`);
                }
            });

            // Intercept outgoing xAPI statements
            if (body && method === 'POST') {
                try {
                    const parsed = JSON.parse(body);
                    if (isXAPIStatement(parsed)) {
                        log.info('NET', `Outgoing xAPI statement(s) in XHR POST`);
                        if (Array.isArray(parsed)) {
                            parsed.forEach(s => processXAPIStatement(s, 'outgoing'));
                        } else {
                            processXAPIStatement(parsed, 'outgoing');
                        }
                    }
                } catch (e) {
                    // Not JSON
                }
            }

            return originalSend.call(this, body);
        };

        log.info('INIT', '✓ XHR interceptor installed');
    }

    async function processResponse(url, response, method) {
        if (!url || !response) return;

        const urlStr = url.toString();
        const contentType = response.headers?.get('content-type') || '';

        // Only process JSON responses or known patterns
        if (!contentType.includes('json') && !matchesKnownPattern(urlStr)) {
            return;
        }

        // Check URL patterns
        const patternMatch = matchUrlPattern(urlStr);
        if (patternMatch) {
            state.stats.patternsMatched++;
            log.info('PATTERN', `Matched: ${patternMatch.type} in ${urlStr.substring(0, 80)}...`);
            trackEndpoint(patternMatch.type, urlStr);
        }

        // Try to parse and analyze JSON
        try {
            const json = await response.json();
            state.stats.jsonParsed++;
            analyzeJsonResponse(urlStr, json, patternMatch, method);
        } catch (e) {
            // Not valid JSON
        }
    }

    function processXHRResponse(url, xhr, method) {
        if (!url || xhr.status < 200 || xhr.status >= 300) return;

        const contentType = xhr.getResponseHeader('content-type') || '';
        const urlStr = url.toString();

        if (!contentType.includes('json') && !matchesKnownPattern(urlStr)) return;

        const patternMatch = matchUrlPattern(urlStr);
        if (patternMatch) {
            state.stats.patternsMatched++;
            log.info('PATTERN', `Matched: ${patternMatch.type} in ${urlStr.substring(0, 80)}...`);
            trackEndpoint(patternMatch.type, urlStr);
        }

        try {
            const json = JSON.parse(xhr.responseText);
            state.stats.jsonParsed++;
            analyzeJsonResponse(urlStr, json, patternMatch, method);
        } catch (e) {
            // Not valid JSON
        }
    }

    function matchUrlPattern(url) {
        for (const [name, pattern] of Object.entries(URL_PATTERNS)) {
            const match = url.match(pattern);
            if (match) {
                return { type: name, match };
            }
        }
        return null;
    }

    function matchesKnownPattern(url) {
        return Object.values(URL_PATTERNS).some(p => p.test(url));
    }

    function trackEndpoint(type, url) {
        try {
            const origin = new URL(url).origin;

            if (type.startsWith('lrs')) {
                state.endpoints.lrs.add(origin);
                log.verbose('ENDPOINT', `LRS endpoint: ${origin}`);
            } else if (type === 'tasksJson' || type === 'contentManifest') {
                state.endpoints.assets.add(origin);
                log.verbose('ENDPOINT', `Assets endpoint: ${origin}`);
            } else if (type === 'sessionApi') {
                state.endpoints.sessions.add(origin);
                log.verbose('ENDPOINT', `Session endpoint: ${origin}`);
            } else if (type === 'completionApi') {
                state.endpoints.completion.add(url);
                log.info('ENDPOINT', `🎯 Completion API endpoint discovered: ${url}`);
            }
        } catch (e) {
            // Invalid URL
        }
    }

    function analyzeJsonResponse(url, json, patternMatch, method) {
        // Check for tasks manifest (by pattern or schema)
        if (patternMatch?.type === 'tasksJson' || isTasksManifest(json)) {
            log.info('DISCOVER', `📋 Tasks manifest discovered: ${url}`);
            state.tasksManifests.set(url, json);
            const questions = extractQuestionsFromManifest(json, url);

            broadcastEvent('TASKS_MANIFEST_DISCOVERED', {
                url,
                slug: json.slug,
                version: json.version,
                questionCount: questions.length,
                taskGroupCount: json.taskGroups?.length || 0
            });
        }

        // Check for xAPI statements
        if (patternMatch?.type === 'lrsStatements' || isXAPIStatement(json)) {
            const statements = Array.isArray(json) ? json :
                              json.statements ? json.statements : [json];

            log.info('xAPI', `Processing ${statements.length} statement(s) from response`);
            statements.forEach(s => processXAPIStatement(s, 'incoming'));
        }

        // Extract session info
        if (patternMatch?.type === 'sessionApi') {
            const sessionId = patternMatch.match[1];
            const contentUrlMatch = url.match(URL_PATTERNS.contentUrlParam);

            state.sessions.set(sessionId, {
                contentUrl: contentUrlMatch ? decodeURIComponent(contentUrlMatch[1]) : null,
                origin: new URL(url).origin,
                discovered: Date.now()
            });

            log.info('SESSION', `Session discovered: ${sessionId}`);
        }

        // Check for completion-related responses
        if (patternMatch?.type === 'completionApi' ||
            (json.success !== undefined && json.completion !== undefined)) {
            log.info('COMPLETE', `Completion response detected in ${url}`, json);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT BROADCASTING
    // ═══════════════════════════════════════════════════════════════════════════

    function broadcastEvent(eventType, data) {
        log.verbose('BROADCAST', `${eventType}`, data);
        window.postMessage({
            type: `${PREFIX}EXTRACTOR_${eventType}`,
            payload: {
                ...data,
                extractorId: EXTRACTOR_ID,
                timestamp: Date.now()
            }
        }, '*');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    function getExtractedData() {
        const data = {
            questions: Array.from(state.questions.values()),
            answers: Object.fromEntries(state.questionAnswers),
            manifests: Array.from(state.tasksManifests.keys()),
            sessions: Object.fromEntries(state.sessions),
            endpoints: {
                lrs: Array.from(state.endpoints.lrs),
                assets: Array.from(state.endpoints.assets),
                sessions: Array.from(state.endpoints.sessions),
                completion: Array.from(state.endpoints.completion)
            },
            cmi5Context: state.cmi5Context,
            stats: {
                questionCount: state.questions.size,
                answeredCount: state.questionAnswers.size,
                correctCount: Array.from(state.questionAnswers.values())
                    .filter(a => a.success === true).length,
                statementCount: state.statements.length,
                outgoingStatementCount: state.outgoingStatements.length,
                fetchIntercepted: state.stats.fetchIntercepted,
                xhrIntercepted: state.stats.xhrIntercepted,
                jsonParsed: state.stats.jsonParsed,
                patternsMatched: state.stats.patternsMatched
            }
        };

        log.info('API', 'getExtractedData() called', data.stats);
        return data;
    }

    function getQuestionById(id) {
        return state.questions.get(id) || null;
    }

    function getCorrectAnswers() {
        const correct = [];
        for (const [id, answer] of state.questionAnswers) {
            if (answer.success === true) {
                const question = state.questions.get(id);
                correct.push({
                    questionId: id,
                    prompt: question?.prompt,
                    response: answer.response,
                    choices: question?.choices
                });
            }
        }
        log.info('API', `getCorrectAnswers(): ${correct.length} correct answers`);
        return correct;
    }

    function getRecentStatements(count = 20) {
        return state.statements.slice(-count);
    }

    function getOutgoingStatements() {
        return state.outgoingStatements;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMMAND HANDLER
    // ═══════════════════════════════════════════════════════════════════════════

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data?.type?.startsWith(PREFIX)) return;

        const type = event.data.type.replace(PREFIX, '');

        log.verbose('CMD', `Received command: ${type}`);

        switch (type) {
            case 'CMD_GET_EXTRACTED_DATA':
                broadcastEvent('EXTRACTED_DATA', getExtractedData());
                break;

            case 'CMD_GET_QUESTIONS':
                broadcastEvent('QUESTIONS', {
                    questions: Array.from(state.questions.values())
                });
                break;

            case 'CMD_GET_CORRECT_ANSWERS':
                broadcastEvent('CORRECT_ANSWERS', {
                    answers: getCorrectAnswers()
                });
                break;

            case 'CMD_GET_STATEMENTS':
                broadcastEvent('STATEMENTS', {
                    statements: getRecentStatements(),
                    outgoing: getOutgoingStatements()
                });
                break;

            case 'CMD_CLEAR_STATE':
                state.questions.clear();
                state.questionAnswers.clear();
                state.tasksManifests.clear();
                state.statements = [];
                state.outgoingStatements = [];
                log.info('CMD', 'State cleared');
                break;
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    console.log('%c[TasksExtractor] Network Interceptor Loading...', 'color: #10b981; font-weight: bold; font-size: 14px');

    // Install interceptors
    interceptFetch();
    interceptXHR();

    // Expose API for debugging
    window.__LMS_QA_EXTRACTOR__ = {
        getExtractedData,
        getQuestionById,
        getCorrectAnswers,
        getRecentStatements,
        getOutgoingStatements,
        getState: () => state,
        PATTERNS: URL_PATTERNS,
        VERBS: XAPI_VERBS,
        VERSION: '2.0'
    };

    log.info('INIT', `✓ Tasks Extractor v2.0 initialized`);
    log.info('INIT', `URL: ${window.location.href}`);
    log.info('INIT', `Debug: window.__LMS_QA_EXTRACTOR__`);

    // Print pattern summary
    log.table('PATTERNS', Object.keys(URL_PATTERNS).map(k => ({ pattern: k, regex: URL_PATTERNS[k].toString() })));

    broadcastEvent('READY', { version: '2.0' });

})();
