/**
 * Tasks Extractor - Network Interceptor
 *
 * Intercepts fetch/XHR requests to capture tasks.json manifests.
 * This is a separate bundle from the main validator.
 */

import { PATHS, TLA_DELIMITERS } from '../core/constants.js';

// Simple logger for this module
const log = {
    info: (ctx, msg) => console.log(`[Tasks] [${ctx}] ${msg}`),
    warn: (ctx, msg) => console.warn(`[Tasks] [${ctx}] ${msg}`),
    error: (ctx, msg) => console.error(`[Tasks] [${ctx}] ${msg}`)
};

// State
const state = {
    manifests: new Map(),
    questions: new Map(),
    statements: []
};

/**
 * Check if response is a TLA tasks.json manifest
 */
function isTasksManifest(url, json) {
    if (!json || typeof json !== 'object') return false;

    // Path-based detection
    if (url.includes('tasks.json')) return true;

    // Schema-based detection
    const hasTaskGroups = Array.isArray(json.taskGroups);
    const hasTasks = hasTaskGroups && json.taskGroups.some(g => Array.isArray(g.tasks));
    const hasQuestions = hasTasks && json.taskGroups.some(g =>
        g.tasks?.some(t => Array.isArray(t.questions) && t.questions.length > 0)
    );

    return hasTaskGroups && hasTasks && hasQuestions;
}

/**
 * Extract questions from tasks manifest
 */
function extractQuestions(manifest, sourceUrl) {
    const questions = [];

    if (!manifest.taskGroups) return questions;

    for (const group of manifest.taskGroups) {
        if (!group.tasks) continue;

        for (const task of group.tasks) {
            if (!task.questions) continue;

            for (const q of task.questions) {
                const question = {
                    id: q.id,
                    prompt: q.prompt || q.question || '',
                    type: q.type || 'CHOICE',
                    choices: (q.choices || []).map(c => ({
                        id: c.id,
                        text: c.text || c.label || '',
                        correct: c.correct || false
                    })),
                    correctPattern: q.correctPattern,
                    taskId: task.id,
                    groupId: group.id,
                    source: sourceUrl
                };

                // Parse correctPattern for correct answers
                if (q.correctPattern) {
                    question.parsedCorrect = parseCorrectPattern(q.correctPattern, q.type);
                }

                questions.push(question);
                state.questions.set(q.id, question);
            }
        }
    }

    return questions;
}

/**
 * Parse correctPattern based on question type
 */
function parseCorrectPattern(pattern, type) {
    if (!pattern) return null;

    const DELIM = TLA_DELIMITERS.CHOICE;
    const MATCH_DELIM = TLA_DELIMITERS.MATCH;

    switch (type) {
        case 'CHOICE':
            return pattern.split(DELIM);

        case 'FILL_IN':
        case 'LONG_FILL_IN':
            if (pattern.startsWith('{case_matters=')) {
                const closeIdx = pattern.indexOf('}');
                return {
                    caseMatters: pattern.substring(14, closeIdx) === 'true',
                    answers: pattern.substring(closeIdx + 1).split(DELIM)
                };
            }
            return { answers: pattern.split(DELIM) };

        case 'MATCHING':
            return pattern.split(DELIM).map(p => {
                const [src, tgt] = p.split(MATCH_DELIM);
                return { source: src, target: tgt };
            });

        case 'SEQUENCING':
            return pattern.split(DELIM).map((item, i) => ({
                position: i + 1,
                item
            }));

        case 'TRUE_FALSE':
            return pattern.toLowerCase() === 'true';

        default:
            return pattern;
    }
}

/**
 * Process intercepted response
 */
async function processResponse(url, response) {
    try {
        const cloned = response.clone();
        const text = await cloned.text();
        let json;

        try {
            json = JSON.parse(text);
        } catch {
            return; // Not JSON
        }

        if (isTasksManifest(url, json)) {
            log.info('INTERCEPT', `Tasks manifest detected: ${url}`);
            state.manifests.set(url, json);

            const questions = extractQuestions(json, url);
            log.info('EXTRACT', `Extracted ${questions.length} questions`);

            // Notify extension
            window.postMessage({
                type: 'LMS_QA_TASKS_MANIFEST',
                payload: {
                    url,
                    questionCount: questions.length,
                    taskGroupCount: json.taskGroups?.length || 0
                }
            }, '*');
        }
    } catch (e) {
        log.error('PROCESS', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH INTERCEPTION
// ═══════════════════════════════════════════════════════════════════════════

const originalFetch = window.fetch;

window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    // Process in background (don't block)
    processResponse(url, response).catch(() => {});

    return response;
};

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

window.__LMS_QA_TASKS__ = {
    getManifests: () => Array.from(state.manifests.entries()),
    getQuestions: () => Array.from(state.questions.values()),
    getQuestion: (id) => state.questions.get(id),
    parseCorrectPattern
};

log.info('INIT', `Tasks extractor ready. URL: ${window.location.href}`);
