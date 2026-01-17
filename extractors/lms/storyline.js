/**
 * LMS QA Validator - Articulate Storyline Extractor
 *
 * Implements Directive #8: Isolate LMS-Specific Logic
 * Storyline quirks don't leak into generic extraction logic.
 *
 * @fileoverview Storyline-specific extraction
 */

'use strict';

// Import dependencies (in browser, these are on window)
const { DOMExtractor, ExtractorCapability, createDetectionResult } =
    typeof window !== 'undefined' ? window.LMSQAExtractors : require('../base.js');
const { createQuestion, createAnswer, Confidence, ExtractionSource, QuestionType } =
    typeof window !== 'undefined' ? window.LMSQATypes : require('../../core/types.js');
const { normalizeText, isPlaceholder } =
    typeof window !== 'undefined' ? window.LMSQANormalize : require('../../core/normalize.js');
const { isQuestion, isNaturalLanguage, isCorrectAnswer } =
    typeof window !== 'undefined' ? window.LMSQARules : require('../../core/rules.js');

/**
 * Storyline-specific detection globals
 */
const STORYLINE_GLOBALS = [
    'DS',               // Data Store
    'g_slideData',      // Slide data
    'Player',           // Storyline Player
    'cpAPIInterface'    // Some versions
];

/**
 * Storyline Extractor
 * Handles Articulate Storyline 360/3/2 content
 */
class StorylineExtractor extends DOMExtractor {
    constructor() {
        super({
            name: 'storyline',
            description: 'Articulate Storyline Extractor',
            priority: 10,  // High priority - specific tool detection
            capabilities: [
                ExtractorCapability.QUESTIONS,
                ExtractorCapability.ANSWERS,
                ExtractorCapability.CORRECT_ANSWERS,
                ExtractorCapability.SCORM_API
            ]
        });
    }

    /**
     * Detect Storyline content
     */
    async detect(session, logger) {
        logger.info('Checking for Storyline indicators...');

        // Check for Storyline globals
        for (const global of STORYLINE_GLOBALS) {
            if (this.hasGlobal(global)) {
                logger.decision(
                    'detection',
                    'storyline',
                    'DETECTED',
                    `Found global: ${global}`,
                    { global }
                );
                return createDetectionResult(true, Confidence.VERY_HIGH, `Found window.${global}`);
            }
        }

        // Check for Storyline-specific DOM elements
        const accShadow = this.querySelector('.acc-shadow-dom');
        if (accShadow) {
            return createDetectionResult(true, Confidence.HIGH, 'Found .acc-shadow-dom element');
        }

        // Check for Storyline frames
        const storyFrame = this.querySelector('#slide-window, #slide-container');
        if (storyFrame) {
            return createDetectionResult(true, Confidence.MEDIUM, 'Found Storyline frame container');
        }

        // Check for globalProvideData function (Storyline pattern)
        if (typeof window.globalProvideData === 'function') {
            return createDetectionResult(true, Confidence.HIGH, 'Found globalProvideData function');
        }

        return createDetectionResult(false, 0, 'No Storyline indicators found');
    }

    /**
     * Extract Q&A from Storyline content
     */
    async extract(session, logger) {
        logger.info('Starting Storyline extraction...');
        const questions = [];
        const answers = [];
        const apis = [];

        // Try multiple extraction strategies
        const strategies = [
            () => this.extractFromSlideData(logger),
            () => this.extractFromAccessibilityDOM(logger),
            () => this.extractFromDS(logger)
        ];

        for (const strategy of strategies) {
            try {
                const result = await strategy();
                if (result.questions.length > 0) {
                    questions.push(...result.questions);
                    answers.push(...result.answers);
                    logger.decision(
                        'extractor',
                        'storyline',
                        'EXTRACTED',
                        `Found ${result.questions.length} questions`,
                        { strategy: strategy.name }
                    );
                }
            } catch (error) {
                logger.warn(`Storyline extraction strategy failed: ${error.message}`);
            }
        }

        // Deduplicate
        const uniqueQuestions = this.deduplicateQuestions(questions);
        const uniqueAnswers = this.deduplicateAnswers(answers);

        logger.info(`Storyline extraction complete: ${uniqueQuestions.length} questions`);

        return {
            questions: uniqueQuestions,
            answers: uniqueAnswers,
            apis
        };
    }

    /**
     * Extract from g_slideData global
     */
    extractFromSlideData(logger) {
        const questions = [];
        const answers = [];

        const slideData = this.getGlobal('g_slideData');
        if (!slideData) {
            logger.debug('No g_slideData found');
            return { questions, answers };
        }

        logger.debug('Extracting from g_slideData...');

        // Storyline stores quiz data in various structures
        const processSlide = (slide, slideIndex) => {
            if (!slide) return;

            // Check for quiz interactions
            if (slide.interactions) {
                for (const interaction of Object.values(slide.interactions)) {
                    const q = this.parseInteraction(interaction, slideIndex, logger);
                    if (q) {
                        questions.push(q.question);
                        answers.push(...q.answers);
                    }
                }
            }

            // Check for question data
            if (slide.questionData || slide.quizData) {
                const qData = slide.questionData || slide.quizData;
                const q = this.parseQuestionData(qData, slideIndex, logger);
                if (q) {
                    questions.push(q.question);
                    answers.push(...q.answers);
                }
            }
        };

        // Process all slides
        if (Array.isArray(slideData)) {
            slideData.forEach((slide, i) => processSlide(slide, i));
        } else if (typeof slideData === 'object') {
            Object.values(slideData).forEach((slide, i) => processSlide(slide, i));
        }

        return { questions, answers };
    }

    /**
     * Extract from accessibility shadow DOM
     */
    extractFromAccessibilityDOM(logger) {
        const questions = [];
        const answers = [];

        // Storyline uses accessibility shadow DOM for screen readers
        const accContainer = this.querySelector('.acc-shadow-dom');
        if (!accContainer) {
            return { questions, answers };
        }

        logger.debug('Extracting from accessibility DOM...');

        // Find question text elements
        const questionElements = this.querySelectorAll(
            '[data-acc-type="question"], .acc-question, [role="heading"]',
            accContainer
        );

        questionElements.forEach((el, index) => {
            const text = normalizeText(el.textContent);
            if (!text || !isNaturalLanguage(text).passed) return;

            const questionResult = isQuestion(text);
            if (!questionResult.passed && questionResult.confidence < 50) return;

            const question = createQuestion({
                text,
                type: QuestionType.CHOICE,
                source: ExtractionSource.DOM,
                confidence: questionResult.confidence,
                metadata: { slideIndex: index, extractedFrom: 'acc-shadow-dom' }
            });

            // Find associated answers
            const answerContainer = el.nextElementSibling;
            if (answerContainer) {
                const answerEls = this.querySelectorAll(
                    '[data-acc-type="answer"], .acc-answer, [role="option"]',
                    answerContainer
                );

                answerEls.forEach(answerEl => {
                    const answerText = normalizeText(answerEl.textContent);
                    if (!answerText || isPlaceholder(answerText)) return;

                    // Check for correct indicator
                    const correctResult = isCorrectAnswer({
                        value: answerEl.getAttribute('data-correct'),
                        dataAttrs: answerEl.dataset,
                        classes: Array.from(answerEl.classList)
                    });

                    const answer = createAnswer({
                        text: answerText,
                        isCorrect: correctResult.passed,
                        source: ExtractionSource.DOM,
                        confidence: correctResult.confidence
                    });

                    question.answers.push(answer);
                    answers.push(answer);

                    if (correctResult.passed) {
                        question.correctAnswerId = answer.id;
                    }
                });
            }

            if (question.answers.length > 0) {
                questions.push(question);
            }
        });

        return { questions, answers };
    }

    /**
     * Extract from DS (Data Store) global
     */
    extractFromDS(logger) {
        const questions = [];
        const answers = [];

        const DS = this.getGlobal('DS');
        if (!DS) {
            return { questions, answers };
        }

        logger.debug('Extracting from DS (Data Store)...');

        // DS contains various data structures
        const searchDS = (obj, path = '') => {
            if (!obj || typeof obj !== 'object') return;

            // Look for quiz-related keys
            for (const [key, value] of Object.entries(obj)) {
                const lowerKey = key.toLowerCase();

                if (lowerKey.includes('question') || lowerKey.includes('quiz') || lowerKey.includes('assess')) {
                    if (typeof value === 'string' && isNaturalLanguage(value).passed) {
                        const questionResult = isQuestion(value);
                        if (questionResult.passed) {
                            questions.push(createQuestion({
                                text: normalizeText(value),
                                source: ExtractionSource.PATTERN,
                                confidence: questionResult.confidence,
                                metadata: { path: `${path}.${key}` }
                            }));
                        }
                    }
                }

                if (typeof value === 'object') {
                    searchDS(value, `${path}.${key}`);
                }
            }
        };

        searchDS(DS);

        return { questions, answers };
    }

    /**
     * Parse Storyline interaction object
     */
    parseInteraction(interaction, slideIndex, logger) {
        if (!interaction) return null;

        const questionText = normalizeText(
            interaction.question || interaction.prompt || interaction.text
        );

        if (!questionText || !isNaturalLanguage(questionText).passed) return null;

        const question = createQuestion({
            text: questionText,
            type: this.mapInteractionType(interaction.type),
            source: ExtractionSource.PATTERN,
            confidence: Confidence.HIGH,
            metadata: {
                slideIndex,
                interactionId: interaction.id,
                originalType: interaction.type
            }
        });

        const answers = [];

        // Extract choices
        const choices = interaction.choices || interaction.options || interaction.answers || [];
        choices.forEach((choice, i) => {
            const choiceText = normalizeText(
                typeof choice === 'string' ? choice : (choice.text || choice.label)
            );

            if (!choiceText || isPlaceholder(choiceText)) return;

            const isCorrect = choice.correct === true ||
                              choice.isCorrect === true ||
                              interaction.correctAnswer === i ||
                              interaction.correctAnswers?.includes(i);

            const answer = createAnswer({
                text: choiceText,
                isCorrect,
                source: ExtractionSource.PATTERN,
                confidence: Confidence.HIGH
            });

            question.answers.push(answer);
            answers.push(answer);

            if (isCorrect) {
                question.correctAnswerId = answer.id;
            }
        });

        return question.answers.length > 0 ? { question, answers } : null;
    }

    /**
     * Parse Storyline question data object
     */
    parseQuestionData(qData, slideIndex, logger) {
        if (!qData) return null;

        // Similar to parseInteraction but handles different structure
        const questionText = normalizeText(
            qData.questionText || qData.stem || qData.prompt
        );

        if (!questionText) return null;

        const question = createQuestion({
            text: questionText,
            type: QuestionType.CHOICE,
            source: ExtractionSource.PATTERN,
            confidence: Confidence.HIGH,
            metadata: { slideIndex }
        });

        return { question, answers: [] };
    }

    /**
     * Map Storyline interaction type to standard type
     */
    mapInteractionType(storylineType) {
        const typeMap = {
            'choice': QuestionType.CHOICE,
            'multichoice': QuestionType.MULTIPLE_CHOICE,
            'truefalse': QuestionType.TRUE_FALSE,
            'fillin': QuestionType.FILL_IN,
            'matching': QuestionType.MATCHING,
            'sequence': QuestionType.SEQUENCING,
            'hotspot': QuestionType.HOTSPOT,
            'dragdrop': QuestionType.DRAG_DROP
        };

        return typeMap[String(storylineType).toLowerCase()] || QuestionType.OTHER;
    }

    /**
     * Deduplicate questions by text
     */
    deduplicateQuestions(questions) {
        const seen = new Set();
        return questions.filter(q => {
            const key = q.text.toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Deduplicate answers by text
     */
    deduplicateAnswers(answers) {
        const seen = new Set();
        return answers.filter(a => {
            const key = a.text.toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StorylineExtractor };
}

if (typeof window !== 'undefined') {
    window.LMSQAStoryline = { StorylineExtractor };
}
