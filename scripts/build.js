#!/usr/bin/env node
/**
 * Build minified pasteable scripts
 *
 * Usage:
 *   npm run build          # Build all scripts
 *   node scripts/build.js  # Same
 *
 * Output:
 *   dist/*.min.js          # Minified scripts (pasteable, no comments)
 *
 * Requirements:
 *   npm install terser
 */

const fs = require('fs');
const path = require('path');

let terser;
try {
    terser = require('terser');
} catch (e) {
    console.error('Missing terser. Install with: npm install terser');
    process.exit(1);
}

const SCRIPTS = [
    'lms-extractor-complete.js',
    'storyline-console-extractor.js',
    'storyline-data-extractor.js',
    'tla-completion-helper.js',
    'unified-qa-extractor.js',
];

const ROOT = path.resolve(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'lib');
const DIST_DIR = path.join(ROOT, 'dist');

// Terser options for maximum minification while keeping it pasteable
const TERSER_OPTIONS = {
    compress: {
        dead_code: true,
        drop_console: false,  // Keep console.log for debugging
        drop_debugger: true,
        evaluate: true,
        unused: true,
        passes: 2,
    },
    mangle: {
        toplevel: false,      // Don't mangle top-level names (keeps API intact)
        reserved: [           // Preserve these names for usability
            'LMSExtractor',
            'TLAHelper',
            'UnifiedQAExtractor',
            'StorylineDataExtractor',
            'StorylineExtractor',
            'exportQA',
            'allQA',
            'courseData',
            'extractorStats',
            'extractorConfig',
        ],
    },
    format: {
        comments: false,      // Remove ALL comments
        beautify: false,      // Single line output
        semicolons: true,
    },
    sourceMap: false,
};

async function minifyScript(filename) {
    const inputPath = path.join(LIB_DIR, filename);
    const outputFilename = filename.replace('.js', '.min.js');
    const outputPath = path.join(DIST_DIR, outputFilename);

    if (!fs.existsSync(inputPath)) {
        console.error(`  SKIP: ${filename} not found`);
        return null;
    }

    const source = fs.readFileSync(inputPath, 'utf8');
    const originalSize = source.length;

    try {
        const result = await terser.minify(source, TERSER_OPTIONS);

        if (result.error) {
            console.error(`  ERROR: ${filename} - ${result.error}`);
            return null;
        }

        fs.writeFileSync(outputPath, result.code);
        const minifiedSize = result.code.length;
        const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);

        return {
            input: filename,
            output: outputFilename,
            originalSize,
            minifiedSize,
            reduction,
        };
    } catch (err) {
        console.error(`  ERROR: ${filename} - ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('Building minified pasteable scripts...\n');

    // Create dist directory
    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    const results = [];
    for (const script of SCRIPTS) {
        const result = await minifyScript(script);
        if (result) {
            results.push(result);
            console.log(`  ${result.input}`);
            console.log(`    -> ${result.output} (${result.reduction}% smaller)`);
            console.log(`    ${result.originalSize.toLocaleString()} -> ${result.minifiedSize.toLocaleString()} bytes\n`);
        }
    }

    // Summary
    if (results.length > 0) {
        const totalOriginal = results.reduce((sum, r) => sum + r.originalSize, 0);
        const totalMinified = results.reduce((sum, r) => sum + r.minifiedSize, 0);
        const totalReduction = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);

        console.log('─'.repeat(50));
        console.log(`Total: ${totalOriginal.toLocaleString()} -> ${totalMinified.toLocaleString()} bytes (${totalReduction}% reduction)`);
        console.log(`Output: ${DIST_DIR}/`);
        console.log('\nMinified scripts are ready for pasting!');
    }
}

main().catch(console.error);
