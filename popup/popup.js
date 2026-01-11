/**
 * LMS QA Validator - Popup v3.0
 * Extension popup interface
 * 
 * Architecture:
 * - Modular components with clear responsibilities
 * - Centralized state management
 * - Consistent event handling
 * - Debounced operations where appropriate
 * 
 * @fileoverview Main popup script
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const DEBOUNCE_DELAY = 150;

    const MSG = Object.freeze({
        SCAN_STARTED: 'SCAN_STARTED',
        SCAN_COMPLETE: 'SCAN_COMPLETE',
        SCAN_ERROR: 'SCAN_ERROR',
        PROGRESS: 'PROGRESS',
        TEST_RESULT: 'TEST_RESULT',
        SET_COMPLETION_RESULT: 'SET_COMPLETION_RESULT',
        CMI_DATA: 'CMI_DATA',
        AUTO_SELECT_RESULT: 'AUTO_SELECT_RESULT',
        STATE_UPDATE: 'STATE_UPDATE',
        SELECTOR_ACTIVATED: 'SELECTOR_ACTIVATED',
        SELECTOR_DEACTIVATED: 'SELECTOR_DEACTIVATED',
        SELECTOR_RULE_CREATED: 'SELECTOR_RULE_CREATED',
        EXTRACTION_COMPLETE: 'EXTRACTION_COMPLETE',
        EXTRACTION_ERROR: 'EXTRACTION_ERROR'
    });

    const STATUS = Object.freeze({
        READY: { text: 'Ready', class: 'ready' },
        SCANNING: { text: 'Scanning...', class: 'scanning' },
        SUCCESS: { text: 'Complete', class: 'success' },
        ERROR: { text: 'Error', class: 'error' }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    function debounce(fn, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function truncate(str, length = 100) {
        if (!str || str.length <= length) return str;
        return str.substring(0, length - 3) + '...';
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    const State = {
        tabId: null,
        tabUrl: '',
        results: null,
        currentRule: null,
        selectorActive: false,
        settings: {
            autoScan: false
        },

        reset() {
            this.results = null;
        },

        hasResults() {
            return this.results?.qa?.items?.length > 0;
        },

        getQAItems() {
            return this.results?.qa?.items || [];
        },

        getAPIs() {
            return this.results?.apis || [];
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DOM CACHE
    // ═══════════════════════════════════════════════════════════════════════════

    const $ = {};

    function cacheElements() {
        const ids = [
            'tab-url', 'status-indicator',
            'btn-scan', 'btn-clear',
            'progress-container', 'progress-fill', 'progress-text',
            'validation-warnings',
            'related-windows', 'related-list', 'btn-refresh-related',
            'search-container', 'search-input', 'search-count',
            'results-tabs', 'qa-list', 'apis-list', 'correct-list', 'logs-list',
            'qa-count', 'apis-count', 'correct-count', 'logs-count',
            'scorm-controls', 'completion-status', 'completion-score',
            'btn-test-api', 'btn-set-completion',
            'quick-actions', 'btn-auto-select', 'btn-element-selector',
            'saved-rules', 'rule-info', 'btn-apply-rule', 'btn-delete-rule',
            'btn-export-json', 'btn-export-csv', 'btn-export-txt',
            'toast'
        ];

        ids.forEach(id => {
            const camelId = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            $[camelId] = document.getElementById(id);
        });

        // Tab buttons
        $.tabButtons = document.querySelectorAll('.tab-btn');
        $.tabPanels = document.querySelectorAll('.tab-panel');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UI UPDATES
    // ═══════════════════════════════════════════════════════════════════════════

    const UI = {
        setStatus(status) {
            if (!$.statusIndicator) return;
            
            const dot = $.statusIndicator.querySelector('.status-dot');
            const text = $.statusIndicator.querySelector('.status-text');
            
            if (dot) {
                dot.className = 'status-dot';
                if (status.class) dot.classList.add(status.class);
            }
            if (text) text.textContent = status.text;
        },

        setProgress(step, total, message) {
            if (!$.progressContainer) return;

            $.progressContainer.classList.add('active');
            
            const percent = (step / total) * 100;
            if ($.progressFill) $.progressFill.style.width = `${percent}%`;
            if ($.progressText) $.progressText.textContent = message || `Step ${step} of ${total}`;
        },

        hideProgress() {
            if ($.progressContainer) {
                $.progressContainer.classList.remove('active');
            }
        },

        setTabUrl(url) {
            if ($.tabUrl) {
                $.tabUrl.textContent = truncate(url, 50);
                $.tabUrl.title = url;
            }
        },

        updateBadge(element, count) {
            if (element) {
                element.textContent = count;
                element.classList.toggle('has-items', count > 0);
            }
        },

        showSearchContainer(show) {
            if ($.searchContainer) {
                $.searchContainer.classList.toggle('has-results', show);
            }
        },

        setSearchCount(matched, total) {
            if ($.searchCount) {
                $.searchCount.textContent = matched < total ? `${matched} of ${total}` : '';
            }
        },

        clearSearch() {
            if ($.searchInput) $.searchInput.value = '';
            if ($.searchCount) $.searchCount.textContent = '';
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const Toast = {
        show(message, type = 'info', duration = 3000) {
            if (!$.toast) return;

            $.toast.textContent = message;
            $.toast.className = `toast ${type} show`;

            setTimeout(() => {
                $.toast.classList.remove('show');
            }, duration);
        },

        success: (msg) => Toast.show(msg, 'success'),
        error: (msg) => Toast.show(msg, 'error'),
        info: (msg) => Toast.show(msg, 'info')
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TAB SWITCHING
    // ═══════════════════════════════════════════════════════════════════════════

    const Tabs = {
        init() {
            $.tabButtons?.forEach(btn => {
                btn.addEventListener('click', () => this.activate(btn.dataset.tab));
            });
        },

        activate(tabId) {
            $.tabButtons?.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });

            $.tabPanels?.forEach(panel => {
                panel.classList.toggle('active', panel.id === `${tabId}-panel`);
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // RESULTS RENDERING
    // ═══════════════════════════════════════════════════════════════════════════

    const Renderer = {
        renderAll(results) {
            if (!results) return;

            State.results = results;

            this.renderQA(results.qa?.items || []);
            this.renderAPIs(results.apis || []);
            this.renderCorrect(results.qa?.items?.filter(i => i.correct) || []);
            this.renderLogs(results.logs || []);

            UI.updateBadge($.qaCount, results.qa?.total || 0);
            UI.updateBadge($.apisCount, results.apis?.length || 0);
            UI.updateBadge($.correctCount, results.qa?.correct || 0);
            UI.updateBadge($.logsCount, results.logs?.length || 0);

            UI.showSearchContainer(State.hasResults());

            if (results.apis?.length > 0) {
                $.scormControls?.classList.add('active');
            }
        },

        renderQA(items) {
            if (!$.qaList) return;

            if (items.length === 0) {
                $.qaList.innerHTML = '<div class="empty-state">No Q&A found. Try scanning the page.</div>';
                return;
            }

            let questionNum = 0;
            $.qaList.innerHTML = items.map(item => {
                if (item.type === 'question') {
                    questionNum++;
                    return `
                        <div class="qa-item question" data-text="${escapeHtml(item.text)}">
                            <span class="qa-num">Q${questionNum}</span>
                            <span class="qa-text">${escapeHtml(item.text)}</span>
                        </div>
                    `;
                } else {
                    const correctClass = item.correct ? 'correct' : '';
                    const marker = item.correct ? '✓' : '○';
                    return `
                        <div class="qa-item answer ${correctClass}" data-text="${escapeHtml(item.text)}">
                            <span class="qa-marker">${marker}</span>
                            <span class="qa-text">${escapeHtml(item.text)}</span>
                        </div>
                    `;
                }
            }).join('');
        },

        renderAPIs(apis) {
            if (!$.apisList) return;

            if (apis.length === 0) {
                $.apisList.innerHTML = '<div class="empty-state">No SCORM/xAPI detected.</div>';
                return;
            }

            $.apisList.innerHTML = apis.map((api, idx) => `
                <div class="api-item" data-index="${idx}">
                    <div class="api-header">
                        <span class="api-type">${escapeHtml(api.type)}</span>
                        <span class="api-status ${api.functional ? 'functional' : ''}">${api.functional ? 'Active' : 'Found'}</span>
                    </div>
                    <div class="api-location">${escapeHtml(api.location)}</div>
                    <div class="api-methods">${(api.methods || []).join(', ')}</div>
                </div>
            `).join('');
        },

        renderCorrect(items) {
            if (!$.correctList) return;

            if (items.length === 0) {
                $.correctList.innerHTML = '<div class="empty-state">No correct answers found.</div>';
                return;
            }

            $.correctList.innerHTML = items.map((item, idx) => `
                <div class="correct-item" data-text="${escapeHtml(item.text)}">
                    <span class="correct-num">${idx + 1}.</span>
                    <span class="correct-text">${escapeHtml(item.text)}</span>
                </div>
            `).join('');
        },

        renderLogs(logs) {
            if (!$.logsList) return;

            if (logs.length === 0) {
                $.logsList.innerHTML = '<div class="empty-state">No logs yet.</div>';
                return;
            }

            $.logsList.innerHTML = logs.slice(-100).reverse().map(log => `
                <div class="log-item ${log.level?.toLowerCase() || 'info'}">
                    <span class="log-time">${log.timestamp?.split('T')[1]?.split('.')[0] || ''}</span>
                    <span class="log-level">${log.level || 'INFO'}</span>
                    <span class="log-msg">${escapeHtml(log.message)}</span>
                </div>
            `).join('');
        },

        renderRelatedTabs(tabs) {
            if (!$.relatedWindows || !$.relatedList) return;

            if (tabs.length === 0) {
                $.relatedWindows.classList.remove('active');
                return;
            }

            $.relatedWindows.classList.add('active');

            const icons = { parent: '↑', child: '↓', sibling: '↔' };

            $.relatedList.innerHTML = tabs.map(tab => `
                <div class="related-tab" data-tab-id="${tab.id}">
                    <span class="related-icon" title="${tab.relationship}">${icons[tab.relationship] || '?'}</span>
                    <span class="related-title" title="${escapeHtml(tab.title)}">${truncate(tab.title, 35)}</span>
                    <div class="related-actions">
                        <button class="btn-sm btn-scan-tab" data-tab-id="${tab.id}">Scan</button>
                        <button class="btn-sm btn-focus-tab" data-tab-id="${tab.id}">Go</button>
                    </div>
                </div>
            `).join('');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SEARCH & FILTER
    // ═══════════════════════════════════════════════════════════════════════════

    const Search = {
        filter: debounce(function(query) {
            const items = State.getQAItems();
            if (items.length === 0) return;

            const normalizedQuery = query.toLowerCase().trim();
            
            if (!normalizedQuery) {
                Renderer.renderQA(items);
                UI.setSearchCount(items.length, items.length);
                return;
            }

            const filtered = items.filter(item => 
                item.text?.toLowerCase().includes(normalizedQuery)
            );

            Renderer.renderQA(filtered);
            UI.setSearchCount(filtered.length, items.length);

            // Update correct tab too
            const correctFiltered = filtered.filter(i => i.correct);
            Renderer.renderCorrect(correctFiltered);
        }, DEBOUNCE_DELAY),

        clear() {
            UI.clearSearch();
            const items = State.getQAItems();
            if (items.length > 0) {
                Renderer.renderQA(items);
                Renderer.renderCorrect(items.filter(i => i.correct));
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTENSION COMMUNICATION
    // ═══════════════════════════════════════════════════════════════════════════

    const Extension = {
        async getCurrentTab() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab;
        },

        async sendToContent(type, data = {}) {
            const tab = await this.getCurrentTab();
            if (!tab?.id) throw new Error('No active tab');

            return new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, { type, ...data }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
        },

        async sendToServiceWorker(type, data = {}) {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({ type, tabId: State.tabId, ...data }, resolve);
            });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const Actions = {
        async scan() {
            try {
                $.btnScan.disabled = true;
                UI.setStatus(STATUS.SCANNING);
                
                await Extension.sendToContent('SCAN');
            } catch (error) {
                UI.setStatus(STATUS.ERROR);
                Toast.error('Failed to start scan: ' + error.message);
                $.btnScan.disabled = false;
            }
        },

        clear() {
            State.reset();
            
            if ($.qaList) $.qaList.innerHTML = '<div class="empty-state">No Q&A found. Try scanning the page.</div>';
            if ($.apisList) $.apisList.innerHTML = '<div class="empty-state">No SCORM/xAPI detected.</div>';
            if ($.correctList) $.correctList.innerHTML = '<div class="empty-state">No correct answers found.</div>';
            if ($.logsList) $.logsList.innerHTML = '<div class="empty-state">No logs yet.</div>';

            UI.updateBadge($.qaCount, 0);
            UI.updateBadge($.apisCount, 0);
            UI.updateBadge($.correctCount, 0);
            UI.updateBadge($.logsCount, 0);

            UI.showSearchContainer(false);
            Search.clear();
            $.scormControls?.classList.remove('active');
            $.validationWarnings?.classList.remove('active');

            Extension.sendToServiceWorker('CLEAR_TAB_STATE');
            
            Toast.info('Results cleared');
        },

        async testAPI() {
            try {
                await Extension.sendToContent('TEST_API', { apiIndex: 0 });
                Toast.info('Testing API...');
            } catch (error) {
                Toast.error('Failed to test API');
            }
        },

        async setCompletion() {
            const status = $.completionStatus?.value || 'completed';
            const score = parseInt($.completionScore?.value || '100', 10);

            try {
                await Extension.sendToContent('SET_COMPLETION', { status, score, apiIndex: 0 });
                Toast.info('Setting completion...');
            } catch (error) {
                Toast.error('Failed to set completion');
            }
        },

        async autoSelect() {
            $.btnAutoSelect.disabled = true;
            $.btnAutoSelect.textContent = 'Selecting...';

            try {
                await Extension.sendToContent('AUTO_SELECT');
            } catch (error) {
                Toast.error('Failed to auto-select');
            }

            $.btnAutoSelect.disabled = false;
            $.btnAutoSelect.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                    <path d="M22 4L12 14.01l-3-3"/>
                </svg>
                Auto-Select Answers
            `;
        },

        export(format) {
            const results = State.results;
            if (!results) {
                Toast.error('No data to export');
                return;
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            let data, filename;

            switch (format) {
                case 'csv':
                    data = this.toCSV(results);
                    filename = `lms-qa-${timestamp}.csv`;
                    break;
                case 'txt':
                    data = this.toTXT(results);
                    filename = `lms-qa-${timestamp}.txt`;
                    break;
                default:
                    data = JSON.stringify(results, null, 2);
                    filename = `lms-qa-${timestamp}.json`;
            }

            this.download(data, filename, format);
            Toast.success(`Exported as ${format.toUpperCase()}`);
        },

        toCSV(results) {
            const rows = [['Type', 'Text', 'Correct', 'Source', 'Confidence']];
            (results.qa?.items || []).forEach(item => {
                rows.push([
                    item.type,
                    `"${(item.text || '').replace(/"/g, '""')}"`,
                    item.correct ? 'Yes' : '',
                    item.source || '',
                    item.confidence || ''
                ]);
            });
            return rows.map(r => r.join(',')).join('\n');
        },

        toTXT(results) {
            const lines = [
                '=' .repeat(60),
                'LMS QA VALIDATOR - ANSWER KEY',
                '='.repeat(60),
                `URL: ${results.url || State.tabUrl}`,
                `Questions: ${results.qa?.questions || 0}`,
                `Correct: ${results.qa?.correct || 0}`,
                '',
                '-'.repeat(60),
                'CORRECT ANSWERS',
                '-'.repeat(60)
            ];

            const correct = (results.qa?.items || []).filter(i => i.correct);
            correct.forEach((item, idx) => {
                lines.push(`${idx + 1}. ${item.text}`);
            });

            return lines.join('\n');
        },

        download(data, filename, format) {
            const mimeTypes = { json: 'application/json', csv: 'text/csv', txt: 'text/plain' };
            const blob = new Blob([data], { type: mimeTypes[format] || 'text/plain' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();

            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },

        async loadRelatedTabs() {
            const response = await Extension.sendToServiceWorker('GET_RELATED_TABS');
            Renderer.renderRelatedTabs(response?.tabs || []);
        },

        async scanRelatedTab(tabId) {
            const response = await Extension.sendToServiceWorker('SCAN_TAB', { targetTabId: tabId });
            if (response?.success) {
                Toast.success('Scan started in related window');
            } else {
                Toast.error('Failed to scan: ' + (response?.error || 'Unknown'));
            }
        },

        focusTab(tabId) {
            chrome.tabs.update(tabId, { active: true });
            chrome.tabs.get(tabId, (tab) => {
                if (tab?.windowId) {
                    chrome.windows.update(tab.windowId, { focused: true });
                }
            });
        },

        async activateSelector() {
            try {
                $.btnElementSelector.disabled = true;
                $.btnElementSelector.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z"/>
                        <path d="M15 15h6v6h-6z"/>
                        <circle cx="12" cy="12" r="2"/>
                    </svg>
                    Selecting...
                `;
                State.selectorActive = true;

                await Extension.sendToContent('ACTIVATE_SELECTOR');
                Toast.info('Click elements on the page to select Q&A');

                // Close popup so user can interact with page
                // window.close();
            } catch (error) {
                Toast.error('Failed to activate selector: ' + error.message);
                $.btnElementSelector.disabled = false;
                this.resetSelectorButton();
            }
        },

        resetSelectorButton() {
            $.btnElementSelector.disabled = false;
            $.btnElementSelector.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z"/>
                    <path d="M15 15h6v6h-6z"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
                Pick Q&A Elements
            `;
            State.selectorActive = false;
        },

        async checkForSavedRule() {
            try {
                const urlPattern = this.getURLPattern(State.tabUrl);
                const response = await Extension.sendToServiceWorker('GET_SELECTOR_RULES', { urlPattern });

                if (response?.rules) {
                    State.currentRule = response.rules;
                    this.showSavedRule(response.rules, urlPattern);
                } else {
                    this.hideSavedRule();
                }
            } catch (error) {
                console.error('Failed to check for saved rule:', error);
            }
        },

        getURLPattern(url) {
            if (!url) return null;
            try {
                const parsed = new URL(url);
                let path = parsed.pathname.replace(/\/\d+/g, '/*');
                path = path.replace(/\/$/, '') || '/';
                return `${parsed.hostname}${path}`;
            } catch {
                return null;
            }
        },

        showSavedRule(rule, pattern) {
            if (!$.savedRules || !$.ruleInfo) return;

            $.savedRules.style.display = 'block';
            $.ruleInfo.innerHTML = `
                <div class="rule-pattern">${escapeHtml(pattern)}</div>
                <div class="rule-stats">
                    Questions: ${rule.questionCount || '?'} |
                    Answers: ${rule.answerCount || '?'}
                </div>
            `;
        },

        hideSavedRule() {
            if ($.savedRules) {
                $.savedRules.style.display = 'none';
            }
            State.currentRule = null;
        },

        async applyRule() {
            if (!State.currentRule) {
                Toast.error('No rule to apply');
                return;
            }

            Toast.info('Applying saved rule...');
            // This will be implemented to use the saved selectors
            // to extract Q&A from the page
            await Extension.sendToContent('APPLY_SELECTOR_RULE', { rule: State.currentRule });
        },

        async deleteRule() {
            const urlPattern = this.getURLPattern(State.tabUrl);
            if (!urlPattern) return;

            await Extension.sendToServiceWorker('DELETE_SELECTOR_RULE', { urlPattern });
            this.hideSavedRule();
            Toast.success('Rule deleted');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    const MessageHandlers = {
        [MSG.SCAN_STARTED]: () => {
            UI.setStatus(STATUS.SCANNING);
            $.btnScan.disabled = true;
        },

        [MSG.PROGRESS]: (payload) => {
            UI.setProgress(payload.step, payload.total, payload.message);
        },

        [MSG.SCAN_COMPLETE]: (payload) => {
            UI.setStatus(STATUS.SUCCESS);
            UI.hideProgress();
            $.btnScan.disabled = false;

            if (payload.results) {
                Renderer.renderAll(payload.results);
            }

            Toast.success('Scan complete');
        },

        [MSG.SCAN_ERROR]: (payload) => {
            UI.setStatus(STATUS.ERROR);
            UI.hideProgress();
            $.btnScan.disabled = false;

            Toast.error(payload.error || 'Scan failed');
        },

        [MSG.TEST_RESULT]: (payload) => {
            if (payload.results?.success) {
                Toast.success('API test passed');
            } else {
                Toast.error('API test failed: ' + (payload.results?.error || ''));
            }
        },

        [MSG.SET_COMPLETION_RESULT]: (payload) => {
            if (payload.results?.success) {
                Toast.success('Completion set successfully');
            } else {
                Toast.error('Failed: ' + (payload.results?.error || ''));
            }
        },

        [MSG.AUTO_SELECT_RESULT]: (payload) => {
            if (payload.count > 0) {
                Toast.success(`Selected ${payload.count} correct answer(s)`);
            } else {
                Toast.info('No form quizzes found');
            }
        },

        [MSG.STATE_UPDATE]: (payload) => {
            if (payload.results) {
                Renderer.renderAll(payload.results);
            }
        },

        [MSG.SELECTOR_ACTIVATED]: () => {
            State.selectorActive = true;
            Toast.info('Selector active - pick elements on the page');
        },

        [MSG.SELECTOR_DEACTIVATED]: () => {
            Actions.resetSelectorButton();
            State.selectorActive = false;
        },

        [MSG.SELECTOR_RULE_CREATED]: (payload) => {
            Actions.resetSelectorButton();
            State.selectorActive = false;

            if (payload.rule) {
                State.currentRule = payload.rule;
                Actions.showSavedRule(payload.rule, payload.rule.urlPattern);
                Toast.success(`Rule saved! Q:${payload.rule.questionCount} A:${payload.rule.answerCount}`);
            }
        },

        [MSG.EXTRACTION_COMPLETE]: (payload) => {
            UI.setStatus(STATUS.SUCCESS);

            if (payload.results) {
                Renderer.renderAll(payload.results);
                const qCount = payload.results.qa?.questions || 0;
                const aCount = payload.results.qa?.items?.filter(i => i.type === 'answer').length || 0;
                Toast.success(`Extracted ${qCount} questions, ${aCount} answers`);
            }
        },

        [MSG.EXTRACTION_ERROR]: (payload) => {
            UI.setStatus(STATUS.ERROR);
            Toast.error(payload.error || 'Extraction failed');
        }
    };

    chrome.runtime.onMessage.addListener((message) => {
        const handler = MessageHandlers[message.type];
        if (handler) {
            handler(message.payload || message);
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT BINDING
    // ═══════════════════════════════════════════════════════════════════════════

    function bindEvents() {
        // Main actions
        $.btnScan?.addEventListener('click', () => Actions.scan());
        $.btnClear?.addEventListener('click', () => Actions.clear());

        // SCORM controls
        $.btnTestApi?.addEventListener('click', () => Actions.testAPI());
        $.btnSetCompletion?.addEventListener('click', () => Actions.setCompletion());

        // Quick actions
        $.btnAutoSelect?.addEventListener('click', () => Actions.autoSelect());
        $.btnElementSelector?.addEventListener('click', () => Actions.activateSelector());

        // Saved rules
        $.btnApplyRule?.addEventListener('click', () => Actions.applyRule());
        $.btnDeleteRule?.addEventListener('click', () => Actions.deleteRule());

        // Export
        $.btnExportJson?.addEventListener('click', () => Actions.export('json'));
        $.btnExportCsv?.addEventListener('click', () => Actions.export('csv'));
        $.btnExportTxt?.addEventListener('click', () => Actions.export('txt'));

        // Search
        $.searchInput?.addEventListener('input', (e) => Search.filter(e.target.value));

        // Related tabs
        $.btnRefreshRelated?.addEventListener('click', () => Actions.loadRelatedTabs());
        $.relatedList?.addEventListener('click', (e) => {
            const scanBtn = e.target.closest('.btn-scan-tab');
            const focusBtn = e.target.closest('.btn-focus-tab');

            if (scanBtn) {
                Actions.scanRelatedTab(parseInt(scanBtn.dataset.tabId, 10));
            }
            if (focusBtn) {
                Actions.focusTab(parseInt(focusBtn.dataset.tabId, 10));
            }
        });

        // Copy on click
        $.qaList?.addEventListener('click', handleCopyClick);
        $.correctList?.addEventListener('click', handleCopyClick);

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'r':
                        e.preventDefault();
                        Actions.scan();
                        break;
                    case 'f':
                        e.preventDefault();
                        $.searchInput?.focus();
                        break;
                    case 'e':
                        e.preventDefault();
                        Actions.export('json');
                        break;
                }
            }

            if (e.key === 'Escape' && $.searchInput) {
                Search.clear();
                $.searchInput.blur();
            }
        });
    }

    async function handleCopyClick(e) {
        const item = e.target.closest('[data-text]');
        if (!item) return;

        const text = item.dataset.text;
        const success = await copyToClipboard(text);

        if (success) {
            item.classList.add('copied');
            setTimeout(() => item.classList.remove('copied'), 500);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    async function init() {
        cacheElements();
        bindEvents();
        Tabs.init();

        // Get current tab
        const tab = await Extension.getCurrentTab();
        if (tab) {
            State.tabId = tab.id;
            State.tabUrl = tab.url || '';
            UI.setTabUrl(State.tabUrl);
        }

        // Load existing state
        const existingState = await Extension.sendToServiceWorker('GET_TAB_STATE');
        if (existingState?.results) {
            Renderer.renderAll(existingState.results);
        }

        // Load related tabs
        await Actions.loadRelatedTabs();

        // Check for saved selector rules
        await Actions.checkForSavedRule();

        UI.setStatus(STATUS.READY);

        console.log('[LMS QA Popup] Initialized');
    }

    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
