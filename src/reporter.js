/**
 * Reporter Module
 *
 * Formats extraction results for display.
 */

import { Logger } from './core/logger.js';
import { StateManager } from './core/state.js';

const Reporter = {
    generate() {
        const qa = StateManager.get('qa');
        const apis = StateManager.get('apis');
        const resources = StateManager.get('resources');
        const logs = StateManager.get('logs');
        const warnings = StateManager.get('warnings');
        const tool = StateManager.get('tool');
        const frameworkEvidence = StateManager.get('frameworkEvidence') || [];
        const groupedQuestions = StateManager.get('groupedQuestions') || [];

        const questions = qa.filter(item => item.type === ITEM_TYPE.QUESTION);
        const answers = qa.filter(item => item.type === ITEM_TYPE.ANSWER);
        const correct = answers.filter(item => item.correct);
        const sequences = qa.filter(item => item.type === ITEM_TYPE.SEQUENCE);
        const matchItems = qa.filter(item =>
            item.type === ITEM_TYPE.MATCH_SOURCE || item.type === ITEM_TYPE.MATCH_TARGET
        );

        return {
            version: VERSION,
            url: window.location.href,
            timestamp: new Date().toISOString(),
            tool: tool || 'generic',
            toolEvidence: frameworkEvidence.slice(0, 5), // Include up to 5 evidence items
            apis: apis.map(api => ({
                type: api.type,
                location: api.location,
                methods: api.methods,
                functional: api.functional
            })),
            qa: {
                total: qa.length,
                questionCount: questions.length,
                answers: answers.length,
                correct: correct.length,
                sequences: sequences.length,
                matchItems: matchItems.length,
                items: qa,
                questions: groupedQuestions  // Structured question objects
            },
            resources: resources.length,
            logs,
            warnings
        };
    }
};


export { Reporter };
