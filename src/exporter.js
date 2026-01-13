/**
 * Exporter Module
 *
 * Exports extraction results in various formats (JSON, CSV, TXT).
 */

import { VERSION } from './core/constants.js';
import { StateManager } from './core/state.js';
import { Logger } from './core/logger.js';

const Exporter = {
    export(format = 'json') {
        const report = Reporter.generate();

        let data, mimeType, filename;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        switch (format) {
            case 'csv':
                data = this.toCSV(report);
                mimeType = 'text/csv';
                filename = `lms-qa-${timestamp}.csv`;
                break;

            case 'txt':
                data = this.toTXT(report);
                mimeType = 'text/plain';
                filename = `lms-qa-${timestamp}.txt`;
                break;

            default:
                data = JSON.stringify(report, null, 2);
                mimeType = 'application/json';
                filename = `lms-qa-${timestamp}.json`;
        }

        Messenger.send('EXPORT_DATA', { format, data, filename, mimeType });
    },

    toCSV(report) {
        const rows = [['Type', 'Text', 'Correct', 'Source', 'Confidence']];
        
        report.qa.items.forEach(item => {
            rows.push([
                item.type,
                `"${(item.text || '').replace(/"/g, '""')}"`,
                item.correct ? 'Yes' : '',
                item.source,
                item.confidence
            ]);
        });

        return rows.map(row => row.join(',')).join('\n');
    },

    toTXT(report) {
        const lines = [
            '='.repeat(60),
            'LMS QA VALIDATOR - ANSWER KEY',
            '='.repeat(60),
            `Exported: ${report.timestamp}`,
            `URL: ${report.url}`,
            `Total Items: ${report.qa.total}`,
            `Questions: ${report.qa.questions}`,
            `Correct Answers: ${report.qa.correct}`,
            '',
            '-'.repeat(60),
            'ALL QUESTIONS & ANSWERS',
            '-'.repeat(60),
            ''
        ];

        let questionNum = 0;
        report.qa.items.forEach(item => {
            if (item.type === ITEM_TYPE.QUESTION) {
                questionNum++;
                lines.push(`Q${questionNum}: ${item.text}`);
            } else {
                const marker = item.correct ? '  * CORRECT:' : '  -';
                lines.push(`${marker} ${item.text}`);
            }
        });

        lines.push('');
        lines.push('-'.repeat(60));
        lines.push('CORRECT ANSWERS ONLY');
        lines.push('-'.repeat(60));
        lines.push('');

        const correct = report.qa.items.filter(i => i.correct);
        correct.forEach((item, idx) => {
            lines.push(`${idx + 1}. ${item.text}`);
        });

        return lines.join('\n');
    }
};


export { Exporter };
