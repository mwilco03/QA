/**
 * LMS QA Validator - Popup v4.0
 * Intentional workflow-driven interface
 *
 * Architecture:
 * - Activation gate: Only run when appropriate
 * - Framework detection: Identify what we're working with first
 * - User-driven workflow: Prompt user for next action
 * - Operation feedback: Show exactly what's happening
 * - Conditional UI: Only show relevant controls
 *
 * @fileoverview Main popup script with workflow management
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
        EXTRACTION_ERROR: 'EXTRACTION_ERROR',
        SELECTOR_INJECTION_FAILED: 'SELECTOR_INJECTION_FAILED',
        FRAMEWORK_DETECTED: 'FRAMEWORK_DETECTED',
        DETECTION_COMPLETE: 'DETECTION_COMPLETE',
        // Objectives and slides completion
        OBJECTIVES_COMPLETE: 'OBJECTIVES_COMPLETE',
        SLIDES_MARKED: 'SLIDES_MARKED',
        FULL_COMPLETION_RESULT: 'FULL_COMPLETION_RESULT'
    });

    const STATUS = Object.freeze({
        READY: { text: 'Ready', class: 'ready' },
        INACTIVE: { text: 'Inactive', class: 'inactive' },
        DETECTING: { text: 'Detecting...', class: 'scanning' },
        SCANNING: { text: 'Scanning...', class: 'scanning' },
        SUCCESS: { text: 'Complete', class: 'success' },
        ERROR: { text: 'Error', class: 'error' }
    });

    // Workflow states
    const WORKFLOW = Object.freeze({
        GATE: 'gate',           // Activation gate - checking if we should run
        DETECTING: 'detecting', // Framework detection in progress
        DETECTED: 'detected',   // Framework found, waiting for user action
        OPERATING: 'operating', // Operation in progress
        RESULTS: 'results',     // Showing results
        IDLE: 'idle'            // Ready for manual actions
    });

    // LMS URL patterns for activation check
    // Organized by category for maintainability
    const LMS_URL_PATTERNS = [
        // Generic e-learning terms
        /scorm/i, /xapi/i, /tincan/i, /aicc/i, /cmi5/i,
        /lms/i, /lcms/i, /learn/i, /training/i, /course/i,
        /elearn/i, /e-learn/i, /education/i, /academy/i,
        /classroom/i, /curriculum/i, /module/i, /lesson/i,

        // Authoring tools
        /articulate/i, /storyline/i, /rise360/i, /review360/i,
        /captivate/i, /lectora/i, /ispring/i, /camtasia/i,
        /elucidat/i, /evolve/i, /gomo/i, /adapt/i,
        /branchtrack/i, /easygenerator/i, /dominknow/i,

        // Major LMS platforms
        /moodle/i, /blackboard/i, /canvas/i, /brightspace/i,
        /d2l/i, /schoology/i, /edmodo/i, /sakai/i,

        // Enterprise LMS
        /cornerstone/i, /csod/i, /successfactors/i, /sap.*learning/i,
        /workday.*learn/i, /docebo/i, /absorb/i, /litmos/i,
        /talentlms/i, /skillsoft/i, /pluralsight/i, /udemy/i,
        /linkedin.*learn/i, /degreed/i, /edcast/i,

        // Healthcare/Compliance LMS
        /healthstream/i, /relias/i, /netlearning/i, /medbridge/i,
        /compliancebridge/i, /kallidus/i, /netexlearning/i,

        // Government/Public Sector
        /govlearn/i, /fedvte/i, /alms\.army/i, /jko\.jten/i,

        // Content hosting patterns
        /scormcloud/i, /scormengine/i, /rustici/i,
        /content\.one/i, /player\.vimeo/i, /wistia/i,

        // Common URL path patterns
        /\/launch\//i, /\/player\//i, /\/viewer\//i,
        /\/courseware\//i, /\/content\//i, /\/modules\//i,
        /launchcourse/i, /playcourse/i, /startcourse/i
    ];

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

    function isLikelyLMSUrl(url) {
        if (!url) return false;
        return LMS_URL_PATTERNS.some(pattern => pattern.test(url));
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
        workflow: WORKFLOW.GATE,
        isActivated: false,
        detectedFramework: null,
        detectedAPIs: [],
        quickActions: [],
        lastOperation: null,
        settings: {
            autoScan: false
        },

        reset() {
            this.results = null;
            this.detectedFramework = null;
            this.detectedAPIs = [];
        },

        hasResults() {
            return this.results?.qa?.items?.length > 0;
        },

        getQAItems() {
            return this.results?.qa?.items || [];
        },

        getAPIs() {
            return this.results?.apis || [];
        },

        setWorkflow(state) {
            this.workflow = state;
            WorkflowUI.update();
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DOM CACHE
    // ═══════════════════════════════════════════════════════════════════════════

    const $ = {};

    function cacheElements() {
        const ids = [
            'tab-url', 'status-indicator',
            'activation-gate', 'gate-reason', 'btn-force-activate', 'btn-import-rules-gate',
            'framework-panel', 'framework-icon', 'framework-name', 'framework-details',
            'btn-extract-qa', 'btn-complete-course', 'btn-skip-detection',
            'main-actions', 'btn-scan', 'btn-clear',
            'progress-container', 'progress-fill', 'progress-text',
            'operation-feedback', 'operation-icon', 'operation-status', 'operation-details',
            'operation-result', 'btn-retry-operation', 'btn-try-alternative', 'btn-save-config',
            'validation-warnings',
            'related-windows', 'related-list', 'btn-refresh-related',
            'quick-actions-saved', 'quick-actions-list', 'quick-actions-count',
            'search-container', 'search-input', 'search-count',
            'results-tabs', 'tab-panels', 'qa-list', 'apis-list', 'correct-list', 'logs-list',
            'qa-count', 'apis-count', 'correct-count', 'logs-count',
            'scorm-controls', 'completion-status', 'completion-score',
            'btn-test-api', 'btn-set-completion', 'btn-copy-all-correct',
            'btn-complete-objectives', 'btn-mark-slides', 'btn-full-completion',
            'element-picker', 'btn-auto-select', 'btn-element-selector',
            'saved-rules', 'rule-info', 'btn-apply-rule', 'btn-delete-rule',
            'rules-management', 'rules-count', 'btn-export-rules', 'btn-import-rules', 'rules-file-input',
            'export-actions', 'btn-export-json', 'btn-export-csv', 'btn-export-txt',
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
    // WORKFLOW UI MANAGEMENT
    // Controls what's visible based on current workflow state
    // ═══════════════════════════════════════════════════════════════════════════

    const WorkflowUI = {
        update() {
            const state = State.workflow;
            const hasResults = State.hasResults();
            const hasAPIs = State.getAPIs().length > 0;

            // Hide all workflow panels first
            this.hideAll();

            switch (state) {
                case WORKFLOW.GATE:
                    this.showGate();
                    break;
                case WORKFLOW.DETECTING:
                    this.showDetecting();
                    break;
                case WORKFLOW.DETECTED:
                    this.showDetected();
                    break;
                case WORKFLOW.OPERATING:
                    this.showOperating();
                    break;
                case WORKFLOW.RESULTS:
                case WORKFLOW.IDLE:
                    this.showMain(hasResults, hasAPIs);
                    break;
            }
        },

        hideAll() {
            $.activationGate?.classList.remove('active');
            $.frameworkPanel?.classList.remove('active');
            $.mainActions?.classList.remove('active');
            $.operationFeedback?.classList.remove('active');
            $.progressContainer?.classList.remove('active');
            $.searchContainer?.classList.remove('active', 'has-results');
            $.resultsTabs?.classList.remove('active');
            // $.tabPanels is a NodeList - iterate over it
            $.tabPanels?.forEach(panel => panel.classList.remove('active'));
            $.scormControls?.classList.remove('active');
            $.elementPicker?.classList.remove('active');
            $.exportActions?.classList.remove('active');
            $.quickActionsSaved?.classList.remove('active');
        },

        showGate() {
            $.activationGate?.classList.add('active');
            UI.setStatus(STATUS.INACTIVE);
        },

        showDetecting() {
            $.progressContainer?.classList.add('active');
            UI.setStatus(STATUS.DETECTING);
            UI.setProgress(1, 2, 'Detecting framework...');
        },

        showDetected() {
            $.frameworkPanel?.classList.add('active');
            UI.setStatus(STATUS.READY);
        },

        showOperating() {
            $.operationFeedback?.classList.add('active');
            $.progressContainer?.classList.add('active');
        },

        showMain(hasResults, hasAPIs) {
            $.mainActions?.classList.add('active');
            $.elementPicker?.classList.add('active');
            $.rulesManagement?.classList.add('active');

            if (hasResults) {
                $.searchContainer?.classList.add('active', 'has-results');
                $.resultsTabs?.classList.add('active');
                // Activate first tab panel by default (Q&A panel)
                $.tabPanels?.forEach((panel, idx) => {
                    panel.classList.toggle('active', idx === 0);
                });
                $.exportActions?.classList.add('active');
            }

            if (hasAPIs) {
                $.scormControls?.classList.add('active');
            }

            // Show quick actions if we have saved configs
            if (State.quickActions.length > 0) {
                $.quickActionsSaved?.classList.add('active');
                UI.updateBadge($.quickActionsCount, State.quickActions.length);
            }

            UI.setStatus(hasResults ? STATUS.SUCCESS : STATUS.READY);
        }
    };

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

        setSearchCount(matched, total) {
            if ($.searchCount) {
                $.searchCount.textContent = matched < total ? `${matched} of ${total}` : '';
            }
        },

        clearSearch() {
            if ($.searchInput) $.searchInput.value = '';
            if ($.searchCount) $.searchCount.textContent = '';
        },

        setGateReason(reason) {
            if ($.gateReason) {
                $.gateReason.textContent = reason;
            }
        },

        setFrameworkInfo(framework, details) {
            const toolNames = {
                storyline: 'Articulate Storyline',
                rise: 'Articulate Rise 360',
                captivate: 'Adobe Captivate',
                lectora: 'Lectora',
                ispring: 'iSpring',
                camtasia: 'Camtasia',
                generic: 'Unknown Framework'
            };

            if ($.frameworkName) {
                $.frameworkName.textContent = toolNames[framework] || framework || 'Unknown';
            }

            if ($.frameworkDetails && details) {
                $.frameworkDetails.innerHTML = `
                    <div class="detail-row">
                        <span class="detail-label">APIs Found:</span>
                        <span class="detail-value">${details.apiCount || 0}</span>
                    </div>
                    ${details.potentialQA ? `
                    <div class="detail-row">
                        <span class="detail-label">Potential Q&A:</span>
                        <span class="detail-value">${details.potentialQA}</span>
                    </div>` : ''}
                    ${details.slideCount ? `
                    <div class="detail-row">
                        <span class="detail-label">Slides:</span>
                        <span class="detail-value">${details.slideCount}</span>
                    </div>` : ''}
                `;
            }

            // Update icon based on framework
            if ($.frameworkIcon) {
                $.frameworkIcon.className = 'framework-icon ' + (framework || 'generic');
            }
        },

        setOperationStatus(status, details = []) {
            if ($.operationStatus) {
                $.operationStatus.textContent = status;
            }

            if ($.operationDetails && details.length > 0) {
                $.operationDetails.innerHTML = details.map(d => `
                    <div class="operation-step ${d.status || ''}">
                        <span class="step-icon">${d.status === 'done' ? '✓' : d.status === 'error' ? '✗' : '○'}</span>
                        <span class="step-text">${escapeHtml(d.text)}</span>
                    </div>
                `).join('');
            }
        },

        setOperationResult(success, message, canRetry = false, hasAlternative = false) {
            if ($.operationResult) {
                $.operationResult.innerHTML = `
                    <div class="result-message ${success ? 'success' : 'error'}">
                        ${escapeHtml(message)}
                    </div>
                `;
            }

            if ($.btnRetryOperation) {
                $.btnRetryOperation.style.display = canRetry ? 'inline-flex' : 'none';
            }
            if ($.btnTryAlternative) {
                $.btnTryAlternative.style.display = hasAlternative ? 'inline-flex' : 'none';
            }
            if ($.btnSaveConfig) {
                $.btnSaveConfig.style.display = success ? 'inline-flex' : 'none';
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const Toast = {
        _timeout: null,

        show(message, type = 'info', duration = 3000) {
            if (!$.toast) return;

            // Clear any existing timeout to prevent premature hide
            if (this._timeout) {
                clearTimeout(this._timeout);
                this._timeout = null;
            }

            $.toast.textContent = message;
            $.toast.className = `toast ${type} show`;

            this._timeout = setTimeout(() => {
                $.toast.classList.remove('show');
                this._timeout = null;
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
    // TEMPLATES
    // ═══════════════════════════════════════════════════════════════════════════

    const Templates = {
        emptyState(message) {
            const div = document.createElement('div');
            div.className = 'empty-state';
            div.textContent = message;
            return div;
        },

        correctItem(text, idx) {
            const div = document.createElement('div');
            div.className = 'correct-item';
            div.dataset.text = text;

            const num = document.createElement('span');
            num.className = 'correct-num';
            num.textContent = `${idx + 1}.`;
            div.appendChild(num);

            const textSpan = document.createElement('span');
            textSpan.className = 'correct-text';
            textSpan.textContent = text;
            div.appendChild(textSpan);

            return div;
        },

        quickActionItem(config, idx) {
            return `
                <div class="quick-action-item" data-index="${idx}">
                    <div class="qa-info">
                        <span class="qa-domain">${escapeHtml(config.domain)}</span>
                        <span class="qa-type">${escapeHtml(config.type)}</span>
                    </div>
                    <button class="btn btn-sm btn-primary btn-run-quick" data-index="${idx}">Run</button>
                </div>
            `;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // RESULTS RENDERING
    // ═══════════════════════════════════════════════════════════════════════════

    const Renderer = {
        renderAll(results) {
            if (!results) return;

            State.results = results;

            this.renderToolBadge(results.tool);
            this.renderSummary(results);
            this.renderQAGrouped(results.qa?.items || [], results.qa?.questions || []);
            this.renderAPIs(results.apis || []);
            this.renderCorrect(results.qa?.items?.filter(i => i.correct) || []);
            this.renderLogs(results.logs || []);

            UI.updateBadge($.qaCount, results.qa?.total || 0);
            UI.updateBadge($.apisCount, results.apis?.length || 0);
            UI.updateBadge($.correctCount, results.qa?.correct || 0);
            UI.updateBadge($.logsCount, results.logs?.length || 0);

            // Update workflow state to show results
            State.setWorkflow(WORKFLOW.RESULTS);
        },

        renderToolBadge(tool) {
            let badge = document.getElementById('tool-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'tool-badge';
                badge.className = 'tool-badge';
                document.querySelector('.tab-info')?.appendChild(badge);
            }

            if (tool && tool !== 'generic') {
                const toolNames = {
                    storyline: 'Storyline',
                    rise: 'Rise 360',
                    captivate: 'Captivate',
                    lectora: 'Lectora',
                    ispring: 'iSpring',
                    camtasia: 'Camtasia'
                };
                badge.textContent = toolNames[tool] || tool;
                badge.className = 'tool-badge ' + tool;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        },

        renderSummary(results) {
            let summary = document.getElementById('scan-summary');
            if (!summary) {
                summary = document.createElement('div');
                summary.id = 'scan-summary';
                summary.className = 'scan-summary';
                $.qaList?.parentElement?.insertBefore(summary, $.qaList);
            }

            const qa = results.qa || {};
            const questions = qa.questions || [];
            const items = qa.items || [];

            if (items.length === 0) {
                summary.style.display = 'none';
                return;
            }

            const typeCounts = {};
            questions.forEach(q => {
                const type = q.questionType || 'choice';
                typeCounts[type] = (typeCounts[type] || 0) + 1;
            });

            const typeLabels = {
                'choice': 'Multiple Choice',
                'sequencing': 'Sequence',
                'matching': 'Matching',
                'true-false': 'True/False',
                'fill-in': 'Fill-in',
                'multiple-choice': 'Multi-Select'
            };

            const typeSummary = Object.entries(typeCounts)
                .map(([type, count]) => `${typeLabels[type] || type}: ${count}`)
                .join(' | ');

            const correctCount = items.filter(i => i.correct).length;
            const answerCount = items.filter(i => i.type === 'answer').length;

            summary.innerHTML = `
                <div class="summary-row">
                    <span class="summary-stat"><strong>${questions.length}</strong> Questions</span>
                    <span class="summary-stat"><strong>${answerCount}</strong> Answers</span>
                    <span class="summary-stat correct"><strong>${correctCount}</strong> Correct</span>
                </div>
                ${typeSummary ? `<div class="summary-types">${typeSummary}</div>` : ''}
            `;
            summary.style.display = 'block';
        },

        renderQAGrouped(items, questions) {
            if (!$.qaList) return;

            if (questions && questions.length > 0) {
                this.renderGroupedQuestions(questions);
                return;
            }

            if (items.length === 0) {
                $.qaList.innerHTML = '<div class="empty-state">No Q&A found. Try scanning the page.</div>';
                return;
            }

            const groups = [];
            let currentGroup = null;

            items.forEach(item => {
                if (item.type === 'question') {
                    if (currentGroup) groups.push(currentGroup);
                    currentGroup = { question: item, answers: [] };
                } else if (item.type === 'answer' && currentGroup) {
                    currentGroup.answers.push(item);
                } else if (item.type === 'answer') {
                    groups.push({ question: null, answers: [item] });
                } else if (item.type === 'sequence_item' && currentGroup) {
                    currentGroup.answers.push({ ...item, isSequence: true });
                }
            });
            if (currentGroup) groups.push(currentGroup);

            $.qaList.innerHTML = groups.map((group, idx) => {
                const qNum = idx + 1;
                const questionHtml = group.question
                    ? `<div class="qa-question" data-text="${escapeHtml(group.question.text)}">
                         <span class="qa-num">Q${qNum}</span>
                         <span class="qa-text">${escapeHtml(group.question.text)}</span>
                       </div>`
                    : `<div class="qa-question orphan"><span class="qa-num">Q${qNum}</span><span class="qa-text">(Question not captured)</span></div>`;

                const answersHtml = group.answers.map(ans => {
                    const correctClass = ans.correct ? 'correct' : '';
                    const marker = ans.correct ? '✓' : '○';
                    return `
                        <div class="qa-answer ${correctClass}" data-text="${escapeHtml(ans.text)}">
                            <span class="qa-marker">${marker}</span>
                            <span class="qa-text">${escapeHtml(ans.text)}</span>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="qa-group">
                        ${questionHtml}
                        <div class="qa-answers">${answersHtml}</div>
                    </div>
                `;
            }).join('');
        },

        renderGroupedQuestions(questions) {
            $.qaList.innerHTML = questions.map((q, idx) => {
                const qNum = idx + 1;
                const typeLabel = q.questionType || 'choice';

                let answersHtml = '';

                if (q.answers && q.answers.length > 0) {
                    answersHtml = q.answers.map(ans => {
                        const correctClass = ans.correct ? 'correct' : '';
                        const marker = ans.correct ? '✓' : '○';
                        return `
                            <div class="qa-answer ${correctClass}" data-text="${escapeHtml(ans.text)}">
                                <span class="qa-marker">${marker}</span>
                                <span class="qa-text">${escapeHtml(ans.text)}</span>
                            </div>
                        `;
                    }).join('');
                }

                if (q.sequenceItems && q.sequenceItems.length > 0) {
                    answersHtml = q.sequenceItems
                        .sort((a, b) => (a.correctPosition || 0) - (b.correctPosition || 0))
                        .map((item, i) => `
                            <div class="qa-answer sequence" data-text="${escapeHtml(item.text)}">
                                <span class="qa-marker seq">${i + 1}</span>
                                <span class="qa-text">${escapeHtml(item.text)}</span>
                            </div>
                        `).join('');
                }

                if (q.matchPairs && q.matchPairs.length > 0) {
                    const sources = q.matchPairs.filter(p => p.type === 'match_source');
                    const targets = q.matchPairs.filter(p => p.type === 'match_target');
                    answersHtml = sources.map(src => {
                        const matchedTarget = targets.find(t => t.correctMatch === src.matchId);
                        return `
                            <div class="qa-answer match" data-text="${escapeHtml(src.text)}">
                                <span class="match-source">${escapeHtml(src.text)}</span>
                                <span class="match-arrow">→</span>
                                <span class="match-target">${matchedTarget ? escapeHtml(matchedTarget.text) : '?'}</span>
                            </div>
                        `;
                    }).join('');
                }

                return `
                    <div class="qa-group" data-type="${typeLabel}">
                        <div class="qa-question" data-text="${escapeHtml(q.text)}">
                            <span class="qa-num">Q${qNum}</span>
                            <span class="qa-text">${escapeHtml(q.text)}</span>
                            <span class="qa-type">${typeLabel}</span>
                        </div>
                        <div class="qa-answers">${answersHtml}</div>
                    </div>
                `;
            }).join('');
        },

        renderQA(items) {
            this.renderQAGrouped(items, []);
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

            if ($.btnCopyAllCorrect) {
                $.btnCopyAllCorrect.disabled = items.length === 0;
            }

            if (items.length === 0) {
                $.correctList.innerHTML = '';
                $.correctList.appendChild(Templates.emptyState('No correct answers found.'));
                return;
            }

            $.correctList.innerHTML = '';
            items.forEach((item, idx) => {
                $.correctList.appendChild(Templates.correctItem(item.text, idx));
            });
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

            const icons = { parent: '↑', child: '↓', sibling: '↔', 'domain-session': '🌐', 'cross-domain': '🔗' };

            $.relatedList.innerHTML = tabs.map(tab => `
                <div class="related-tab" data-tab-id="${tab.id}">
                    <span class="related-icon" title="${tab.relationship}">${icons[tab.relationship] || '?'}</span>
                    <span class="related-title" title="${escapeHtml(tab.title)}">${truncate(tab.title, 30)}</span>
                    <div class="related-actions">
                        <button class="btn-sm btn-pick-tab" data-tab-id="${tab.id}" title="Pick Q&A Elements">Pick</button>
                        <button class="btn-sm btn-scan-tab" data-tab-id="${tab.id}" title="Pattern Scan">Scan</button>
                        <button class="btn-sm btn-focus-tab" data-tab-id="${tab.id}" title="Focus Window">Go</button>
                    </div>
                </div>`).join('');
        },

        renderQuickActions(actions) {
            if (!$.quickActionsList) return;

            if (actions.length === 0) {
                $.quickActionsSaved?.classList.remove('active');
                return;
            }

            $.quickActionsSaved?.classList.add('active');
            UI.updateBadge($.quickActionsCount, actions.length);

            $.quickActionsList.innerHTML = actions.map((config, idx) =>
                Templates.quickActionItem(config, idx)
            ).join('');
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
    // ACTIVATION GATE
    // Determines if extension should be active on this page
    // ═══════════════════════════════════════════════════════════════════════════

    const ActivationGate = {
        async check() {
            const url = State.tabUrl;

            // Check 1: Is this a likely LMS URL?
            if (isLikelyLMSUrl(url)) {
                return { active: true, reason: 'LMS URL pattern detected' };
            }

            // Check 2: Do we have saved rules for this domain?
            const urlPattern = Actions.getURLPattern(url);
            if (urlPattern) {
                const response = await Extension.sendToServiceWorker('GET_SELECTOR_RULES', { urlPattern });
                if (response?.rules) {
                    return { active: true, reason: 'Saved rules found', hasRules: true };
                }
            }

            // Check 3: Check if we have any quick actions for this domain
            const domain = this.getDomain(url);
            const quickActions = await this.loadQuickActionsForDomain(domain);
            if (quickActions.length > 0) {
                State.quickActions = quickActions;
                return { active: true, reason: 'Quick actions available', quickActions };
            }

            // Not activated - show gate
            return {
                active: false,
                reason: 'This doesn\'t appear to be an LMS page. Activate manually if needed.'
            };
        },

        getDomain(url) {
            try {
                return new URL(url).hostname;
            } catch {
                return null;
            }
        },

        async loadQuickActionsForDomain(domain) {
            try {
                const data = await chrome.storage.local.get('quickActions');
                const allActions = data.quickActions || [];
                return allActions.filter(a => a.domain === domain);
            } catch {
                return [];
            }
        },

        activate() {
            State.isActivated = true;
            State.setWorkflow(WORKFLOW.IDLE);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    const Actions = {
        async detect() {
            State.setWorkflow(WORKFLOW.DETECTING);

            try {
                const response = await Extension.sendToContent('DETECT_FRAMEWORK');

                if (response?.framework) {
                    State.detectedFramework = response.framework;
                    State.detectedAPIs = response.apis || [];

                    UI.setFrameworkInfo(response.framework, {
                        apiCount: response.apis?.length || 0,
                        potentialQA: response.potentialQA,
                        slideCount: response.slideCount
                    });

                    State.setWorkflow(WORKFLOW.DETECTED);
                } else {
                    // No framework detected, go to manual mode
                    State.setWorkflow(WORKFLOW.IDLE);
                    Toast.info('No framework detected - use manual scan');
                }
            } catch (error) {
                State.setWorkflow(WORKFLOW.IDLE);
                Toast.error('Detection failed: ' + error.message);
            }
        },

        async scan() {
            try {
                if ($.btnScan) $.btnScan.disabled = true;
                State.setWorkflow(WORKFLOW.OPERATING);
                UI.setStatus(STATUS.SCANNING);
                UI.setOperationStatus('Scanning page...', [
                    { text: 'Discovering APIs', status: 'pending' },
                    { text: 'Detecting framework', status: 'pending' },
                    { text: 'Extracting Q&A', status: 'pending' }
                ]);

                await Extension.sendToContent('SCAN');
            } catch (error) {
                UI.setStatus(STATUS.ERROR);
                UI.setOperationResult(false, 'Scan failed: ' + error.message, true, false);
                Toast.error('Failed to start scan: ' + error.message);
                if ($.btnScan) $.btnScan.disabled = false;
            }
        },

        async extractQA() {
            State.setWorkflow(WORKFLOW.OPERATING);
            State.lastOperation = { type: 'extract', framework: State.detectedFramework };

            UI.setOperationStatus('Extracting Q&A...', [
                { text: `Using ${State.detectedFramework || 'generic'} extractor`, status: 'active' }
            ]);

            try {
                await Extension.sendToContent('SCAN');
            } catch (error) {
                UI.setOperationResult(false, 'Extraction failed: ' + error.message, true, true);
            }
        },

        async completeCourse() {
            State.setWorkflow(WORKFLOW.OPERATING);
            State.lastOperation = { type: 'complete', framework: State.detectedFramework };

            UI.setOperationStatus('Completing course...', [
                { text: 'Setting completion status', status: 'active' },
                { text: 'Setting score to 100%', status: 'pending' }
            ]);

            try {
                await Extension.sendToContent('SET_COMPLETION', {
                    status: 'completed',
                    score: 100,
                    apiIndex: 0
                });
            } catch (error) {
                UI.setOperationResult(false, 'Completion failed: ' + error.message, true, true);
            }
        },

        skipDetection() {
            State.setWorkflow(WORKFLOW.IDLE);
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

            Search.clear();

            State.setWorkflow(WORKFLOW.IDLE);
            Extension.sendToServiceWorker('CLEAR_TAB_STATE');

            Toast.info('Results cleared');
        },

        async saveAsQuickAction() {
            if (!State.lastOperation) {
                Toast.error('No operation to save');
                return;
            }

            const config = {
                domain: ActivationGate.getDomain(State.tabUrl),
                type: State.lastOperation.type,
                framework: State.lastOperation.framework,
                savedAt: new Date().toISOString()
            };

            try {
                const data = await chrome.storage.local.get('quickActions');
                const quickActions = data.quickActions || [];

                // Don't duplicate
                const exists = quickActions.some(a =>
                    a.domain === config.domain && a.type === config.type
                );

                if (!exists) {
                    quickActions.push(config);
                    await chrome.storage.local.set({ quickActions });
                    State.quickActions = quickActions.filter(a => a.domain === config.domain);
                    Renderer.renderQuickActions(State.quickActions);
                    Toast.success('Quick action saved');
                } else {
                    Toast.info('Quick action already exists');
                }
            } catch (error) {
                Toast.error('Failed to save: ' + error.message);
            }
        },

        async runQuickAction(index) {
            const action = State.quickActions[index];
            if (!action) return;

            if (action.type === 'extract') {
                await this.extractQA();
            } else if (action.type === 'complete') {
                await this.completeCourse();
            }
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

        async completeObjectives() {
            const status = $.completionStatus?.value || 'passed';
            const score = parseInt($.completionScore?.value || '100', 10);

            try {
                Toast.info('Completing all objectives...');
                await Extension.sendToContent('COMPLETE_OBJECTIVES', { status, score, apiIndex: 0 });
            } catch (error) {
                Toast.error('Failed to complete objectives');
            }
        },

        async markAllSlides() {
            try {
                Toast.info('Marking all slides as viewed...');
                await Extension.sendToContent('MARK_SLIDES', { apiIndex: 0 });
            } catch (error) {
                Toast.error('Failed to mark slides');
            }
        },

        async fullCompletion() {
            const status = $.completionStatus?.value || 'passed';
            const score = parseInt($.completionScore?.value || '100', 10);

            try {
                Toast.info('Running full course completion...');
                await Extension.sendToContent('FULL_COMPLETION', { status, score, apiIndex: 0 });
            } catch (error) {
                Toast.error('Failed to set completion');
            }
        },

        async autoSelect() {
            if (!$.btnAutoSelect) return;

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

        async copyAllCorrect() {
            const items = State.results?.qa?.items?.filter(i => i.correct) || [];
            if (items.length === 0) {
                Toast.info('No correct answers to copy');
                return;
            }

            const text = items.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n');
            const success = await copyToClipboard(text);

            if (success) {
                if ($.btnCopyAllCorrect) {
                    $.btnCopyAllCorrect.classList.add('copied');
                    const originalHTML = $.btnCopyAllCorrect.innerHTML;
                    $.btnCopyAllCorrect.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Copied!
                    `;
                    setTimeout(() => {
                        $.btnCopyAllCorrect.classList.remove('copied');
                        $.btnCopyAllCorrect.innerHTML = originalHTML;
                    }, 1500);
                }
                Toast.success(`Copied ${items.length} correct answer(s)`);
            } else {
                Toast.error('Failed to copy to clipboard');
            }
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
                    data = this.toAutomationJSON(results);
                    filename = `lms-qa-${timestamp}.json`;
            }

            this.download(data, filename, format);
            Toast.success(`Exported as ${format.toUpperCase()}`);
        },

        toAutomationJSON(results) {
            const questions = results.qa?.questions || [];
            const items = results.qa?.items || [];

            const structuredQuestions = questions.map((q, idx) => {
                const qIndex = items.findIndex(item => item.type === 'question' && item.text === q.text);
                const answers = [];
                for (let i = qIndex + 1; i < items.length; i++) {
                    if (items[i].type === 'answer') {
                        answers.push(items[i]);
                    } else if (items[i].type === 'question') {
                        break;
                    }
                }

                const correctAnswers = answers.filter(a => a.correct);

                return {
                    id: `q${idx + 1}`,
                    questionNumber: idx + 1,
                    questionType: q.questionType || 'choice',
                    text: q.text || '',
                    answers: answers.map((a, aIdx) => ({
                        id: `q${idx + 1}_a${aIdx + 1}`,
                        text: a.text || '',
                        isCorrect: !!a.correct,
                        position: aIdx + 1
                    })),
                    correctAnswerIds: correctAnswers.map((_, aIdx) =>
                        `q${idx + 1}_a${answers.indexOf(correctAnswers[aIdx]) + 1}`
                    ),
                    correctAnswerTexts: correctAnswers.map(a => a.text)
                };
            });

            const exportData = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                schema: 'lms-qa-validator-v1',
                source: {
                    url: results.url || State.tabUrl,
                    tool: results.tool || 'unknown'
                },
                summary: {
                    totalQuestions: questions.length,
                    totalAnswers: items.filter(i => i.type === 'answer').length,
                    correctAnswers: items.filter(i => i.correct).length
                },
                questions: structuredQuestions,
                answerKey: items
                    .filter(i => i.correct)
                    .map((item, idx) => ({
                        position: idx + 1,
                        text: item.text
                    }))
            };

            return JSON.stringify(exportData, null, 2);
        },

        toCSV(results) {
            const rows = [['QuestionNum', 'Type', 'Text', 'Correct', 'Source', 'Confidence']];
            let currentQuestion = 0;

            (results.qa?.items || []).forEach(item => {
                if (item.type === 'question') {
                    currentQuestion++;
                }
                rows.push([
                    item.type === 'question' ? currentQuestion : '',
                    item.type,
                    '"' + (item.text || '').replace(/"/g, '""') + '"',
                    item.correct ? 'Yes' : '',
                    item.source || '',
                    item.confidence || ''
                ]);
            });
            return rows.map(r => r.join(',')).join('\n');
        },

        toTXT(results) {
            const lines = [
                '='.repeat(60),
                'LMS QA VALIDATOR - ANSWER KEY',
                '='.repeat(60),
                'URL: ' + (results.url || State.tabUrl),
                'Tool: ' + (results.tool || 'Unknown'),
                '',
                '-'.repeat(60),
                'CORRECT ANSWERS',
                '-'.repeat(60)
            ];

            const correct = (results.qa?.items || []).filter(i => i.correct);
            correct.forEach((item, idx) => {
                lines.push((idx + 1) + '. ' + item.text);
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

        async activateSelectorOnTab(tabId) {
            const response = await Extension.sendToServiceWorker('ACTIVATE_SELECTOR_TAB', { targetTabId: tabId });
            if (response?.success) {
                Toast.success('Selector activated - switch to that window');
                window.close();
            } else {
                Toast.error('Failed to activate selector: ' + (response?.error || 'Unknown'));
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
            if (!$.btnElementSelector) return;

            try {
                $.btnElementSelector.disabled = true;
                $.btnElementSelector.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z"/>
                        <path d="M15 15h6v6h-6z"/>
                        <circle cx="12" cy="12" r="2"/>
                    </svg>
                    Activating...
                `;
                State.selectorActive = true;

                const response = await Extension.sendToContent('ACTIVATE_SELECTOR');

                if (response?.success) {
                    Toast.info('Selector panel opened - close this popup to interact with the page');
                    setTimeout(() => window.close(), 800);
                } else {
                    throw new Error(response?.reason || 'Failed to inject selector');
                }
            } catch (error) {
                Toast.error('Failed to activate selector: ' + error.message);
                $.btnElementSelector.disabled = false;
                this.resetSelectorButton();
                State.selectorActive = false;
            }
        },

        resetSelectorButton() {
            if (!$.btnElementSelector) return;

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
            await Extension.sendToContent('APPLY_SELECTOR_RULE', { rule: State.currentRule });
        },

        async deleteRule() {
            const urlPattern = this.getURLPattern(State.tabUrl);
            if (!urlPattern) return;

            await Extension.sendToServiceWorker('DELETE_SELECTOR_RULE', { urlPattern });
            this.hideSavedRule();
            await this.loadRulesCount();
            Toast.success('Rule deleted');
        },

        async loadRulesCount() {
            try {
                const response = await Extension.sendToServiceWorker('GET_ALL_SELECTOR_RULES');
                const rules = response?.rules || {};
                const count = Object.keys(rules).length;

                UI.updateBadge($.rulesCount, count);
            } catch (error) {
                console.error('Failed to load rules count:', error);
            }
        },

        async exportRules() {
            try {
                const response = await Extension.sendToServiceWorker('GET_ALL_SELECTOR_RULES');
                const rules = response?.rules || {};

                if (Object.keys(rules).length === 0) {
                    Toast.error('No rules to export');
                    return;
                }

                const exportData = {
                    version: '4.0.0',
                    exportedAt: new Date().toISOString(),
                    rules: rules
                };

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const data = JSON.stringify(exportData, null, 2);
                const filename = `lms-qa-rules-${timestamp}.json`;

                this.download(data, filename, 'json');
                Toast.success(`Exported ${Object.keys(rules).length} rule(s)`);
            } catch (error) {
                Toast.error('Failed to export rules: ' + error.message);
            }
        },

        async importRules() {
            $.rulesFileInput?.click();
        },

        async handleRulesFileSelect(event) {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                if (!data.rules || typeof data.rules !== 'object') {
                    Toast.error('Invalid rules file format');
                    return;
                }

                const validRules = {};
                let validCount = 0;

                for (const [pattern, rule] of Object.entries(data.rules)) {
                    if (this.isValidRule(rule)) {
                        validRules[pattern] = rule;
                        validCount++;
                    }
                }

                if (validCount === 0) {
                    Toast.error('No valid rules found in file');
                    return;
                }

                await Extension.sendToServiceWorker('IMPORT_SELECTOR_RULES', { rules: validRules });
                await this.loadRulesCount();
                await this.checkForSavedRule();

                Toast.success(`Imported ${validCount} rule(s)`);

                // After importing rules, re-check activation
                const gateResult = await ActivationGate.check();
                if (gateResult.active) {
                    ActivationGate.activate();
                }
            } catch (error) {
                Toast.error('Failed to import: ' + error.message);
            }

            event.target.value = '';
        },

        isValidRule(rule) {
            return rule &&
                   typeof rule.questionSelector === 'string' &&
                   typeof rule.answerSelector === 'string';
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

            // Update operation details if in operating mode
            if (State.workflow === WORKFLOW.OPERATING && $.operationDetails) {
                const steps = [
                    { text: 'Discovering APIs', status: payload.step >= 1 ? 'done' : 'pending' },
                    { text: 'Detecting framework', status: payload.step >= 2 ? 'done' : payload.step === 1 ? 'active' : 'pending' },
                    { text: 'Extracting Q&A', status: payload.step >= 3 ? 'done' : payload.step === 2 ? 'active' : 'pending' }
                ];
                UI.setOperationStatus(payload.message, steps);
            }
        },

        [MSG.SCAN_COMPLETE]: (payload) => {
            UI.setStatus(STATUS.SUCCESS);
            UI.hideProgress();
            $.btnScan.disabled = false;

            if (payload.results) {
                Renderer.renderAll(payload.results);

                const tool = payload.results.tool;
                const questions = payload.results.qa?.questions?.length || 0;
                const correct = payload.results.qa?.items?.filter(i => i.correct)?.length || 0;

                let message = 'Scan complete';
                if (tool && tool !== 'generic') {
                    const toolNames = {
                        storyline: 'Storyline',
                        rise: 'Rise 360',
                        captivate: 'Captivate',
                        lectora: 'Lectora',
                        ispring: 'iSpring'
                    };
                    message = 'Found ' + (toolNames[tool] || tool);
                }

                if (questions > 0) {
                    message += `: ${questions} question(s), ${correct} correct`;
                }

                // Update operation result
                if (State.workflow === WORKFLOW.OPERATING) {
                    UI.setOperationResult(true, message, false, false);
                }

                Toast.success(message);
            } else {
                Toast.success('Scan complete');
            }

            State.setWorkflow(WORKFLOW.RESULTS);
        },

        [MSG.SCAN_ERROR]: (payload) => {
            UI.setStatus(STATUS.ERROR);
            UI.hideProgress();
            $.btnScan.disabled = false;

            const errorMsg = payload.error || 'Scan failed';

            if (State.workflow === WORKFLOW.OPERATING) {
                UI.setOperationResult(false, errorMsg, true, true);
            }

            Toast.error(errorMsg);
            State.setWorkflow(WORKFLOW.IDLE);
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

                if (State.workflow === WORKFLOW.OPERATING) {
                    UI.setOperationResult(true, 'Course marked as complete with 100% score', false, false);
                    State.setWorkflow(WORKFLOW.RESULTS);
                }
            } else {
                const errorMsg = 'Failed: ' + (payload.results?.error || 'Unknown error');
                Toast.error(errorMsg);

                if (State.workflow === WORKFLOW.OPERATING) {
                    UI.setOperationResult(false, errorMsg, true, true);
                }
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

        [MSG.SELECTOR_INJECTION_FAILED]: (payload) => {
            Toast.error('Selector failed: ' + (payload.error || 'Unknown error'));
            State.selectorActive = false;
            Actions.resetSelectorButton();
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
                const qCount = payload.results.qa?.questions?.length || 0;
                const aCount = payload.results.qa?.items?.filter(i => i.type === 'answer').length || 0;

                const msg = `Extracted ${qCount} questions, ${aCount} answers`;

                if (State.workflow === WORKFLOW.OPERATING) {
                    UI.setOperationResult(true, msg, false, false);
                }

                Toast.success(msg);
            }

            State.setWorkflow(WORKFLOW.RESULTS);
        },

        [MSG.EXTRACTION_ERROR]: (payload) => {
            UI.setStatus(STATUS.ERROR);
            const errorMsg = payload.error || 'Extraction failed';

            if (State.workflow === WORKFLOW.OPERATING) {
                UI.setOperationResult(false, errorMsg, true, true);
            }

            Toast.error(errorMsg);
        },

        [MSG.OBJECTIVES_COMPLETE]: (payload) => {
            if (payload.success) {
                const msg = `Completed ${payload.objectivesCompleted}/${payload.objectivesFound} objectives`;
                Toast.success(msg);
            } else {
                Toast.error('Failed to complete objectives: ' + (payload.errors?.join(', ') || 'Unknown error'));
            }
        },

        [MSG.SLIDES_MARKED]: (payload) => {
            if (payload.success) {
                const msg = `Marked ${payload.slidesMarked}/${payload.slidesFound} slides as viewed (${payload.tool || 'generic'})`;
                Toast.success(msg);
            } else {
                Toast.error('Failed to mark slides: ' + (payload.errors?.join(', ') || 'Unknown error'));
            }
        },

        [MSG.FULL_COMPLETION_RESULT]: (payload) => {
            if (payload.success) {
                const objMsg = payload.objectives ? `${payload.objectives.objectivesCompleted} objectives` : '';
                const slideMsg = payload.slides ? `${payload.slides.slidesMarked} slides` : '';
                const parts = [objMsg, slideMsg].filter(Boolean).join(', ');
                Toast.success(`Full completion successful: ${parts || 'Course marked complete'}`);
            } else {
                Toast.error('Full completion failed: ' + (payload.errors?.join(', ') || 'Unknown error'));
            }
        },

        [MSG.DETECTION_COMPLETE]: (payload) => {
            if (payload.framework) {
                State.detectedFramework = payload.framework;
                State.detectedAPIs = payload.apis || [];

                UI.setFrameworkInfo(payload.framework, {
                    apiCount: payload.apis?.length || 0,
                    potentialQA: payload.potentialQA
                });

                State.setWorkflow(WORKFLOW.DETECTED);
            } else {
                State.setWorkflow(WORKFLOW.IDLE);
            }
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
        // Activation gate actions
        $.btnForceActivate?.addEventListener('click', () => {
            ActivationGate.activate();
            // Optionally start detection
            Actions.detect();
        });

        $.btnImportRulesGate?.addEventListener('click', () => Actions.importRules());

        // Framework panel actions
        $.btnExtractQa?.addEventListener('click', () => Actions.extractQA());
        $.btnCompleteCourse?.addEventListener('click', () => Actions.completeCourse());
        $.btnSkipDetection?.addEventListener('click', () => Actions.skipDetection());

        // Operation feedback actions
        $.btnRetryOperation?.addEventListener('click', () => {
            if (State.lastOperation?.type === 'extract') {
                Actions.extractQA();
            } else if (State.lastOperation?.type === 'complete') {
                Actions.completeCourse();
            } else {
                Actions.scan();
            }
        });

        $.btnTryAlternative?.addEventListener('click', () => {
            // If extraction failed, try completion; vice versa
            if (State.lastOperation?.type === 'extract') {
                Actions.completeCourse();
            } else {
                Actions.extractQA();
            }
        });

        $.btnSaveConfig?.addEventListener('click', () => Actions.saveAsQuickAction());

        // Quick actions list
        $.quickActionsList?.addEventListener('click', (e) => {
            const runBtn = e.target.closest('.btn-run-quick');
            if (runBtn) {
                Actions.runQuickAction(parseInt(runBtn.dataset.index, 10));
            }
        });

        // Main actions
        $.btnScan?.addEventListener('click', () => Actions.scan());
        $.btnClear?.addEventListener('click', () => Actions.clear());

        // SCORM controls
        $.btnTestApi?.addEventListener('click', () => Actions.testAPI());
        $.btnSetCompletion?.addEventListener('click', () => Actions.setCompletion());
        $.btnCompleteObjectives?.addEventListener('click', () => Actions.completeObjectives());
        $.btnMarkSlides?.addEventListener('click', () => Actions.markAllSlides());
        $.btnFullCompletion?.addEventListener('click', () => Actions.fullCompletion());

        // Quick copy
        $.btnCopyAllCorrect?.addEventListener('click', () => Actions.copyAllCorrect());

        // Element picker
        $.btnAutoSelect?.addEventListener('click', () => Actions.autoSelect());
        $.btnElementSelector?.addEventListener('click', () => Actions.activateSelector());

        // Saved rules
        $.btnApplyRule?.addEventListener('click', () => Actions.applyRule());
        $.btnDeleteRule?.addEventListener('click', () => Actions.deleteRule());

        // Rules management
        $.btnExportRules?.addEventListener('click', () => Actions.exportRules());
        $.btnImportRules?.addEventListener('click', () => Actions.importRules());
        $.rulesFileInput?.addEventListener('change', (e) => Actions.handleRulesFileSelect(e));

        // Export
        $.btnExportJson?.addEventListener('click', () => Actions.export('json'));
        $.btnExportCsv?.addEventListener('click', () => Actions.export('csv'));
        $.btnExportTxt?.addEventListener('click', () => Actions.export('txt'));

        // Search
        $.searchInput?.addEventListener('input', (e) => Search.filter(e.target.value));

        // Related tabs
        $.btnRefreshRelated?.addEventListener('click', () => Actions.loadRelatedTabs());
        $.relatedList?.addEventListener('click', (e) => {
            const pickBtn = e.target.closest('.btn-pick-tab');
            const scanBtn = e.target.closest('.btn-scan-tab');
            const focusBtn = e.target.closest('.btn-focus-tab');

            if (pickBtn) {
                Actions.activateSelectorOnTab(parseInt(pickBtn.dataset.tabId, 10));
            }
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

        // Check activation gate
        const gateResult = await ActivationGate.check();

        if (gateResult.active) {
            State.isActivated = true;

            // Load existing state first
            const existingState = await Extension.sendToServiceWorker('GET_TAB_STATE');
            if (existingState?.results) {
                Renderer.renderAll(existingState.results);
                State.setWorkflow(WORKFLOW.RESULTS);
            } else if (gateResult.hasRules) {
                // Has rules, go to idle mode for manual actions
                State.setWorkflow(WORKFLOW.IDLE);
            } else {
                // Start detection for LMS pages
                State.setWorkflow(WORKFLOW.IDLE);
                // Optionally auto-detect: Actions.detect();
            }

            // Load quick actions
            if (gateResult.quickActions) {
                State.quickActions = gateResult.quickActions;
                Renderer.renderQuickActions(State.quickActions);
            }
        } else {
            // Show activation gate
            UI.setGateReason(gateResult.reason);
            State.setWorkflow(WORKFLOW.GATE);
        }

        // Load related tabs
        await Actions.loadRelatedTabs();

        // Check for saved selector rules
        await Actions.checkForSavedRule();

        // Load rules count
        await Actions.loadRulesCount();

        console.log('[LMS QA Popup v4.0] Initialized');
    }

    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
