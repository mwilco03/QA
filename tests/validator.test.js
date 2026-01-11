/**
 * LMS QA Validator - Test Suite v3.0
 */

(function() {
    'use strict';

    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        tests: []
    };

    const $ = {
        runBtn: document.getElementById('run-btn'),
        totalCount: document.getElementById('total-count'),
        passedCount: document.getElementById('passed-count'),
        failedCount: document.getElementById('failed-count'),
        timeTotal: document.getElementById('time-total'),
        testResults: document.getElementById('test-results'),
        testQuizForm: document.getElementById('test-quiz-form')
    };

    // Test Framework
    function test(name, fn) {
        results.total++;
        const start = performance.now();
        
        try {
            fn();
            results.passed++;
            results.tests.push({ name, passed: true, time: performance.now() - start });
        } catch (error) {
            results.failed++;
            results.tests.push({ name, passed: false, error: error.message, time: performance.now() - start });
            console.error(`FAIL: ${name}`, error);
        }
    }

    function assertEqual(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    }

    function assertTrue(value, message = '') {
        if (!value) {
            throw new Error(`${message} Expected truthy value, got ${value}`);
        }
    }

    function assertFalse(value, message = '') {
        if (value) {
            throw new Error(`${message} Expected falsy value, got ${value}`);
        }
    }

    function assertExists(value, message = '') {
        if (value === undefined || value === null) {
            throw new Error(`${message} Expected value to exist`);
        }
    }

    function assertType(value, type, message = '') {
        if (typeof value !== type) {
            throw new Error(`${message} Expected type ${type}, got ${typeof value}`);
        }
    }

    function assertArray(value, message = '') {
        if (!Array.isArray(value)) {
            throw new Error(`${message} Expected array, got ${typeof value}`);
        }
    }

    // Render results
    function renderResults() {
        const totalTime = results.tests.reduce((sum, t) => sum + t.time, 0);
        
        $.totalCount.textContent = results.total;
        $.passedCount.textContent = results.passed;
        $.failedCount.textContent = results.failed;
        $.timeTotal.textContent = `${totalTime.toFixed(0)}ms`;

        // Group tests by section
        const sections = {};
        results.tests.forEach(t => {
            const parts = t.name.split(':');
            const section = parts.length > 1 ? parts[0].trim() : 'General';
            const name = parts.length > 1 ? parts.slice(1).join(':').trim() : t.name;
            
            if (!sections[section]) sections[section] = [];
            sections[section].push({ ...t, displayName: name });
        });

        let html = '';
        for (const [section, tests] of Object.entries(sections)) {
            html += `<div class="test-section"><h2>${section}</h2>`;
            tests.forEach(t => {
                const status = t.passed ? 'pass' : 'fail';
                const icon = t.passed ? '✓' : '✗';
                html += `
                    <div class="test">
                        <div class="test-status ${status}">${icon}</div>
                        <div class="test-name">${t.displayName}${t.error ? ` - ${t.error}` : ''}</div>
                        <div class="test-time">${t.time.toFixed(1)}ms</div>
                    </div>
                `;
            });
            html += '</div>';
        }

        $.testResults.innerHTML = html;
    }

    // Test Suites
    function runTests() {
        results.total = 0;
        results.passed = 0;
        results.failed = 0;
        results.tests = [];

        // Show test form for DOM tests
        $.testQuizForm.classList.add('visible');

        // Wait for validator to initialize
        setTimeout(() => {
            runPublicAPITests();
            runStateTests();
            runDOMExtractionTests();
            runUtilityTests();
            
            renderResults();
            $.runBtn.disabled = false;
        }, 100);
    }

    function runPublicAPITests() {
        test('Public API: LMS_QA exists', () => {
            assertExists(window.LMS_QA);
        });

        test('Public API: version is defined', () => {
            assertExists(window.LMS_QA.version);
            assertType(window.LMS_QA.version, 'string');
        });

        test('Public API: getState returns object', () => {
            const state = window.LMS_QA.getState();
            assertExists(state);
            assertType(state, 'object');
        });

        test('Public API: getAPIs returns array', () => {
            const apis = window.LMS_QA.getAPIs();
            assertArray(apis);
        });

        test('Public API: getQA returns array', () => {
            const qa = window.LMS_QA.getQA();
            assertArray(qa);
        });

        test('Public API: getLogs returns array', () => {
            const logs = window.LMS_QA.getLogs();
            assertArray(logs);
        });

        test('Public API: scan is a function', () => {
            assertType(window.LMS_QA.scan, 'function');
        });

        test('Public API: autoSelect is a function', () => {
            assertType(window.LMS_QA.autoSelect, 'function');
        });

        test('Public API: export is a function', () => {
            assertType(window.LMS_QA.export, 'function');
        });

        test('Public API: getDOMQuizzes is a function', () => {
            assertType(window.LMS_QA.getDOMQuizzes, 'function');
        });
    }

    function runStateTests() {
        test('State: initial state has required keys', () => {
            const state = window.LMS_QA.getState();
            assertExists(state.apis, 'apis');
            assertExists(state.resources, 'resources');
            assertExists(state.qa, 'qa');
            assertExists(state.logs, 'logs');
        });

        test('State: apis is an array', () => {
            const state = window.LMS_QA.getState();
            assertArray(state.apis);
        });

        test('State: scanning is boolean', () => {
            const state = window.LMS_QA.getState();
            assertType(state.scanning, 'boolean');
        });
    }

    function runDOMExtractionTests() {
        test('DOM Extraction: getDOMQuizzes returns array', () => {
            const quizzes = window.LMS_QA.getDOMQuizzes();
            assertArray(quizzes);
        });

        test('DOM Extraction: finds select quiz', () => {
            const quizzes = window.LMS_QA.getDOMQuizzes();
            const selectQuiz = quizzes.find(q => q.type === 'select');
            assertExists(selectQuiz, 'Should find select quiz');
        });

        test('DOM Extraction: finds checkbox quiz', () => {
            const quizzes = window.LMS_QA.getDOMQuizzes();
            const checkboxQuiz = quizzes.find(q => q.type === 'checkbox');
            assertExists(checkboxQuiz, 'Should find checkbox quiz');
        });

        test('DOM Extraction: finds radio quiz', () => {
            const quizzes = window.LMS_QA.getDOMQuizzes();
            const radioQuiz = quizzes.find(q => q.type === 'radio');
            assertExists(radioQuiz, 'Should find radio quiz');
        });

        test('DOM Extraction: select quiz has correct answer', () => {
            const quizzes = window.LMS_QA.getDOMQuizzes();
            const selectQuiz = quizzes.find(q => q.type === 'select');
            if (selectQuiz) {
                const correctAnswer = selectQuiz.answers.find(a => a.correct);
                assertExists(correctAnswer, 'Should have correct answer');
                assertEqual(correctAnswer.text, 'Paris', 'Correct answer should be Paris');
            }
        });

        test('DOM Extraction: autoSelect returns number', () => {
            const count = window.LMS_QA.autoSelect();
            assertType(count, 'number');
        });

        test('DOM Extraction: autoSelect selects answers', () => {
            // Reset form first
            document.getElementById('q1').selectedIndex = 0;
            document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('input[type="radio"]').forEach(r => r.checked = false);

            const count = window.LMS_QA.autoSelect();
            assertTrue(count > 0, 'Should select at least one answer');
        });

        test('DOM Extraction: select is correctly set after autoSelect', () => {
            const select = document.getElementById('q1');
            const selectedOption = select.options[select.selectedIndex];
            assertEqual(selectedOption.value, 'true', 'Select should have correct value selected');
        });
    }

    function runUtilityTests() {
        test('Utility: getReport returns valid report', () => {
            const report = window.LMS_QA.getReport();
            assertExists(report);
            assertExists(report.version);
            assertExists(report.url);
            assertExists(report.qa);
            assertType(report.qa.total, 'number');
        });

        test('Utility: report has correct structure', () => {
            const report = window.LMS_QA.getReport();
            assertExists(report.apis);
            assertExists(report.qa.items);
            assertExists(report.logs);
        });
    }

    // Event handlers
    $.runBtn.addEventListener('click', () => {
        $.runBtn.disabled = true;
        runTests();
    });

    // Auto-run on load
    window.addEventListener('load', () => {
        setTimeout(runTests, 500);
    });
})();
