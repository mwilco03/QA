/**
 * Logger Module
 *
 * Centralized logging with level filtering and state integration.
 */

import { CONFIG } from './constants.js';
import { StateManager } from './state.js';

const LOG_LEVEL = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLevel = LOG_LEVEL.INFO;

function formatEntry(level, message, data) {
    return {
        timestamp: new Date().toISOString(),
        level,
        message,
        data: data ? JSON.parse(JSON.stringify(data)) : undefined
    };
}

function log(level, levelName, message, data) {
    if (level < currentLevel) return;

    const entry = formatEntry(levelName, message, data);
    StateManager.append('logs', entry);

    const logs = StateManager.get('logs');
    if (logs.length > CONFIG.MAX_LOGS) {
        StateManager.set('logs', logs.slice(-CONFIG.MAX_LOGS));
    }

    const consoleMethod = levelName === 'ERROR' ? 'error' :
                          levelName === 'WARN' ? 'warn' : 'log';
    if (data) {
        console[consoleMethod](`[LMS QA] ${message}`, data);
    } else {
        console[consoleMethod](`[LMS QA] ${message}`);
    }

    return entry;
}

export const Logger = {
    debug: (msg, data) => log(LOG_LEVEL.DEBUG, 'DEBUG', msg, data),
    info: (msg, data) => log(LOG_LEVEL.INFO, 'INFO', msg, data),
    warn: (msg, data) => log(LOG_LEVEL.WARN, 'WARN', msg, data),
    error: (msg, data) => log(LOG_LEVEL.ERROR, 'ERROR', msg, data),

    setLevel(level) {
        currentLevel = LOG_LEVEL[level] ?? LOG_LEVEL.INFO;
    },

    getLogs() {
        return StateManager.get('logs');
    },

    time(label) {
        const start = performance.now();
        return () => {
            const duration = performance.now() - start;
            this.debug(`${label}: ${duration.toFixed(2)}ms`);
            return duration;
        };
    }
};
