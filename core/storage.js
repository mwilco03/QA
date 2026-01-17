/**
 * LMS QA Validator - Decoupled Storage Layer
 *
 * Implements Directive #11: Decouple storage from logic
 * Background script stores data only; it never interprets it.
 * Storage logic shouldn't decide meaning.
 *
 * @fileoverview Pure storage operations without business logic
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Storage key prefixes
 * @enum {string}
 */
const StorageKey = Object.freeze({
    SESSION: 'session_',           // Session state: session_{sessionId}
    RESULT: 'result_',             // Extraction results: result_{domain}
    HISTORY: 'scan_history',       // Scan history array
    SETTINGS: 'settings',          // User settings
    RULES: 'custom_rules_',        // Custom rules: custom_rules_{domain}
    CACHE: 'cache_'                // Cached data: cache_{key}
});

/**
 * Storage configuration
 */
const StorageConfig = {
    maxHistoryItems: 50,
    maxCacheAge: 24 * 60 * 60 * 1000,  // 24 hours
    defaultArea: 'local'                 // 'local' or 'sync'
};

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a storage interface
 * Pure storage operations - no interpretation of data
 *
 * @param {string} [area='local'] - Storage area ('local' or 'sync')
 * @returns {Object} Storage interface
 */
function createStorage(area = 'local') {
    const storage = area === 'sync' ? chrome.storage.sync : chrome.storage.local;

    return {
        /**
         * Get value by key
         * @param {string} key - Storage key
         * @returns {Promise<any>}
         */
        async get(key) {
            return new Promise((resolve, reject) => {
                storage.get(key, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(result[key]);
                    }
                });
            });
        },

        /**
         * Get multiple values
         * @param {string[]} keys - Storage keys
         * @returns {Promise<Object>}
         */
        async getMultiple(keys) {
            return new Promise((resolve, reject) => {
                storage.get(keys, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(result);
                    }
                });
            });
        },

        /**
         * Get all stored data
         * @returns {Promise<Object>}
         */
        async getAll() {
            return new Promise((resolve, reject) => {
                storage.get(null, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(result);
                    }
                });
            });
        },

        /**
         * Set value by key
         * Data is stored as-is, no transformation
         *
         * @param {string} key - Storage key
         * @param {any} value - Value to store
         * @returns {Promise<void>}
         */
        async set(key, value) {
            return new Promise((resolve, reject) => {
                storage.set({ [key]: value }, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });
        },

        /**
         * Set multiple values
         * @param {Object} items - Key-value pairs
         * @returns {Promise<void>}
         */
        async setMultiple(items) {
            return new Promise((resolve, reject) => {
                storage.set(items, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });
        },

        /**
         * Remove value by key
         * @param {string} key - Storage key
         * @returns {Promise<void>}
         */
        async remove(key) {
            return new Promise((resolve, reject) => {
                storage.remove(key, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });
        },

        /**
         * Remove multiple keys
         * @param {string[]} keys - Storage keys
         * @returns {Promise<void>}
         */
        async removeMultiple(keys) {
            return new Promise((resolve, reject) => {
                storage.remove(keys, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });
        },

        /**
         * Clear all storage
         * @returns {Promise<void>}
         */
        async clear() {
            return new Promise((resolve, reject) => {
                storage.clear(() => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });
        },

        /**
         * Get storage usage
         * @returns {Promise<{bytesUsed: number, quota: number}>}
         */
        async getUsage() {
            return new Promise((resolve, reject) => {
                storage.getBytesInUse(null, (bytesUsed) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve({
                            bytesUsed,
                            quota: area === 'sync'
                                ? chrome.storage.sync.QUOTA_BYTES
                                : chrome.storage.local.QUOTA_BYTES
                        });
                    }
                });
            });
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// SPECIALIZED STORAGE OPERATIONS
// Pure operations that don't interpret data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a results storage interface
 * Stores ExtractionResult objects without modification
 */
function createResultsStorage(storage) {
    return {
        /**
         * Store extraction result
         * @param {string} domain - Domain identifier
         * @param {Object} result - ExtractionResult object
         */
        async store(domain, result) {
            const key = `${StorageKey.RESULT}${domain}`;
            await storage.set(key, {
                ...result,
                storedAt: Date.now()
            });
        },

        /**
         * Retrieve extraction result
         * @param {string} domain - Domain identifier
         * @returns {Promise<Object|null>}
         */
        async retrieve(domain) {
            const key = `${StorageKey.RESULT}${domain}`;
            return storage.get(key);
        },

        /**
         * Remove extraction result
         * @param {string} domain - Domain identifier
         */
        async remove(domain) {
            const key = `${StorageKey.RESULT}${domain}`;
            await storage.remove(key);
        },

        /**
         * List all stored domains
         * @returns {Promise<string[]>}
         */
        async listDomains() {
            const all = await storage.getAll();
            return Object.keys(all)
                .filter(key => key.startsWith(StorageKey.RESULT))
                .map(key => key.replace(StorageKey.RESULT, ''));
        }
    };
}

/**
 * Create a history storage interface
 * Manages scan history as a simple array
 */
function createHistoryStorage(storage) {
    return {
        /**
         * Add history entry
         * @param {Object} entry - History entry
         */
        async add(entry) {
            const history = await storage.get(StorageKey.HISTORY) || [];
            history.unshift({
                ...entry,
                timestamp: Date.now()
            });

            // Trim to max size
            if (history.length > StorageConfig.maxHistoryItems) {
                history.length = StorageConfig.maxHistoryItems;
            }

            await storage.set(StorageKey.HISTORY, history);
        },

        /**
         * Get history
         * @param {number} [limit] - Maximum entries to return
         * @returns {Promise<Array>}
         */
        async get(limit) {
            const history = await storage.get(StorageKey.HISTORY) || [];
            return limit ? history.slice(0, limit) : history;
        },

        /**
         * Clear history
         */
        async clear() {
            await storage.set(StorageKey.HISTORY, []);
        }
    };
}

/**
 * Create a session storage interface
 * Stores session state
 */
function createSessionStorage(storage) {
    return {
        /**
         * Store session
         * @param {Object} session - Session object
         */
        async store(session) {
            if (!session.id) throw new Error('Session must have an id');
            const key = `${StorageKey.SESSION}${session.id}`;
            await storage.set(key, session);
        },

        /**
         * Retrieve session
         * @param {string} sessionId - Session ID
         * @returns {Promise<Object|null>}
         */
        async retrieve(sessionId) {
            const key = `${StorageKey.SESSION}${sessionId}`;
            return storage.get(key);
        },

        /**
         * Remove session
         * @param {string} sessionId - Session ID
         */
        async remove(sessionId) {
            const key = `${StorageKey.SESSION}${sessionId}`;
            await storage.remove(key);
        },

        /**
         * Clean up old sessions
         * @param {number} maxAge - Max age in ms
         */
        async cleanup(maxAge = 24 * 60 * 60 * 1000) {
            const all = await storage.getAll();
            const keysToRemove = [];
            const now = Date.now();

            for (const [key, value] of Object.entries(all)) {
                if (key.startsWith(StorageKey.SESSION)) {
                    if (value.createdAt && (now - value.createdAt) > maxAge) {
                        keysToRemove.push(key);
                    }
                }
            }

            if (keysToRemove.length > 0) {
                await storage.removeMultiple(keysToRemove);
            }

            return keysToRemove.length;
        }
    };
}

/**
 * Create a cache storage interface
 */
function createCacheStorage(storage) {
    return {
        /**
         * Set cached value
         * @param {string} key - Cache key
         * @param {any} value - Value to cache
         * @param {number} [ttl] - Time to live in ms
         */
        async set(key, value, ttl = StorageConfig.maxCacheAge) {
            const cacheKey = `${StorageKey.CACHE}${key}`;
            await storage.set(cacheKey, {
                value,
                createdAt: Date.now(),
                expiresAt: Date.now() + ttl
            });
        },

        /**
         * Get cached value
         * @param {string} key - Cache key
         * @returns {Promise<any|null>}
         */
        async get(key) {
            const cacheKey = `${StorageKey.CACHE}${key}`;
            const cached = await storage.get(cacheKey);

            if (!cached) return null;

            // Check expiration
            if (cached.expiresAt && Date.now() > cached.expiresAt) {
                await storage.remove(cacheKey);
                return null;
            }

            return cached.value;
        },

        /**
         * Remove cached value
         * @param {string} key - Cache key
         */
        async remove(key) {
            const cacheKey = `${StorageKey.CACHE}${key}`;
            await storage.remove(cacheKey);
        },

        /**
         * Clean up expired cache entries
         */
        async cleanup() {
            const all = await storage.getAll();
            const keysToRemove = [];
            const now = Date.now();

            for (const [key, value] of Object.entries(all)) {
                if (key.startsWith(StorageKey.CACHE)) {
                    if (value.expiresAt && now > value.expiresAt) {
                        keysToRemove.push(key);
                    }
                }
            }

            if (keysToRemove.length > 0) {
                await storage.removeMultiple(keysToRemove);
            }

            return keysToRemove.length;
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED STORAGE API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create the unified storage API
 * Provides specialized interfaces for different data types
 *
 * @param {string} [area='local'] - Storage area
 * @returns {Object} Unified storage API
 */
function createStorageAPI(area = 'local') {
    const storage = createStorage(area);

    return {
        // Raw storage access
        raw: storage,

        // Specialized interfaces
        results: createResultsStorage(storage),
        history: createHistoryStorage(storage),
        sessions: createSessionStorage(storage),
        cache: createCacheStorage(storage),

        // Utility
        async getUsage() {
            return storage.getUsage();
        },

        async clearAll() {
            return storage.clear();
        }
    };
}

// Export for both browser and module contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        StorageKey,
        StorageConfig,
        createStorage,
        createResultsStorage,
        createHistoryStorage,
        createSessionStorage,
        createCacheStorage,
        createStorageAPI
    };
}

if (typeof window !== 'undefined') {
    window.LMSQAStorage = {
        StorageKey,
        StorageConfig,
        createStorage,
        createResultsStorage,
        createHistoryStorage,
        createSessionStorage,
        createCacheStorage,
        createStorageAPI
    };
}
