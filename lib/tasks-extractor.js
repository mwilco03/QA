/**
 * LMS QA Validator - Tasks Extractor v1.0
 * Universal network interceptor for TLA/xAPI content discovery
 *
 * Detects:
 * - tasks.json manifests (by path pattern + schema)
 * - xAPI LRS endpoints (statements, state)
 * - Correct answers from xAPI 'answered' statements with result.success
 *
 * Domain-agnostic: matches URL patterns and response schemas, not specific domains
 */

(function() {
    'use strict';

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
        contentUrlParam: /[?&]contentUrl=([^&]+)/i
    };

    // xAPI ADL Verbs
    const XAPI_VERBS = {
        ANSWERED: 'http://adlnet.gov/expapi/verbs/answered',
        COMPLETED: 'http://adlnet.gov/expapi/verbs/completed',
        PASSED: 'http://adlnet.gov/expapi/verbs/passed',
        FAILED: 'http://adlnet.gov/expapi/verbs/failed',
        EXPERIENCED: 'http://adlnet.gov/expapi/verbs/experienced',
        ATTEMPTED: 'http://adlnet.gov/expapi/verbs/attempted',
        INTERACTED: 'http://adlnet.gov/expapi/verbs/interacted'
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

        // Endpoints discovered
        endpoints: {
            lrs: new Set(),
            assets: new Set(),
            sessions: new Set()
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

        // Must have taskGroups or tasks, and should have questions or competencies
        return (hasTaskGroups || hasTasks) && (hasQuestions || hasCompetencies || hasScorable || hasSlug);
    }

    function isXAPIStatement(json) {
        if (!json || typeof json !== 'object') return false;

        // Single statement
        if (json.actor && json.verb && json.object) return true;

        // Array of statements
        if (Array.isArray(json) && json.length > 0) {
            return json[0].actor && json[0].verb && json[0].object;
        }

        // Statements response wrapper
        if (json.statements && Array.isArray(json.statements)) {
            return json.statements.length === 0 ||
                   (json.statements[0]?.actor && json.statements[0]?.verb);
        }

        return false;
    }

    function isLRSState(json) {
        if (!json || typeof json !== 'object') return false;
        return 'stateId' in json || 'activityId' in json || 'registration' in json;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // QUESTION EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    function extractQuestionsFromManifest(manifest, sourceUrl) {
        const questions = [];

        if (!manifest.taskGroups) return questions;

        for (const group of manifest.taskGroups) {
            if (!group.tasks) continue;

            for (const task of group.tasks) {
                if (!task.questions) continue;

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
                }
            }
        }

        log(`Extracted ${questions.length} questions from manifest`);
        return questions;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // xAPI STATEMENT PROCESSING
    // ═══════════════════════════════════════════════════════════════════════════

    function processXAPIStatement(statement) {
        if (!statement || !statement.verb) return;

        const verbId = statement.verb.id;
        const result = statement.result;
        const objectId = statement.object?.id;

        // Track all statements
        state.statements.push({
            verb: verbId,
            objectId,
            success: result?.success,
            completion: result?.completion,
            response: result?.response,
            score: result?.score,
            timestamp: statement.timestamp || new Date().toISOString()
        });

        // Limit stored statements
        if (state.statements.length > 500) {
            state.statements = state.statements.slice(-250);
        }

        // Process answered statements to discover correct answers
        if (verbId === XAPI_VERBS.ANSWERED && result) {
            processAnsweredStatement(statement);
        }

        // Track completion/pass/fail
        if (verbId === XAPI_VERBS.COMPLETED ||
            verbId === XAPI_VERBS.PASSED ||
            verbId === XAPI_VERBS.FAILED) {
            broadcastEvent('COMPLETION_DETECTED', {
                verb: verbId,
                objectId,
                success: result?.success,
                score: result?.score
            });
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
                log(`Discovered correct answer for question ${questionId}: ${result.response}`);
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
            const response = await originalFetch.apply(this, args);

            try {
                const url = args[0]?.url || args[0]?.toString() || args[0];
                await processResponse(url, response.clone());
            } catch (e) {
                // Don't break fetch on processing errors
            }

            return response;
        };

        log('Fetch interceptor installed');
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
            this.addEventListener('load', function() {
                try {
                    processXHRResponse(this._interceptedUrl, this);
                } catch (e) {
                    // Don't break XHR on processing errors
                }
            });

            // Also intercept outgoing xAPI statements
            if (body && this._interceptedMethod === 'POST') {
                try {
                    const parsed = JSON.parse(body);
                    if (isXAPIStatement(parsed)) {
                        if (Array.isArray(parsed)) {
                            parsed.forEach(s => processXAPIStatement(s));
                        } else {
                            processXAPIStatement(parsed);
                        }
                    }
                } catch (e) {
                    // Not JSON or not a statement
                }
            }

            return originalSend.call(this, body);
        };

        log('XHR interceptor installed');
    }

    async function processResponse(url, response) {
        if (!url || !response) return;

        const urlStr = url.toString();
        const contentType = response.headers?.get('content-type') || '';

        // Only process JSON responses
        if (!contentType.includes('json') && !matchesKnownPattern(urlStr)) return;

        // Check URL patterns
        const patternMatch = matchUrlPattern(urlStr);
        if (patternMatch) {
            trackEndpoint(patternMatch.type, urlStr);
        }

        // Try to parse and analyze JSON
        try {
            const json = await response.json();
            analyzeJsonResponse(urlStr, json, patternMatch);
        } catch (e) {
            // Not valid JSON
        }
    }

    function processXHRResponse(url, xhr) {
        if (!url || xhr.status < 200 || xhr.status >= 300) return;

        const contentType = xhr.getResponseHeader('content-type') || '';
        const urlStr = url.toString();

        if (!contentType.includes('json') && !matchesKnownPattern(urlStr)) return;

        const patternMatch = matchUrlPattern(urlStr);
        if (patternMatch) {
            trackEndpoint(patternMatch.type, urlStr);
        }

        try {
            const json = JSON.parse(xhr.responseText);
            analyzeJsonResponse(urlStr, json, patternMatch);
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
        const origin = new URL(url).origin;

        if (type.startsWith('lrs')) {
            state.endpoints.lrs.add(origin);
        } else if (type === 'tasksJson' || type === 'contentManifest') {
            state.endpoints.assets.add(origin);
        } else if (type === 'sessionApi') {
            state.endpoints.sessions.add(origin);
        }
    }

    function analyzeJsonResponse(url, json, patternMatch) {
        // Check for tasks manifest (by pattern or schema)
        if (patternMatch?.type === 'tasksJson' || isTasksManifest(json)) {
            log(`Tasks manifest discovered: ${url}`);
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

            statements.forEach(s => processXAPIStatement(s));

            log(`Processed ${statements.length} xAPI statements`);
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

            log(`Session discovered: ${sessionId}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT BROADCASTING
    // ═══════════════════════════════════════════════════════════════════════════

    function broadcastEvent(eventType, data) {
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
        return {
            questions: Array.from(state.questions.values()),
            answers: Object.fromEntries(state.questionAnswers),
            manifests: Array.from(state.tasksManifests.keys()),
            sessions: Object.fromEntries(state.sessions),
            endpoints: {
                lrs: Array.from(state.endpoints.lrs),
                assets: Array.from(state.endpoints.assets),
                sessions: Array.from(state.endpoints.sessions)
            },
            stats: {
                questionCount: state.questions.size,
                answeredCount: state.questionAnswers.size,
                correctCount: Array.from(state.questionAnswers.values())
                    .filter(a => a.success === true).length,
                statementCount: state.statements.length
            }
        };
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
        return correct;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMMAND HANDLER
    // ═══════════════════════════════════════════════════════════════════════════

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data?.type?.startsWith(PREFIX)) return;

        const type = event.data.type.replace(PREFIX, '');

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

            case 'CMD_CLEAR_STATE':
                state.questions.clear();
                state.questionAnswers.clear();
                state.tasksManifests.clear();
                state.statements = [];
                log('State cleared');
                break;
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGGING
    // ═══════════════════════════════════════════════════════════════════════════

    function log(msg) {
        console.log(`[LMS QA TasksExtractor] ${msg}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    // Install interceptors
    interceptFetch();
    interceptXHR();

    // Expose API for debugging
    window.__LMS_QA_EXTRACTOR__ = {
        getExtractedData,
        getQuestionById,
        getCorrectAnswers,
        getState: () => state,
        PATTERNS: URL_PATTERNS,
        VERBS: XAPI_VERBS
    };

    log('Tasks Extractor initialized');
    broadcastEvent('READY', { version: '1.0' });

})();
