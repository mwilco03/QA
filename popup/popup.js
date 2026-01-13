/**
 * LMS QA Validator - Popup v7.0
 * Simplified UI: Priority actions always visible
 * 1) Complete Course 2) Scan Q&A 3) Export
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const STATUS = Object.freeze({
        READY: 'ready',
        SCANNING: 'scanning',
        SUCCESS: 'success',
        ERROR: 'error'
    });

    const MSG = Object.freeze({
        // Commands to content script
        SCAN: 'SCAN',
        TEST_API: 'TEST_API',
        SET_COMPLETION: 'SET_COMPLETION',
        FULL_COMPLETION: 'FULL_COMPLETION',
        COMPLETE_OBJECTIVES: 'COMPLETE_OBJECTIVES',
        MARK_SLIDES: 'MARK_SLIDES',
        AUTO_SELECT: 'AUTO_SELECT',
        EXPORT: 'EXPORT',
        DETECT_FRAMEWORK: 'DETECT_FRAMEWORK',
        GET_EXTRACTED_DATA: 'GET_EXTRACTED_DATA',
        // Messages from content script
        SCAN_STARTED: 'SCAN_STARTED',
        SCAN_COMPLETE: 'SCAN_COMPLETE',
        SCAN_ERROR: 'SCAN_ERROR',
        PROGRESS: 'PROGRESS',
        TEST_RESULT: 'TEST_RESULT',
        SET_COMPLETION_RESULT: 'SET_COMPLETION_RESULT',
        FULL_COMPLETION_RESULT: 'FULL_COMPLETION_RESULT',
        AUTO_SELECT_RESULT: 'AUTO_SELECT_RESULT',
        FRAMEWORK_DETECTED: 'FRAMEWORK_DETECTED',
        // TasksExtractor messages
        EXTRACTOR_TASKS_MANIFEST_DISCOVERED: 'EXTRACTOR_TASKS_MANIFEST_DISCOVERED',
        EXTRACTOR_ANSWER_RECORDED: 'EXTRACTOR_ANSWER_RECORDED',
        EXTRACTOR_EXTRACTED_DATA: 'EXTRACTOR_EXTRACTED_DATA',
        EXTRACTOR_QUESTIONS: 'EXTRACTOR_QUESTIONS',
        EXTRACTOR_CORRECT_ANSWERS: 'EXTRACTOR_CORRECT_ANSWERS'
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DOM ELEMENTS
    // ═══════════════════════════════════════════════════════════════════════════

    const $ = {
        // Status
        statusIndicator: document.getElementById('status-indicator'),
        statusText: document.querySelector('.status-text'),
        statusDot: document.querySelector('.status-dot'),
        tabUrl: document.getElementById('tab-url'),

        // Primary actions
        btnComplete: document.getElementById('btn-complete'),
        btnScan: document.getElementById('btn-scan'),
        btnExportJson: document.getElementById('btn-export-json'),

        // Status panel
        apiStatus: document.getElementById('api-status'),
        frameworkStatus: document.getElementById('framework-status'),
        questionsStatus: document.getElementById('questions-status'),
        networkStatus: document.getElementById('network-status'),

        // Progress
        progressContainer: document.getElementById('progress-container'),
        progressFill: document.getElementById('progress-fill'),
        progressText: document.getElementById('progress-text'),

        // Search
        searchContainer: document.getElementById('search-container'),
        searchInput: document.getElementById('search-input'),
        searchCount: document.getElementById('search-count'),

        // Tabs
        resultsTabs: document.getElementById('results-tabs'),
        tabPanels: document.getElementById('tab-panels'),
        qaCount: document.getElementById('qa-count'),
        correctCount: document.getElementById('correct-count'),
        networkCount: document.getElementById('network-count'),
        apisCount: document.getElementById('apis-count'),

        // Lists
        qaList: document.getElementById('qa-list'),
        correctList: document.getElementById('correct-list'),
        networkList: document.getElementById('network-list'),
        apisList: document.getElementById('apis-list'),

        // Panel actions
        btnCopyAllCorrect: document.getElementById('btn-copy-all-correct'),
        btnAutoSelect: document.getElementById('btn-auto-select'),
        btnRefreshNetwork: document.getElementById('btn-refresh-network'),

        // SCORM controls
        scormControls: document.getElementById('scorm-controls'),
        scormHeader: document.getElementById('scorm-header'),
        scormBody: document.getElementById('scorm-body'),
        completionStatus: document.getElementById('completion-status'),
        completionScore: document.getElementById('completion-score'),
        sessionTimeAuto: document.getElementById('session-time-auto'),
        sessionTimeMinutes: document.getElementById('session-time-minutes'),
        btnTestApi: document.getElementById('btn-test-api'),
        btnSetCompletion: document.getElementById('btn-set-completion'),
        btnFullCompletion: document.getElementById('btn-full-completion'),

        // Related windows
        relatedWindows: document.getElementById('related-windows'),
        relatedHeader: document.getElementById('related-header'),
        relatedBody: document.getElementById('related-body'),
        relatedList: document.getElementById('related-list'),
        relatedCount: document.getElementById('related-count'),

        // Export
        exportSection: document.getElementById('export-section'),
        exportHeader: document.getElementById('export-header'),
        exportBody: document.getElementById('export-body'),
        btnExportCsv: document.getElementById('btn-export-csv'),
        btnExportTxt: document.getElementById('btn-export-txt'),
        btnClear: document.getElementById('btn-clear'),

        // Toast
        toast: document.getElementById('toast')
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    const State = {
        tabId: null,
        tabUrl: '',
        status: STATUS.READY,

        // Detection results
        framework: null,
        apis: [],

        // Scan results (DOM-based)
        results: null,
        qaItems: [],
        correctItems: [],

        // Network results (TasksExtractor)
        networkData: null,
        networkQuestions: [],
        networkAnswers: [],

        // UI state
        activeTab: 'qa',
        searchQuery: ''
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function truncate(str, len = 100) {
        if (!str) return '';
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    function showToast(message, type = 'info', duration = 3000) {
        $.toast.textContent = message;
        $.toast.className = `toast ${type} show`;
        setTimeout(() => $.toast.classList.remove('show'), duration);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UI UPDATES
    // ═══════════════════════════════════════════════════════════════════════════

    const UI = {
        setStatus(status) {
            State.status = status;
            $.statusIndicator.className = `status-indicator ${status}`;

            const statusTexts = {
                [STATUS.READY]: 'Ready',
                [STATUS.SCANNING]: 'Scanning...',
                [STATUS.SUCCESS]: 'Complete',
                [STATUS.ERROR]: 'Error'
            };
            $.statusText.textContent = statusTexts[status] || 'Ready';
        },

        setProgress(step, total, message) {
            $.progressContainer.classList.add('active');
            const percent = (step / total) * 100;
            $.progressFill.style.width = `${percent}%`;
            $.progressText.textContent = message || `Step ${step} of ${total}`;
        },

        hideProgress() {
            $.progressContainer.classList.remove('active');
        },

        updateStatusPanel() {
            // API status
            if (State.apis.length > 0) {
                const apiType = State.apis[0]?.type || 'SCORM';
                $.apiStatus.textContent = apiType;
                $.apiStatus.classList.add('found');
                $.scormControls.classList.add('active');
            } else {
                $.apiStatus.textContent = '--';
                $.apiStatus.classList.remove('found');
            }

            // Framework status
            if (State.framework) {
                const names = {
                    storyline: 'Storyline',
                    rise: 'Rise 360',
                    captivate: 'Captivate',
                    lectora: 'Lectora',
                    ispring: 'iSpring'
                };
                $.frameworkStatus.textContent = names[State.framework] || State.framework;
                $.frameworkStatus.classList.add('found');
            } else {
                $.frameworkStatus.textContent = '--';
                $.frameworkStatus.classList.remove('found');
            }

            // Questions status
            const totalQuestions = State.qaItems.filter(i => i.type === 'question').length +
                                   State.networkQuestions.length;
            $.questionsStatus.textContent = totalQuestions > 0 ? totalQuestions : '--';
            $.questionsStatus.classList.toggle('found', totalQuestions > 0);

            // Network status
            const networkFound = State.networkQuestions.length > 0;
            $.networkStatus.textContent = networkFound ? `${State.networkQuestions.length} Q` : '--';
            $.networkStatus.classList.toggle('found', networkFound);
        },

        updateBadge(element, count) {
            if (element) {
                element.textContent = count;
                element.classList.toggle('has-items', count > 0);
            }
        },

        setSearchCount(matched, total) {
            $.searchCount.textContent = `${matched}/${total}`;
        },

        clearSearch() {
            $.searchInput.value = '';
            $.searchCount.textContent = '';
            State.searchQuery = '';
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════════════════════

    const Renderer = {
        renderAll() {
            this.renderQA();
            this.renderCorrect();
            this.renderNetwork();
            this.renderAPIs();
            this.updateCounts();
            UI.updateStatusPanel();
        },

        renderQA() {
            const items = State.qaItems;

            if (!items || items.length === 0) {
                $.qaList.innerHTML = '<div class="empty-state">Click "Scan Q&A" to extract questions and answers.</div>';
                return;
            }

            // Group into questions with answers
            const questions = [];
            let currentQ = null;

            for (const item of items) {
                if (item.type === 'question') {
                    if (currentQ) questions.push(currentQ);
                    currentQ = { question: item, answers: [] };
                } else if (item.type === 'answer' && currentQ) {
                    currentQ.answers.push(item);
                }
            }
            if (currentQ) questions.push(currentQ);

            if (questions.length === 0) {
                $.qaList.innerHTML = '<div class="empty-state">No structured Q&A found.</div>';
                return;
            }

            $.qaList.innerHTML = questions.map((q, idx) => `
                <div class="qa-item">
                    <div class="question">
                        <span class="q-number">Q${idx + 1}</span>
                        <span class="q-text">${escapeHtml(truncate(q.question.text, 200))}</span>
                    </div>
                    <div class="answers">
                        ${q.answers.map(a => `
                            <div class="answer ${a.correct ? 'correct' : ''}">
                                ${a.correct ? '<span class="correct-marker">✓</span>' : ''}
                                <span class="a-text">${escapeHtml(truncate(a.text, 150))}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        },

        renderCorrect() {
            const correct = State.qaItems.filter(i => i.correct);
            const networkCorrect = State.networkAnswers.filter(a => a.success);
            const allCorrect = [...correct, ...networkCorrect];

            if (allCorrect.length === 0) {
                $.correctList.innerHTML = '<div class="empty-state">No correct answers found yet.</div>';
                $.btnCopyAllCorrect.disabled = true;
                return;
            }

            $.btnCopyAllCorrect.disabled = false;
            $.correctList.innerHTML = allCorrect.map((item, idx) => `
                <div class="correct-item">
                    <span class="correct-number">${idx + 1}</span>
                    <span class="correct-text">${escapeHtml(item.text || item.response || 'Unknown')}</span>
                    <span class="correct-source">${item.source || (item.questionId ? 'Network' : 'DOM')}</span>
                </div>
            `).join('');
        },

        renderNetwork() {
            const questions = State.networkQuestions;
            const answers = State.networkAnswers;

            if (questions.length === 0 && answers.length === 0) {
                $.networkList.innerHTML = '<div class="empty-state">Monitoring network for tasks.json and xAPI statements...</div>';
                return;
            }

            let html = '';

            // Show discovered questions from tasks.json
            if (questions.length > 0) {
                html += `<div class="network-section">
                    <div class="section-label">Tasks.json Questions (${questions.length})</div>
                    ${questions.map((q, idx) => `
                        <div class="network-question">
                            <span class="q-number">Q${idx + 1}</span>
                            <span class="q-text">${escapeHtml(truncate(q.prompt || q.text, 150))}</span>
                            ${q.choices ? `
                                <div class="choices">
                                    ${q.choices.map((c, i) => `
                                        <span class="choice ${q.correctAnswer === String(i) ? 'correct' : ''}">${escapeHtml(truncate(c, 50))}</span>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>`;
            }

            // Show recorded answers from xAPI
            if (answers.length > 0) {
                html += `<div class="network-section">
                    <div class="section-label">xAPI Answers (${answers.length})</div>
                    ${answers.map(a => `
                        <div class="network-answer ${a.success ? 'correct' : 'incorrect'}">
                            <span class="answer-status">${a.success ? '✓' : '✗'}</span>
                            <span class="answer-response">${escapeHtml(a.response || 'N/A')}</span>
                            <span class="answer-id">${truncate(a.questionId, 20)}</span>
                        </div>
                    `).join('')}
                </div>`;
            }

            $.networkList.innerHTML = html;
        },

        renderAPIs() {
            const apis = State.apis;

            if (!apis || apis.length === 0) {
                $.apisList.innerHTML = '<div class="empty-state">No SCORM/xAPI APIs detected.</div>';
                return;
            }

            $.apisList.innerHTML = apis.map((api, idx) => `
                <div class="api-item">
                    <div class="api-header">
                        <span class="api-type">${api.type || 'SCORM'}</span>
                        <span class="api-location">${api.location || 'window'}</span>
                        <span class="api-status ${api.functional ? 'functional' : 'error'}">
                            ${api.functional ? '✓ Working' : '✗ Error'}
                        </span>
                    </div>
                    ${api.methods ? `
                        <div class="api-methods">
                            ${api.methods.slice(0, 5).map(m => `<span class="method">${m}</span>`).join('')}
                            ${api.methods.length > 5 ? `<span class="method more">+${api.methods.length - 5}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            `).join('');
        },

        updateCounts() {
            const qaCount = State.qaItems.filter(i => i.type === 'question').length;
            const correctCount = State.qaItems.filter(i => i.correct).length +
                                State.networkAnswers.filter(a => a.success).length;
            const networkCount = State.networkQuestions.length;
            const apisCount = State.apis.length;

            UI.updateBadge($.qaCount, qaCount);
            UI.updateBadge($.correctCount, correctCount);
            UI.updateBadge($.networkCount, networkCount);
            UI.updateBadge($.apisCount, apisCount);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTENSION COMMUNICATION
    // ═══════════════════════════════════════════════════════════════════════════

    const Extension = {
        async getActiveTab() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab;
        },

        async sendToContent(type, payload = {}) {
            console.log(`[Popup] Sending to content: ${type}`, payload);
            try {
                const tab = await this.getActiveTab();
                if (!tab?.id) throw new Error('No active tab');
                console.log(`[Popup] Target tab: ${tab.id} - ${tab.url?.substring(0, 50)}...`);

                return new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(tab.id, { type, ...payload }, response => {
                        if (chrome.runtime.lastError) {
                            console.error(`[Popup] Send error: ${chrome.runtime.lastError.message}`);
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            console.log(`[Popup] Response from content:`, response);
                            resolve(response);
                        }
                    });
                });
            } catch (error) {
                console.error('[Popup] Send error:', error);
                throw error;
            }
        },

        async sendToServiceWorker(type, payload = {}) {
            console.log(`[Popup] Sending to SW: ${type}`, payload);
            return chrome.runtime.sendMessage({ type, ...payload });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const Actions = {
        async complete() {
            try {
                UI.setStatus(STATUS.SCANNING);
                UI.setProgress(1, 3, 'Completing course...');

                const status = $.completionStatus.value;
                const score = parseInt($.completionScore.value, 10) || 100;
                const autoTime = $.sessionTimeAuto.checked;
                const minutes = parseInt($.sessionTimeMinutes.value, 10) || 15;
                const sessionTime = autoTime ? null : minutes * 60;

                await Extension.sendToContent(MSG.FULL_COMPLETION, {
                    status,
                    score,
                    sessionTime
                });

                // Result will come via message listener
            } catch (error) {
                UI.setStatus(STATUS.ERROR);
                UI.hideProgress();
                showToast('Completion failed: ' + error.message, 'error');
            }
        },

        async scan() {
            try {
                UI.setStatus(STATUS.SCANNING);
                UI.setProgress(1, 7, 'Starting scan...');

                await Extension.sendToContent(MSG.SCAN);
                // Results will come via message listener
            } catch (error) {
                UI.setStatus(STATUS.ERROR);
                UI.hideProgress();
                showToast('Scan failed: ' + error.message, 'error');
            }
        },

        async testApi() {
            try {
                await Extension.sendToContent(MSG.TEST_API, { apiIndex: 0 });
                showToast('Testing API...', 'info');
            } catch (error) {
                showToast('API test failed: ' + error.message, 'error');
            }
        },

        async setCompletion() {
            try {
                const status = $.completionStatus.value;
                const score = parseInt($.completionScore.value, 10) || 100;

                await Extension.sendToContent(MSG.SET_COMPLETION, { status, score });
                showToast('Setting completion...', 'info');
            } catch (error) {
                showToast('Set completion failed: ' + error.message, 'error');
            }
        },

        async autoSelect() {
            try {
                await Extension.sendToContent(MSG.AUTO_SELECT);
                showToast('Auto-selecting answers...', 'info');
            } catch (error) {
                showToast('Auto-select failed: ' + error.message, 'error');
            }
        },

        async refreshNetwork() {
            try {
                await Extension.sendToContent(MSG.GET_EXTRACTED_DATA);
                showToast('Refreshing network data...', 'info');
            } catch (error) {
                showToast('Refresh failed: ' + error.message, 'error');
            }
        },

        export(format) {
            try {
                Extension.sendToContent(MSG.EXPORT, { format });
                showToast(`Exporting as ${format.toUpperCase()}...`, 'info');
            } catch (error) {
                showToast('Export failed: ' + error.message, 'error');
            }
        },

        copyAllCorrect() {
            const correct = State.qaItems.filter(i => i.correct);
            const networkCorrect = State.networkAnswers.filter(a => a.success);
            const allCorrect = [...correct, ...networkCorrect];

            if (allCorrect.length === 0) {
                showToast('No correct answers to copy', 'error');
                return;
            }

            const text = allCorrect.map((item, i) =>
                `${i + 1}. ${item.text || item.response || 'Unknown'}`
            ).join('\n');

            navigator.clipboard.writeText(text).then(() => {
                showToast(`Copied ${allCorrect.length} answers`, 'success');
            }).catch(() => {
                showToast('Copy failed', 'error');
            });
        },

        clear() {
            State.results = null;
            State.qaItems = [];
            State.correctItems = [];
            State.apis = [];
            State.framework = null;

            Renderer.renderAll();
            UI.setStatus(STATUS.READY);
            showToast('Cleared', 'info');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    const MessageHandlers = {
        [MSG.SCAN_STARTED]() {
            UI.setStatus(STATUS.SCANNING);
        },

        [MSG.PROGRESS](payload) {
            UI.setProgress(payload.step, payload.total, payload.message);
        },

        [MSG.SCAN_COMPLETE](payload) {
            UI.setStatus(STATUS.SUCCESS);
            UI.hideProgress();

            State.results = payload;
            State.qaItems = payload.qa?.items || [];
            State.apis = payload.apis || [];
            State.framework = payload.tool;

            Renderer.renderAll();
            showToast(`Found ${State.qaItems.length} items`, 'success');
        },

        [MSG.SCAN_ERROR](payload) {
            UI.setStatus(STATUS.ERROR);
            UI.hideProgress();
            showToast('Scan error: ' + (payload.error || 'Unknown'), 'error');
        },

        [MSG.TEST_RESULT](payload) {
            if (payload.success) {
                showToast('API test successful', 'success');
            } else {
                showToast('API test failed: ' + (payload.error || 'Unknown'), 'error');
            }
        },

        [MSG.SET_COMPLETION_RESULT](payload) {
            if (payload.success) {
                showToast('Completion status set', 'success');
            } else {
                showToast('Failed: ' + (payload.error || 'Unknown'), 'error');
            }
        },

        [MSG.FULL_COMPLETION_RESULT](payload) {
            UI.setStatus(payload.success ? STATUS.SUCCESS : STATUS.ERROR);
            UI.hideProgress();

            if (payload.success) {
                showToast('Course marked complete!', 'success');
            } else {
                showToast('Completion failed: ' + (payload.error || 'Unknown'), 'error');
            }
        },

        [MSG.AUTO_SELECT_RESULT](payload) {
            if (payload.success) {
                showToast(`Auto-selected ${payload.count || 0} answers`, 'success');
            } else {
                showToast('Auto-select failed', 'error');
            }
        },

        [MSG.FRAMEWORK_DETECTED](payload) {
            State.framework = payload.framework;
            State.apis = payload.apis || State.apis;
            UI.updateStatusPanel();
        },

        // TasksExtractor messages
        [MSG.EXTRACTOR_TASKS_MANIFEST_DISCOVERED](payload) {
            showToast(`Discovered ${payload.questionCount} questions from tasks.json`, 'success');
            // Request full data
            Extension.sendToContent(MSG.GET_EXTRACTED_DATA);
        },

        [MSG.EXTRACTOR_ANSWER_RECORDED](payload) {
            // Add to network answers
            State.networkAnswers.push({
                questionId: payload.questionId,
                response: payload.response,
                success: payload.success
            });
            Renderer.renderNetwork();
            Renderer.updateCounts();
        },

        [MSG.EXTRACTOR_EXTRACTED_DATA](payload) {
            State.networkData = payload;
            State.networkQuestions = payload.questions || [];
            State.networkAnswers = Object.values(payload.answers || {});

            Renderer.renderNetwork();
            Renderer.updateCounts();
            UI.updateStatusPanel();
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT BINDINGS
    // ═══════════════════════════════════════════════════════════════════════════

    function bindEvents() {
        // Primary actions
        $.btnComplete?.addEventListener('click', () => Actions.complete());
        $.btnScan?.addEventListener('click', () => Actions.scan());
        $.btnExportJson?.addEventListener('click', () => Actions.export('json'));

        // Panel actions
        $.btnCopyAllCorrect?.addEventListener('click', () => Actions.copyAllCorrect());
        $.btnAutoSelect?.addEventListener('click', () => Actions.autoSelect());
        $.btnRefreshNetwork?.addEventListener('click', () => Actions.refreshNetwork());

        // SCORM controls
        $.btnTestApi?.addEventListener('click', () => Actions.testApi());
        $.btnSetCompletion?.addEventListener('click', () => Actions.setCompletion());
        $.btnFullCompletion?.addEventListener('click', () => Actions.complete());

        // Session time toggle
        $.sessionTimeAuto?.addEventListener('change', (e) => {
            $.sessionTimeMinutes.disabled = e.target.checked;
        });

        // Export options
        $.btnExportCsv?.addEventListener('click', () => Actions.export('csv'));
        $.btnExportTxt?.addEventListener('click', () => Actions.export('txt'));
        $.btnClear?.addEventListener('click', () => Actions.clear());

        // Tab switching
        $.resultsTabs?.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;

            const tabName = btn.dataset.tab;

            // Update active tab button
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update active panel
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`${tabName}-panel`)?.classList.add('active');

            State.activeTab = tabName;
        });

        // Search
        $.searchInput?.addEventListener('input', (e) => {
            State.searchQuery = e.target.value.toLowerCase();
            filterResults();
        });

        // Collapsible sections
        $.scormHeader?.addEventListener('click', () => {
            $.scormControls.classList.toggle('collapsed');
        });

        $.relatedHeader?.addEventListener('click', () => {
            $.relatedWindows.classList.toggle('collapsed');
        });

        $.exportHeader?.addEventListener('click', () => {
            $.exportSection.classList.toggle('collapsed');
        });

        // Listen for messages from service worker
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const handler = MessageHandlers[message.type];
            if (handler) {
                handler(message.payload || message);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'r':
                        e.preventDefault();
                        Actions.scan();
                        break;
                    case 'e':
                        e.preventDefault();
                        Actions.export('json');
                        break;
                    case 'f':
                        e.preventDefault();
                        $.searchInput?.focus();
                        break;
                }
            }
        });
    }

    function filterResults() {
        const query = State.searchQuery;
        if (!query) {
            // Show all
            document.querySelectorAll('.qa-item, .correct-item, .network-question, .api-item')
                .forEach(el => el.style.display = '');
            return;
        }

        // Filter visible items
        document.querySelectorAll('.qa-item, .correct-item, .network-question, .api-item')
            .forEach(el => {
                const text = el.textContent.toLowerCase();
                el.style.display = text.includes(query) ? '' : 'none';
            });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

    async function init() {
        try {
            // Get current tab
            const tab = await Extension.getActiveTab();
            State.tabId = tab?.id;
            State.tabUrl = tab?.url || '';

            // Show URL in footer
            if ($.tabUrl) {
                $.tabUrl.textContent = truncate(State.tabUrl, 40);
                $.tabUrl.title = State.tabUrl;
            }

            // Bind events
            bindEvents();

            // Initial render
            Renderer.renderAll();

            // Auto-detect framework
            try {
                await Extension.sendToContent(MSG.DETECT_FRAMEWORK);
            } catch (e) {
                console.log('Framework detection skipped:', e.message);
            }

            // Request network data from TasksExtractor
            try {
                await Extension.sendToContent(MSG.GET_EXTRACTED_DATA);
            } catch (e) {
                console.log('Network data request skipped:', e.message);
            }

            UI.setStatus(STATUS.READY);

        } catch (error) {
            console.error('Init error:', error);
            UI.setStatus(STATUS.ERROR);
        }
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
