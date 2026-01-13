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

    /**
     * Build complete LRS state with ALL tasks, questions marked as viewed/completed
     * Iterates through every taskGroup -> task -> question
     */
    function buildFullCompletionState(tasksData) {
        const state = {
            answers: {},
            viewedTasks: [],
            viewedTaskGroups: [],
            completedTasks: [],
            completedTaskGroups: [],
            questionResults: {},
            taskProgress: {},
            taskGroupProgress: {}
        };

        if (!tasksData?.taskGroups) return state;

        // Iterate through ALL task groups
        for (const group of tasksData.taskGroups) {
            const groupId = group.id || group.slug;

            // Mark task group as viewed
            state.viewedTaskGroups.push(groupId);

            let groupQuestionsCorrect = 0;
            let groupQuestionsTotal = 0;

            if (!group.tasks) {
                state.completedTaskGroups.push(groupId);
                state.taskGroupProgress[groupId] = { viewed: true, completed: true, progress: 1 };
                continue;
            }

            // Iterate through ALL tasks in this group
            for (const task of group.tasks) {
                const taskId = task.id || task.slug;

                // Mark task as viewed
                state.viewedTasks.push(taskId);

                let taskQuestionsCorrect = 0;
                let taskQuestionsTotal = 0;

                if (!task.questions || task.questions.length === 0) {
                    // Task has no questions - mark as complete
                    state.completedTasks.push(taskId);
                    state.taskProgress[taskId] = {
                        viewed: true,
                        completed: true,
                        progress: 1,
                        questionsAnswered: 0,
                        questionsTotal: 0
                    };
                    continue;
                }

                // Iterate through ALL questions in this task
                for (const question of task.questions) {
                    const questionId = question.id;
                    taskQuestionsTotal++;
                    groupQuestionsTotal++;

                    // Generate and store correct answer
                    const correctAnswer = generateCorrectResponse({
                        ...question,
                        parsedCorrect: parseCorrectPattern(question.correctPattern, question.type)
                    });

                    state.answers[questionId] = correctAnswer;

                    // Mark question as answered correctly
                    state.questionResults[questionId] = {
                        answered: true,
                        correct: true,
                        response: correctAnswer,
                        attempts: 1,
                        timestamp: new Date().toISOString()
                    };

                    taskQuestionsCorrect++;
                    groupQuestionsCorrect++;
                }

                // Mark task as completed (all questions answered)
                state.completedTasks.push(taskId);
                state.taskProgress[taskId] = {
                    viewed: true,
                    completed: true,
                    progress: 1,
                    questionsAnswered: taskQuestionsCorrect,
                    questionsTotal: taskQuestionsTotal,
                    score: taskQuestionsTotal > 0 ? (taskQuestionsCorrect / taskQuestionsTotal) : 1
                };
            }

            // Mark task group as completed (all tasks completed)
            state.completedTaskGroups.push(groupId);
            state.taskGroupProgress[groupId] = {
                viewed: true,
                completed: true,
                progress: 1,
                tasksCompleted: group.tasks.length,
                tasksTotal: group.tasks.length,
                questionsCorrect: groupQuestionsCorrect,
                questionsTotal: groupQuestionsTotal,
                score: groupQuestionsTotal > 0 ? (groupQuestionsCorrect / groupQuestionsTotal) : 1
            };
        }

        return state;
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
        buildFullCompletionState,

        /**
         * Full workflow: Iterate ALL taskGroups -> tasks -> questions, mark complete
         * @param {string} sessionId - Active session ID
         * @param {string} contentUrl - Content URL for tasks.json
         */
        async autoComplete(sessionId, contentUrl) {
            console.log('[TLAHelper] ═══════════════════════════════════════════════════');
            console.log('[TLAHelper] Starting FULL auto-complete with iteration...');
            console.log('[TLAHelper] ═══════════════════════════════════════════════════');

            // 1. Fetch tasks
            const tasks = await getTasks(contentUrl);
            if (!tasks) throw new Error('Failed to fetch tasks.json');

            // 2. Count all items
            let totalGroups = 0, totalTasks = 0, totalQuestions = 0;
            if (tasks.taskGroups) {
                for (const group of tasks.taskGroups) {
                    totalGroups++;
                    if (group.tasks) {
                        for (const task of group.tasks) {
                            totalTasks++;
                            if (task.questions) {
                                totalQuestions += task.questions.length;
                            }
                        }
                    }
                }
            }
            console.log(`[TLAHelper] Found: ${totalGroups} groups, ${totalTasks} tasks, ${totalQuestions} questions`);

            // 3. Build FULL completion state (iterates ALL items)
            const fullState = buildFullCompletionState(tasks);
            console.log('[TLAHelper] Built full completion state:');
            console.log(`  - Task Groups viewed/completed: ${fullState.viewedTaskGroups.length}/${fullState.completedTaskGroups.length}`);
            console.log(`  - Tasks viewed/completed: ${fullState.viewedTasks.length}/${fullState.completedTasks.length}`);
            console.log(`  - Questions answered: ${Object.keys(fullState.answers).length}`);

            // 4. Get current LRS state and merge
            let currentState = {};
            try {
                currentState = await getLrsState(sessionId) || {};
            } catch (e) {
                console.log('[TLAHelper] No existing state, starting fresh');
            }

            // 5. Merge with full state (preserve any existing data)
            const mergedState = {
                ...currentState,
                ...fullState,
                answers: { ...currentState.answers, ...fullState.answers },
                viewedTasks: [...new Set([...(currentState.viewedTasks || []), ...fullState.viewedTasks])],
                viewedTaskGroups: [...new Set([...(currentState.viewedTaskGroups || []), ...fullState.viewedTaskGroups])],
                completedTasks: [...new Set([...(currentState.completedTasks || []), ...fullState.completedTasks])],
                completedTaskGroups: [...new Set([...(currentState.completedTaskGroups || []), ...fullState.completedTaskGroups])],
                questionResults: { ...currentState.questionResults, ...fullState.questionResults }
            };

            // 6. Update LRS state with FULL completion
            console.log('[TLAHelper] Updating LRS state with all items marked complete...');
            await setLrsState(sessionId, mergedState);
            console.log('[TLAHelper] ✓ LRS state updated');

            // 7. Submit score to trigger final completion
            console.log('[TLAHelper] Submitting score...');
            const result = await submitScore(sessionId);
            console.log('[TLAHelper] ✓ Score submitted:', result);

            console.log('[TLAHelper] ═══════════════════════════════════════════════════');
            console.log('[TLAHelper] AUTO-COMPLETE FINISHED');
            console.log('[TLAHelper] ═══════════════════════════════════════════════════');

            return {
                tasks,
                fullState: mergedState,
                result,
                summary: {
                    taskGroups: totalGroups,
                    tasks: totalTasks,
                    questions: totalQuestions,
                    allCompleted: true
                }
            };
        },

        /**
         * Iterate and mark individual items (for step-by-step completion)
         */
        async iterateAndComplete(sessionId, contentUrl, options = {}) {
            const { delay = 100, onProgress = null } = options;

            console.log('[TLAHelper] Starting iterative completion...');

            const tasks = await getTasks(contentUrl);
            if (!tasks?.taskGroups) throw new Error('No task groups found');

            let currentState = await getLrsState(sessionId) || {};
            let completed = 0;
            let total = 0;

            // Count total items
            for (const group of tasks.taskGroups) {
                total++; // group itself
                for (const task of group.tasks || []) {
                    total++; // task itself
                    total += (task.questions || []).length; // questions
                }
            }

            // Iterate through each item
            for (const group of tasks.taskGroups) {
                const groupId = group.id || group.slug;

                // Mark group as viewed
                currentState.viewedTaskGroups = currentState.viewedTaskGroups || [];
                if (!currentState.viewedTaskGroups.includes(groupId)) {
                    currentState.viewedTaskGroups.push(groupId);
                }

                for (const task of group.tasks || []) {
                    const taskId = task.id || task.slug;

                    // Mark task as viewed
                    currentState.viewedTasks = currentState.viewedTasks || [];
                    if (!currentState.viewedTasks.includes(taskId)) {
                        currentState.viewedTasks.push(taskId);
                    }

                    for (const question of task.questions || []) {
                        const questionId = question.id;

                        // Answer question correctly
                        currentState.answers = currentState.answers || {};
                        currentState.answers[questionId] = generateCorrectResponse({
                            ...question,
                            parsedCorrect: parseCorrectPattern(question.correctPattern, question.type)
                        });

                        // Mark question result
                        currentState.questionResults = currentState.questionResults || {};
                        currentState.questionResults[questionId] = {
                            answered: true,
                            correct: true,
                            response: currentState.answers[questionId],
                            attempts: 1
                        };

                        completed++;
                        if (onProgress) onProgress({ completed, total, current: questionId, type: 'question' });

                        // Optional delay between items
                        if (delay > 0) await new Promise(r => setTimeout(r, delay));
                    }

                    // Mark task as completed
                    currentState.completedTasks = currentState.completedTasks || [];
                    if (!currentState.completedTasks.includes(taskId)) {
                        currentState.completedTasks.push(taskId);
                    }

                    completed++;
                    if (onProgress) onProgress({ completed, total, current: taskId, type: 'task' });

                    // Save state after each task
                    await setLrsState(sessionId, currentState);
                }

                // Mark group as completed
                currentState.completedTaskGroups = currentState.completedTaskGroups || [];
                if (!currentState.completedTaskGroups.includes(groupId)) {
                    currentState.completedTaskGroups.push(groupId);
                }

                completed++;
                if (onProgress) onProgress({ completed, total, current: groupId, type: 'group' });

                // Save state after each group
                await setLrsState(sessionId, currentState);
            }

            // Final score submission
            const result = await submitScore(sessionId);

            console.log(`[TLAHelper] Iterative completion done: ${completed}/${total} items`);

            return { state: currentState, result, completed, total };
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
