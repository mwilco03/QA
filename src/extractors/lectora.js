/**
 * Lectora Extractor
 *
 * Extracts Q&A content from Trivantis Lectora courses.
 */

import { AUTHORING_TOOL, ITEM_TYPE, QUESTION_TYPE, CONFIDENCE } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const LectoraExtractor = {
    toolId: AUTHORING_TOOL.LECTORA,

    /**
     * Detect if current page is Lectora content
     * Lectora markers: trivantis.*, lectora-specific classes, runtime
     */
    detect() {
        return !!(
            window.trivantis ||
            window.TrivantisCore ||
            window.ObL ||
            document.querySelector('[class*="lectora"]') ||
            document.querySelector('meta[name="generator"][content*="Lectora"]') ||
            document.querySelector('#lectoraContent, .lectora-page') ||
            (typeof window.getObjbyID === 'function')
        );
    },

    /**
     * Extract Q&A from Lectora content
     */
    async extract() {
        if (!this.detect()) {
            Logger.debug('No Lectora content detected');
            return [];
        }

        Logger.info('Extracting Lectora content...');
        const items = [];

        // Method 1: Extract from trivantis quiz objects
        items.push(...this.extractFromTrivantisQuiz());

        // Method 2: Extract from Lectora DOM
        items.push(...this.extractFromLectoraDOM());

        // Method 3: Extract from test/question objects
        items.push(...this.extractFromTestObjects());

        Logger.info(`Extracted ${items.length} items from Lectora`);
        return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
    },

    /**
     * Extract from Trivantis quiz data structures
     */
    extractFromTrivantisQuiz() {
        const items = [];

        try {
            // Lectora stores quiz data in trivantis namespace
            const trivantis = window.trivantis || window.TrivantisCore;
            if (!trivantis) return items;

            // Look for question bank or test objects
            const tests = trivantis.tests || trivantis.questionBank || [];

            Object.values(tests).forEach(test => {
                if (test.questions) {
                    test.questions.forEach(q => {
                        if (q.questionText || q.text) {
                            items.push({
                                type: ITEM_TYPE.QUESTION,
                                questionType: QUESTION_TYPE.CHOICE,
                                text: q.questionText || q.text,
                                source: 'Lectora:trivantis',
                                confidence: CONFIDENCE.HIGH
                            });
                        }

                        // Extract answers
                        const choices = q.choices || q.answers || q.distractors;
                        if (Array.isArray(choices)) {
                            choices.forEach((choice, idx) => {
                                const text = typeof choice === 'string' ? choice : choice.text;
                                if (text) {
                                    items.push({
                                        type: ITEM_TYPE.ANSWER,
                                        text: text,
                                        correct: q.correctIndex === idx ||
                                                q.correctAnswers?.includes(idx) ||
                                                choice.isCorrect,
                                        source: 'Lectora:trivantis',
                                        confidence: CONFIDENCE.HIGH
                                    });
                                }
                            });
                        }
                    });
                }
            });
        } catch (e) {
            Logger.debug('Error extracting Trivantis quiz data', { error: e.message });
        }

        return items;
    },

    /**
     * Extract from Lectora DOM elements
     */
    extractFromLectoraDOM() {
        const items = [];

        // Lectora question containers
        const questionContainers = document.querySelectorAll(
            '[class*="question"], [id*="question"], .test-question'
        );

        questionContainers.forEach(container => {
            // Look for question text
            const qText = container.querySelector(
                '[class*="questiontext"], [class*="qtext"], .question-stem'
            );
            if (qText) {
                items.push({
                    type: ITEM_TYPE.QUESTION,
                    text: qText.textContent?.trim(),
                    source: 'Lectora:DOM',
                    confidence: CONFIDENCE.MEDIUM
                });
            }

            // Look for answer choices
            const choices = container.querySelectorAll(
                'input[type="radio"] + label, input[type="checkbox"] + label, ' +
                '[class*="choice"], [class*="answer-option"]'
            );

            choices.forEach(choice => {
                const text = choice.textContent?.trim();
                if (text) {
                    const input = choice.previousElementSibling;
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: text,
                        correct: input?.getAttribute('data-correct') === 'true' ||
                                choice.classList.contains('correct'),
                        source: 'Lectora:DOM',
                        confidence: CONFIDENCE.MEDIUM
                    });
                }
            });
        });

        return items;
    },

    /**
     * Extract from test/question objects in page scope
     */
    extractFromTestObjects() {
        const items = [];

        try {
            // Look for Lectora test objects on window
            const testObjects = Object.keys(window).filter(key =>
                key.includes('test') || key.includes('quiz') || key.includes('question')
            );

            testObjects.forEach(key => {
                const obj = window[key];
                if (obj && typeof obj === 'object' && obj.questions) {
                    // Already handled in trivantis extraction
                    return;
                }
            });
        } catch (e) {
            Logger.debug('Error extracting Lectora test objects', { error: e.message });
        }

        return items;
    }
};


export { LectoraExtractor };
