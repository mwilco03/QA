/**
 * LMS QA Validator - Generic DOM Extractor
 *
 * Fallback extractor for content that doesn't match specific LMS tools.
 * Uses heuristics to find Q&A patterns in generic HTML.
 *
 * @fileoverview Generic heuristic-based extraction
 */

'use strict';

// Import dependencies
const { DOMExtractor, ExtractorCapability, createDetectionResult } =
    typeof window !== 'undefined' ? window.LMSQAExtractors : require('../base.js');
const { createQuestion, createAnswer, Confidence, ExtractionSource, QuestionType } =
    typeof window !== 'undefined' ? window.LMSQATypes : require('../../core/types.js');
const { normalizeText, isPlaceholder, extractFormOptions, getElementText, isElementVisible } =
    typeof window !== 'undefined' ? window.LMSQANormalize : require('../../core/normalize.js');
const { isQuestion, isNaturalLanguage, isCorrectAnswer, hasMinimumContent } =
    typeof window !== 'undefined' ? window.LMSQARules : require('../../core/rules.js');

/**
 * Common question container selectors
 */
const QUESTION_SELECTORS = [
    // Explicit quiz/question markers
    '[data-question]',
    '[data-quiz-question]',
    '.question',
    '.quiz-question',
    '.assessment-question',

    // Form-based questions
    'fieldset:has(legend)',
    '.form-group:has(label)',

    // Generic containers with form elements
    'div:has(select)',
    'div:has(input[type="radio"])',
    'div:has(input[type="checkbox"])',

    // List-based questions
    'ol > li:has(input)',
    'ul > li:has(input)'
];

/**
 * Common answer selectors
 */
const ANSWER_SELECTORS = [
    // Explicit answer markers
    '[data-answer]',
    '.answer',
    '.choice',
    '.option',

    // Form elements
    'select option',
    'input[type="radio"]',
    'input[type="checkbox"]',

    // Label associations
    'label:has(input[type="radio"])',
    'label:has(input[type="checkbox"])'
];

/**
 * Generic DOM Extractor
 * Heuristic-based extraction for any HTML content
 */
class GenericExtractor extends DOMExtractor {
    constructor() {
        super({
            name: 'generic',
            description: 'Generic DOM Heuristic Extractor',
            priority: 90,  // Low priority - fallback
            capabilities: [
                ExtractorCapability.QUESTIONS,
                ExtractorCapability.ANSWERS
            ]
        });
    }

    /**
     * Generic extractor always applies (it's a fallback)
     */
    async detect(session, logger) {
        // Check if page has any form elements that might be Q&A
        const formElements = this.querySelectorAll(
            'select, input[type="radio"], input[type="checkbox"]'
        );

        if (formElements.length === 0) {
            return createDetectionResult(
                false,
                Confidence.VERY_LOW,
                'No form elements found'
            );
        }

        // Check if there's potential question content
        const potentialQuestions = this.findPotentialQuestions();

        if (potentialQuestions.length === 0) {
            return createDetectionResult(
                true,  // Still apply, but low confidence
                Confidence.LOW,
                `Found ${formElements.length} form elements but no clear questions`
            );
        }

        return createDetectionResult(
            true,
            Confidence.MEDIUM,
            `Found ${potentialQuestions.length} potential questions`
        );
    }

    /**
     * Extract Q&A using heuristics
     */
    async extract(session, logger) {
        logger.info('Starting generic extraction...');

        const questions = [];
        const answers = [];

        // Strategy 1: Find explicit question containers
        const explicitQuestions = this.extractExplicitQuestions(logger);
        questions.push(...explicitQuestions.questions);
        answers.push(...explicitQuestions.answers);

        // Strategy 2: Find form-based questions
        const formQuestions = this.extractFormQuestions(logger);
        questions.push(...formQuestions.questions);
        answers.push(...formQuestions.answers);

        // Strategy 3: Proximity-based grouping
        const proximityQuestions = this.extractByProximity(logger);
        questions.push(...proximityQuestions.questions);
        answers.push(...proximityQuestions.answers);

        // Deduplicate
        const uniqueQuestions = this.deduplicateQuestions(questions);

        logger.info(`Generic extraction complete: ${uniqueQuestions.length} questions`);

        return {
            questions: uniqueQuestions,
            answers,
            apis: []
        };
    }

    /**
     * Find potential question elements
     */
    findPotentialQuestions() {
        const potential = [];

        // Check for elements that might contain questions
        const textElements = this.querySelectorAll('p, div, span, label, legend, h1, h2, h3, h4, h5, h6');

        for (const el of textElements) {
            if (!isElementVisible(el)) continue;

            const text = getElementText(el, { recursive: false });
            if (!text) continue;

            const questionResult = isQuestion(text);
            if (questionResult.passed || questionResult.confidence > 40) {
                potential.push({
                    element: el,
                    text,
                    confidence: questionResult.confidence
                });
            }
        }

        return potential;
    }

    /**
     * Extract from explicit question containers
     */
    extractExplicitQuestions(logger) {
        const questions = [];
        const answers = [];

        for (const selector of QUESTION_SELECTORS) {
            try {
                const containers = this.querySelectorAll(selector);

                for (const container of containers) {
                    const result = this.extractFromContainer(container, logger);
                    if (result) {
                        questions.push(result.question);
                        answers.push(...result.answers);
                    }
                }
            } catch (e) {
                // Selector might not be supported
            }
        }

        return { questions, answers };
    }

    /**
     * Extract from form elements
     */
    extractFormQuestions(logger) {
        const questions = [];
        const answers = [];

        // Find all select elements
        const selects = this.querySelectorAll('select');
        for (const select of selects) {
            const result = this.extractFromSelect(select, logger);
            if (result) {
                questions.push(result.question);
                answers.push(...result.answers);
            }
        }

        // Find radio/checkbox groups
        const radioGroups = this.findRadioGroups();
        for (const group of radioGroups) {
            const result = this.extractFromRadioGroup(group, logger);
            if (result) {
                questions.push(result.question);
                answers.push(...result.answers);
            }
        }

        return { questions, answers };
    }

    /**
     * Extract using proximity-based grouping
     */
    extractByProximity(logger) {
        const questions = [];
        const answers = [];

        // Find all text that looks like questions
        const potentialQuestions = this.findPotentialQuestions();

        for (const pq of potentialQuestions) {
            // Look for form elements near this question
            const nearbyAnswers = this.findNearbyAnswers(pq.element);

            if (nearbyAnswers.length > 0) {
                const question = createQuestion({
                    text: pq.text,
                    type: this.inferQuestionType(nearbyAnswers),
                    source: ExtractionSource.HEURISTIC,
                    confidence: Math.min(pq.confidence, Confidence.MEDIUM),
                    metadata: { extractedBy: 'proximity' }
                });

                for (const na of nearbyAnswers) {
                    const answer = createAnswer({
                        text: na.text,
                        isCorrect: na.isCorrect,
                        source: ExtractionSource.HEURISTIC,
                        confidence: na.confidence
                    });

                    question.answers.push(answer);
                    answers.push(answer);
                }

                if (question.answers.length > 0) {
                    questions.push(question);
                }
            }
        }

        return { questions, answers };
    }

    /**
     * Extract Q&A from a container element
     */
    extractFromContainer(container, logger) {
        if (!isElementVisible(container)) return null;

        // Find question text
        const questionText = this.findQuestionText(container);
        if (!questionText) return null;

        const questionResult = isQuestion(questionText);
        if (!questionResult.passed && questionResult.confidence < 40) return null;

        const question = createQuestion({
            text: questionText,
            type: QuestionType.CHOICE,
            source: ExtractionSource.DOM,
            confidence: questionResult.confidence
        });

        const answers = [];

        // Find answers within container
        const options = extractFormOptions(container);
        for (const opt of options) {
            const answer = createAnswer({
                text: opt.text,
                isCorrect: opt.isSelected,  // Might be correct if pre-selected
                source: ExtractionSource.DOM,
                confidence: Confidence.MEDIUM
            });

            question.answers.push(answer);
            answers.push(answer);
        }

        return question.answers.length > 0 ? { question, answers } : null;
    }

    /**
     * Extract from select element
     */
    extractFromSelect(select, logger) {
        if (!isElementVisible(select)) return null;

        // Find associated label/question
        const questionText = this.findLabelFor(select);
        if (!questionText) return null;

        const questionResult = isQuestion(questionText);
        if (!questionResult.passed && questionResult.confidence < 40) return null;

        const question = createQuestion({
            text: questionText,
            type: QuestionType.CHOICE,
            source: ExtractionSource.DOM,
            confidence: questionResult.confidence
        });

        const answers = [];

        // Extract options
        for (const option of select.options) {
            const text = normalizeText(option.text);
            if (!text || isPlaceholder(text)) continue;

            const answer = createAnswer({
                text,
                isCorrect: option.selected,
                source: ExtractionSource.DOM,
                confidence: Confidence.MEDIUM
            });

            question.answers.push(answer);
            answers.push(answer);
        }

        return question.answers.length > 1 ? { question, answers } : null;
    }

    /**
     * Find radio button groups
     */
    findRadioGroups() {
        const groups = new Map();

        const radios = this.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
            const name = radio.name;
            if (!name) continue;

            if (!groups.has(name)) {
                groups.set(name, []);
            }
            groups.get(name).push(radio);
        }

        return Array.from(groups.values()).filter(g => g.length > 1);
    }

    /**
     * Extract from radio button group
     */
    extractFromRadioGroup(radios, logger) {
        // Find container that holds all radios
        const container = this.findCommonAncestor(radios);
        if (!container) return null;

        // Find question text
        const questionText = this.findQuestionText(container) ||
                            this.findLabelFor(radios[0]);
        if (!questionText) return null;

        const questionResult = isQuestion(questionText);
        if (!questionResult.passed && questionResult.confidence < 40) return null;

        const question = createQuestion({
            text: questionText,
            type: QuestionType.CHOICE,
            source: ExtractionSource.DOM,
            confidence: questionResult.confidence
        });

        const answers = [];

        for (const radio of radios) {
            const text = this.findLabelFor(radio);
            if (!text || isPlaceholder(text)) continue;

            // Check for correct indicators
            const correctResult = isCorrectAnswer({
                value: radio.value,
                dataAttrs: radio.dataset,
                classes: Array.from(radio.classList)
            });

            const answer = createAnswer({
                text,
                isCorrect: correctResult.passed,
                source: ExtractionSource.DOM,
                confidence: correctResult.passed ? correctResult.confidence : Confidence.MEDIUM
            });

            question.answers.push(answer);
            answers.push(answer);

            if (correctResult.passed) {
                question.correctAnswerId = answer.id;
            }
        }

        return question.answers.length > 1 ? { question, answers } : null;
    }

    /**
     * Find question text within container
     */
    findQuestionText(container) {
        // Look for common question elements
        const candidates = [
            container.querySelector('legend'),
            container.querySelector('label'),
            container.querySelector('h1, h2, h3, h4, h5, h6'),
            container.querySelector('p'),
            container.querySelector('[data-question]'),
            container.querySelector('.question-text')
        ].filter(Boolean);

        for (const el of candidates) {
            const text = getElementText(el, { recursive: false });
            if (text && hasMinimumContent(text).passed) {
                return text;
            }
        }

        return null;
    }

    /**
     * Find label for element
     */
    findLabelFor(element) {
        if (!element) return null;

        // Check for associated label
        if (element.labels && element.labels.length > 0) {
            return getElementText(element.labels[0]);
        }

        // Check for label with matching 'for' attribute
        if (element.id) {
            const label = this.querySelector(`label[for="${element.id}"]`);
            if (label) {
                return getElementText(label);
            }
        }

        // Check parent label
        const parentLabel = element.closest('label');
        if (parentLabel) {
            return getElementText(parentLabel);
        }

        // Check adjacent text
        const parent = element.parentElement;
        if (parent) {
            const text = normalizeText(parent.textContent);
            if (text && text !== normalizeText(element.textContent)) {
                return text;
            }
        }

        return null;
    }

    /**
     * Find common ancestor of elements
     */
    findCommonAncestor(elements) {
        if (!elements || elements.length === 0) return null;
        if (elements.length === 1) return elements[0].parentElement;

        let ancestor = elements[0].parentElement;
        while (ancestor) {
            if (elements.every(el => ancestor.contains(el))) {
                return ancestor;
            }
            ancestor = ancestor.parentElement;
        }

        return null;
    }

    /**
     * Find answers near a question element
     */
    findNearbyAnswers(questionEl) {
        const answers = [];
        const maxDistance = 5;  // Maximum DOM nodes to traverse

        // Look for form elements in siblings/descendants
        let current = questionEl.nextElementSibling;
        let distance = 0;

        while (current && distance < maxDistance) {
            const formOptions = extractFormOptions(current);
            if (formOptions.length > 0) {
                for (const opt of formOptions) {
                    answers.push({
                        text: opt.text,
                        isCorrect: false,
                        confidence: Confidence.LOW
                    });
                }
                break;
            }

            current = current.nextElementSibling;
            distance++;
        }

        return answers;
    }

    /**
     * Infer question type from answers
     */
    inferQuestionType(answers) {
        if (answers.length === 2) {
            const texts = answers.map(a => a.text.toLowerCase());
            if (texts.includes('true') && texts.includes('false')) {
                return QuestionType.TRUE_FALSE;
            }
        }

        return QuestionType.CHOICE;
    }

    /**
     * Deduplicate questions by text
     */
    deduplicateQuestions(questions) {
        const seen = new Set();
        return questions.filter(q => {
            const key = q.text.toLowerCase().trim().substring(0, 100);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GenericExtractor };
}

if (typeof window !== 'undefined') {
    window.LMSQAGeneric = { GenericExtractor };
}
