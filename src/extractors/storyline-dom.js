/**
 * Storyline DOM Extractor
 *
 * Extracts Q&A from Storyline accessibility DOM elements.
 */

import { AUTHORING_TOOL, ITEM_TYPE, QUESTION_TYPE, CONFIDENCE } from '../core/constants.js';
import { Logger } from '../core/logger.js';
import { Utils } from '../core/utils.js';

const StorylineDOMExtractor = {
    /**
     * Check if this page contains Storyline accessibility DOM
     */
    isStorylinePage() {
        // Check for Storyline markers
        return !!(
            document.querySelector('.slide-object[data-acc-text]') ||
            document.querySelector('.acc-shadow-dom') ||
            document.querySelector('[class*="slide-object-"]') ||
            document.querySelector('svg.vector-slide-content') ||
            window.DS || // Storyline runtime
            window.globalProvideData
        );
    },

    /**
     * Extract Q&A from all documents (main + iframes)
     */
    extract() {
        if (!this.isStorylinePage()) {
            Logger.debug('No Storyline accessibility DOM detected');
            return [];
        }

        Logger.info('Extracting from Storyline accessibility DOM...');
        const items = [];

        // Process main document
        items.push(...this.extractFromDocument(document));

        // Process iframes (Storyline often runs in an iframe)
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc) {
                    items.push(...this.extractFromDocument(doc));
                }
            } catch (e) { /* Cross-origin */ }
        });

        Logger.info(`Extracted ${items.length} items from Storyline DOM`);
        return items;
    },

    /**
     * Extract from a single document
     */
    extractFromDocument(doc) {
        const items = [];
        const processed = new Set();

        // Method 1: Extract from data-acc-text attributes (most reliable)
        items.push(...this.extractFromAccText(doc, processed));

        // Method 2: Extract from accessibility shadow elements
        items.push(...this.extractFromAccShadow(doc, processed));

        // Method 3: Extract from aria-labeled elements
        items.push(...this.extractFromAriaLabels(doc, processed));

        return items;
    },

    /**
     * Extract from data-acc-text attributes
     * Storyline stores accessible text in these attributes
     */
    extractFromAccText(doc, processed) {
        const items = [];
        const elements = doc.querySelectorAll('[data-acc-text]');

        elements.forEach(el => {
            const text = el.getAttribute('data-acc-text')?.trim();
            if (!text || text.length < 10 || processed.has(text)) return;

            // Skip if looks like code or navigation/UI elements
            if (Utils.isCodeLike(text)) return;
            if (this.isUIElement(text)) return;

            processed.add(text);

            // Determine if this is a question or answer
            const isQuestion = this.isQuestionText(text, el);
            const isCorrect = this.isCorrectAnswer(el);

            items.push({
                type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                text,
                correct: isCorrect,
                source: 'StorylineDOM:acc-text',
                confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
            });
        });

        return items;
    },

    /**
     * Check if text is a UI/navigation element (not content)
     */
    isUIElement(text) {
        const lower = text.toLowerCase();

        // Exact matches for common UI labels
        const uiLabels = [
            'correct', 'incorrect', 'right', 'wrong',
            'next', 'prev', 'previous', 'back', 'forward',
            'submit', 'continue', 'menu', 'close', 'open',
            'play', 'pause', 'stop', 'mute', 'unmute',
            'replay', 'restart', 'reset', 'retry',
            'yes', 'no', 'ok', 'cancel', 'done',
            'loading', 'please wait', 'processing'
        ];
        if (uiLabels.includes(lower)) return true;

        // Pattern matches for UI elements
        const uiPatterns = [
            /^back\s+to/i,                    // "Back to top", "Back to menu"
            /playback\s*(speed|rate)/i,       // Media controls
            /sidebar\s*(toggle|open|close)/i, // Sidebar controls
            /volume\s*(up|down|control)/i,    // Volume controls
            /full\s*screen/i,                 // Fullscreen toggle
            /closed?\s*caption/i,             // CC controls
            /transcript/i,                    // Transcript toggle
            /bookmark/i,                      // Bookmark button
            /print/i,                         // Print button
            /download/i,                      // Download button
            /share/i,                         // Share button
            /help/i,                          // Help button
            /settings?/i,                     // Settings
            /slide\s*\d+\s*(of|\/)\s*\d+/i,   // "Slide 1 of 10"
            /page\s*\d+/i,                    // "Page 1"
            /^\d+\s*%$/,                      // "50%"
            /^\d+:\d+/,                       // "1:30" (time)
            /^(section|chapter|module)\s*\d+$/i, // Navigation labels
        ];

        return uiPatterns.some(p => p.test(text));
    },

    /**
     * Extract from accessibility shadow elements (acc-shadow-el)
     * These are hidden form elements for screen readers
     */
    extractFromAccShadow(doc, processed) {
        const items = [];

        // Find radio buttons and checkboxes in accessibility layer
        const accRadios = doc.querySelectorAll('.acc-shadow-el.acc-radio, .acc-shadow-el input[type="radio"]');
        const accCheckboxes = doc.querySelectorAll('.acc-shadow-el.acc-checkbox, .acc-shadow-el input[type="checkbox"]');

        // Group radios by name for proper question/answer grouping
        const radioGroups = new Map();
        accRadios.forEach(radio => {
            const name = radio.getAttribute('name') || radio.closest('[role="radiogroup"]')?.id || 'default';
            if (!radioGroups.has(name)) {
                radioGroups.set(name, []);
            }
            radioGroups.set(name, [...radioGroups.get(name), radio]);
        });

        // Process radio groups
        radioGroups.forEach((radios, groupName) => {
            radios.forEach(radio => {
                const labelText = this.findLabelForElement(radio, doc);
                if (!labelText || labelText.length < 10 || processed.has(labelText)) return;
                if (Utils.isCodeLike(labelText)) return;
                if (this.isUIElement(labelText)) return;

                processed.add(labelText);

                const isCorrect = this.isCorrectAnswer(radio);
                items.push({
                    type: ITEM_TYPE.ANSWER,
                    text: labelText,
                    correct: isCorrect,
                    source: `StorylineDOM:acc-radio:${groupName}`,
                    confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
                });
            });
        });

        // Process checkboxes
        accCheckboxes.forEach(checkbox => {
            const labelText = this.findLabelForElement(checkbox, doc);
            if (!labelText || labelText.length < 10 || processed.has(labelText)) return;
            if (Utils.isCodeLike(labelText)) return;
            if (this.isUIElement(labelText)) return;

            processed.add(labelText);

            const isCorrect = this.isCorrectAnswer(checkbox);
            items.push({
                type: ITEM_TYPE.ANSWER,
                text: labelText,
                correct: isCorrect,
                source: 'StorylineDOM:acc-checkbox',
                confidence: isCorrect ? CONFIDENCE.VERY_HIGH : CONFIDENCE.HIGH
            });
        });

        return items;
    },

    /**
     * Extract from aria-label and aria-labelledby attributes
     */
    extractFromAriaLabels(doc, processed) {
        const items = [];

        // Elements with aria-label that look like Q&A content
        doc.querySelectorAll('[aria-label]').forEach(el => {
            const text = el.getAttribute('aria-label')?.trim();
            if (!text || text.length < 15 || processed.has(text)) return;
            if (Utils.isCodeLike(text)) return;
            if (this.isUIElement(text)) return;
            if (/^(button|link|image|icon)/i.test(text)) return;

            // Only include if it looks like content
            if (!Utils.isNaturalLanguage(text)) return;

            processed.add(text);

            const isQuestion = this.isQuestionText(text, el);
            items.push({
                type: isQuestion ? ITEM_TYPE.QUESTION : ITEM_TYPE.ANSWER,
                text,
                correct: false,
                source: 'StorylineDOM:aria-label',
                confidence: CONFIDENCE.MEDIUM
            });
        });

        return items;
    },

    /**
     * Determine if text is likely a question
     */
    isQuestionText(text, element) {
        // Ends with question mark
        if (text.endsWith('?')) return true;

        // Contains question keywords
        if (/^(what|which|who|when|where|why|how|select|choose|identify)/i.test(text)) return true;

        // Element has question-like attributes
        if (element.classList.contains('question') ||
            element.getAttribute('data-model-id')?.includes('Question')) return true;

        // Parent is a question container
        const parent = element.closest('[class*="question"], [data-acc-text*="?"]');
        if (parent && parent !== element) return false; // This is likely an answer within a question

        return false;
    },

    /**
     * Check if element represents a correct answer
     */
    isCorrectAnswer(element) {
        // Check aria-checked state
        if (element.getAttribute('aria-checked') === 'true') return true;

        // Check for correct-related classes
        const classes = element.className || '';
        if (/correct|right|selected.*correct/i.test(classes)) return true;

        // Check parent states
        const slideObject = element.closest('.slide-object, [class*="slide-object-"]');
        if (slideObject) {
            const stateAttr = slideObject.getAttribute('data-state') || '';
            if (/correct|review(?!.*incorrect)/i.test(stateAttr)) return true;
        }

        // Check data attributes
        if (element.dataset?.correct === 'true' || element.dataset?.answer === 'true') return true;

        // Check Storyline state system
        const objectId = element.id || element.closest('[id]')?.id;
        if (objectId && window.DS?.VO?.[objectId]) {
            const objectData = window.DS.VO[objectId];
            if (objectData?.states?.includes('Correct') ||
                objectData?.states?.includes('Selected Correct')) {
                return true;
            }
        }

        return false;
    },

    /**
     * Find label text for a form element
     */
    findLabelForElement(element, doc) {
        // Method 1: aria-labelledby
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const labelEl = doc.getElementById(labelledBy);
            if (labelEl) {
                return labelEl.textContent?.trim() || labelEl.getAttribute('data-acc-text')?.trim();
            }
        }

        // Method 2: aria-label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim();

        // Method 3: Associated label element (id_label pattern from Storyline)
        const id = element.id;
        if (id) {
            // Try id_label pattern
            const label = doc.getElementById(`${id}_label`) || doc.querySelector(`label[for="${id}"]`);
            if (label) {
                return label.textContent?.trim() || label.getAttribute('data-acc-text')?.trim();
            }

            // Try finding text in same slide-object
            const slideObject = element.closest('.slide-object, [class*="slide-object-"]');
            if (slideObject) {
                const textEl = slideObject.querySelector('[data-acc-text]');
                if (textEl && textEl !== element) {
                    return textEl.getAttribute('data-acc-text')?.trim();
                }
            }
        }

        // Method 4: Parent with data-acc-text
        const parent = element.closest('[data-acc-text]');
        if (parent && parent !== element) {
            return parent.getAttribute('data-acc-text')?.trim();
        }

        // Method 5: Sibling text content
        const nextText = element.nextSibling;
        if (nextText?.nodeType === Node.TEXT_NODE) {
            const text = nextText.textContent?.trim();
            if (text && text.length > 2) return text;
        }

        // Method 6: Inner text as last resort
        const innerText = element.textContent?.trim();
        if (innerText && innerText.length > 2 && innerText.length < 200) {
            return innerText;
        }

        return null;
    }
};


export { StorylineDOMExtractor };
