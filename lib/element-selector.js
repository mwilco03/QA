/**
 * LMS QA Validator - Element Selector v2.0
 * Visual element picker for user-guided Q&A extraction
 *
 * Key architectural decisions:
 * - ONLY runs in the top frame to prevent multiple panels
 * - Can select elements across same-origin iframes
 * - Uses message passing for cross-frame coordination
 *
 * @fileoverview Provides visual overlay for selecting Q&A elements
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // IFRAME ANCHORING - Only run in top frame
    // This prevents the selector panel from appearing in every iframe
    // ═══════════════════════════════════════════════════════════════════════════

    const isTopFrame = (window === window.top);
    const isForceInjected = window.__LMS_SELECTOR_FORCE_INJECT__;

    // If we're in an iframe and not force-injected, exit silently
    // The selector in the top frame will handle cross-frame element selection
    if (!isTopFrame && !isForceInjected) {
        console.log('[LMS Selector] Skipping - not top frame. Panel anchored to top window only.');

        // Still listen for messages from top frame for coordination
        window.addEventListener('message', (e) => {
            if (e.data?.type === 'LMS_SELECTOR_HIGHLIGHT') {
                // Top frame wants us to highlight an element in this iframe
                const selector = e.data.selector;
                if (selector) {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => el.classList.add('lms-qa-selector-match'));
                    } catch {}
                }
            }
            if (e.data?.type === 'LMS_SELECTOR_CLEAR') {
                // Clear highlights in this iframe
                document.querySelectorAll('.lms-qa-selector-match, .lms-qa-selector-highlight').forEach(el => {
                    el.classList.remove('lms-qa-selector-match', 'lms-qa-selector-highlight');
                });
            }
        });

        return; // Exit - don't create panel in iframe
    }

    const PANEL_ID = 'lms-qa-selector-panel';
    const OVERLAY_ID = 'lms-qa-selector-overlay';

    // Aggressive cleanup - remove any existing panels/overlays first
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
    document.querySelectorAll('.lms-qa-selector-highlight').forEach(el => {
        el.classList.remove('lms-qa-selector-highlight', 'answer-mode', 'correct-mode');
    });
    document.querySelectorAll('.lms-qa-selector-match-question, .lms-qa-selector-match-answer, .lms-qa-selector-match-correct').forEach(el => {
        el.classList.remove('lms-qa-selector-match-question', 'lms-qa-selector-match-answer', 'lms-qa-selector-match-correct');
    });

    // Prevent double injection - cleanup any existing instance
    if (window.__LMS_SELECTOR_INJECTED__) {
        if (window.LMS_QA_SELECTOR?.deactivate) {
            try { window.LMS_QA_SELECTOR.deactivate(); } catch(e) {}
        }
        window.__LMS_SELECTOR_INJECTED__ = false;
    }
    window.__LMS_SELECTOR_INJECTED__ = true;

    console.log('[LMS Selector] Initialized in top frame - panel anchored here');

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const PREFIX = 'LMS_QA_SELECTOR_';
    const HIGHLIGHT_CLASS = 'lms-qa-selector-highlight';

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
    // DOM UTILITIES - Cross-frame element access
    // ═══════════════════════════════════════════════════════════════════════════

    const DOMUtils = {
        /**
         * Get all accessible documents (main + same-origin iframes)
         */
        getAllDocuments() {
            const docs = [document];

            try {
                const iframes = document.querySelectorAll('iframe');
                iframes.forEach(iframe => {
                    try {
                        if (iframe.contentDocument) {
                            docs.push(iframe.contentDocument);
                        }
                    } catch (e) {
                        // Cross-origin iframe - can't access
                    }
                });
            } catch (e) {
                // Ignore errors
            }

            return docs;
        },

        /**
         * Query selector across all accessible documents
         */
        querySelectorAll(selector) {
            const results = [];
            const docs = this.getAllDocuments();

            for (const doc of docs) {
                try {
                    const elements = doc.querySelectorAll(selector);
                    results.push(...elements);
                } catch (e) {
                    // Invalid selector or access denied
                }
            }

            return results;
        },

        /**
         * Get element at point, checking iframes and handling Storyline SVG content
         */
        elementFromPoint(x, y) {
            let target = document.elementFromPoint(x, y);

            // Check if it's an iframe and try to get element within it
            if (target?.tagName === 'IFRAME') {
                try {
                    const iframe = target;
                    const rect = iframe.getBoundingClientRect();
                    const iframeX = x - rect.left;
                    const iframeY = y - rect.top;

                    if (iframe.contentDocument) {
                        const iframeTarget = iframe.contentDocument.elementFromPoint(iframeX, iframeY);
                        if (iframeTarget) {
                            target = iframeTarget;
                        }
                    }
                } catch (e) {
                    // Cross-origin iframe - keep the iframe as target
                }
            }

            // Handle Storyline SVG content - find the accessibility element
            target = this.resolveStorylineElement(target, x, y) || target;

            return target;
        },

        /**
         * For Storyline SVG elements, find the corresponding accessibility element
         */
        resolveStorylineElement(target, x, y) {
            if (!target) return null;

            const doc = target.ownerDocument || document;

            // Check if we're clicking on SVG content (Storyline renders as SVG)
            const svgParent = target.closest('svg');
            const slideObject = target.closest('.slide-object, [class*="slide-object-"]');

            if (svgParent || slideObject) {
                // Try to find corresponding accessibility element
                // Method 1: Check if the slide-object has data-acc-text
                if (slideObject) {
                    const accText = slideObject.getAttribute('data-acc-text');
                    if (accText && accText.length > 5) {
                        // This slide-object has accessible text - return it
                        return slideObject;
                    }

                    // Method 2: Check data-model-id and find matching acc element
                    const modelId = slideObject.getAttribute('data-model-id');
                    if (modelId) {
                        const accEl = doc.querySelector(`[data-represents*="${modelId}"], #acc-${modelId}`);
                        if (accEl) {
                            return accEl;
                        }
                    }
                }

                // Method 3: Find accessibility element at same position
                const accShadow = doc.querySelector('.acc-shadow-dom');
                if (accShadow) {
                    const accElements = accShadow.querySelectorAll('[data-acc-text], .acc-shadow-el');
                    for (const accEl of accElements) {
                        const rect = accEl.getBoundingClientRect();
                        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                            return accEl;
                        }
                    }
                }

                // Method 4: Find any element with data-acc-text near the click
                const allAccText = doc.querySelectorAll('[data-acc-text]');
                for (const el of allAccText) {
                    const rect = el.getBoundingClientRect();
                    // Check if click is within or near this element
                    if (x >= rect.left - 10 && x <= rect.right + 10 &&
                        y >= rect.top - 10 && y <= rect.bottom + 10) {
                        const text = el.getAttribute('data-acc-text');
                        if (text && text.length > 10) {
                            return el;
                        }
                    }
                }
            }

            // Not Storyline content, return null to use original target
            return null;
        },

        /**
         * Get the owner document of an element
         */
        getOwnerDoc(element) {
            return element?.ownerDocument || document;
        },

        /**
         * Check if element is in an iframe
         */
        isInIframe(element) {
            try {
                return element?.ownerDocument !== document;
            } catch (e) {
                return false;
            }
        }
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
            cursor: move !important;
            user-select: none !important;
        }

        /* Override pointer-events and user-select on page elements during selection */
        .lms-qa-selector-active * {
            pointer-events: auto !important;
            -webkit-user-select: auto !important;
            user-select: auto !important;
            cursor: crosshair !important;
        }

        /* Ensure text is selectable even on restricted elements */
        .lms-qa-selector-active [style*="user-select"],
        .lms-qa-selector-active [style*="-webkit-user-select"],
        .lms-qa-selector-active [unselectable="on"] {
            -webkit-user-select: auto !important;
            user-select: auto !important;
            unselectable: off !important;
        }

        /* Storyline SVG content - enable pointer events */
        .lms-qa-selector-active svg,
        .lms-qa-selector-active svg *,
        .lms-qa-selector-active .slide-object,
        .lms-qa-selector-active .slide-object *,
        .lms-qa-selector-active [class*="slide-object-"],
        .lms-qa-selector-active [class*="slide-object-"] *,
        .lms-qa-selector-active .acc-shadow-dom,
        .lms-qa-selector-active .acc-shadow-dom *,
        .lms-qa-selector-active .acc-shadow-el {
            pointer-events: auto !important;
        }

        /* Make accessibility elements visible when selector is active */
        .lms-qa-selector-active .acc-shadow-dom {
            opacity: 0.01 !important;
            visibility: visible !important;
        }

        /* Highlight data-acc-text elements on hover */
        .lms-qa-selector-active [data-acc-text]:hover {
            outline: 2px dashed #4CAF50 !important;
            outline-offset: 2px !important;
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
                        <div class="lms-selector-step-desc">Hover over questions, click to select<br><small style="color:#888;">Right-click to exclude false positives</small></div>
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

            // Make panel draggable
            this.initDrag();
        },

        initDrag() {
            const header = this.element.querySelector('.lms-selector-header');
            const panel = this.element;
            let isDragging = false;
            let startX, startY, startLeft, startTop;

            header.addEventListener('mousedown', (e) => {
                // Don't start drag on close button
                if (e.target.closest('.lms-selector-close')) return;

                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;

                const rect = panel.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;

                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                // Keep panel within viewport
                const newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + dx));
                const newTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop + dy));

                panel.style.left = `${newLeft}px`;
                panel.style.top = `${newTop}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
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

            // Helper to extract clean text from element
            const getCleanText = (el) => {
                // Clone and remove scripts/styles
                const clone = el.cloneNode(true);
                clone.querySelectorAll('script, style, [aria-hidden="true"]').forEach(n => n.remove());

                // Get text, decode HTML entities, normalize whitespace
                let text = clone.textContent || '';
                text = text.replace(/\s+/g, ' ').trim();

                // Decode common HTML entities
                const textarea = document.createElement('textarea');
                textarea.innerHTML = text;
                text = textarea.value;

                return text.substring(0, 60);
            };

            // Deduplicate by text content
            const seen = new Set();
            const uniqueQTexts = [];
            questions.forEach(el => {
                const text = getCleanText(el);
                if (text && !seen.has(text)) {
                    seen.add(text);
                    uniqueQTexts.push(text);
                }
            });

            const uniqueATexts = [];
            const seenA = new Set();
            answers.forEach(el => {
                const text = getCleanText(el);
                if (text && !seenA.has(text)) {
                    seenA.add(text);
                    uniqueATexts.push(text);
                }
            });

            let html = '';
            uniqueQTexts.slice(0, 5).forEach((q) => {
                const escaped = q.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                html += `<div class="lms-selector-preview-item lms-selector-preview-q">Q: ${escaped}${q.length >= 60 ? '...' : ''}</div>`;
            });

            html += '<div style="height: 8px;"></div>';

            uniqueATexts.slice(0, 5).forEach((a) => {
                const escaped = a.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                html += `<div class="lms-selector-preview-item lms-selector-preview-a">A: ${escaped}${a.length >= 60 ? '...' : ''}</div>`;
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

            // Add class for pointer-events override
            document.body.classList.add('lms-qa-selector-active');

            // Remove unselectable attributes that block selection
            document.querySelectorAll('[unselectable="on"]').forEach(el => {
                el.setAttribute('unselectable', 'off');
                el.dataset.lmsWasUnselectable = 'true';
            });

            document.addEventListener('mousemove', this.handleMouseMove);
            document.addEventListener('click', this.handleClick, true);
            document.addEventListener('contextmenu', this.handleContextMenu, true);
            document.addEventListener('keydown', this.handleKeydown);

            this.sendMessage('SELECTOR_ACTIVATED');
        },

        deactivate() {
            log('Deactivating selector');

            document.removeEventListener('mousemove', this.handleMouseMove);
            document.removeEventListener('click', this.handleClick, true);
            document.removeEventListener('contextmenu', this.handleContextMenu, true);
            document.removeEventListener('keydown', this.handleKeydown);

            // Remove class for pointer-events override
            document.body.classList.remove('lms-qa-selector-active');

            // Restore unselectable attributes
            document.querySelectorAll('[data-lms-was-unselectable="true"]').forEach(el => {
                el.setAttribute('unselectable', 'on');
                delete el.dataset.lmsWasUnselectable;
            });

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

            // Use DOMUtils to also check same-origin iframes
            const target = DOMUtils.elementFromPoint(e.clientX, e.clientY);

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

            // Allow clicks on our panel
            if (e.target.closest(`#${PANEL_ID}`)) return;

            e.preventDefault();
            e.stopPropagation();

            // Use DOMUtils to resolve Storyline SVG elements to their accessibility counterparts
            const target = DOMUtils.elementFromPoint(e.clientX, e.clientY);

            if (!target || Selector.shouldIgnoreElement(target)) return;

            Selector.selectElement(target);
        },

        // Right-click to exclude an element (remove false positive)
        handleContextMenu: (e) => {
            if (State.step === STEP.PREVIEW || State.step === STEP.DONE) return;

            const target = e.target;

            // Allow right-clicks on our panel
            if (target.closest(`#${PANEL_ID}`)) return;

            e.preventDefault();
            e.stopPropagation();

            // Find if this element is in current matches and mark as excluded
            const matchClass = State.step === STEP.PICK_QUESTION ? 'lms-qa-selector-match-question' :
                              State.step === STEP.PICK_ANSWER ? 'lms-qa-selector-match-answer' :
                              'lms-qa-selector-match-correct';

            if (target.classList.contains(matchClass)) {
                target.classList.remove(matchClass);

                // Remove from matches array
                if (State.step === STEP.PICK_ANSWER) {
                    State.answerMatches = State.answerMatches.filter(el => el !== target);
                    Panel.element.querySelector('#answer-count').textContent =
                        `Found ${State.answerMatches.length} matches`;
                } else if (State.step === STEP.PICK_QUESTION) {
                    State.questionMatches = State.questionMatches.filter(el => el !== target);
                    Panel.element.querySelector('#question-count').textContent =
                        `Found ${State.questionMatches.length} matches`;
                } else if (State.step === STEP.PICK_CORRECT) {
                    State.correctMatches = State.correctMatches.filter(el => el !== target);
                    Panel.element.querySelector('#correct-count').textContent =
                        `Found ${State.correctMatches.length} matches`;
                }

                log('Excluded element from selection', target);
            }
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

            // Clear highlights from all accessible documents (including iframes)
            DOMUtils.querySelectorAll('.lms-qa-selector-match-question').forEach(el => {
                el.classList.remove('lms-qa-selector-match-question');
            });
            DOMUtils.querySelectorAll('.lms-qa-selector-match-answer').forEach(el => {
                el.classList.remove('lms-qa-selector-match-answer');
            });
            DOMUtils.querySelectorAll('.lms-qa-selector-match-correct').forEach(el => {
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
            // Query the element's owner document (handles elements from iframes)
            const ownerDoc = DOMUtils.getOwnerDoc(element);
            const matches = Array.from(ownerDoc.querySelectorAll(selector));

            log(`Selected: ${selector} (${matches.length} matches, iframe: ${DOMUtils.isInIframe(element)})`);

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

            // Also trigger seed extraction using the first question's text
            // This searches JS files for additional Q&A based on the selected question
            if (State.selectedQuestion) {
                const seedText = State.selectedQuestion.textContent?.trim() ||
                                 State.selectedQuestion.getAttribute('data-acc-text') ||
                                 State.selectedQuestion.getAttribute('aria-label');

                if (seedText && seedText.length > 10) {
                    log('Triggering seed extraction with:', seedText.substring(0, 50));
                    this.sendMessage('TRIGGER_SEED_EXTRACT', { seedText });
                }
            }

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
    // RULE EXTRACTOR
    // Uses saved selectors to extract Q&A with proximity-based grouping
    // ═══════════════════════════════════════════════════════════════════════════

    const RuleExtractor = {
        /**
         * Apply a saved rule to extract Q&A from the current page
         */
        extract(rule) {
            if (!rule?.questionSelector || !rule?.answerSelector) {
                log('Invalid rule: missing selectors');
                return { success: false, error: 'Invalid rule' };
            }

            log('Applying rule', rule);

            try {
                // Find all question and answer elements (also searches same-origin iframes)
                const questionElements = DOMUtils.querySelectorAll(rule.questionSelector);
                const answerElements = DOMUtils.querySelectorAll(rule.answerSelector);
                const correctElements = rule.correctSelector
                    ? DOMUtils.querySelectorAll(rule.correctSelector)
                    : [];

                log(`Found: ${questionElements.length} questions, ${answerElements.length} answers, ${correctElements.length} correct indicators`);

                if (questionElements.length === 0) {
                    return { success: false, error: 'No questions found with saved selector' };
                }

                // Group answers with their questions using DOM proximity
                const qaGroups = this.groupByProximity(questionElements, answerElements, correctElements);

                // Convert to flat item list for compatibility with existing renderer
                const items = this.groupsToItems(qaGroups);

                // Build results object compatible with existing popup renderer
                const results = {
                    qa: {
                        items: items,
                        total: items.length,
                        questions: qaGroups.length,
                        correct: items.filter(i => i.correct).length
                    },
                    apis: [],
                    logs: [{
                        level: 'INFO',
                        message: `Extracted ${qaGroups.length} questions with ${items.filter(i => i.type === 'answer').length} answers using saved rule`,
                        timestamp: new Date().toISOString()
                    }],
                    source: 'selector-rule',
                    url: window.location.href
                };

                log('Extraction complete', results);
                return { success: true, results, qaGroups };

            } catch (error) {
                log('Extraction error', error);
                return { success: false, error: error.message };
            }
        },

        /**
         * Group answers with questions based on DOM proximity
         * Uses multiple strategies: common ancestor, document order, spatial position
         */
        groupByProximity(questions, answers, correctIndicators) {
            const groups = [];
            const usedAnswers = new Set();

            // Create a set of correct answer elements for quick lookup
            const correctSet = new Set(correctIndicators);

            // For each question, find its associated answers
            questions.forEach((questionEl, qIndex) => {
                const group = {
                    questionIndex: qIndex,
                    question: {
                        text: this.getElementText(questionEl),
                        element: questionEl,
                        confidence: 95
                    },
                    answers: []
                };

                // Strategy 1: Find answers within same container
                const container = this.findCommonContainer(questionEl, answers);

                // Strategy 2: Find answers by document order (between this Q and next Q)
                const nextQuestion = questions[qIndex + 1];
                const answersInRange = this.findAnswersBetween(questionEl, nextQuestion, answers, usedAnswers);

                // Strategy 3: Find answers by spatial proximity
                const nearbyAnswers = this.findNearbyAnswers(questionEl, answers, usedAnswers);

                // Combine strategies, preferring document order
                let associatedAnswers = answersInRange.length > 0 ? answersInRange : nearbyAnswers;

                // If we found a common container, filter to only answers in that container
                if (container && container !== document.body) {
                    associatedAnswers = associatedAnswers.filter(a => container.contains(a));
                }

                // Add answers to group
                associatedAnswers.forEach(answerEl => {
                    if (usedAnswers.has(answerEl)) return;
                    usedAnswers.add(answerEl);

                    const isCorrect = this.isAnswerCorrect(answerEl, correctSet, correctIndicators);

                    group.answers.push({
                        text: this.getElementText(answerEl),
                        element: answerEl,
                        correct: isCorrect,
                        confidence: 90
                    });
                });

                groups.push(group);
            });

            return groups;
        },

        /**
         * Find answers that appear between this question and the next in document order
         */
        findAnswersBetween(questionEl, nextQuestionEl, allAnswers, usedAnswers) {
            const result = [];

            // Get document position of elements
            const qPos = this.getDocumentPosition(questionEl);
            const nextQPos = nextQuestionEl ? this.getDocumentPosition(nextQuestionEl) : Infinity;

            for (const answer of allAnswers) {
                if (usedAnswers.has(answer)) continue;

                const aPos = this.getDocumentPosition(answer);

                // Answer must be after this question and before next question
                if (aPos > qPos && aPos < nextQPos) {
                    result.push(answer);
                }
            }

            return result;
        },

        /**
         * Find answers that are spatially close to the question
         */
        findNearbyAnswers(questionEl, allAnswers, usedAnswers, maxDistance = 500) {
            const qRect = questionEl.getBoundingClientRect();
            const qCenter = {
                x: qRect.left + qRect.width / 2,
                y: qRect.top + qRect.height / 2
            };

            const withDistance = [];

            for (const answer of allAnswers) {
                if (usedAnswers.has(answer)) continue;

                const aRect = answer.getBoundingClientRect();
                const aCenter = {
                    x: aRect.left + aRect.width / 2,
                    y: aRect.top + aRect.height / 2
                };

                // Prefer vertical proximity (answers usually below questions)
                const distance = Math.abs(aCenter.y - qRect.bottom) + Math.abs(aCenter.x - qCenter.x) * 0.5;

                if (distance < maxDistance) {
                    withDistance.push({ element: answer, distance });
                }
            }

            // Sort by distance and return elements
            withDistance.sort((a, b) => a.distance - b.distance);
            return withDistance.map(w => w.element);
        },

        /**
         * Find the smallest common container for a question and potential answers
         */
        findCommonContainer(questionEl, answers) {
            let container = questionEl.parentElement;
            let depth = 0;
            const maxDepth = 10;

            while (container && container !== document.body && depth < maxDepth) {
                // Check if this container has any answers
                const answersInContainer = answers.filter(a => container.contains(a));
                if (answersInContainer.length > 0) {
                    return container;
                }
                container = container.parentElement;
                depth++;
            }

            return null;
        },

        /**
         * Determine if an answer is marked as correct
         */
        isAnswerCorrect(answerEl, correctSet, correctIndicators) {
            // Check if answer element itself is in correct set
            if (correctSet.has(answerEl)) return true;

            // Check if answer contains or is contained by a correct indicator
            for (const correct of correctIndicators) {
                if (answerEl.contains(correct) || correct.contains(answerEl)) {
                    return true;
                }
            }

            // Check data attributes
            if (answerEl.dataset.correct === 'true' ||
                answerEl.dataset.answer === 'true' ||
                answerEl.dataset.right === 'true') {
                return true;
            }

            // Check classes
            if (answerEl.classList.contains('correct') ||
                answerEl.classList.contains('right-answer') ||
                answerEl.classList.contains('is-correct')) {
                return true;
            }

            // Check value attribute (for form elements)
            const value = answerEl.value || answerEl.getAttribute('value');
            if (value === 'true' || value === 'correct' || value === '1') {
                return true;
            }

            return false;
        },

        /**
         * Get document position for ordering elements
         */
        getDocumentPosition(element) {
            let pos = 0;
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_ELEMENT,
                null,
                false
            );

            while (walker.nextNode()) {
                if (walker.currentNode === element) {
                    return pos;
                }
                pos++;
            }

            return pos;
        },

        /**
         * Get clean text content from an element
         */
        getElementText(element) {
            // Clone to avoid modifying original
            const clone = element.cloneNode(true);

            // Remove script and style elements
            clone.querySelectorAll('script, style').forEach(el => el.remove());

            // Get text and clean it up
            let text = clone.textContent || clone.innerText || '';
            text = text.replace(/\s+/g, ' ').trim();

            // Limit length
            if (text.length > 500) {
                text = text.substring(0, 497) + '...';
            }

            return text;
        },

        /**
         * Convert grouped Q&A to flat item list for existing renderer
         */
        groupsToItems(groups) {
            const items = [];

            groups.forEach(group => {
                // Add question
                items.push({
                    type: 'question',
                    text: group.question.text,
                    confidence: group.question.confidence,
                    source: 'selector-rule',
                    correct: false
                });

                // Add answers
                group.answers.forEach(answer => {
                    items.push({
                        type: 'answer',
                        text: answer.text,
                        confidence: answer.confidence,
                        source: 'selector-rule',
                        correct: answer.correct
                    });
                });
            });

            return items;
        },

        /**
         * Send extraction results to extension
         */
        sendResults(results) {
            window.postMessage({
                type: `${PREFIX}EXTRACTION_COMPLETE`,
                payload: results,
                timestamp: Date.now()
            }, '*');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE HANDLING
    // ═══════════════════════════════════════════════════════════════════════════

    // Track pending hybrid extraction
    let pendingHybridResults = null;

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

            case 'CMD_APPLY_RULE':
                const payload = event.data.payload || {};
                const result = RuleExtractor.extract(payload.rule);

                if (result.success) {
                    if (payload.hybrid) {
                        // Store results and request API detection
                        pendingHybridResults = result.results;
                        log('Hybrid mode: requesting API detection');
                        window.postMessage({
                            type: `${PREFIX}CMD_DETECT_APIS`,
                            payload: {},
                            timestamp: Date.now()
                        }, '*');
                    } else {
                        // Non-hybrid: send results immediately
                        RuleExtractor.sendResults(result.results);
                    }
                } else {
                    window.postMessage({
                        type: `${PREFIX}EXTRACTION_ERROR`,
                        payload: { error: result.error },
                        timestamp: Date.now()
                    }, '*');
                }
                break;

            case 'APIS_DETECTED':
                // Merge API results with pending Q&A extraction
                if (pendingHybridResults) {
                    const apis = event.data.payload?.apis || [];
                    log(`Hybrid mode: merging ${apis.length} API(s) with extraction results`);

                    // Merge APIs into results
                    pendingHybridResults.apis = apis;
                    pendingHybridResults.logs.push({
                        level: 'INFO',
                        message: `Detected ${apis.length} SCORM/xAPI API(s)`,
                        timestamp: new Date().toISOString()
                    });

                    RuleExtractor.sendResults(pendingHybridResults);
                    pendingHybridResults = null;
                }
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
        getURLPattern: () => URLMatcher.getPatternKey(),
        applyRule: (rule) => RuleExtractor.extract(rule),
        extractWithSelectors: (qSel, aSel, cSel) => RuleExtractor.extract({
            questionSelector: qSel,
            answerSelector: aSel,
            correctSelector: cSel
        })
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    log('Element selector loaded');

})();
