/**
 * iSpring Extractor
 *
 * Extracts Q&A content from iSpring Suite courses.
 */

import { AUTHORING_TOOL, ITEM_TYPE, QUESTION_TYPE, CONFIDENCE, PATHS } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const iSpringExtractor = {
    toolId: AUTHORING_TOOL.ISPRING,

    /**
     * Detect if current page is iSpring content
     * iSpring markers: ispring.*, specific DOM elements, runtime
     */
    detect() {
        return !!(
            window.iSpring ||
            window.ispringPresentationConnector ||
            window.PresentationSettings ||
            document.querySelector('[class*="ispring"]') ||
            document.querySelector('meta[name="generator"][content*="iSpring"]') ||
            document.querySelector('#ispring-player, .ispring-slide') ||
            document.querySelector('object[data*="ispring"], embed[src*="ispring"]')
        );
    },

    /**
     * Extract Q&A from iSpring content
     */
    async extract() {
        if (!this.detect()) {
            Logger.debug('No iSpring content detected');
            return [];
        }

        Logger.info('Extracting iSpring content...');
        const items = [];

        // Method 1: Extract from iSpring quiz module
        items.push(...this.extractFromQuizModule());

        // Method 2: Extract from presentation slides
        items.push(...this.extractFromSlides());

        // Method 3: Extract from iSpring data.js
        items.push(...this.extractFromDataJS());

        Logger.info(`Extracted ${items.length} items from iSpring`);
        return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
    },

    /**
     * Extract from iSpring Quiz module
     */
    extractFromQuizModule() {
        const items = [];

        try {
            // iSpring stores quiz data in various locations
            const quizModule = window.iSpring?.quiz ||
                               window.QuizModule ||
                               window.ispringQuiz;

            if (!quizModule) return items;

            const questions = quizModule.questions || quizModule.getQuestions?.() || [];

            questions.forEach(q => {
                const questionText = q.text || q.questionText || q.stem;
                if (questionText) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        questionType: this.mapQuestionType(q.type),
                        text: questionText,
                        source: 'iSpring:quiz-module',
                        confidence: CONFIDENCE.HIGH
                    });
                }

                // Answer choices
                const answers = q.answers || q.choices || q.options;
                if (Array.isArray(answers)) {
                    answers.forEach(ans => {
                        const text = typeof ans === 'string' ? ans : (ans.text || ans.label);
                        if (text) {
                            items.push({
                                type: ITEM_TYPE.ANSWER,
                                text: text,
                                correct: ans.correct || ans.isCorrect || false,
                                source: 'iSpring:quiz-module',
                                confidence: CONFIDENCE.HIGH
                            });
                        }
                    });
                }
            });
        } catch (e) {
            Logger.debug('Error extracting iSpring quiz module', { error: e.message });
        }

        return items;
    },

    /**
     * Extract from iSpring presentation slides
     */
    extractFromSlides() {
        const items = [];

        // Look for quiz slides in DOM
        const quizSlides = document.querySelectorAll(
            '.quiz-slide, [class*="quiz"], .ispring-quiz-container'
        );

        quizSlides.forEach(slide => {
            // Question text
            const qText = slide.querySelector(
                '.question-text, [class*="question"], .quiz-question'
            );
            if (qText) {
                items.push({
                    type: ITEM_TYPE.QUESTION,
                    text: qText.textContent?.trim(),
                    source: 'iSpring:slides',
                    confidence: CONFIDENCE.MEDIUM
                });
            }

            // Answer options
            const options = slide.querySelectorAll(
                '.answer-option, [class*="choice"], input[type="radio"] + span'
            );

            options.forEach(opt => {
                const text = opt.textContent?.trim();
                if (text) {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: text,
                        correct: opt.classList.contains('correct') ||
                                opt.getAttribute('data-correct') === 'true',
                        source: 'iSpring:slides',
                        confidence: CONFIDENCE.MEDIUM
                    });
                }
            });
        });

        return items;
    },

    /**
     * Extract from iSpring data.js file
     */
    extractFromDataJS() {
        const items = [];

        try {
            // iSpring sometimes exposes data through PresentationSettings
            const settings = window.PresentationSettings || window.presentationData;
            if (!settings) return items;

            // Look for quiz data in settings
            if (settings.quizzes || settings.quiz) {
                const quizzes = settings.quizzes || [settings.quiz];
                quizzes.forEach(quiz => {
                    if (quiz.questions) {
                        quiz.questions.forEach(q => {
                            if (q.text) {
                                items.push({
                                    type: ITEM_TYPE.QUESTION,
                                    text: q.text,
                                    source: 'iSpring:data.js',
                                    confidence: CONFIDENCE.HIGH
                                });
                            }
                        });
                    }
                });
            }
        } catch (e) {
            Logger.debug('Error extracting iSpring data.js', { error: e.message });
        }

        return items;
    },

    /**
     * Map iSpring question types to standard types
     */
    mapQuestionType(ispringType) {
        const typeMap = {
            'multiple_choice': QUESTION_TYPE.CHOICE,
            'multiple_response': QUESTION_TYPE.MULTIPLE_CHOICE,
            'true_false': QUESTION_TYPE.TRUE_FALSE,
            'matching': QUESTION_TYPE.MATCHING,
            'sequence': QUESTION_TYPE.SEQUENCING,
            'fill_blank': QUESTION_TYPE.FILL_IN,
            'numeric': QUESTION_TYPE.FILL_IN,
            'hotspot': QUESTION_TYPE.CHOICE
        };
        return typeMap[String(ispringType).toLowerCase()] || QUESTION_TYPE.CHOICE;
    }
};

// Register extractors

export { iSpringExtractor };
