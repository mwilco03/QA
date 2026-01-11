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
    // HTML TEMPLATES
    // Centralized template functions for consistent rendering
    // ═══════════════════════════════════════════════════════════════════════════

    const Templates = {
        emptyState(message) {
            const div = document.createElement('div');
            div.className = 'empty-state';
            div.textContent = message;
            return div;
        },

        qaGroup(question, answers, qNum, questionType) {
            const group = document.createElement('div');
            group.className = 'qa-group';
            if (questionType) group.dataset.type = questionType;

            // Question
            const qDiv = document.createElement('div');
            qDiv.className = question ? 'qa-question' : 'qa-question orphan';
            qDiv.dataset.text = question?.text || '';

            const numSpan = document.createElement('span');
            numSpan.className = 'qa-num';
            numSpan.textContent = `Q${qNum}`;
            qDiv.appendChild(numSpan);

            const textSpan = document.createElement('span');
            textSpan.className = 'qa-text';
            textSpan.textContent = question?.text || '(Question not captured)';
            qDiv.appendChild(textSpan);

            if (questionType) {
                const typeSpan = document.createElement('span');
                typeSpan.className = 'qa-type';
                typeSpan.textContent = questionType;
                qDiv.appendChild(typeSpan);
            }

            group.appendChild(qDiv);

            // Answers container
            const answersDiv = document.createElement('div');
            answersDiv.className = 'qa-answers';
            answers.forEach(ans => answersDiv.appendChild(ans));
            group.appendChild(answersDiv);

            return group;
        },

        qaAnswer(text, isCorrect, markerContent = null) {
            const div = document.createElement('div');
            div.className = 'qa-answer' + (isCorrect ? ' correct' : '');
            div.dataset.text = text;

            const marker = document.createElement('span');
            marker.className = 'qa-marker';
            marker.textContent = markerContent || (isCorrect ? '✓' : '○');
            div.appendChild(marker);

            const textSpan = document.createElement('span');
            textSpan.className = 'qa-text';
            textSpan.textContent = text;
            div.appendChild(textSpan);

            return div;
        },

        sequenceAnswer(text, position) {
            const div = document.createElement('div');
            div.className = 'qa-answer sequence';
            div.dataset.text = text;

            const marker = document.createElement('span');
            marker.className = 'qa-marker seq';
            marker.textContent = String(position);
            div.appendChild(marker);

            const textSpan = document.createElement('span');
            textSpan.className = 'qa-text';
            textSpan.textContent = text;
            div.appendChild(textSpan);

            return div;
        },

        matchAnswer(sourceText, targetText) {
            const div = document.createElement('div');
            div.className = 'qa-answer match';
            div.dataset.text = sourceText;

            const source = document.createElement('span');
            source.className = 'match-source';
            source.textContent = sourceText;
            div.appendChild(source);

            const arrow = document.createElement('span');
            arrow.className = 'match-arrow';
            arrow.textContent = '→';
            div.appendChild(arrow);

            const target = document.createElement('span');
            target.className = 'match-target';
            target.textContent = targetText || '?';
            div.appendChild(target);

            return div;
        },

        correctItem(text, index) {
            const div = document.createElement('div');
            div.className = 'correct-item';
            div.dataset.text = text;

            const num = document.createElement('span');
            num.className = 'correct-num';
            num.textContent = `${index + 1}.`;
            div.appendChild(num);

            const textSpan = document.createElement('span');
            textSpan.className = 'correct-text';
            textSpan.textContent = text;
            div.appendChild(textSpan);

            return div;
        },

        apiItem(api, index) {
            const div = document.createElement('div');
            div.className = 'api-item';
            div.dataset.index = index;

            const header = document.createElement('div');
            header.className = 'api-header';

            const typeSpan = document.createElement('span');
            typeSpan.className = 'api-type';
            typeSpan.textContent = api.type;

            const statusSpan = document.createElement('span');
            statusSpan.className = 'api-status' + (api.functional ? ' functional' : '');
            statusSpan.textContent = api.functional ? 'Active' : 'Found';

            header.appendChild(typeSpan);
            header.appendChild(statusSpan);
            div.appendChild(header);

            const location = document.createElement('div');
            location.className = 'api-location';
            location.textContent = api.location;
            div.appendChild(location);

            if (api.methods && api.methods.length > 0) {
                const methods = document.createElement('div');
                methods.className = 'api-methods';
                methods.textContent = api.methods.join(', ');
                div.appendChild(methods);
            }

            return div;
        },

        logItem(log) {
            const div = document.createElement('div');
            div.className = 'log-item ' + (log.level?.toLowerCase() || 'info');

            const time = document.createElement('span');
            time.className = 'log-time';
            time.textContent = log.timestamp?.split('T')[1]?.split('.')[0] || '';
            div.appendChild(time);

            const level = document.createElement('span');
            level.className = 'log-level';
            level.textContent = log.level || 'INFO';
            div.appendChild(level);

            const msg = document.createElement('span');
            msg.className = 'log-msg';
            msg.textContent = log.message;
            div.appendChild(msg);

            return div;
        },

        scanSummary(questionCount, answerCount, correctCount, typeBreakdown) {
            const div = document.createElement('div');
            div.id = 'scan-summary';
            div.className = 'scan-summary';

            const row = document.createElement('div');
            row.className = 'summary-row';

            const qStat = this.summaryStatElement(questionCount, 'Questions');
            const aStat = this.summaryStatElement(answerCount, 'Answers');
            const cStat = this.summaryStatElement(correctCount, 'Correct', 'correct');

            row.appendChild(qStat);
            row.appendChild(aStat);
            row.appendChild(cStat);
            div.appendChild(row);

            if (typeBreakdown) {
                const types = document.createElement('div');
                types.className = 'summary-types';
                types.textContent = typeBreakdown;
                div.appendChild(types);
            }

            return div;
        },

        summaryStatElement(value, label, extraClass = '') {
            const span = document.createElement('span');
            span.className = 'summary-stat' + (extraClass ? ' ' + extraClass : '');

            const strong = document.createElement('strong');
            strong.textContent = value;
            span.appendChild(strong);
            span.appendChild(document.createTextNode(' ' + label));

            return span;
        }
    };

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
            'btn-test-api', 'btn-set-completion', 'btn-copy-all-correct',
            'quick-actions', 'btn-auto-select', 'btn-element-selector',
            'saved-rules', 'rule-info', 'btn-apply-rule', 'btn-delete-rule',
            'rules-management', 'rules-count', 'btn-export-rules', 'btn-import-rules', 'rules-file-input',
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

            // Show detected tool if available
            this.renderToolBadge(results.tool);

            // Show scan summary
            this.renderSummary(results);

            // Render grouped Q&A (questions with their answers nested)
            this.renderQAGrouped(results.qa?.items || [], results.qa?.questions || []);

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

        renderToolBadge(tool) {
            // Add tool detection badge to header area
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

            // Count by question type
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

            // If we have structured questions, use grouped rendering
            if (questions && questions.length > 0) {
                this.renderGroupedQuestions(questions);
                return;
            }

            // Fallback: group items by inferring structure
            if (items.length === 0) {
                $.qaList.innerHTML = '<div class="empty-state">No Q&A found. Try scanning the page.</div>';
                return;
            }

            // Group items: each question followed by its answers
            const groups = [];
            let currentGroup = null;

            items.forEach(item => {
                if (item.type === 'question') {
                    if (currentGroup) groups.push(currentGroup);
                    currentGroup = { question: item, answers: [] };
                } else if (item.type === 'answer' && currentGroup) {
                    currentGroup.answers.push(item);
                } else if (item.type === 'answer') {
                    // Orphan answer - create implicit group
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
                         ${group.question.questionType ? `<span class="qa-type">${group.question.questionType}</span>` : ''}
                       </div>`
                    : `<div class="qa-question orphan"><span class="qa-num">Q${qNum}</span><span class="qa-text">(Question not captured)</span></div>`;

                const answersHtml = group.answers.map(ans => {
                    const correctClass = ans.correct ? 'correct' : '';
                    const marker = ans.correct ? '✓' : '○';
                    const seqPos = ans.isSequence && ans.correctPosition !== null
                        ? `<span class="seq-pos">#${ans.correctPosition + 1}</span>`
                        : '';
                    return `
                        <div class="qa-answer ${correctClass}" data-text="${escapeHtml(ans.text)}">
                            <span class="qa-marker">${marker}</span>
                            <span class="qa-text">${escapeHtml(ans.text)}</span>
                            ${seqPos}
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

                // Regular answers
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

                // Sequence items
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

                // Match pairs
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
            // Keep for backward compatibility / search filtering
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

            // Update copy all button state
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

            $.relatedList.innerHTML = tabs.map(tab => {
                const domainInfo = tab.domain ? ` (${tab.domain})` : '';
                const tooltip = tab.relationship === 'cross-domain'
                    ? `Cross-domain: ${tab.domain}`
                    : tab.relationship;
                return `
                <div class="related-tab" data-tab-id="${tab.id}">
                    <span class="related-icon" title="${tooltip}">${icons[tab.relationship] || '?'}</span>
                    <span class="related-title" title="${escapeHtml(tab.title)}${domainInfo}">${truncate(tab.title, 30)}</span>
                    <div class="related-actions">
                        <button class="btn-sm btn-pick-tab" data-tab-id="${tab.id}" title="Pick Q&A Elements">Pick</button>
                        <button class="btn-sm btn-scan-tab" data-tab-id="${tab.id}" title="Pattern Scan">Scan</button>
                        <button class="btn-sm btn-focus-tab" data-tab-id="${tab.id}" title="Focus Window">Go</button>
                    </div>
                </div>`;
            }).join('');
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

        async copyAllCorrect() {
            const items = State.results?.qa?.items?.filter(i => i.correct) || [];
            if (items.length === 0) {
                Toast.info('No correct answers to copy');
                return;
            }

            // Format all correct answers as numbered list
            const text = items.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n');
            const success = await copyToClipboard(text);

            if (success) {
                // Visual feedback on button
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

        /**
         * Convert results to structured JSON for test automation pipelines
         * Schema designed for easy parsing and validation
         */
        toAutomationJSON(results) {
            const questions = results.qa?.questions || [];
            const items = results.qa?.items || [];

            // Group answers under their questions
            const structuredQuestions = questions.map((q, idx) => {
                // Find answers that belong to this question
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
                    correctAnswerTexts: correctAnswers.map(a => a.text),
                    metadata: {
                        source: q.source || 'unknown',
                        confidence: q.confidence || 0
                    }
                };
            });

            // Build structured export
            const exportData = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                schema: 'lms-qa-validator-v1',
                source: {
                    url: results.url || State.tabUrl,
                    tool: results.tool || 'unknown',
                    extractedAt: results.timestamp || new Date().toISOString()
                },
                summary: {
                    totalQuestions: questions.length,
                    totalAnswers: items.filter(i => i.type === 'answer').length,
                    correctAnswers: items.filter(i => i.correct).length,
                    questionTypes: this.countQuestionTypes(questions)
                },
                questions: structuredQuestions,
                apis: (results.apis || []).map(api => ({
                    type: api.type,
                    standard: api.standard || 'unknown',
                    functional: !!api.functional,
                    location: api.location
                })),
                // Flat list for simple iteration
                answerKey: items
                    .filter(i => i.correct)
                    .map((item, idx) => ({
                        position: idx + 1,
                        text: item.text
                    }))
            };

            return JSON.stringify(exportData, null, 2);
        },

        /**
         * Count question types for summary
         */
        countQuestionTypes(questions) {
            const counts = {};
            questions.forEach(q => {
                const type = q.questionType || 'choice';
                counts[type] = (counts[type] || 0) + 1;
            });
            return counts;
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
                'Questions: ' + (results.qa?.questions?.length || 0),
                'Correct Answers: ' + (results.qa?.correct || 0),
                '',
                '-'.repeat(60),
                'CORRECT ANSWERS',
                '-'.repeat(60)
            ];

            const correct = (results.qa?.items || []).filter(i => i.correct);
            correct.forEach((item, idx) => {
                lines.push((idx + 1) + '. ' + item.text);
            });

            // Add question breakdown
            const questions = results.qa?.questions || [];
            if (questions.length > 0) {
                lines.push('');
                lines.push('-'.repeat(60));
                lines.push('FULL Q&A BREAKDOWN');
                lines.push('-'.repeat(60));

                questions.forEach((q, idx) => {
                    lines.push('');
                    lines.push('Q' + (idx + 1) + ': ' + q.text);

                    // Find answers for this question
                    const items = results.qa?.items || [];
                    const qIndex = items.findIndex(item => item.type === 'question' && item.text === q.text);
                    for (let i = qIndex + 1; i < items.length; i++) {
                        if (items[i].type === 'answer') {
                            const marker = items[i].correct ? '[CORRECT] ' : '          ';
                            lines.push('  ' + marker + items[i].text);
                        } else if (items[i].type === 'question') {
                            break;
                        }
                    }
                });
            }

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
                // Close popup so user can interact with the other window
                window.close();
            } else {
                Toast.error('Failed to activate selector: ' + (response?.error || 'Unknown'));
            }
        },

        async applyRuleOnTab(tabId) {
            if (!State.currentRule) {
                Toast.error('No rule to apply');
                return;
            }

            const response = await Extension.sendToServiceWorker('APPLY_RULE_TAB', {
                targetTabId: tabId,
                rule: State.currentRule
            });

            if (response?.success) {
                Toast.success('Rule applied to related window');
            } else {
                Toast.error('Failed to apply rule: ' + (response?.error || 'Unknown'));
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
                    version: '3.2.0',
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

                // Validate structure
                if (!data.rules || typeof data.rules !== 'object') {
                    Toast.error('Invalid rules file format');
                    return;
                }

                // Validate each rule
                const validRules = {};
                let validCount = 0;
                let skippedCount = 0;

                for (const [pattern, rule] of Object.entries(data.rules)) {
                    if (this.isValidRule(rule)) {
                        validRules[pattern] = rule;
                        validCount++;
                    } else {
                        skippedCount++;
                    }
                }

                if (validCount === 0) {
                    Toast.error('No valid rules found in file');
                    return;
                }

                // Import the rules
                await Extension.sendToServiceWorker('IMPORT_SELECTOR_RULES', { rules: validRules });
                await this.loadRulesCount();
                await this.checkForSavedRule();

                if (skippedCount > 0) {
                    Toast.success(`Imported ${validCount} rule(s), skipped ${skippedCount} invalid`);
                } else {
                    Toast.success(`Imported ${validCount} rule(s)`);
                }
            } catch (error) {
                Toast.error('Failed to import: ' + error.message);
            }

            // Clear the file input for future imports
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
                const customFn = payload.results?.customFunction;
                if (customFn) {
                    Toast.success(`Found: ${customFn}() is available`);
                } else {
                    Toast.success('API test passed');
                }
            } else {
                Toast.error('API test failed: ' + (payload.results?.error || ''));
            }
        },

        [MSG.SET_COMPLETION_RESULT]: (payload) => {
            if (payload.results?.success) {
                const customFn = payload.results?.customFunction;
                if (customFn) {
                    Toast.success(`${customFn}() executed successfully`);
                } else {
                    Toast.success('Completion set successfully');
                }
            } else {
                Toast.error('Failed: ' + (payload.results?.error || 'Unknown error'));
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
                const apiCount = payload.results.apis?.length || 0;

                let msg = `Extracted ${qCount} questions, ${aCount} answers`;
                if (apiCount > 0) {
                    msg += `, ${apiCount} API(s)`;
                }
                Toast.success(msg);
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

        // Quick copy
        $.btnCopyAllCorrect?.addEventListener('click', () => Actions.copyAllCorrect());

        // Quick actions
        $.btnAutoSelect?.addEventListener('click', () => Actions.autoSelect());
        $.btnElementSelector?.addEventListener('click', () => Actions.activateSelector());

        // Saved rules
        $.btnApplyRule?.addEventListener('click', () => Actions.applyRule());
        $.btnDeleteRule?.addEventListener('click', () => Actions.deleteRule());

        // Rules management (export/import)
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

        // Load existing state
        const existingState = await Extension.sendToServiceWorker('GET_TAB_STATE');
        if (existingState?.results) {
            Renderer.renderAll(existingState.results);
        }

        // Load related tabs
        await Actions.loadRelatedTabs();

        // Check for saved selector rules
        await Actions.checkForSavedRule();

        // Load rules count
        await Actions.loadRulesCount();

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
