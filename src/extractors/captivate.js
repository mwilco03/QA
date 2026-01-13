/**
 * Adobe Captivate Extractor
 *
 * Extracts Q&A content from Adobe Captivate courses.
 */

import { AUTHORING_TOOL, ITEM_TYPE, QUESTION_TYPE, CONFIDENCE } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const CaptivateExtractor = {
    toolId: AUTHORING_TOOL.CAPTIVATE,

    /**
     * Detect if current page is Captivate content
     * Captivate markers: cp.*, Captivate runtime variables, specific DOM patterns
     */
    detect() {
        return !!(
            window.cp ||
            window.cpAPIInterface ||
            window.cpAPIEventEmitter ||
            document.querySelector('[class*="cp-"]') ||
            document.querySelector('meta[name="generator"][content*="Captivate"]') ||
            document.querySelector('#cpMainContainer') ||
            (typeof window.cpCmndResume === 'function')
        );
    },

    /**
     * Extract Q&A from Captivate content
     */
    async extract() {
        if (!this.detect()) {
            Logger.debug('No Captivate content detected');
            return [];
        }

        Logger.info('Extracting Captivate content...');
        const items = [];

        // Method 1: Extract from cp quiz data
        items.push(...this.extractFromCPQuizData());

        // Method 2: Extract from DOM quiz slides
        items.push(...this.extractFromQuizSlides());

        // Method 3: Extract from cpInfoQuiz object
        items.push(...this.extractFromInfoQuiz());

        Logger.info(`Extracted ${items.length} items from Captivate`);
        return Utils.dedupeBy(items, item => `${item.type}:${item.text}`);
    },

    /**
     * Extract from Captivate's quiz data structure
     */
    extractFromCPQuizData() {
        const items = [];

        try {
            // Captivate stores quiz data in various locations
            const quizData = window.cpQuizInfoObject ||
                             window.cp?.QuizManager?.questionList ||
                             window.cpInfoQuiz?.questionArray;

            if (!quizData) return items;

            const questions = Array.isArray(quizData) ? quizData : Object.values(quizData);

            questions.forEach(q => {
                // Question text
                if (q.questionText || q.strQuestion) {
                    items.push({
                        type: ITEM_TYPE.QUESTION,
                        questionType: this.mapQuestionType(q.type || q.questionType),
                        text: q.questionText || q.strQuestion,
                        source: 'Captivate:quiz-data',
                        confidence: CONFIDENCE.HIGH
                    });
                }

                // Answer choices
                const choices = q.answers || q.arrAnswers || q.choices;
                if (Array.isArray(choices)) {
                    choices.forEach((choice, idx) => {
                        const text = typeof choice === 'string' ? choice : (choice.text || choice.strText);
                        const isCorrect = typeof choice === 'object'
                            ? (choice.correct || choice.bCorrect || choice.isCorrect)
                            : (q.correctAnswer === idx || q.arrCorrect?.[idx]);

                        if (text) {
                            items.push({
                                type: ITEM_TYPE.ANSWER,
                                text: text,
                                correct: !!isCorrect,
                                source: 'Captivate:quiz-data',
                                confidence: CONFIDENCE.HIGH
                            });
                        }
                    });
                }
            });
        } catch (e) {
            Logger.debug('Error extracting Captivate quiz data', { error: e.message });
        }

        return items;
    },

    /**
     * Extract from DOM quiz slides
     */
    extractFromQuizSlides() {
        const items = [];

        // Common Captivate quiz DOM patterns
        const questionContainers = document.querySelectorAll(
            '.cp-quiz-question, [class*="questiontext"], .cp_quiz_question'
        );

        questionContainers.forEach(container => {
            const questionText = container.querySelector('.cp-question-text, [class*="qtext"]');
            if (questionText) {
                items.push({
                    type: ITEM_TYPE.QUESTION,
                    text: questionText.textContent?.trim(),
                    source: 'Captivate:DOM',
                    confidence: CONFIDENCE.MEDIUM
                });
            }

            // Answer options
            const options = container.querySelectorAll(
                '.cp-quiz-option, [class*="answeroption"], .cp_radio_button, .cp_checkbox'
            );

            options.forEach(opt => {
                const text = opt.textContent?.trim() || opt.getAttribute('aria-label');
                if (text) {
                    items.push({
                        type: ITEM_TYPE.ANSWER,
                        text: text,
                        correct: opt.classList.contains('correct') ||
                                opt.getAttribute('data-correct') === 'true',
                        source: 'Captivate:DOM',
                        confidence: CONFIDENCE.MEDIUM
                    });
                }
            });
        });

        return items;
    },

    /**
     * Extract from cpInfoQuiz global object
     */
    extractFromInfoQuiz() {
        const items = [];

        if (!window.cpInfoQuiz) return items;

        try {
            const infoQuiz = window.cpInfoQuiz;

            // Extract from reporting data
            if (infoQuiz.quiz) {
                const quiz = infoQuiz.quiz;
                if (Array.isArray(quiz.questions)) {
                    quiz.questions.forEach(q => {
                        if (q.text) {
                            items.push({
                                type: ITEM_TYPE.QUESTION,
                                text: q.text,
                                source: 'Captivate:infoQuiz',
                                confidence: CONFIDENCE.HIGH
                            });
                        }
                    });
                }
            }
        } catch (e) {
            Logger.debug('Error extracting cpInfoQuiz', { error: e.message });
        }

        return items;
    },

    /**
     * Map Captivate question types to standard types
     */
    mapQuestionType(cpType) {
        const typeMap = {
            'mcq': QUESTION_TYPE.MULTIPLE_CHOICE,
            'mcqsa': QUESTION_TYPE.CHOICE,
            'mcqma': QUESTION_TYPE.MULTIPLE_CHOICE,
            'truefalse': QUESTION_TYPE.TRUE_FALSE,
            'tf': QUESTION_TYPE.TRUE_FALSE,
            'matching': QUESTION_TYPE.MATCHING,
            'sequence': QUESTION_TYPE.SEQUENCING,
            'fillin': QUESTION_TYPE.FILL_IN,
            'shortanswer': QUESTION_TYPE.FILL_IN
        };
        return typeMap[String(cpType).toLowerCase()] || QUESTION_TYPE.CHOICE;
    }
};


export { CaptivateExtractor };
