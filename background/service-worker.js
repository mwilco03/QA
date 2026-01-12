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
    EXTRACTION_ERROR: 'EXTRACTION_ERROR',
    // Question Bank messages
    BANK_SAVED: 'BANK_SAVED',
    BANK_UPDATED: 'BANK_UPDATED',
    BANK_DELETED: 'BANK_DELETED',
    BANK_MERGED: 'BANK_MERGED'
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
const activeDomainSessions = new Map(); // domain -> { tabs: Set<tabId>, startTime, primaryTabId }

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
// DOMAIN SESSION TRACKING
// Track all tabs across related domains when extension is activated
// Supports cross-domain training (LMS portal → content CDN)
// ═══════════════════════════════════════════════════════════════════════════

let sessionIdCounter = 0;
const domainToSessionId = new Map(); // domain -> sessionId (for quick lookup)

const DomainSession = {
    getDomain(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return null;
        }
    },

    // Start tracking a domain when extension is activated
    async startSession(tabId, url) {
        const domain = this.getDomain(url);
        if (!domain) return;

        // Check if this domain already belongs to a session
        let sessionId = domainToSessionId.get(domain);

        if (!sessionId) {
            // Create new session
            sessionId = ++sessionIdCounter;
            activeDomainSessions.set(sessionId, {
                domains: new Set([domain]),
                tabs: new Set(),
                startTime: Date.now(),
                primaryTabId: tabId
            });
            domainToSessionId.set(domain, sessionId);
            log.info(`Started session ${sessionId} for domain ${domain}`);
        }

        const session = activeDomainSessions.get(sessionId);
        session.tabs.add(tabId);

        // Find and add all existing tabs on this domain
        await this.discoverSessionTabs(sessionId);
    },

    // Link a new domain to an existing session (for cross-domain training)
    linkDomainToSession(newDomain, existingTabId) {
        // Find the session that contains the existing tab
        for (const [sessionId, session] of activeDomainSessions) {
            if (session.tabs.has(existingTabId)) {
                if (!session.domains.has(newDomain)) {
                    session.domains.add(newDomain);
                    domainToSessionId.set(newDomain, sessionId);
                    log.info(`Linked domain ${newDomain} to session ${sessionId} (now tracking: ${[...session.domains].join(', ')})`);
                }
                return sessionId;
            }
        }
        return null;
    },

    // Discover all open tabs on all domains in a session
    async discoverSessionTabs(sessionId) {
        try {
            const allTabs = await chrome.tabs.query({});
            const session = activeDomainSessions.get(sessionId);
            if (!session) return;

            for (const tab of allTabs) {
                const tabDomain = this.getDomain(tab.url);
                if (tabDomain && session.domains.has(tabDomain)) {
                    session.tabs.add(tab.id);
                    TabState.update(tab.id, { sessionId });
                }
            }

            log.info(`Session ${sessionId}: ${session.tabs.size} tabs across ${session.domains.size} domains`);
        } catch (error) {
            log.error('Failed to discover session tabs:', error.message);
        }
    },

    // Add a new tab to an existing session (checks all domains in session)
    addTab(tabId, url, openerTabId = null) {
        const domain = this.getDomain(url);
        if (!domain) return false;

        // First, check if this domain is already in a session
        const sessionId = domainToSessionId.get(domain);
        if (sessionId) {
            const session = activeDomainSessions.get(sessionId);
            if (session) {
                session.tabs.add(tabId);
                TabState.update(tabId, { sessionId });
                log.info(`Added tab ${tabId} to session ${sessionId} (domain: ${domain})`);
                return true;
            }
        }

        // If opener is in a session, link this new domain to that session
        if (openerTabId) {
            for (const [sessId, session] of activeDomainSessions) {
                if (session.tabs.has(openerTabId)) {
                    // Cross-domain popup - link the new domain
                    session.domains.add(domain);
                    session.tabs.add(tabId);
                    domainToSessionId.set(domain, sessId);
                    TabState.update(tabId, { sessionId: sessId });
                    log.info(`Cross-domain link: tab ${tabId} (${domain}) linked to session ${sessId} via opener ${openerTabId}`);
                    return true;
                }
            }
        }

        return false;
    },

    // Remove a tab from its session
    removeTab(tabId) {
        for (const [sessionId, session] of activeDomainSessions) {
            if (session.tabs.has(tabId)) {
                session.tabs.delete(tabId);
                if (session.tabs.size === 0) {
                    // Clean up session and domain mappings
                    for (const domain of session.domains) {
                        domainToSessionId.delete(domain);
                    }
                    activeDomainSessions.delete(sessionId);
                    log.info(`Ended session ${sessionId} (no tabs remaining)`);
                }
                return;
            }
        }
    },

    // Get all tabs in the same session as a given tab
    getSessionTabs(tabId) {
        for (const [sessionId, session] of activeDomainSessions) {
            if (session.tabs.has(tabId)) {
                return {
                    sessionId,
                    domains: Array.from(session.domains),
                    tabs: Array.from(session.tabs),
                    primaryTabId: session.primaryTabId
                };
            }
        }
        return null;
    },

    // Get session by any of its domains
    getByDomain(domain) {
        const sessionId = domainToSessionId.get(domain);
        if (sessionId) {
            return activeDomainSessions.get(sessionId) || null;
        }
        return null;
    },

    // Check if a domain has an active session
    hasSession(domain) {
        return domainToSessionId.has(domain);
    },

    // Get session ID for a domain
    getSessionId(domain) {
        return domainToSessionId.get(domain) || null;
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

    // If we have a pending URL, try to add to session (supports cross-domain via opener)
    if (tab.pendingUrl) {
        DomainSession.addTab(tab.id, tab.pendingUrl, tab.openerTabId);
    }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    // Check if this tab belongs to an active domain session
    const domain = DomainSession.getDomain(tab.url);
    let hasActiveSession = domain && DomainSession.hasSession(domain);

    // Try to add to session (supports cross-domain via opener relationship)
    const openerTabId = tab.openerTabId || TabState.getParent(tabId);
    if (!hasActiveSession && openerTabId) {
        // Try to link via opener for cross-domain training content
        hasActiveSession = DomainSession.addTab(tabId, tab.url, openerTabId);
    } else if (hasActiveSession) {
        DomainSession.addTab(tabId, tab.url);
    }

    const shouldInject = isLikelyLMSUrl(tab.url) ||
                        TabState.getParent(tabId) !== null ||
                        TabState.getChildren(tabId).size > 0 ||
                        hasActiveSession;

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
    DomainSession.removeTab(tabId);
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
            // Start domain session for this tab's domain
            if (url) DomainSession.startSession(tabId, url);
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
            // Start domain session for this tab's domain
            if (url) DomainSession.startSession(tabId, url);
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

        case 'WINDOW_INFO':
            // Content script reporting window.opener relationship
            if (message.payload?.isPopup && tabId) {
                log.info(`Popup window detected: tab ${tabId}, name: ${message.payload.windowName}`);
                TabState.update(tabId, {
                    isPopup: true,
                    windowName: message.payload.windowName
                });
                // Try to find parent tab and establish relationship
                findAndLinkParentTab(tabId, message.payload.url);
            }
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

        case 'ACTIVATE_SELECTOR_TAB':
            activateSelectorOnTab(message.targetTabId).then(result => {
                sendResponse(result);
            });
            return true;

        case 'APPLY_RULE_TAB':
            applyRuleOnTab(message.targetTabId, message.rule).then(result => {
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

        case 'START_DOMAIN_SESSION':
            if (message.url || url) {
                DomainSession.startSession(tabId, message.url || url).then(() => {
                    const domain = DomainSession.getDomain(message.url || url);
                    const session = DomainSession.getByDomain(domain);
                    sendResponse({
                        success: true,
                        domain,
                        tabCount: session?.tabs.size || 0
                    });
                });
            } else {
                sendResponse({ success: false, error: 'No URL provided' });
            }
            return true;

        case 'GET_DOMAIN_SESSION':
            const sessionInfo = DomainSession.getSessionTabs(message.tabId || tabId);
            sendResponse(sessionInfo);
            return true;

        case 'END_DOMAIN_SESSION':
            const domainToEnd = message.domain || DomainSession.getDomain(url);
            const sessionToEnd = domainToEnd ? DomainSession.getSessionId(domainToEnd) : null;
            if (sessionToEnd) {
                const session = activeDomainSessions.get(sessionToEnd);
                if (session) {
                    // Clean up all domain mappings for this session
                    for (const d of session.domains) {
                        domainToSessionId.delete(d);
                    }
                    activeDomainSessions.delete(sessionToEnd);
                    log.info(`Manually ended session ${sessionToEnd} (domains: ${[...session.domains].join(', ')})`);
                    sendResponse({ success: true, sessionId: sessionToEnd, domains: [...session.domains] });
                }
            } else {
                sendResponse({ success: false, error: 'No active session for domain' });
            }
            return true;

        // Question Bank Operations
        case 'SAVE_QUESTION_BANK':
            saveQuestionBank(message.bankData).then(result => {
                if (result.success) {
                    notifyPopup(MSG.BANK_SAVED, { bank: result.bank });
                }
                sendResponse(result);
            });
            return true;

        case 'GET_QUESTION_BANKS':
            getQuestionBanks(message.bankId).then(result => {
                sendResponse({ success: true, banks: result });
            });
            return true;

        case 'UPDATE_BANK_ITEM':
            updateBankItem(message.updateData).then(result => {
                if (result.success) {
                    notifyPopup(MSG.BANK_UPDATED, { bank: result.bank });
                }
                sendResponse(result);
            });
            return true;

        case 'DELETE_QUESTION_BANK':
            deleteQuestionBank(message.bankId).then(result => {
                if (result.success) {
                    notifyPopup(MSG.BANK_DELETED, { bankId: message.bankId });
                }
                sendResponse(result);
            });
            return true;

        case 'MERGE_QUESTION_BANKS':
            mergeQuestionBanks(message.mergeData).then(result => {
                if (result.success) {
                    notifyPopup(MSG.BANK_MERGED, {
                        bank: result.bank,
                        questionsAdded: result.questionsAdded,
                        questionsUpdated: result.questionsUpdated
                    });
                }
                sendResponse(result);
            });
            return true;

        case 'EXPORT_QUESTION_BANKS':
            exportQuestionBanks(message.bankIds).then(result => {
                if (result.success) {
                    // Trigger download
                    const json = JSON.stringify(result.data, null, 2);
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    handleDownload('json', json, `question-banks-${timestamp}.json`);
                }
                sendResponse(result);
            });
            return true;

        case 'IMPORT_QUESTION_BANKS':
            importQuestionBanks(message.importData, message.testerName).then(result => {
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

    // Session tabs (may span multiple domains for cross-domain training)
    const session = DomainSession.getSessionTabs(tabId);
    if (session) {
        const addedIds = new Set(related.map(r => r.id));
        addedIds.add(tabId); // Don't include self
        const currentDomain = DomainSession.getDomain(allTabs.find(t => t.id === tabId)?.url);

        for (const sessionTabId of session.tabs) {
            if (!addedIds.has(sessionTabId)) {
                const sessionTab = allTabs.find(t => t.id === sessionTabId);
                if (sessionTab) {
                    const tabDomain = DomainSession.getDomain(sessionTab.url);
                    const isCrossDomain = tabDomain !== currentDomain;
                    related.push({
                        id: sessionTab.id,
                        title: sessionTab.title,
                        url: sessionTab.url,
                        domain: tabDomain,
                        relationship: isCrossDomain ? 'cross-domain' : 'domain-session',
                        hasResults: TabState.get(sessionTab.id)?.results !== null
                    });
                }
            }
        }
    }

    return related;
}

async function findAndLinkParentTab(childTabId, childUrl) {
    try {
        const allTabs = await chrome.tabs.query({});
        const childDomain = new URL(childUrl).hostname;

        // Look for potential parent tabs on same domain
        for (const tab of allTabs) {
            if (tab.id === childTabId) continue;

            try {
                const tabDomain = new URL(tab.url).hostname;
                // Same domain and has LMS-like URL patterns
                if (tabDomain === childDomain && isLikelyLMSUrl(tab.url)) {
                    // Check if this tab already has children or is a likely parent
                    const existingChildren = TabState.getChildren(tab.id);

                    // If no explicit relationship exists, create one
                    if (!TabState.getParent(childTabId)) {
                        TabState.addRelationship(childTabId, tab.id);
                        log.info(`Linked popup tab ${childTabId} to parent tab ${tab.id}`);
                        return;
                    }
                }
            } catch (e) {
                // Invalid URL
            }
        }
    } catch (error) {
        log.error('Failed to find parent tab:', error.message);
    }
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

async function activateSelectorOnTab(tabId) {
    try {
        await injectContentScript(tabId);
        await new Promise(r => setTimeout(r, 100));
        await chrome.tabs.sendMessage(tabId, { type: 'ACTIVATE_SELECTOR' });

        // Focus the tab so user can interact with selector
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        if (tab.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
        }

        return { success: true, tabId };
    } catch (error) {
        log.error(`Failed to activate selector on tab ${tabId}: ${error.message}`);
        return { success: false, error: error.message, tabId };
    }
}

async function applyRuleOnTab(tabId, rule) {
    try {
        await injectContentScript(tabId);
        await new Promise(r => setTimeout(r, 100));
        await chrome.tabs.sendMessage(tabId, { type: 'APPLY_SELECTOR_RULE', rule, hybrid: true });
        return { success: true, tabId };
    } catch (error) {
        log.error(`Failed to apply rule on tab ${tabId}: ${error.message}`);
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
// QUESTION BANK STORAGE
// Supports QA team collaboration - save, share, merge question banks
// ═══════════════════════════════════════════════════════════════════════════

function generateBankId() {
    return 'bank_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Save extracted Q&A to a named question bank
 * @param {Object} bankData - { name, testerName, sourceUrl, tool, questions }
 */
async function saveQuestionBank(bankData) {
    try {
        const data = await chrome.storage.local.get('questionBanks');
        const banks = data.questionBanks || {};

        const bankId = bankData.id || generateBankId();
        const now = new Date().toISOString();

        // Transform questions to bank format with verification fields
        const questions = (bankData.questions || []).map((q, qIndex) => ({
            id: q.id || `q${qIndex + 1}`,
            text: q.text || q.questionText || '',
            type: q.type || q.questionType || 'choice',
            verified: false,
            verifiedBy: null,
            verifiedAt: null,
            tags: [],
            notes: '',
            answers: (q.answers || []).map((a, aIndex) => ({
                id: a.id || `q${qIndex + 1}_a${aIndex + 1}`,
                text: a.text || a.answerText || '',
                isCorrect: a.isCorrect || a.correct || false,
                probability: a.probability || (a.isCorrect ? 0.9 : 0.1),
                verified: false,
                verifiedBy: null,
                tags: []
            }))
        }));

        // Calculate summary stats
        const summary = {
            totalQuestions: questions.length,
            verifiedQuestions: 0,
            totalAnswers: questions.reduce((sum, q) => sum + q.answers.length, 0),
            correctAnswers: questions.reduce((sum, q) => sum + q.answers.filter(a => a.isCorrect).length, 0),
            verifiedCorrectAnswers: 0
        };

        banks[bankId] = {
            id: bankId,
            name: bankData.name || `Bank ${Object.keys(banks).length + 1}`,
            createdAt: now,
            updatedAt: now,
            createdBy: bankData.testerName || 'Unknown',
            sourceUrl: bankData.sourceUrl || '',
            tool: bankData.tool || 'generic',
            questions,
            mergeHistory: [],
            summary
        };

        await chrome.storage.local.set({ questionBanks: banks });
        log.info(`Saved question bank: ${banks[bankId].name} (${bankId})`);

        return { success: true, bankId, bank: banks[bankId] };
    } catch (error) {
        log.error('Failed to save question bank:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Get all question banks or a specific one
 * @param {string} bankId - Optional specific bank ID
 */
async function getQuestionBanks(bankId = null) {
    try {
        const data = await chrome.storage.local.get('questionBanks');
        const banks = data.questionBanks || {};

        if (bankId) {
            return banks[bankId] || null;
        }
        return banks;
    } catch (error) {
        log.error('Failed to get question banks:', error.message);
        return bankId ? null : {};
    }
}

/**
 * Update verification status or tags for a question/answer
 * @param {Object} updateData - { bankId, questionId, answerId?, verified, tags, notes, testerName }
 */
async function updateBankItem(updateData) {
    try {
        const data = await chrome.storage.local.get('questionBanks');
        const banks = data.questionBanks || {};

        const bank = banks[updateData.bankId];
        if (!bank) {
            return { success: false, error: 'Bank not found' };
        }

        const question = bank.questions.find(q => q.id === updateData.questionId);
        if (!question) {
            return { success: false, error: 'Question not found' };
        }

        const now = new Date().toISOString();

        if (updateData.answerId) {
            // Update specific answer
            const answer = question.answers.find(a => a.id === updateData.answerId);
            if (!answer) {
                return { success: false, error: 'Answer not found' };
            }

            if (updateData.verified !== undefined) {
                answer.verified = updateData.verified;
                answer.verifiedBy = updateData.testerName || null;
            }
            if (updateData.tags) {
                answer.tags = updateData.tags;
            }
            if (updateData.probability !== undefined) {
                answer.probability = updateData.probability;
            }
        } else {
            // Update question
            if (updateData.verified !== undefined) {
                question.verified = updateData.verified;
                question.verifiedBy = updateData.testerName || null;
                question.verifiedAt = updateData.verified ? now : null;
            }
            if (updateData.tags) {
                question.tags = updateData.tags;
            }
            if (updateData.notes !== undefined) {
                question.notes = updateData.notes;
            }
        }

        // Recalculate summary
        bank.summary.verifiedQuestions = bank.questions.filter(q => q.verified).length;
        bank.summary.verifiedCorrectAnswers = bank.questions.reduce(
            (sum, q) => sum + q.answers.filter(a => a.isCorrect && a.verified).length, 0
        );
        bank.updatedAt = now;

        await chrome.storage.local.set({ questionBanks: banks });
        log.info(`Updated bank item: ${updateData.bankId}/${updateData.questionId}`);

        return { success: true, bank };
    } catch (error) {
        log.error('Failed to update bank item:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Delete a question bank
 * @param {string} bankId
 */
async function deleteQuestionBank(bankId) {
    try {
        const data = await chrome.storage.local.get('questionBanks');
        const banks = data.questionBanks || {};

        if (!banks[bankId]) {
            return { success: false, error: 'Bank not found' };
        }

        const bankName = banks[bankId].name;
        delete banks[bankId];

        await chrome.storage.local.set({ questionBanks: banks });
        log.info(`Deleted question bank: ${bankName} (${bankId})`);

        return { success: true };
    } catch (error) {
        log.error('Failed to delete question bank:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Merge questions from one bank into another
 * Supports non-linear workflow - tester A creates bank, tester B merges in their findings
 * @param {Object} mergeData - { targetBankId, sourceBankId, testerName, strategy }
 */
async function mergeQuestionBanks(mergeData) {
    try {
        const data = await chrome.storage.local.get('questionBanks');
        const banks = data.questionBanks || {};

        const target = banks[mergeData.targetBankId];
        const source = banks[mergeData.sourceBankId];

        if (!target) return { success: false, error: 'Target bank not found' };
        if (!source) return { success: false, error: 'Source bank not found' };

        const now = new Date().toISOString();
        let questionsAdded = 0;
        let questionsUpdated = 0;

        // Merge strategy: 'add_new' | 'merge_all' | 'overwrite'
        const strategy = mergeData.strategy || 'add_new';

        for (const srcQuestion of source.questions) {
            // Find matching question by text similarity
            const existingQuestion = target.questions.find(q =>
                normalizeText(q.text) === normalizeText(srcQuestion.text)
            );

            if (existingQuestion) {
                if (strategy === 'merge_all' || strategy === 'overwrite') {
                    // Merge verification status and tags
                    if (srcQuestion.verified && !existingQuestion.verified) {
                        existingQuestion.verified = true;
                        existingQuestion.verifiedBy = srcQuestion.verifiedBy;
                        existingQuestion.verifiedAt = srcQuestion.verifiedAt;
                    }

                    // Merge tags (unique)
                    existingQuestion.tags = [...new Set([...existingQuestion.tags, ...srcQuestion.tags])];

                    // Merge notes
                    if (srcQuestion.notes && srcQuestion.notes !== existingQuestion.notes) {
                        existingQuestion.notes = existingQuestion.notes
                            ? `${existingQuestion.notes}\n---\n${srcQuestion.notes}`
                            : srcQuestion.notes;
                    }

                    // Merge answer verification
                    for (const srcAnswer of srcQuestion.answers) {
                        const existingAnswer = existingQuestion.answers.find(a =>
                            normalizeText(a.text) === normalizeText(srcAnswer.text)
                        );
                        if (existingAnswer) {
                            if (srcAnswer.verified && !existingAnswer.verified) {
                                existingAnswer.verified = true;
                                existingAnswer.verifiedBy = srcAnswer.verifiedBy;
                            }
                            existingAnswer.tags = [...new Set([...existingAnswer.tags, ...srcAnswer.tags])];
                            // Use higher probability
                            if (srcAnswer.probability > existingAnswer.probability) {
                                existingAnswer.probability = srcAnswer.probability;
                            }
                        }
                    }
                    questionsUpdated++;
                }
            } else {
                // Add new question
                const newQuestion = JSON.parse(JSON.stringify(srcQuestion));
                newQuestion.id = `q${target.questions.length + 1}_merged`;
                target.questions.push(newQuestion);
                questionsAdded++;
            }
        }

        // Record merge history
        target.mergeHistory.push({
            mergedFrom: mergeData.sourceBankId,
            mergedFromName: source.name,
            mergedAt: now,
            mergedBy: mergeData.testerName || 'Unknown',
            questionsAdded,
            questionsUpdated,
            strategy
        });

        // Recalculate summary
        target.summary.totalQuestions = target.questions.length;
        target.summary.verifiedQuestions = target.questions.filter(q => q.verified).length;
        target.summary.totalAnswers = target.questions.reduce((sum, q) => sum + q.answers.length, 0);
        target.summary.correctAnswers = target.questions.reduce((sum, q) => sum + q.answers.filter(a => a.isCorrect).length, 0);
        target.summary.verifiedCorrectAnswers = target.questions.reduce(
            (sum, q) => sum + q.answers.filter(a => a.isCorrect && a.verified).length, 0
        );
        target.updatedAt = now;

        await chrome.storage.local.set({ questionBanks: banks });
        log.info(`Merged banks: ${source.name} -> ${target.name} (added: ${questionsAdded}, updated: ${questionsUpdated})`);

        return { success: true, questionsAdded, questionsUpdated, bank: target };
    } catch (error) {
        log.error('Failed to merge question banks:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Export question banks for sharing between testers
 * @param {string[]} bankIds - Array of bank IDs to export (null = all)
 */
async function exportQuestionBanks(bankIds = null) {
    try {
        const banks = await getQuestionBanks();

        let exportBanks;
        if (bankIds && bankIds.length > 0) {
            exportBanks = {};
            for (const id of bankIds) {
                if (banks[id]) {
                    exportBanks[id] = banks[id];
                }
            }
        } else {
            exportBanks = banks;
        }

        return {
            success: true,
            data: {
                version: '1.0',
                schema: 'lms-qa-question-bank',
                exportedAt: new Date().toISOString(),
                bankCount: Object.keys(exportBanks).length,
                banks: exportBanks
            }
        };
    } catch (error) {
        log.error('Failed to export question banks:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Import question banks from another tester
 * @param {Object} importData - The exported banks object
 * @param {string} testerName - Who is importing
 */
async function importQuestionBanks(importData, testerName = 'Unknown') {
    try {
        if (!importData?.banks || importData.schema !== 'lms-qa-question-bank') {
            return { success: false, error: 'Invalid question bank format' };
        }

        const data = await chrome.storage.local.get('questionBanks');
        const existingBanks = data.questionBanks || {};

        let imported = 0;
        let skipped = 0;
        const now = new Date().toISOString();

        for (const [bankId, bank] of Object.entries(importData.banks)) {
            // Check if bank already exists
            if (existingBanks[bankId]) {
                // Skip if already exists - user should use merge explicitly
                skipped++;
                continue;
            }

            // Add import metadata
            bank.importedAt = now;
            bank.importedBy = testerName;
            existingBanks[bankId] = bank;
            imported++;
        }

        await chrome.storage.local.set({ questionBanks: existingBanks });
        log.info(`Imported ${imported} question banks (skipped ${skipped} duplicates)`);

        return { success: true, imported, skipped };
    } catch (error) {
        log.error('Failed to import question banks:', error.message);
        return { success: false, error: error.message };
    }
}

// Helper: Normalize text for comparison
function normalizeText(text) {
    return (text || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .trim();
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
