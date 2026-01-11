/**
 * LMS QA Validator - Service Worker v3.0
 * Handles cross-tab state, downloads, and background operations
 * 
 * @fileoverview Background service worker for extension coordination
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MSG = Object.freeze({
    READY: 'READY',
    SCAN_STARTED: 'SCAN_STARTED',
    SCAN_COMPLETE: 'SCAN_COMPLETE',
    SCAN_ERROR: 'SCAN_ERROR',
    PROGRESS: 'PROGRESS',
    STATE: 'STATE',
    CMI_DATA: 'CMI_DATA',
    TEST_RESULT: 'TEST_RESULT',
    SET_COMPLETION_RESULT: 'SET_COMPLETION_RESULT',
    AUTO_SELECT_RESULT: 'AUTO_SELECT_RESULT',
    SELECTOR_ACTIVATED: 'SELECTOR_ACTIVATED',
    SELECTOR_DEACTIVATED: 'SELECTOR_DEACTIVATED',
    SELECTOR_RULE_CREATED: 'SELECTOR_RULE_CREATED',
    EXTRACTION_COMPLETE: 'EXTRACTION_COMPLETE',
    EXTRACTION_ERROR: 'EXTRACTION_ERROR'
});

const LMS_URL_PATTERNS = [
    /scorm/i, /lms/i, /learn/i, /training/i, /course/i,
    /articulate/i, /storyline/i, /captivate/i, /lectora/i,
    /bravo/i, /moodle/i, /blackboard/i, /canvas/i
];

const MAX_SCAN_HISTORY = 50;

// ═══════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

const tabStates = new Map();
const tabRelationships = new Map();

const TabState = {
    get(tabId) {
        return tabStates.get(tabId) || null;
    },

    set(tabId, state) {
        tabStates.set(tabId, state);
    },

    update(tabId, updates) {
        const current = tabStates.get(tabId) || {};
        tabStates.set(tabId, { ...current, ...updates });
    },

    delete(tabId) {
        tabStates.delete(tabId);
        tabRelationships.delete(tabId);
        
        for (const [parentId, children] of tabRelationships) {
            children.delete(tabId);
        }
    },

    addRelationship(childId, parentId) {
        if (!tabRelationships.has(parentId)) {
            tabRelationships.set(parentId, new Set());
        }
        tabRelationships.get(parentId).add(childId);
        
        this.update(childId, { openerTabId: parentId });
    },

    getChildren(tabId) {
        return tabRelationships.get(tabId) || new Set();
    },

    getParent(tabId) {
        const state = tabStates.get(tabId);
        return state?.openerTabId || null;
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════

const log = {
    info: (msg, data) => console.log(`[LMS QA SW] ${msg}`, data !== undefined ? data : ''),
    warn: (msg, data) => console.warn(`[LMS QA SW] ${msg}`, data !== undefined ? data : ''),
    error: (msg, data) => console.error(`[LMS QA SW] ${msg}`, data !== undefined ? data : ''),
    debug: (msg, data) => console.log(`[LMS QA SW] [DEBUG] ${msg}`, data !== undefined ? data : '')
};

// ═══════════════════════════════════════════════════════════════════════════
// TAB TRACKING
// ═══════════════════════════════════════════════════════════════════════════

function isLikelyLMSUrl(url) {
    if (!url) return false;
    return LMS_URL_PATTERNS.some(pattern => pattern.test(url));
}

async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['content/content.js']
        });
        log.info(`Injected into tab ${tabId}`);
        return true;
    } catch (error) {
        log.debug(`Could not inject into tab ${tabId}: ${error.message}`);
        return false;
    }
}

// Track new tabs
chrome.tabs.onCreated.addListener((tab) => {
    log.debug(`Tab created: ${tab.id}, opener: ${tab.openerTabId}`);
    
    if (tab.openerTabId) {
        TabState.addRelationship(tab.id, tab.openerTabId);
    }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    const shouldInject = isLikelyLMSUrl(tab.url) || 
                        TabState.getParent(tabId) !== null ||
                        TabState.getChildren(tabId).size > 0;

    if (shouldInject) {
        await injectContentScript(tabId);
    }

    const existing = TabState.get(tabId);
    if (existing) {
        TabState.update(tabId, { url: tab.url, ready: false, results: null });
    }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
    TabState.delete(tabId);
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url || message.url;
    const type = message.type;

    log.debug(`Message: ${type} from tab ${tabId}`);

    // Handle different message types
    switch (type) {
        case MSG.READY:
            log.info(`Validator ready on tab ${tabId}`);
            TabState.update(tabId, {
                ready: true,
                version: message.payload?.version,
                url
            });
            break;

        case MSG.SCAN_STARTED:
            log.info(`Scan started on tab ${tabId}`);
            TabState.update(tabId, { scanning: true, scanStarted: Date.now() });
            notifyPopup(MSG.SCAN_STARTED, { tabId });
            break;

        case MSG.PROGRESS:
            log.debug(`Progress: Step ${message.payload?.step}`);
            notifyPopup(MSG.PROGRESS, { tabId, ...message.payload });
            break;

        case MSG.SCAN_COMPLETE:
            log.info(`Scan complete on tab ${tabId}`);
            TabState.update(tabId, {
                scanning: false,
                lastScan: Date.now(),
                results: message.payload
            });
            storeScanResult(url, message.payload);
            notifyPopup(MSG.SCAN_COMPLETE, { tabId, results: message.payload });
            break;

        case MSG.SCAN_ERROR:
            log.error(`Scan error on tab ${tabId}:`, message.payload?.error);
            TabState.update(tabId, { scanning: false, error: message.payload?.error });
            notifyPopup(MSG.SCAN_ERROR, { tabId, error: message.payload?.error });
            break;

        case MSG.TEST_RESULT:
            notifyPopup(MSG.TEST_RESULT, { tabId, results: message.payload });
            break;

        case MSG.SET_COMPLETION_RESULT:
            notifyPopup(MSG.SET_COMPLETION_RESULT, { tabId, results: message.payload });
            break;

        case MSG.CMI_DATA:
            notifyPopup(MSG.CMI_DATA, { tabId, data: message.payload?.data || message.payload });
            break;

        case MSG.AUTO_SELECT_RESULT:
            notifyPopup(MSG.AUTO_SELECT_RESULT, { tabId, ...message.payload });
            break;

        case MSG.SELECTOR_ACTIVATED:
            log.info(`Selector activated on tab ${tabId}`);
            notifyPopup(MSG.SELECTOR_ACTIVATED, { tabId });
            break;

        case MSG.SELECTOR_DEACTIVATED:
            log.info(`Selector deactivated on tab ${tabId}`);
            notifyPopup(MSG.SELECTOR_DEACTIVATED, { tabId });
            break;

        case MSG.SELECTOR_RULE_CREATED:
            log.info(`Selector rule created`, message.payload?.rule);
            storeSelectionRule(message.payload?.rule);
            notifyPopup(MSG.SELECTOR_RULE_CREATED, { tabId, rule: message.payload?.rule });
            break;

        case MSG.EXTRACTION_COMPLETE:
            log.info(`Extraction complete on tab ${tabId}`);
            TabState.update(tabId, {
                results: message.payload,
                lastScan: Date.now()
            });
            notifyPopup(MSG.EXTRACTION_COMPLETE, { tabId, results: message.payload });
            break;

        case MSG.EXTRACTION_ERROR:
            log.error(`Extraction error on tab ${tabId}:`, message.payload?.error);
            notifyPopup(MSG.EXTRACTION_ERROR, { tabId, error: message.payload?.error });
            break;

        case MSG.STATE:
            TabState.update(tabId, { results: message.payload });
            notifyPopup('STATE_UPDATE', { tabId, results: message.payload });
            break;

        case 'GET_TAB_STATE':
            const requestedTabId = message.tabId || tabId;
            const state = TabState.get(requestedTabId);
            log.debug(`GET_TAB_STATE for tab ${requestedTabId}`);
            sendResponse(state);
            return true;

        case 'GET_RELATED_TABS':
            getRelatedTabs(message.tabId || tabId).then(tabs => {
                sendResponse({ tabs });
            });
            return true;

        case 'SCAN_TAB':
            scanSpecificTab(message.targetTabId).then(result => {
                sendResponse(result);
            });
            return true;

        case 'DOWNLOAD':
            handleDownload(message.format, message.data, message.filename);
            break;

        case 'EXPORT_DATA':
            handleExport(message.format, message.data, message.filename);
            break;

        case 'CLEAR_TAB_STATE':
            if (message.tabId) {
                TabState.delete(message.tabId);
                log.info(`Cleared state for tab ${message.tabId}`);
            }
            break;

        case 'GET_SELECTOR_RULES':
            getSelectionRules(message.urlPattern).then(rules => {
                sendResponse({ rules });
            });
            return true;

        case 'GET_ALL_SELECTOR_RULES':
            getAllSelectionRules().then(rules => {
                sendResponse({ rules });
            });
            return true;

        case 'DELETE_SELECTOR_RULE':
            deleteSelectionRule(message.urlPattern).then(() => {
                sendResponse({ success: true });
            });
            return true;

        case 'IMPORT_SELECTOR_RULES':
            importSelectionRules(message.rules).then((result) => {
                sendResponse(result);
            });
            return true;
    }

    return false;
});

// ═══════════════════════════════════════════════════════════════════════════
// POPUP COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════

async function notifyPopup(type, payload) {
    try {
        await chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
        // Popup not open - this is expected
    }
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup') {
        port.onMessage.addListener(async (msg) => {
            if (msg.type === 'GET_CURRENT_STATE') {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    const state = TabState.get(tab.id);
                    port.postMessage({ type: 'CURRENT_STATE', tabId: tab.id, state });
                }
            }
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// RELATED TABS
// ═══════════════════════════════════════════════════════════════════════════

async function getRelatedTabs(tabId) {
    const related = [];
    const allTabs = await chrome.tabs.query({});

    // Parent
    const parentId = TabState.getParent(tabId);
    if (parentId) {
        const parentTab = allTabs.find(t => t.id === parentId);
        if (parentTab) {
            related.push({
                id: parentTab.id,
                title: parentTab.title,
                url: parentTab.url,
                relationship: 'parent',
                hasResults: TabState.get(parentTab.id)?.results !== null
            });
        }
    }

    // Children
    const children = TabState.getChildren(tabId);
    for (const childId of children) {
        const childTab = allTabs.find(t => t.id === childId);
        if (childTab) {
            related.push({
                id: childTab.id,
                title: childTab.title,
                url: childTab.url,
                relationship: 'child',
                hasResults: TabState.get(childTab.id)?.results !== null
            });
        }
    }

    // Siblings
    if (parentId) {
        const siblings = TabState.getChildren(parentId);
        for (const siblingId of siblings) {
            if (siblingId !== tabId) {
                const siblingTab = allTabs.find(t => t.id === siblingId);
                if (siblingTab) {
                    related.push({
                        id: siblingTab.id,
                        title: siblingTab.title,
                        url: siblingTab.url,
                        relationship: 'sibling',
                        hasResults: TabState.get(siblingTab.id)?.results !== null
                    });
                }
            }
        }
    }

    return related;
}

async function scanSpecificTab(tabId) {
    try {
        await injectContentScript(tabId);
        await new Promise(r => setTimeout(r, 100));
        await chrome.tabs.sendMessage(tabId, { type: 'SCAN' });
        return { success: true, tabId };
    } catch (error) {
        log.error(`Failed to scan tab ${tabId}: ${error.message}`);
        return { success: false, error: error.message, tabId };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SELECTOR RULES STORAGE
// ═══════════════════════════════════════════════════════════════════════════

async function storeSelectionRule(rule) {
    if (!rule?.urlPattern) {
        log.error('Cannot store rule without urlPattern');
        return;
    }

    try {
        const data = await chrome.storage.local.get('selectorRules');
        const rules = data.selectorRules || {};

        rules[rule.urlPattern] = {
            questionSelector: rule.questionSelector,
            answerSelector: rule.answerSelector,
            correctSelector: rule.correctSelector,
            created: rule.created || new Date().toISOString(),
            questionCount: rule.questionCount,
            answerCount: rule.answerCount
        };

        await chrome.storage.local.set({ selectorRules: rules });
        log.info(`Stored selector rule for ${rule.urlPattern}`);
    } catch (error) {
        log.error('Failed to store selector rule:', error.message);
    }
}

async function getSelectionRules(urlPattern) {
    try {
        const data = await chrome.storage.local.get('selectorRules');
        const rules = data.selectorRules || {};

        if (urlPattern) {
            // Return exact match or matching patterns
            const exactMatch = rules[urlPattern];
            if (exactMatch) return exactMatch;

            // Try to find a matching wildcard pattern
            for (const [pattern, rule] of Object.entries(rules)) {
                if (urlMatchesPattern(urlPattern, pattern)) {
                    return rule;
                }
            }
            return null;
        }

        return rules;
    } catch (error) {
        log.error('Failed to get selector rules:', error.message);
        return null;
    }
}

async function getAllSelectionRules() {
    try {
        const data = await chrome.storage.local.get('selectorRules');
        return data.selectorRules || {};
    } catch (error) {
        log.error('Failed to get all selector rules:', error.message);
        return {};
    }
}

async function deleteSelectionRule(urlPattern) {
    if (!urlPattern) return;

    try {
        const data = await chrome.storage.local.get('selectorRules');
        const rules = data.selectorRules || {};

        delete rules[urlPattern];

        await chrome.storage.local.set({ selectorRules: rules });
        log.info(`Deleted selector rule for ${urlPattern}`);
    } catch (error) {
        log.error('Failed to delete selector rule:', error.message);
    }
}

async function importSelectionRules(newRules) {
    if (!newRules || typeof newRules !== 'object') {
        return { success: false, error: 'Invalid rules object' };
    }

    try {
        const data = await chrome.storage.local.get('selectorRules');
        const existingRules = data.selectorRules || {};

        // Merge new rules with existing (new rules overwrite existing)
        const mergedRules = { ...existingRules, ...newRules };

        await chrome.storage.local.set({ selectorRules: mergedRules });

        const importedCount = Object.keys(newRules).length;
        log.info(`Imported ${importedCount} selector rules`);

        return { success: true, imported: importedCount };
    } catch (error) {
        log.error('Failed to import selector rules:', error.message);
        return { success: false, error: error.message };
    }
}

function urlMatchesPattern(url, pattern) {
    // Convert pattern to regex
    // example.com/course/* -> example\.com/course/.*
    const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars except *
        .replace(/\*/g, '.*');                    // Convert * to .*

    try {
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(url);
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════════════════

async function storeScanResult(url, results) {
    if (!url) return;
    
    try {
        const domain = new URL(url).hostname;
        const data = await chrome.storage.local.get('scanHistory');
        const scanHistory = data.scanHistory || [];

        scanHistory.unshift({
            domain,
            url,
            timestamp: Date.now(),
            apiCount: results.apis?.length || 0,
            qaCount: results.qa?.total || 0,
            correctCount: results.qa?.correct || 0
        });

        if (scanHistory.length > MAX_SCAN_HISTORY) {
            scanHistory.length = MAX_SCAN_HISTORY;
        }

        await chrome.storage.local.set({ 
            scanHistory,
            [`results_${domain}`]: results
        });
    } catch (error) {
        log.error('Failed to store scan result:', error.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOADS
// ═══════════════════════════════════════════════════════════════════════════

function handleExport(format, data, filename) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const finalFilename = filename || `lms-qa-${timestamp}.${format}`;
    
    handleDownload(format, data, finalFilename);
}

function handleDownload(format, content, filename) {
    const mimeTypes = {
        json: 'application/json',
        csv: 'text/csv',
        txt: 'text/plain'
    };
    
    const type = mimeTypes[format] || 'text/plain';
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
        url,
        filename,
        saveAs: true
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            log.error('Download failed:', chrome.runtime.lastError.message);
        } else {
            log.info(`Download started: ${filename}`);
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
    log.info('Extension installed');
    chrome.storage.local.set({ scanHistory: [] });
});

log.info('Service worker initialized');
