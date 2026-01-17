/**
 * LMS QA Validator - DOM Input Normalization
 *
 * Implements Directive #9: Normalize DOM inputs before processing
 * Preprocesses DOM text (whitespace, hidden elements, duplicates) in one place
 * so every extractor doesn't compensate differently.
 *
 * @fileoverview DOM normalization utilities
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Elements that are considered hidden
 */
const HIDDEN_DISPLAY_VALUES = ['none', 'hidden'];

/**
 * Elements typically containing non-content
 */
const NON_CONTENT_TAGS = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas',
    'audio', 'video', 'iframe', 'object', 'embed', 'head', 'meta', 'link'
];

/**
 * Elements typically containing navigation/chrome
 */
const CHROME_TAGS = ['nav', 'header', 'footer', 'aside', 'menu', 'menuitem'];

/**
 * Common aria roles for non-content
 */
const NON_CONTENT_ROLES = ['navigation', 'banner', 'contentinfo', 'complementary', 'menu'];

/**
 * Placeholder patterns
 */
const PLACEHOLDER_PATTERNS = [
    /^choose\.{0,3}$/i,
    /^select\.{0,3}$/i,
    /^select an? option$/i,
    /^select one$/i,
    /^-{1,5}$/,
    /^-+\s*select\s*-+$/i,
    /^\s*$/
];

// ═══════════════════════════════════════════════════════════════════════════
// TEXT NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize whitespace in text
 * - Collapses multiple spaces/tabs to single space
 * - Trims leading/trailing whitespace
 * - Normalizes line breaks
 *
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeWhitespace(text) {
    if (!text) return '';

    return text
        .replace(/[\r\n]+/g, ' ')           // Normalize line breaks
        .replace(/\t+/g, ' ')               // Tabs to spaces
        .replace(/\s{2,}/g, ' ')            // Collapse multiple spaces
        .trim();
}

/**
 * Normalize Unicode characters
 * - Converts smart quotes to regular quotes
 * - Normalizes dashes
 * - Handles common Unicode issues
 *
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeUnicode(text) {
    if (!text) return '';

    return text
        // Smart quotes to regular
        .replace(/[\u2018\u2019\u201A]/g, "'")
        .replace(/[\u201C\u201D\u201E]/g, '"')
        // Dashes
        .replace(/[\u2013\u2014]/g, '-')
        // Ellipsis
        .replace(/\u2026/g, '...')
        // Non-breaking space
        .replace(/\u00A0/g, ' ')
        // Zero-width characters
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
}

/**
 * Strip HTML tags from text
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
function stripHtmlTags(html) {
    if (!html) return '';

    // Create a temporary element to leverage browser's HTML parsing
    if (typeof document !== 'undefined') {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent || temp.innerText || '';
    }

    // Fallback for non-browser environment
    return html.replace(/<[^>]*>/g, '');
}

/**
 * Full text normalization pipeline
 * @param {string} text - Text to normalize
 * @returns {string} Fully normalized text
 */
function normalizeText(text) {
    if (!text) return '';

    return normalizeWhitespace(normalizeUnicode(text));
}

// ═══════════════════════════════════════════════════════════════════════════
// ELEMENT VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if an element is visible
 * @param {Element} element - DOM element
 * @returns {boolean} Whether element is visible
 */
function isElementVisible(element) {
    if (!element) return false;

    // Check basic properties
    if (element.hidden) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;

    // Check computed styles if available
    if (typeof getComputedStyle !== 'undefined') {
        try {
            const style = getComputedStyle(element);
            if (style.display === 'none') return false;
            if (style.visibility === 'hidden') return false;
            if (style.opacity === '0') return false;
        } catch (e) {
            // Element may not be in DOM
        }
    }

    // Check inline styles
    const inlineStyle = element.style;
    if (inlineStyle) {
        if (HIDDEN_DISPLAY_VALUES.includes(inlineStyle.display)) return false;
        if (inlineStyle.visibility === 'hidden') return false;
    }

    return true;
}

/**
 * Check if an element contains actual content (not chrome/navigation)
 * @param {Element} element - DOM element
 * @returns {boolean} Whether element likely contains content
 */
function isContentElement(element) {
    if (!element || !element.tagName) return false;

    const tagName = element.tagName.toLowerCase();

    // Exclude non-content tags
    if (NON_CONTENT_TAGS.includes(tagName)) return false;

    // Check aria roles
    const role = element.getAttribute('role');
    if (role && NON_CONTENT_ROLES.includes(role)) return false;

    // Check for common non-content classes
    const className = element.className || '';
    if (typeof className === 'string') {
        if (/\b(nav|menu|header|footer|sidebar|toolbar|modal-backdrop)\b/i.test(className)) {
            return false;
        }
    }

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM EXTRACTION NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get normalized text content from an element
 * Handles visibility, nested elements, and text normalization
 *
 * @param {Element} element - DOM element
 * @param {Object} [options] - Options
 * @param {boolean} [options.includeHidden=false] - Include hidden elements
 * @param {boolean} [options.recursive=true] - Get text recursively
 * @returns {string} Normalized text content
 */
function getElementText(element, options = {}) {
    const { includeHidden = false, recursive = true } = options;

    if (!element) return '';

    // Check visibility
    if (!includeHidden && !isElementVisible(element)) {
        return '';
    }

    // Check if content element
    if (!isContentElement(element)) {
        return '';
    }

    let text = '';

    if (recursive) {
        // Walk text nodes to preserve structure
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (!includeHidden && !isElementVisible(parent)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (!isContentElement(parent)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            text += node.textContent + ' ';
        }
    } else {
        text = element.textContent || '';
    }

    return normalizeText(text);
}

/**
 * Check if text is a placeholder (Directive #9)
 * @param {string} text - Text to check
 * @returns {boolean} Whether text is a placeholder
 */
function isPlaceholder(text) {
    if (!text) return true;

    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return true;

    return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Extract all visible text elements from a container
 * Returns deduplicated, normalized text items
 *
 * @param {Element} container - Container element
 * @param {string} selector - CSS selector for target elements
 * @param {Object} [options] - Options
 * @returns {Array<{element: Element, text: string, index: number}>}
 */
function extractTextElements(container, selector, options = {}) {
    if (!container || !selector) return [];

    const elements = container.querySelectorAll(selector);
    const seen = new Set();
    const results = [];

    elements.forEach((element, index) => {
        // Check visibility
        if (!options.includeHidden && !isElementVisible(element)) {
            return;
        }

        // Get normalized text
        const text = getElementText(element, options);

        // Skip empty or placeholder
        if (!text || isPlaceholder(text)) {
            return;
        }

        // Deduplicate
        const key = text.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);

        results.push({
            element,
            text,
            index
        });
    });

    return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize form input value
 * @param {Element} input - Input element
 * @returns {string} Normalized value
 */
function normalizeInputValue(input) {
    if (!input) return '';

    let value = '';

    if (input.tagName === 'SELECT') {
        const selected = input.options[input.selectedIndex];
        value = selected ? (selected.text || selected.value) : '';
    } else if (input.type === 'checkbox' || input.type === 'radio') {
        // For checkbox/radio, return the label text or value
        const label = input.labels?.[0];
        value = label ? getElementText(label) : input.value;
    } else {
        value = input.value || '';
    }

    return normalizeText(value);
}

/**
 * Get normalized answer options from form elements
 * Handles select, radio groups, checkbox groups
 *
 * @param {Element} container - Container element
 * @returns {Array<{element: Element, text: string, value: string, isSelected: boolean}>}
 */
function extractFormOptions(container) {
    if (!container) return [];

    const options = [];

    // Handle select elements
    const selects = container.querySelectorAll('select');
    selects.forEach(select => {
        Array.from(select.options).forEach(option => {
            const text = normalizeText(option.text);
            if (text && !isPlaceholder(text)) {
                options.push({
                    element: option,
                    text,
                    value: option.value,
                    isSelected: option.selected
                });
            }
        });
    });

    // Handle radio/checkbox inputs
    const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    inputs.forEach(input => {
        if (!isElementVisible(input)) return;

        // Find label
        let text = '';
        if (input.labels && input.labels.length > 0) {
            text = getElementText(input.labels[0]);
        } else if (input.id) {
            const label = container.querySelector(`label[for="${input.id}"]`);
            if (label) text = getElementText(label);
        }

        // Fallback to nearby text
        if (!text) {
            const parent = input.parentElement;
            if (parent) {
                text = normalizeText(parent.textContent);
            }
        }

        if (text && !isPlaceholder(text)) {
            options.push({
                element: input,
                text,
                value: input.value,
                isSelected: input.checked
            });
        }
    });

    return options;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deduplicate items by key function
 * @param {Array} items - Items to deduplicate
 * @param {Function} keyFn - Function to extract key from item
 * @returns {Array} Deduplicated items
 */
function deduplicateBy(items, keyFn) {
    const seen = new Set();
    return items.filter(item => {
        const key = keyFn(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Deduplicate by normalized text
 * @param {Array<{text: string}>} items - Items with text property
 * @returns {Array} Deduplicated items
 */
function deduplicateByText(items) {
    return deduplicateBy(items, item => (item.text || '').toLowerCase().trim());
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZATION REPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a normalization report for an extraction
 * Useful for debugging and understanding what was normalized
 *
 * @param {Object} before - Before normalization counts
 * @param {Object} after - After normalization counts
 * @returns {Object} Normalization report
 */
function createNormalizationReport(before, after) {
    return {
        timestamp: Date.now(),
        before: { ...before },
        after: { ...after },
        removed: {
            hidden: (before.total || 0) - (after.total || 0),
            placeholders: before.placeholders || 0,
            duplicates: before.duplicates || 0,
            empty: before.empty || 0
        },
        retained: after.total || 0
    };
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // Text normalization
        normalizeWhitespace,
        normalizeUnicode,
        normalizeText,
        stripHtmlTags,

        // Element utilities
        isElementVisible,
        isContentElement,
        getElementText,

        // Content extraction
        isPlaceholder,
        extractTextElements,
        normalizeInputValue,
        extractFormOptions,

        // Deduplication
        deduplicateBy,
        deduplicateByText,

        // Reporting
        createNormalizationReport,

        // Constants
        NON_CONTENT_TAGS,
        CHROME_TAGS,
        PLACEHOLDER_PATTERNS
    };
}

if (typeof window !== 'undefined') {
    window.LMSQANormalize = {
        normalizeWhitespace,
        normalizeUnicode,
        normalizeText,
        stripHtmlTags,
        isElementVisible,
        isContentElement,
        getElementText,
        isPlaceholder,
        extractTextElements,
        normalizeInputValue,
        extractFormOptions,
        deduplicateBy,
        deduplicateByText,
        createNormalizationReport,
        NON_CONTENT_TAGS,
        CHROME_TAGS,
        PLACEHOLDER_PATTERNS
    };
}
