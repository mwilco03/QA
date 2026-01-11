/**
 * LMS QA Validator - Element Selector v1.0
 * Visual element picker for user-guided Q&A extraction
 *
 * Inspired by uBlock Origin's element picker
 *
 * @fileoverview Provides visual overlay for selecting Q&A elements
 */

(function() {
    'use strict';

    // Prevent double injection
    if (window.__LMS_SELECTOR_INJECTED__) {
        window.postMessage({ type: 'LMS_QA_SELECTOR_ALREADY_ACTIVE' }, '*');
        return;
    }
    window.__LMS_SELECTOR_INJECTED__ = true;

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const PREFIX = 'LMS_QA_SELECTOR_';
    const HIGHLIGHT_CLASS = 'lms-qa-selector-highlight';
    const OVERLAY_ID = 'lms-qa-selector-overlay';
    const PANEL_ID = 'lms-qa-selector-panel';

    const STEP = Object.freeze({
        IDLE: 'idle',
        PICK_QUESTION: 'pick_question',
        PICK_ANSWER: 'pick_answer',
        PICK_CORRECT: 'pick_correct',
        PREVIEW: 'preview',
        DONE: 'done'
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    const State = {
        step: STEP.IDLE,
        hoveredElement: null,
        selectedQuestion: null,
        selectedAnswer: null,
        selectedCorrect: null,
        questionSelector: null,
        answerSelector: null,
        correctSelector: null,
        questionMatches: [],
        answerMatches: [],
        correctMatches: []
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STYLES (injected into page)
    // ═══════════════════════════════════════════════════════════════════════════

    const STYLES = `
        .${HIGHLIGHT_CLASS} {
            outline: 3px solid #4CAF50 !important;
            outline-offset: 2px !important;
            background-color: rgba(76, 175, 80, 0.1) !important;
            cursor: crosshair !important;
        }

        .${HIGHLIGHT_CLASS}.answer-mode {
            outline-color: #2196F3 !important;
            background-color: rgba(33, 150, 243, 0.1) !important;
        }

        .${HIGHLIGHT_CLASS}.correct-mode {
            outline-color: #FF9800 !important;
            background-color: rgba(255, 152, 0, 0.1) !important;
        }

        .lms-qa-selector-match-question {
            outline: 2px dashed #4CAF50 !important;
            outline-offset: 1px !important;
        }

        .lms-qa-selector-match-answer {
            outline: 2px dashed #2196F3 !important;
            outline-offset: 1px !important;
        }

        .lms-qa-selector-match-correct {
            outline: 2px dashed #FF9800 !important;
            outline-offset: 1px !important;
        }

        #${OVERLAY_ID} {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 2147483646 !important;
            pointer-events: none !important;
        }

        #${PANEL_ID} {
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
            width: 320px !important;
            background: #1a1a2e !important;
            border: 1px solid #4a4a6a !important;
            border-radius: 8px !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
            z-index: 2147483647 !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            font-size: 13px !important;
            color: #e0e0e0 !important;
            pointer-events: auto !important;
        }

        #${PANEL_ID} * {
            box-sizing: border-box !important;
        }

        .lms-selector-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            padding: 12px 16px !important;
            border-bottom: 1px solid #4a4a6a !important;
            background: #252542 !important;
            border-radius: 8px 8px 0 0 !important;
        }

        .lms-selector-title {
            font-weight: 600 !important;
            font-size: 14px !important;
            color: #fff !important;
        }

        .lms-selector-close {
            background: none !important;
            border: none !important;
            color: #888 !important;
            cursor: pointer !important;
            font-size: 20px !important;
            line-height: 1 !important;
            padding: 0 !important;
            width: 24px !important;
            height: 24px !important;
        }

        .lms-selector-close:hover {
            color: #fff !important;
        }

        .lms-selector-content {
            padding: 16px !important;
        }

        .lms-selector-step {
            margin-bottom: 16px !important;
            padding: 12px !important;
            background: #252542 !important;
            border-radius: 6px !important;
            border-left: 3px solid #666 !important;
        }

        .lms-selector-step.active {
            border-left-color: #4CAF50 !important;
            background: #2a2a4a !important;
        }

        .lms-selector-step.completed {
            border-left-color: #4CAF50 !important;
            opacity: 0.7 !important;
        }

        .lms-selector-step.answer-step.active {
            border-left-color: #2196F3 !important;
        }

        .lms-selector-step.correct-step.active {
            border-left-color: #FF9800 !important;
        }

        .lms-selector-step-title {
            font-weight: 500 !important;
            margin-bottom: 4px !important;
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
        }

        .lms-selector-step-num {
            width: 20px !important;
            height: 20px !important;
            border-radius: 50% !important;
            background: #4a4a6a !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 11px !important;
            font-weight: 600 !important;
        }

        .lms-selector-step.active .lms-selector-step-num {
            background: #4CAF50 !important;
        }

        .lms-selector-step.completed .lms-selector-step-num {
            background: #4CAF50 !important;
        }

        .lms-selector-step.answer-step.active .lms-selector-step-num {
            background: #2196F3 !important;
        }

        .lms-selector-step.correct-step.active .lms-selector-step-num {
            background: #FF9800 !important;
        }

        .lms-selector-step-desc {
            font-size: 12px !important;
            color: #888 !important;
            margin-left: 28px !important;
        }

        .lms-selector-match-count {
            font-size: 11px !important;
            color: #4CAF50 !important;
            margin-left: 28px !important;
            margin-top: 4px !important;
        }

        .lms-selector-selector-display {
            font-family: monospace !important;
            font-size: 10px !important;
            color: #aaa !important;
            margin-left: 28px !important;
            margin-top: 4px !important;
            word-break: break-all !important;
        }

        .lms-selector-actions {
            display: flex !important;
            gap: 8px !important;
            margin-top: 16px !important;
        }

        .lms-selector-btn {
            flex: 1 !important;
            padding: 10px 16px !important;
            border: none !important;
            border-radius: 6px !important;
            cursor: pointer !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            transition: background 0.2s !important;
        }

        .lms-selector-btn-primary {
            background: #4CAF50 !important;
            color: #fff !important;
        }

        .lms-selector-btn-primary:hover {
            background: #45a049 !important;
        }

        .lms-selector-btn-primary:disabled {
            background: #3a3a5a !important;
            color: #666 !important;
            cursor: not-allowed !important;
        }

        .lms-selector-btn-secondary {
            background: #3a3a5a !important;
            color: #ccc !important;
        }

        .lms-selector-btn-secondary:hover {
            background: #4a4a6a !important;
        }

        .lms-selector-preview {
            margin-top: 12px !important;
            padding: 12px !important;
            background: #1e1e36 !important;
            border-radius: 6px !important;
            max-height: 150px !important;
            overflow-y: auto !important;
        }

        .lms-selector-preview-title {
            font-size: 11px !important;
            color: #888 !important;
            margin-bottom: 8px !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
        }

        .lms-selector-preview-item {
            font-size: 12px !important;
            padding: 4px 0 !important;
            border-bottom: 1px solid #2a2a4a !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        .lms-selector-preview-item:last-child {
            border-bottom: none !important;
        }

        .lms-selector-preview-q {
            color: #4CAF50 !important;
        }

        .lms-selector-preview-a {
            color: #2196F3 !important;
        }

        .lms-selector-skip-btn {
            display: block !important;
            margin-left: 28px !important;
            margin-top: 8px !important;
            background: none !important;
            border: none !important;
            color: #888 !important;
            font-size: 11px !important;
            cursor: pointer !important;
            padding: 0 !important;
            text-decoration: underline !important;
        }

        .lms-selector-skip-btn:hover {
            color: #ccc !important;
        }
    `;

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function log(msg, data) {
        console.log(`[LMS Selector] ${msg}`, data !== undefined ? data : '');
    }

    function injectStyles() {
        if (document.getElementById('lms-selector-styles')) return;
        const style = document.createElement('style');
        style.id = 'lms-selector-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    function removeStyles() {
        document.getElementById('lms-selector-styles')?.remove();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CSS SELECTOR GENERATION
    // ═══════════════════════════════════════════════════════════════════════════

    const SelectorGenerator = {
        /**
         * Generate multiple candidate selectors for an element
         * Returns array sorted by specificity (most specific first)
         */
        generate(element) {
            if (!element || element === document.body || element === document.documentElement) {
                return [];
            }

            const candidates = [];

            // Strategy 1: ID (if unique and not dynamic-looking)
            if (element.id && !this.isDynamicId(element.id)) {
                candidates.push({
                    selector: `#${CSS.escape(element.id)}`,
                    strategy: 'id',
                    specificity: 1
                });
            }

            // Strategy 2: Unique class combination
            const classSelector = this.getClassSelector(element);
            if (classSelector) {
                candidates.push({
                    selector: classSelector,
                    strategy: 'class',
                    specificity: 2
                });
            }

            // Strategy 3: Tag + class
            const tagClassSelector = this.getTagClassSelector(element);
            if (tagClassSelector) {
                candidates.push({
                    selector: tagClassSelector,
                    strategy: 'tag+class',
                    specificity: 3
                });
            }

            // Strategy 4: Data attributes
            const dataSelector = this.getDataAttrSelector(element);
            if (dataSelector) {
                candidates.push({
                    selector: dataSelector,
                    strategy: 'data-attr',
                    specificity: 2
                });
            }

            // Strategy 5: Structural (parent > child)
            const structuralSelector = this.getStructuralSelector(element);
            if (structuralSelector) {
                candidates.push({
                    selector: structuralSelector,
                    strategy: 'structural',
                    specificity: 4
                });
            }

            // Strategy 6: nth-child pattern
            const nthSelector = this.getNthSelector(element);
            if (nthSelector) {
                candidates.push({
                    selector: nthSelector,
                    strategy: 'nth-child',
                    specificity: 5
                });
            }

            return candidates;
        },

        /**
         * Check if ID looks auto-generated/dynamic
         */
        isDynamicId(id) {
            // Patterns that suggest dynamic IDs
            return /^[a-f0-9]{8,}$/i.test(id) ||     // Hex strings
                   /^\d+$/.test(id) ||               // Pure numbers
                   /^(ember|react|vue|ng)[_-]?\d+/i.test(id) || // Framework IDs
                   /_\d{10,}/.test(id) ||            // Timestamps
                   /^:[a-z]+\d+$/i.test(id);         // jQuery-style
        },

        /**
         * Get selector using classes
         */
        getClassSelector(element) {
            const classes = Array.from(element.classList)
                .filter(c => !this.isDynamicClass(c));

            if (classes.length === 0) return null;

            // Try single class first
            for (const cls of classes) {
                const selector = `.${CSS.escape(cls)}`;
                const matches = document.querySelectorAll(selector);
                if (matches.length > 1 && matches.length < 50) {
                    return selector;
                }
            }

            // Try class combinations
            if (classes.length >= 2) {
                const selector = classes.slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
                const matches = document.querySelectorAll(selector);
                if (matches.length > 1 && matches.length < 50) {
                    return selector;
                }
            }

            return null;
        },

        /**
         * Check if class looks dynamic
         */
        isDynamicClass(cls) {
            return /^[a-z]{1,3}[A-Z][a-zA-Z]*_[a-z0-9]{5,}$/i.test(cls) || // CSS modules
                   /^_[a-f0-9]{6,}$/i.test(cls) ||                          // Hash classes
                   /^css-[a-z0-9]+$/i.test(cls);                            // Emotion/styled
        },

        /**
         * Get tag + class selector
         */
        getTagClassSelector(element) {
            const tag = element.tagName.toLowerCase();
            const classes = Array.from(element.classList)
                .filter(c => !this.isDynamicClass(c));

            if (classes.length === 0) return null;

            const selector = `${tag}.${CSS.escape(classes[0])}`;
            const matches = document.querySelectorAll(selector);

            if (matches.length > 1 && matches.length < 50) {
                return selector;
            }

            return null;
        },

        /**
         * Get selector using data attributes
         */
        getDataAttrSelector(element) {
            const dataAttrs = Array.from(element.attributes)
                .filter(attr => attr.name.startsWith('data-'))
                .filter(attr => !this.isDynamicValue(attr.value));

            for (const attr of dataAttrs) {
                // Prefer semantic data attributes
                if (['data-type', 'data-role', 'data-component', 'data-question',
                     'data-answer', 'data-id', 'data-index'].includes(attr.name)) {
                    const selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
                    const matches = document.querySelectorAll(selector);
                    if (matches.length > 1 && matches.length < 50) {
                        return selector;
                    }
                }
            }

            // Try any data attribute without value (just presence)
            for (const attr of dataAttrs) {
                const selector = `[${attr.name}]`;
                const matches = document.querySelectorAll(selector);
                if (matches.length > 1 && matches.length < 50) {
                    return selector;
                }
            }

            return null;
        },

        /**
         * Check if value looks dynamic
         */
        isDynamicValue(value) {
            return /^[a-f0-9]{8,}$/i.test(value) ||
                   /^\d{10,}$/.test(value);
        },

        /**
         * Get structural selector (parent > child)
         */
        getStructuralSelector(element) {
            const parent = element.parentElement;
            if (!parent || parent === document.body) return null;

            const tag = element.tagName.toLowerCase();
            const parentClasses = Array.from(parent.classList)
                .filter(c => !this.isDynamicClass(c));

            if (parentClasses.length > 0) {
                const selector = `.${CSS.escape(parentClasses[0])} > ${tag}`;
                const matches = document.querySelectorAll(selector);
                if (matches.length > 1 && matches.length < 50) {
                    return selector;
                }

                // Try with child class too
                const childClasses = Array.from(element.classList)
                    .filter(c => !this.isDynamicClass(c));
                if (childClasses.length > 0) {
                    const selector2 = `.${CSS.escape(parentClasses[0])} > .${CSS.escape(childClasses[0])}`;
                    const matches2 = document.querySelectorAll(selector2);
                    if (matches2.length > 1 && matches2.length < 50) {
                        return selector2;
                    }
                }
            }

            return null;
        },

        /**
         * Get nth-child based selector
         */
        getNthSelector(element) {
            const parent = element.parentElement;
            if (!parent) return null;

            const siblings = Array.from(parent.children);
            const sameTagSiblings = siblings.filter(s => s.tagName === element.tagName);

            if (sameTagSiblings.length < 2) return null;

            const parentClasses = Array.from(parent.classList)
                .filter(c => !this.isDynamicClass(c));

            if (parentClasses.length > 0) {
                const tag = element.tagName.toLowerCase();
                const selector = `.${CSS.escape(parentClasses[0])} > ${tag}`;
                const matches = document.querySelectorAll(selector);
                if (matches.length > 1 && matches.length < 50) {
                    return selector;
                }
            }

            return null;
        },

        /**
         * Find the best selector from candidates by testing match count
         */
        findBest(candidates, targetElement) {
            // Filter to only selectors that match the target
            const valid = candidates.filter(c => {
                try {
                    const matches = document.querySelectorAll(c.selector);
                    return Array.from(matches).includes(targetElement);
                } catch {
                    return false;
                }
            });

            if (valid.length === 0) return null;

            // Sort by number of matches (prefer more matches for patterns)
            // but not too many (< 100)
            valid.sort((a, b) => {
                const aCount = document.querySelectorAll(a.selector).length;
                const bCount = document.querySelectorAll(b.selector).length;

                // Prefer selectors with 2-50 matches
                const aScore = (aCount >= 2 && aCount <= 50) ? 100 - aCount : 0;
                const bScore = (bCount >= 2 && bCount <= 50) ? 100 - bCount : 0;

                return bScore - aScore;
            });

            return valid[0];
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // URL PATTERN MATCHING
    // ═══════════════════════════════════════════════════════════════════════════

    const URLMatcher = {
        /**
         * Generate a storage key from current URL
         * Uses path pattern, not full URL with query params
         */
        getPatternKey() {
            const url = new URL(window.location.href);
            const host = url.hostname;
            let path = url.pathname;

            // Replace numeric segments with wildcards
            // /course/123/module/456 -> /course/*/module/*
            path = path.replace(/\/\d+/g, '/*');

            // Remove trailing slash
            path = path.replace(/\/$/, '') || '/';

            return `${host}${path}`;
        },

        /**
         * Get all pattern keys that might match current URL (for lookup)
         */
        getMatchingPatterns() {
            const url = new URL(window.location.href);
            const host = url.hostname;
            const pathParts = url.pathname.split('/').filter(Boolean);

            const patterns = [];

            // Exact path (with wildcards for numbers)
            patterns.push(this.getPatternKey());

            // Progressive wildcards from end
            for (let i = pathParts.length - 1; i >= 0; i--) {
                const partial = '/' + pathParts.slice(0, i).join('/') + '/*';
                patterns.push(`${host}${partial}`);
            }

            // Domain only
            patterns.push(`${host}/*`);

            return [...new Set(patterns)];
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // UI PANEL
    // ═══════════════════════════════════════════════════════════════════════════

    const Panel = {
        element: null,

        create() {
            if (this.element) return;

            this.element = document.createElement('div');
            this.element.id = PANEL_ID;
            this.element.innerHTML = this.getHTML();
            document.body.appendChild(this.element);

            this.bindEvents();
            this.update();
        },

        getHTML() {
            return `
                <div class="lms-selector-header">
                    <span class="lms-selector-title">Q&A Element Selector</span>
                    <button class="lms-selector-close" id="lms-selector-close">&times;</button>
                </div>
                <div class="lms-selector-content">
                    <div class="lms-selector-step" id="step-question">
                        <div class="lms-selector-step-title">
                            <span class="lms-selector-step-num">1</span>
                            Click a QUESTION element
                        </div>
                        <div class="lms-selector-step-desc">Hover over questions, click to select</div>
                        <div class="lms-selector-selector-display" id="question-selector"></div>
                        <div class="lms-selector-match-count" id="question-count"></div>
                    </div>

                    <div class="lms-selector-step answer-step" id="step-answer">
                        <div class="lms-selector-step-title">
                            <span class="lms-selector-step-num">2</span>
                            Click an ANSWER element
                        </div>
                        <div class="lms-selector-step-desc">Click an answer choice</div>
                        <div class="lms-selector-selector-display" id="answer-selector"></div>
                        <div class="lms-selector-match-count" id="answer-count"></div>
                    </div>

                    <div class="lms-selector-step correct-step" id="step-correct">
                        <div class="lms-selector-step-title">
                            <span class="lms-selector-step-num">3</span>
                            Click CORRECT indicator (optional)
                        </div>
                        <div class="lms-selector-step-desc">Click element that marks correct answers</div>
                        <button class="lms-selector-skip-btn" id="skip-correct">Skip this step</button>
                        <div class="lms-selector-selector-display" id="correct-selector"></div>
                        <div class="lms-selector-match-count" id="correct-count"></div>
                    </div>

                    <div class="lms-selector-preview" id="preview-container" style="display: none;">
                        <div class="lms-selector-preview-title">Preview (first 5)</div>
                        <div id="preview-list"></div>
                    </div>

                    <div class="lms-selector-actions">
                        <button class="lms-selector-btn lms-selector-btn-secondary" id="btn-reset">Reset</button>
                        <button class="lms-selector-btn lms-selector-btn-primary" id="btn-save" disabled>Save Rule</button>
                    </div>
                </div>
            `;
        },

        bindEvents() {
            this.element.querySelector('#lms-selector-close').addEventListener('click', () => {
                Selector.deactivate();
            });

            this.element.querySelector('#btn-reset').addEventListener('click', () => {
                Selector.reset();
            });

            this.element.querySelector('#btn-save').addEventListener('click', () => {
                Selector.saveRule();
            });

            this.element.querySelector('#skip-correct').addEventListener('click', () => {
                State.step = STEP.PREVIEW;
                this.update();
                Selector.showPreview();
            });
        },

        update() {
            const steps = {
                'step-question': State.step === STEP.PICK_QUESTION,
                'step-answer': State.step === STEP.PICK_ANSWER,
                'step-correct': State.step === STEP.PICK_CORRECT
            };

            // Update step states
            Object.entries(steps).forEach(([id, isActive]) => {
                const el = this.element.querySelector(`#${id}`);
                el.classList.toggle('active', isActive);
            });

            // Mark completed steps
            if (State.questionSelector) {
                this.element.querySelector('#step-question').classList.add('completed');
                this.element.querySelector('#question-selector').textContent = State.questionSelector;
                this.element.querySelector('#question-count').textContent =
                    `Found ${State.questionMatches.length} matches`;
            }

            if (State.answerSelector) {
                this.element.querySelector('#step-answer').classList.add('completed');
                this.element.querySelector('#answer-selector').textContent = State.answerSelector;
                this.element.querySelector('#answer-count').textContent =
                    `Found ${State.answerMatches.length} matches`;
            }

            if (State.correctSelector) {
                this.element.querySelector('#step-correct').classList.add('completed');
                this.element.querySelector('#correct-selector').textContent = State.correctSelector;
                this.element.querySelector('#correct-count').textContent =
                    `Found ${State.correctMatches.length} matches`;
            }

            // Enable save button when we have at least Q and A
            const canSave = State.questionSelector && State.answerSelector;
            this.element.querySelector('#btn-save').disabled = !canSave;

            // Show/hide skip button
            const skipBtn = this.element.querySelector('#skip-correct');
            skipBtn.style.display = State.step === STEP.PICK_CORRECT ? 'block' : 'none';
        },

        showPreview(questions, answers) {
            const container = this.element.querySelector('#preview-container');
            const list = this.element.querySelector('#preview-list');

            container.style.display = 'block';

            let html = '';
            const qTexts = questions.slice(0, 5).map(el => el.textContent?.trim().substring(0, 60));
            const aTexts = answers.slice(0, 5).map(el => el.textContent?.trim().substring(0, 60));

            qTexts.forEach((q, i) => {
                html += `<div class="lms-selector-preview-item lms-selector-preview-q">Q: ${q}...</div>`;
            });

            html += '<div style="height: 8px;"></div>';

            aTexts.forEach((a, i) => {
                html += `<div class="lms-selector-preview-item lms-selector-preview-a">A: ${a}...</div>`;
            });

            list.innerHTML = html;
        },

        destroy() {
            this.element?.remove();
            this.element = null;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN SELECTOR LOGIC
    // ═══════════════════════════════════════════════════════════════════════════

    const Selector = {
        overlay: null,

        activate() {
            log('Activating selector');
            injectStyles();
            this.createOverlay();
            Panel.create();

            State.step = STEP.PICK_QUESTION;
            Panel.update();

            document.addEventListener('mousemove', this.handleMouseMove);
            document.addEventListener('click', this.handleClick, true);
            document.addEventListener('keydown', this.handleKeydown);

            this.sendMessage('SELECTOR_ACTIVATED');
        },

        deactivate() {
            log('Deactivating selector');

            document.removeEventListener('mousemove', this.handleMouseMove);
            document.removeEventListener('click', this.handleClick, true);
            document.removeEventListener('keydown', this.handleKeydown);

            this.clearHighlights();
            this.overlay?.remove();
            Panel.destroy();
            removeStyles();

            window.__LMS_SELECTOR_INJECTED__ = false;

            this.sendMessage('SELECTOR_DEACTIVATED');
        },

        reset() {
            this.clearHighlights();

            State.step = STEP.PICK_QUESTION;
            State.selectedQuestion = null;
            State.selectedAnswer = null;
            State.selectedCorrect = null;
            State.questionSelector = null;
            State.answerSelector = null;
            State.correctSelector = null;
            State.questionMatches = [];
            State.answerMatches = [];
            State.correctMatches = [];

            // Reset panel UI
            Panel.element.querySelector('#step-question').classList.remove('completed');
            Panel.element.querySelector('#step-answer').classList.remove('completed');
            Panel.element.querySelector('#step-correct').classList.remove('completed');
            Panel.element.querySelector('#question-selector').textContent = '';
            Panel.element.querySelector('#answer-selector').textContent = '';
            Panel.element.querySelector('#correct-selector').textContent = '';
            Panel.element.querySelector('#question-count').textContent = '';
            Panel.element.querySelector('#answer-count').textContent = '';
            Panel.element.querySelector('#correct-count').textContent = '';
            Panel.element.querySelector('#preview-container').style.display = 'none';

            Panel.update();
        },

        createOverlay() {
            this.overlay = document.createElement('div');
            this.overlay.id = OVERLAY_ID;
            document.body.appendChild(this.overlay);
        },

        handleMouseMove: (e) => {
            if (State.step === STEP.PREVIEW || State.step === STEP.DONE) return;

            const target = document.elementFromPoint(e.clientX, e.clientY);

            // Ignore our own UI elements
            if (!target || target.closest(`#${PANEL_ID}`)) {
                Selector.clearHover();
                return;
            }

            // Ignore tiny elements and structural elements
            if (Selector.shouldIgnoreElement(target)) {
                Selector.clearHover();
                return;
            }

            if (target !== State.hoveredElement) {
                Selector.clearHover();
                State.hoveredElement = target;

                let highlightClass = HIGHLIGHT_CLASS;
                if (State.step === STEP.PICK_ANSWER) highlightClass += ' answer-mode';
                if (State.step === STEP.PICK_CORRECT) highlightClass += ' correct-mode';

                target.classList.add(...highlightClass.split(' '));
            }
        },

        handleClick: (e) => {
            if (State.step === STEP.PREVIEW || State.step === STEP.DONE) return;

            const target = e.target;

            // Allow clicks on our panel
            if (target.closest(`#${PANEL_ID}`)) return;

            e.preventDefault();
            e.stopPropagation();

            if (Selector.shouldIgnoreElement(target)) return;

            Selector.selectElement(target);
        },

        handleKeydown: (e) => {
            if (e.key === 'Escape') {
                Selector.deactivate();
            }
        },

        shouldIgnoreElement(el) {
            if (!el) return true;
            if (el === document.body || el === document.documentElement) return true;

            const rect = el.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 10) return true;

            const tag = el.tagName.toLowerCase();
            if (['html', 'body', 'script', 'style', 'link', 'meta', 'head'].includes(tag)) return true;

            return false;
        },

        clearHover() {
            if (State.hoveredElement) {
                State.hoveredElement.classList.remove(HIGHLIGHT_CLASS, 'answer-mode', 'correct-mode');
                State.hoveredElement = null;
            }
        },

        clearHighlights() {
            this.clearHover();

            document.querySelectorAll('.lms-qa-selector-match-question').forEach(el => {
                el.classList.remove('lms-qa-selector-match-question');
            });
            document.querySelectorAll('.lms-qa-selector-match-answer').forEach(el => {
                el.classList.remove('lms-qa-selector-match-answer');
            });
            document.querySelectorAll('.lms-qa-selector-match-correct').forEach(el => {
                el.classList.remove('lms-qa-selector-match-correct');
            });
        },

        selectElement(element) {
            const candidates = SelectorGenerator.generate(element);
            const best = SelectorGenerator.findBest(candidates, element);

            if (!best) {
                log('Could not generate selector for element', element);
                return;
            }

            const selector = best.selector;
            const matches = Array.from(document.querySelectorAll(selector));

            log(`Selected: ${selector} (${matches.length} matches)`);

            switch (State.step) {
                case STEP.PICK_QUESTION:
                    State.selectedQuestion = element;
                    State.questionSelector = selector;
                    State.questionMatches = matches;
                    matches.forEach(el => el.classList.add('lms-qa-selector-match-question'));
                    State.step = STEP.PICK_ANSWER;
                    break;

                case STEP.PICK_ANSWER:
                    State.selectedAnswer = element;
                    State.answerSelector = selector;
                    State.answerMatches = matches;
                    matches.forEach(el => el.classList.add('lms-qa-selector-match-answer'));
                    State.step = STEP.PICK_CORRECT;
                    break;

                case STEP.PICK_CORRECT:
                    State.selectedCorrect = element;
                    State.correctSelector = selector;
                    State.correctMatches = matches;
                    matches.forEach(el => el.classList.add('lms-qa-selector-match-correct'));
                    State.step = STEP.PREVIEW;
                    this.showPreview();
                    break;
            }

            this.clearHover();
            Panel.update();
        },

        showPreview() {
            Panel.showPreview(State.questionMatches, State.answerMatches);
        },

        saveRule() {
            if (!State.questionSelector || !State.answerSelector) {
                log('Cannot save: missing selectors');
                return;
            }

            const rule = {
                questionSelector: State.questionSelector,
                answerSelector: State.answerSelector,
                correctSelector: State.correctSelector || null,
                urlPattern: URLMatcher.getPatternKey(),
                created: new Date().toISOString(),
                questionCount: State.questionMatches.length,
                answerCount: State.answerMatches.length
            };

            log('Saving rule', rule);

            // Send to extension for storage
            this.sendMessage('SELECTOR_RULE_CREATED', { rule });

            State.step = STEP.DONE;

            // Show success and close
            setTimeout(() => {
                this.deactivate();
            }, 500);
        },

        sendMessage(type, payload = {}) {
            window.postMessage({
                type: `${PREFIX}${type}`,
                payload,
                timestamp: Date.now()
            }, '*');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE HANDLING
    // ═══════════════════════════════════════════════════════════════════════════

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data?.type?.startsWith('LMS_QA_')) return;

        const type = event.data.type.replace('LMS_QA_', '');

        switch (type) {
            case 'CMD_ACTIVATE_SELECTOR':
                Selector.activate();
                break;
            case 'CMD_DEACTIVATE_SELECTOR':
                Selector.deactivate();
                break;
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    window.LMS_QA_SELECTOR = {
        activate: () => Selector.activate(),
        deactivate: () => Selector.deactivate(),
        getState: () => ({ ...State }),
        getURLPattern: () => URLMatcher.getPatternKey()
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    log('Element selector loaded');

    // Auto-activate if injected via command
    if (window.__LMS_SELECTOR_AUTO_ACTIVATE__) {
        Selector.activate();
    }

})();
