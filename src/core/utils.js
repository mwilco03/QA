/**
 * Utilities Module
 *
 * Shared utility functions used across all modules.
 * Import what you need - no more copy-paste.
 */

import { CONFIG, CODE_INDICATORS, CORRECT_INDICATORS, PLACEHOLDER_TEXT } from './constants.js';
import { Logger } from './logger.js';

export const Utils = {
    matchesAny(value, patterns) {
        if (!value) return false;
        const normalized = String(value).toLowerCase().trim();
        return patterns.some(p => normalized === p.toLowerCase());
    },

    /**
     * Check if text looks like code rather than natural language content
     */
    isCodeLike(text) {
        if (!text || text.length < 5) return true;

        for (const pattern of CODE_INDICATORS) {
            if (pattern.test(text)) {
                return true;
            }
        }

        const codeCharCount = (text.match(/[{}\[\]();=<>!&|+\-*\/]/g) || []).length;
        const codeCharRatio = codeCharCount / text.length;
        if (codeCharRatio > 0.15) return true;

        const words = text.split(/\s+/);
        const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
        if (avgWordLength < 3 && words.length > 3) return true;

        if (/^[a-z]+[A-Z]/.test(text) && !text.includes(' ')) return true;

        return false;
    },

    /**
     * Check if text looks like natural language content
     */
    isNaturalLanguage(text) {
        if (!text || text.length < 10) return false;
        if (!text.includes(' ')) return false;
        if (!/^[A-Z0-9]/.test(text.trim())) return false;

        const words = text.trim().split(/\s+/);
        if (words.length < 2) return false;

        const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
        if (avgLen < 2 || avgLen > 15) return false;

        return !Utils.isCodeLike(text);
    },

    isCorrectAnswer(element) {
        if (!element) return false;

        const value = element.value || element.getAttribute('value');
        if (Utils.matchesAny(value, CORRECT_INDICATORS.VALUES)) {
            return true;
        }

        for (const attr of CORRECT_INDICATORS.DATA_ATTRS) {
            if (element.dataset?.[attr] === 'true' ||
                element.getAttribute(`data-${attr}`) === 'true') {
                return true;
            }
        }

        if (element.classList) {
            for (const cls of CORRECT_INDICATORS.CLASSES) {
                if (element.classList.contains(cls)) {
                    return true;
                }
            }
        }

        return false;
    },

    isPlaceholder(text) {
        if (!text) return true;
        return Utils.matchesAny(text.trim(), PLACEHOLDER_TEXT);
    },

    safeJsonParse(str, defaultValue = null) {
        try {
            return JSON.parse(str);
        } catch {
            return defaultValue;
        }
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    generateId(prefix = '') {
        const random = Math.random().toString(36).substring(2, 8);
        return prefix ? `${prefix}-${random}` : random;
    },

    truncate(str, maxLength = 100) {
        if (!str || str.length <= maxLength) return str;
        return str.substring(0, maxLength - 3) + '...';
    },

    async fetchWithTimeout(url, timeout = CONFIG.MAX_FETCH_TIMEOUT) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout: ${url}`);
            }
            throw error;
        }
    },

    isSameOrigin(url) {
        try {
            const parsed = new URL(url, window.location.href);
            return parsed.origin === window.location.origin;
        } catch {
            return false;
        }
    },

    dedupeBy(array, keyFn) {
        const seen = new Set();
        return array.filter(item => {
            const key = keyFn(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    },

    /**
     * Detect compression type in suspend_data
     */
    detectCompression(data) {
        if (!data || typeof data !== 'string') return null;

        if (data.startsWith('H4sI')) return 'gzip';

        if (data.startsWith('[') && /^\[\d+(?:,\d+)*\]$/.test(data.substring(0, 100))) {
            try {
                const arr = JSON.parse(data);
                if (Array.isArray(arr) && arr.length > 0 && arr.every(n => typeof n === 'number')) {
                    return 'lzw';
                }
            } catch {}
        }

        if (data.length >= 50 && /^[A-Za-z0-9+/=]+$/.test(data) && !data.includes(' ')) {
            if (data.length > 100) return 'base64';
        }

        if (data.length > 100 && !/[aeiou]{3,}/i.test(data) && /^[A-Za-z0-9+/=_-]+$/.test(data)) {
            return 'storyline-custom';
        }

        return null;
    },

    /**
     * Base64 decode with error handling
     */
    base64Decode(str) {
        try {
            return atob(str);
        } catch (e) {
            Logger.debug('Base64 decode failed', e);
            return null;
        }
    },

    /**
     * Base64 encode
     */
    base64Encode(str) {
        try {
            return btoa(str);
        } catch (e) {
            Logger.debug('Base64 encode failed', e);
            return null;
        }
    }
};
