/*
 * STORYLINE QUIZ EXTRACTOR v1.0
 * Works on Articulate Storyline courses
 * 
 * Usage:
 * 1. Open course in browser
 * 2. Open DevTools Console (F12)
 * 3. Paste and run this entire script
 */

(async function StorylineExtractor() {
    console.log('=== STORYLINE QUIZ EXTRACTOR ===\n');
    
    // STEP 1: Find base URL automatically
    let scripts = performance.getEntriesByType('resource').map(r => r.name);
    let courseScript = scripts.find(s => s.includes('/html5/') || s.includes('/story_content/'));
    let baseUrl = courseScript?.match(/(.*?)\/html5\//)?.[1] || 
                  courseScript?.match(/(.*?)\/story_content\//)?.[1];
    
    if (!baseUrl) {
        // Try from DOM
        document.querySelectorAll('script[src]').forEach(s => {
            if (s.src.includes('/html5/')) baseUrl = s.src.match(/(.*?)\/html5\//)?.[1];
        });
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                iframe.contentDocument.querySelectorAll('script[src]').forEach(s => {
                    if (s.src.includes('/html5/')) baseUrl = s.src.match(/(.*?)\/html5\//)?.[1];
                });
            } catch(e) {}
        });
    }
    
    if (!baseUrl) {
        console.log('✗ Could not find course URL. Please set manually:');
        console.log('  window.baseUrl = "YOUR_COURSE_URL";');
        console.log('  Then run script again.');
        return;
    }
    
    console.log('Base URL:', baseUrl);
    
    // STEP 2: Fetch data.js to get course structure
    console.log('\nFetching course data...');
    
    let dataResp = await fetch(baseUrl + '/html5/data/js/data.js');
    let dataText = await dataResp.text();
    
    // Parse data.js
    let dataMatch = dataText.match(/globalProvideData\s*\(\s*'data'\s*,\s*'(.+)'\s*\)/);
    if (!dataMatch) {
        console.log('✗ Could not parse data.js');
        return;
    }
    
    let dataJson = dataMatch[1]
        .replace(/\\'/g, "'")
        .replace(/\\\\"/g, '\\"')
        .replace(/\\\\n/g, '\\n')
        .replace(/\\\\t/g, '\\t')
        .replace(/\\\\r/g, '\\r');
    
    let courseData = JSON.parse(dataJson);
    console.log('✓ Course data loaded');
    
    // STEP 3: Get quiz slide IDs
    let slideIds = [];
    courseData.quizzes?.forEach(quiz => {
        quiz.sliderefs?.forEach(ref => {
            let parts = ref.id.split('.');
            slideIds.push(parts[parts.length - 1]);
        });
    });
    
    // Also get from scenes if no quizzes
    if (slideIds.length === 0) {
        courseData.scenes?.forEach(scene => {
            scene.slides?.forEach(slide => {
                if (slide.id) slideIds.push(slide.id);
            });
        });
    }
    
    console.log('Found', slideIds.length, 'slides to check\n');
    
    // STEP 4: Fetch each slide and extract Q&A
    let allQA = [];
    
    for (let i = 0; i < slideIds.length; i++) {
        let slideId = slideIds[i];
        
        try {
            let resp = await fetch(`${baseUrl}/html5/data/js/${slideId}.js`);
            if (!resp.ok) continue;
            
            let text = await resp.text();
            let match = text.match(/globalProvideData\s*\(\s*'slide'\s*,\s*'(.+)'\s*\)/);
            if (!match) continue;
            
            let jsonStr = match[1]
                .replace(/\\'/g, "'")
                .replace(/\\\\"/g, '\\"')
                .replace(/\\\\n/g, '\\n')
                .replace(/\\\\t/g, '\\t')
                .replace(/\\\\r/g, '\\r');
            
            let slideData = JSON.parse(jsonStr);
            let qa = extractQA(slideData, slideId);
            
            if (qa.answers.length > 0) {
                allQA.push(qa);
                console.log(`✓ [${i+1}/${slideIds.length}] ${slideId}: ${qa.answers.length} answers`);
            }
        } catch(e) {}
    }
    
    // STEP 5: Output results
    console.log('\n=== RESULTS ===');
    console.log('Questions found:', allQA.length);
    console.log('Total answers:', allQA.reduce((sum, q) => sum + q.answers.length, 0));
    console.log('Correct answers:', allQA.reduce((sum, q) => sum + q.answers.filter(a => a.correct).length, 0));
    
    console.log('\n=== QUESTIONS & ANSWERS ===\n');
    
    allQA.forEach((qa, i) => {
        console.log(`--- Question ${i + 1} [${qa.slideId}] ---`);
        if (qa.question) console.log('Q:', qa.question);
        qa.answers.forEach((a, j) => {
            console.log(`  ${j + 1}. ${a.correct ? '✓ CORRECT' : '✗'} ${a.text}`);
        });
        console.log('');
    });
    
    // Save to window
    window.allQA = allQA;
    window.courseData = courseData;
    
    console.log('=== SAVED ===');
    console.log('window.allQA - all questions/answers');
    console.log('window.courseData - full course data');
    console.log('\nRun exportQA() to download results');
    
    // Export function
    window.exportQA = function(format = 'txt') {
        let qa = window.allQA;
        let output = '';
        let filename = 'answer_key';
        let type = 'text/plain';
        
        if (format === 'csv') {
            output = 'Question,Slide,Answer,Correct\n';
            qa.forEach((q, i) => {
                q.answers.forEach(a => {
                    output += `"${i+1}","${q.slideId}","${a.text.replace(/"/g, '""')}",${a.correct ? 'YES' : 'NO'}\n`;
                });
            });
            filename = 'answer_key.csv';
            type = 'text/csv';
        } else if (format === 'json') {
            output = JSON.stringify(qa, null, 2);
            filename = 'answer_key.json';
            type = 'application/json';
        } else {
            output = '=== ANSWER KEY ===\n\n';
            qa.forEach((q, i) => {
                output += `--- Question ${i + 1} [${q.slideId}] ---\n`;
                if (q.question) output += `Q: ${q.question}\n`;
                q.answers.forEach((a, j) => {
                    output += `${j + 1}. ${a.correct ? '✓ CORRECT' : '✗'} ${a.text}\n`;
                });
                output += '\n';
            });
            output += '\n=== CORRECT ANSWERS ONLY ===\n\n';
            qa.forEach((q, i) => {
                let correct = q.answers.filter(a => a.correct);
                if (correct.length) output += `Q${i+1}: ${correct.map(a => a.text).join(' | ')}\n`;
            });
            filename = 'answer_key.txt';
        }
        
        let blob = new Blob([output], {type});
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        console.log('✓ Downloaded', filename);
    };
    
    // Helper function
    function extractQA(obj, slideId) {
        let result = { slideId, question: '', answers: [] };
        
        function search(obj) {
            if (!obj || typeof obj !== 'object') return;
            
            let text = '';
            if (obj.textLib?.[0]?.vartext?.blocks) {
                text = obj.textLib[0].vartext.blocks
                    .flatMap(b => b.spans?.map(s => s.text) || [])
                    .join('')
                    .replace(/\\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }
            
            let hasReview = obj.states?.some(s => 
                s.name?.includes('_Review') || s.name?.includes('_Selected_Review')
            ) && !obj.states?.every(s => s.name?.includes('Incorrect'));
            
            if ((obj.accType === 'checkbox' || obj.accType === 'radiobutton') && text && text.length > 5) {
                result.answers.push({ text, correct: hasReview });
            }
            
            if (obj.accType === 'text' && text && text.length > 20) {
                if (text.includes('?') || text.toLowerCase().includes('select')) {
                    if (!result.question || text.length > result.question.length) {
                        result.question = text;
                    }
                }
            }
            
            for (let key in obj) {
                if (Array.isArray(obj[key])) obj[key].forEach(item => search(item));
                else if (typeof obj[key] === 'object') search(obj[key]);
            }
        }
        
        search(obj);
        return result;
    }
    
})();