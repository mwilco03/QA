/**
 * Rise 360 Extractor
 *
 * Extracts Q&A content from Articulate Rise 360 courses.
 */

import { AUTHORING_TOOL, ITEM_TYPE, QUESTION_TYPE, CONFIDENCE } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const RiseExtractor = {
    toolId: AUTHORING_TOOL.RISE,

    /**
     * Detect if current page is Rise 360 content
     */
    detect() {
        return !!(
            document.querySelector('[data-ba-component]') ||
            document.querySelector('.block-knowledge') ||
            document.querySelector('.block-quiz') ||
            document.querySelector('[class*="rise-"]') ||
            window.__RISE_COURSE_DATA__ ||
            document.querySelector('meta[name="generator"][content*="Rise"]')
        );
    },

    /**
     * Extract Q&A from Rise 360 content
     */
    async extract() {
        if (!this.detect()) {
            Logger.debug('No Rise 360 content detected');
            return [];
        }

        Logger.info('Extracting Rise 360 content...');
        const items = [];

        // Method 1: Extract from knowledge check blocks
        items.push(...this.extractFromKnowledgeBlocks());

        // Method 2: Extract from quiz blocks
        items.push(...this.extractFromQuizBlocks());

        // Method 3: Extract from embedded course data
        items.push(...this.extractFromCourseData());

        Logger.info(`Extracted ${items.length} items from Rise 360`);
        return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
    },

    /**
     * Extract from Rise knowledge check blocks
     */
    extractFromKnowledgeBlocks() {
        const items = [];
        const blocks = document.querySelectorAll('.block-knowledge, [data-ba-component="knowledge"]');

        blocks.forEach(block => {
            // Find question text
            const questionEl = block.querySelector('.knowledge-check__question, .question-text, h3, h2');
            if (questionEl) {
                const questionText = questionEl.textContent?.trim();
                if (questionText && questionText.length > 10) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        questionType: QUESTION_TYPE.MULTIPLE_CHOICE,
                        text: questionText,
                        source: 'Rise:knowledge-block',
                        confidence: CONFIDENCE.HIGH
                    });
                }
            }

            // Find answer choices
            const choices = block.querySelectorAll('.knowledge-check__choice, .choice, [role="radio"], [role="checkbox"]');
            choices.forEach(choice => {
                const choiceText = choice.textContent?.trim();
                if (choiceText && choiceText.length > 0) {
                    const isCorrect = choice.classList.contains('correct') ||
                        choice.getAttribute('data-correct') === 'true' ||
                        choice.getAttribute('aria-checked') === 'true';

                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: choiceText,
                        correct: isCorrect,
                        source: 'Rise:knowledge-block',
                        confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
                    });
                }
            });
        });

        return items;
    },

    /**
     * Extract from Rise quiz blocks
     */
    extractFromQuizBlocks() {
        const items = [];
        const quizBlocks = document.querySelectorAll('.block-quiz, [data-ba-component="quiz"]');

        quizBlocks.forEach(block => {
            // Similar extraction to knowledge blocks
            const questionEl = block.querySelector('.quiz-question, .question');
            if (questionEl) {
                items.push({
                    type: ITEM_TYPE.QUESTION,
                    questionType: QUESTION_TYPE.MULTIPLE_CHOICE,
                    text: questionEl.textContent?.trim(),
                    source: 'Rise:quiz-block',
                    confidence: CONFIDENCE.HIGH
                });
            }

            const choices = block.querySelectorAll('.quiz-choice, .answer-choice');
            choices.forEach(choice => {
                items.push({
                    type: ITEM_TYPE.ANSWER,
                    text: choice.textContent?.trim(),
                    correct: choice.classList.contains('correct'),
                    source: 'Rise:quiz-block',
                    confidence: CONFIDENCE.MEDIUM
                });
            });
        });

        return items;
    },

    /**
     * Extract from Rise course data object
     */
    extractFromCourseData() {
        const items = [];

        // Rise sometimes exposes course data on window
        const courseData = window.__RISE_COURSE_DATA__ || window.courseData;
        if (!courseData) return items;

        try {
            // Recursively search for question/quiz content
            this.extractFromObject(courseData, items);
        } catch (e) {
            Logger.debug('Error extracting Rise course data', { error: e.message });
        }

        return items;
    },

    /**
     * Recursively extract from Rise data objects
     */
    extractFromObject(obj, items, depth = 0) {
        if (!obj || depth > 15) return;

        if (Array.isArray(obj)) {
            obj.forEach(item => this.extractFromObject(item, items, depth + 1));
            return;
        }

        if (typeof obj === 'object') {
            // Look for question structures
            if (obj.type === 'knowledge' || obj.type === 'quiz' || obj.questionText) {
                const questionText = obj.questionText || obj.question || obj.text;
                if (questionText) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        questionType: QUESTION_TYPE.MULTIPLE_CHOICE,
                        text: questionText,
                        source: 'Rise:course-data',
                        confidence: CONFIDENCE.HIGH
                    });
                }

                // Extract choices
                const choices = obj.choices || obj.answers || obj.options;
                if (Array.isArray(choices)) {
                    choices.forEach(choice => {
                        const text = choice.text || choice.label || choice;
                        if (typeof text === 'string' && text.length > 0) {
                            items.push({
                                type: ITEM_TYPE.ANSWER,
                                text: text,
                                correct: choice.correct || choice.isCorrect || false,
                                source: 'Rise:course-data',
                                confidence: CONFIDENCE.HIGH
                            });
                        }
                    });
                }
            }

            // Recurse
            Object.values(obj).forEach(value => {
                if (value && typeof value === 'object') {
                    this.extractFromObject(value, items, depth + 1);
                }
            });
        }
    }
};


export { RiseExtractor };
