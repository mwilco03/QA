/**
 * DOM Quiz Extractor
 *
 * Extracts Q&A from generic DOM-based quizzes (forms, radio buttons, checkboxes).
 */

import { ITEM_TYPE, QUESTION_TYPE, CONFIDENCE, CORRECT_INDICATORS, PLACEHOLDER_TEXT } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const DOMQuizExtractor = {
    extract() {
        Logger.info('Extracting DOM quizzes...');
        const quizzes = [];
        const processed = new Set();

        this.processDocument(document, null, quizzes, processed);
        
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc) {
                    this.processDocument(doc, iframe, quizzes, processed);
                }
            } catch (e) { /* Cross-origin */ }
        });

        Logger.info(`Found ${quizzes.length} DOM quizzes`);
        return quizzes;
    },

    processDocument(doc, iframe, quizzes, processed) {
        const correctSelectors = [
            'option[value="true"]', 'option[value="correct"]', 'option[value="1"]',
            'input[type="radio"][value="true"]', 'input[type="radio"][value="correct"]',
            'input[type="checkbox"][value="true"]', 'input[type="checkbox"][value="correct"]',
            '[data-correct="true"]', '[data-answer="true"]'
        ].join(',');

        doc.querySelectorAll(correctSelectors).forEach(el => {
            if (el.tagName === 'OPTION') {
                const select = el.closest('select');
                if (select && !processed.has(select)) {
                    processed.add(select);
                    const quiz = this.extractSelect(select, doc, iframe);
                    if (quiz) quizzes.push(quiz);
                }
            } else if (el.tagName === 'INPUT') {
                if (el.type === 'radio' && el.name) {
                    const key = `radio:${el.name}`;
                    if (!processed.has(key)) {
                        processed.add(key);
                        const quiz = this.extractRadioGroup(doc, el.name, iframe);
                        if (quiz) quizzes.push(quiz);
                    }
                } else if (el.type === 'checkbox') {
                    if (!processed.has(el)) {
                        processed.add(el);
                        const quiz = this.extractCheckbox(el, doc, iframe);
                        if (quiz) quizzes.push(quiz);
                    }
                }
            }
        });
    },

    extractSelect(select, doc, iframe) {
        const questionId = select.id || select.name || Utils.generateId('select');
        const questionText = this.findQuestionText(select, doc);
        
        const answers = [];
        Array.from(select.options).forEach(option => {
            const text = option.textContent.trim();
            if (Utils.isPlaceholder(text)) return;

            answers.push({
                text,
                correct: Utils.isCorrectAnswer(option),
                value: option.value,
                element: option
            });
        });

        if (answers.length === 0) return null;

        return { type: 'select', questionId, questionText, answers, selectElement: select, iframe };
    },

    extractRadioGroup(doc, groupName, iframe) {
        const radios = doc.querySelectorAll(`input[type="radio"][name="${groupName}"]`);
        if (radios.length === 0) return null;

        const questionText = this.findQuestionText(radios[0], doc);
        const answers = [];

        radios.forEach(radio => {
            const text = this.findLabelText(radio, doc) || radio.value;
            answers.push({
                text,
                correct: Utils.isCorrectAnswer(radio),
                value: radio.value,
                element: radio
            });
        });

        return { type: 'radio', questionId: groupName, questionText, answers, iframe };
    },

    extractCheckbox(checkbox, doc, iframe) {
        const text = this.findLabelText(checkbox, doc) || checkbox.value;
        const questionText = this.findQuestionText(checkbox, doc);

        return {
            type: 'checkbox',
            questionId: checkbox.id || checkbox.name || Utils.generateId('cb'),
            questionText,
            answers: [{
                text,
                correct: Utils.isCorrectAnswer(checkbox),
                value: checkbox.value,
                element: checkbox
            }],
            iframe
        };
    },

    findQuestionText(element, doc) {
        if (element.id) {
            const label = doc.querySelector(`label[for="${element.id}"]`);
            if (label) return label.textContent.trim();
        }

        const container = element.closest('.question, .form-group, .quiz-item, fieldset, [class*="question"]');
        if (container) {
            const textEl = container.querySelector('label, legend, .question-text, p:first-child');
            if (textEl && textEl !== element.parentElement) {
                return textEl.textContent.trim();
            }
        }

        return '';
    },

    findLabelText(input, doc) {
        if (input.id) {
            const label = doc.querySelector(`label[for="${input.id}"]`);
            if (label) return label.textContent.trim();
        }

        const parentLabel = input.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();

        const next = input.nextSibling;
        if (next) {
            if (next.nodeType === Node.TEXT_NODE) {
                return next.textContent.trim();
            }
            if (next.nodeType === Node.ELEMENT_NODE) {
                return next.textContent.trim();
            }
        }

        return '';
    },

    autoSelect() {
        Logger.info('Auto-selecting correct answers...');
        let count = 0;

        const quizzes = this.extract();

        quizzes.forEach(quiz => {
            quiz.answers.forEach(answer => {
                if (!answer.correct) return;

                try {
                    if (quiz.type === 'select' && quiz.selectElement) {
                        const optionIndex = Array.from(quiz.selectElement.options)
                            .findIndex(opt => opt.value === answer.value);
                        
                        if (optionIndex >= 0) {
                            quiz.selectElement.selectedIndex = optionIndex;
                            quiz.selectElement.dispatchEvent(new Event('change', { bubbles: true }));
                            quiz.selectElement.dispatchEvent(new Event('input', { bubbles: true }));
                            count++;
                            Logger.debug(`Selected: "${answer.text}"`);
                        }
                    } else if (quiz.type === 'radio' || quiz.type === 'checkbox') {
                        if (answer.element && !answer.element.checked) {
                            answer.element.checked = true;
                            answer.element.dispatchEvent(new Event('change', { bubbles: true }));
                            answer.element.dispatchEvent(new Event('click', { bubbles: true }));
                            count++;
                            Logger.debug(`Checked: "${answer.text}"`);
                        }
                    }
                } catch (error) {
                    Logger.warn(`Failed to select: ${error.message}`);
                }
            });
        });

        Logger.info(`Auto-selected ${count} answers`);
        return count;
    },

    toQAItems(quizzes) {
        const items = [];

        quizzes.forEach(quiz => {
            if (quiz.questionText) {
                items.push({
                    type: ITEM_TYPE.QUESTION,
                    text: quiz.questionText,
                    source: `DOM:${quiz.type}:${quiz.questionId}`,
                    confidence: CONFIDENCE.HIGH
                });
            }

            quiz.answers.forEach(answer => {
                items.push({
                    type: ITEM_TYPE.ANSWER,
                    text: answer.text,
                    correct: answer.correct,
                    source: `DOM:${quiz.type}:${quiz.questionId}`,
                    confidence: answer.correct ? CONFIDENCE.VERY_HIGH : CONFIDENCE.MEDIUM
                });
            });
        });

        return items;
    }
};


export { DOMQuizExtractor };
