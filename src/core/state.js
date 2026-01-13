/**
 * State Management Module
 *
 * Centralized state with event-based change notification.
 * Single source of truth for runtime state.
 */

const state = {
    apis: [],
    resources: [],
    qa: [],
    logs: [],
    warnings: [],
    scanning: false,
    lastScan: null
};

const listeners = new Map();

function emit(event, data) {
    const handlers = listeners.get(event) || [];
    handlers.forEach(fn => {
        try {
            fn(data);
        } catch (e) {
            console.error(`[LMS QA] Event handler error for ${event}:`, e);
        }
    });
}

export const StateManager = {
    get(key) {
        return key ? state[key] : { ...state };
    },

    set(key, value) {
        const oldValue = state[key];
        state[key] = value;
        emit('change', { key, value, oldValue });
        emit(`change:${key}`, { value, oldValue });
    },

    append(key, item) {
        if (Array.isArray(state[key])) {
            state[key].push(item);
            emit(`append:${key}`, item);
        }
    },

    reset() {
        state.apis = [];
        state.resources = [];
        state.qa = [];
        state.logs = [];
        state.warnings = [];
        state.scanning = false;
        emit('reset');
    },

    on(event, handler) {
        if (!listeners.has(event)) {
            listeners.set(event, []);
        }
        listeners.get(event).push(handler);
        return () => this.off(event, handler);
    },

    off(event, handler) {
        const handlers = listeners.get(event);
        if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx > -1) handlers.splice(idx, 1);
        }
    }
};
