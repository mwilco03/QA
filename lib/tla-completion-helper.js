/**
 * TLA (Total Learning Architecture) Completion Helper v1.0
 *
 * Based on API patterns extracted from _index-JPAQiMOr.js
 *
 * Provides utilities to:
 * - Parse TLA correctPattern formats
 * - Submit scores/completion via session API
 * - Interact with LRS state
 *
 * Usage:
 *   Browser Console: Paste and run, then use TLAHelper methods
 *   Node.js: const helper = require('./tla-completion-helper.js')
 */

(function(global) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // Default API base URL (override with setBaseUrl)
        baseUrl: '',

        // TLA correctPattern delimiters
        DELIMITER_CHOICE: '[,]',      // Between multiple choices
        DELIMITER_MATCH: '[.]',       // Between source/target in matching
        DELIMITER_CASE: '{case_matters=',

        // Question types
        types: {
            CHOICE: 'CHOICE',
            FILL_IN: 'FILL_IN',
            LONG_FILL_IN: 'LONG_FILL_IN',
            MATCHING: 'MATCHING',
            SEQUENCING: 'SEQUENCING',
            TRUE_FALSE: 'TRUE_FALSE'
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // CORRECT PATTERN PARSERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Parse CHOICE correctPattern
     * Format: "choice_id" or "choice_id1[,]choice_id2" for multiple
     */
    function parseChoicePattern(pattern) {
        if (!pattern) return [];
        return pattern.split(CONFIG.DELIMITER_CHOICE).map(s => s.trim()).filter(Boolean);
    }

    /**
     * Parse FILL_IN correctPattern
     * Format: "{case_matters=true}answer1[,]answer2"
     */
    function parseFillInPattern(pattern) {
        if (!pattern) return { answers: [], caseMatters: false };

        let caseMatters = false;
        let answerStr = pattern;

        if (pattern.startsWith(CONFIG.DELIMITER_CASE)) {
            const closeIdx = pattern.indexOf('}');
            if (closeIdx !== -1) {
                caseMatters = pattern.substring(CONFIG.DELIMITER_CASE.length, closeIdx) === 'true';
                answerStr = pattern.substring(closeIdx + 1);
            }
        }

        return {
            answers: answerStr.split(CONFIG.DELIMITER_CHOICE).map(s => s.trim()).filter(Boolean),
            caseMatters
        };
    }

    /**
     * Parse MATCHING correctPattern
     * Format: "source1[.]target1[,]source2[.]target2"
     */
    function parseMatchingPattern(pattern) {
        if (!pattern) return [];
        return pattern.split(CONFIG.DELIMITER_CHOICE).map(pair => {
            const [source, target] = pair.split(CONFIG.DELIMITER_MATCH);
            return { source: source?.trim(), target: target?.trim() };
        }).filter(p => p.source && p.target);
    }

    /**
     * Parse SEQUENCING correctPattern
     * Format: "item1[,]item2[,]item3" (in correct order)
     */
    function parseSequencingPattern(pattern) {
        if (!pattern) return [];
        return pattern.split(CONFIG.DELIMITER_CHOICE).map((item, idx) => ({
            position: idx + 1,
            item: item.trim()
        })).filter(s => s.item);
    }

    /**
     * Parse TRUE_FALSE correctPattern
     * Format: "true" or "false"
     */
    function parseTrueFalsePattern(pattern) {
        if (!pattern) return null;
        return pattern.toLowerCase().trim() === 'true';
    }

    /**
     * Auto-detect and parse any correctPattern
     */
    function parseCorrectPattern(pattern, type) {
        switch (type?.toUpperCase()) {
            case CONFIG.types.CHOICE:
                return { type: 'choice', correct: parseChoicePattern(pattern) };
            case CONFIG.types.FILL_IN:
            case CONFIG.types.LONG_FILL_IN:
                return { type: 'fill_in', ...parseFillInPattern(pattern) };
            case CONFIG.types.MATCHING:
                return { type: 'matching', pairs: parseMatchingPattern(pattern) };
            case CONFIG.types.SEQUENCING:
                return { type: 'sequencing', sequence: parseSequencingPattern(pattern) };
            case CONFIG.types.TRUE_FALSE:
                return { type: 'true_false', correct: parseTrueFalsePattern(pattern) };
            default:
                // Auto-detect
                if (pattern?.includes(CONFIG.DELIMITER_MATCH)) {
                    return { type: 'matching', pairs: parseMatchingPattern(pattern) };
                }
                if (pattern?.startsWith(CONFIG.DELIMITER_CASE)) {
                    return { type: 'fill_in', ...parseFillInPattern(pattern) };
                }
                return { type: 'choice', correct: parseChoicePattern(pattern) };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TASKS.JSON EXTRACTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Extract Q&A from tasks.json format
     */
    function extractFromTasksJson(tasksData) {
        const questions = [];

        if (!tasksData?.taskGroups) return questions;

        for (const group of tasksData.taskGroups) {
            if (!group.tasks) continue;

            for (const task of group.tasks) {
                if (!task.questions) continue;

                for (const q of task.questions) {
                    const parsed = parseCorrectPattern(q.correctPattern, q.type);

                    questions.push({
                        id: q.id,
                        prompt: q.prompt,
                        type: q.type,
                        choices: q.choices || [],
                        source: q.source || [],
                        target: q.target || [],
                        correctPattern: q.correctPattern,
                        parsedCorrect: parsed,
                        taskId: task.id,
                        taskTitle: task.title,
                        groupId: group.id,
                        groupTitle: group.title
                    });
                }
            }
        }

        return questions;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // API INTERACTION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Make API request
     */
    async function apiRequest(endpoint, options = {}) {
        const url = CONFIG.baseUrl + endpoint;
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        return response.json().catch(() => null);
    }

    /**
     * Get tasks.json for a content URL
     */
    async function getTasks(contentUrl) {
        const endpoint = `/api/assets/tasks.json?contentUrl=${encodeURIComponent(contentUrl)}`;
        return apiRequest(endpoint);
    }

    /**
     * Get LRS state for a session
     */
    async function getLrsState(sessionId) {
        return apiRequest(`/api/sessions/${sessionId}/lrs/state`);
    }

    /**
     * Update LRS state for a session
     */
    async function setLrsState(sessionId, state) {
        return apiRequest(`/api/sessions/${sessionId}/lrs/state`, {
            method: 'PUT',
            body: JSON.stringify(state)
        });
    }

    /**
     * Submit score for a session (triggers completion)
     */
    async function submitScore(sessionId) {
        return apiRequest(`/api/sessions/${sessionId}/score`, {
            method: 'POST'
        });
    }

    /**
     * Get session info
     */
    async function getSession(sessionId) {
        return apiRequest(`/api/sessions/${sessionId}`, {
            cache: 'no-store'
        });
    }

    /**
     * Create a new session
     */
    async function createSession(contentUrl, cmi5LaunchParams = null, dryRun = false) {
        return apiRequest('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({
                contentUrl,
                cmi5LaunchParameters: cmi5LaunchParams,
                dryRun
            })
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANSWER GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Generate correct answer response for a question
     */
    function generateCorrectResponse(question) {
        const parsed = question.parsedCorrect || parseCorrectPattern(question.correctPattern, question.type);

        switch (parsed.type) {
            case 'choice':
                return parsed.correct;

            case 'fill_in':
                return parsed.answers[0] || '';

            case 'matching':
                return parsed.pairs.map(p => `${p.source}[.]${p.target}`).join('[,]');

            case 'sequencing':
                return parsed.sequence.map(s => s.item).join('[,]');

            case 'true_false':
                return String(parsed.correct);

            default:
                return question.correctPattern;
        }
    }

    /**
     * Build LRS state with all correct answers
     */
    function buildCorrectLrsState(questions) {
        const answers = {};

        for (const q of questions) {
            answers[q.id] = generateCorrectResponse(q);
        }

        return { answers };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    const TLAHelper = {
        config: CONFIG,

        // Pattern parsers
        parseChoicePattern,
        parseFillInPattern,
        parseMatchingPattern,
        parseSequencingPattern,
        parseTrueFalsePattern,
        parseCorrectPattern,

        // Extraction
        extractFromTasksJson,

        // API interaction
        setBaseUrl(url) {
            CONFIG.baseUrl = url.replace(/\/$/, '');
        },

        getTasks,
        getLrsState,
        setLrsState,
        submitScore,
        getSession,
        createSession,

        // Answer generation
        generateCorrectResponse,
        buildCorrectLrsState,

        /**
         * Full workflow: Extract questions, build correct answers, submit
         * @param {string} sessionId - Active session ID
         * @param {string} contentUrl - Content URL for tasks.json
         */
        async autoComplete(sessionId, contentUrl) {
            console.log('[TLAHelper] Starting auto-complete...');

            // 1. Fetch tasks
            const tasks = await getTasks(contentUrl);
            if (!tasks) throw new Error('Failed to fetch tasks.json');

            // 2. Extract questions
            const questions = extractFromTasksJson(tasks);
            console.log(`[TLAHelper] Found ${questions.length} questions`);

            // 3. Build correct state
            const correctState = buildCorrectLrsState(questions);
            console.log('[TLAHelper] Built correct answers:', correctState);

            // 4. Update LRS state
            await setLrsState(sessionId, correctState);
            console.log('[TLAHelper] Updated LRS state');

            // 5. Submit score
            const result = await submitScore(sessionId);
            console.log('[TLAHelper] Score submitted:', result);

            return { questions, correctState, result };
        },

        /**
         * Export questions with correct answers
         */
        exportQuestions(questions, format = 'json') {
            switch (format) {
                case 'text': {
                    let output = '=== TLA QUESTIONS & ANSWERS ===\n\n';
                    questions.forEach((q, i) => {
                        output += `--- Q${i + 1}: ${q.prompt || 'No prompt'} ---\n`;
                        output += `Type: ${q.type}\n`;
                        output += `Correct Pattern: ${q.correctPattern}\n`;
                        const parsed = q.parsedCorrect || parseCorrectPattern(q.correctPattern, q.type);

                        if (parsed.type === 'sequencing') {
                            output += 'Correct Sequence:\n';
                            parsed.sequence.forEach(s => {
                                output += `  ${s.position}. ${s.item}\n`;
                            });
                        } else if (parsed.type === 'matching') {
                            output += 'Correct Matches:\n';
                            parsed.pairs.forEach(p => {
                                output += `  ${p.source} → ${p.target}\n`;
                            });
                        } else if (parsed.type === 'fill_in') {
                            output += `Correct Answers: ${parsed.answers.join(', ')}\n`;
                            output += `Case Sensitive: ${parsed.caseMatters}\n`;
                        } else {
                            output += `Correct: ${JSON.stringify(parsed.correct)}\n`;
                        }
                        output += '\n';
                    });
                    return output;
                }

                case 'csv': {
                    let output = 'ID,Prompt,Type,CorrectPattern,ParsedAnswer\n';
                    questions.forEach(q => {
                        const prompt = (q.prompt || '').replace(/"/g, '""');
                        const answer = generateCorrectResponse(q).replace(/"/g, '""');
                        output += `"${q.id}","${prompt}","${q.type}","${q.correctPattern}","${answer}"\n`;
                    });
                    return output;
                }

                default:
                    return JSON.stringify(questions, null, 2);
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    if (typeof window !== 'undefined') {
        window.TLAHelper = TLAHelper;
        console.log('[TLAHelper] Loaded. Use TLAHelper.autoComplete(sessionId, contentUrl) for auto-completion');
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TLAHelper;
    }

    return TLAHelper;

})(typeof window !== 'undefined' ? window : global);
