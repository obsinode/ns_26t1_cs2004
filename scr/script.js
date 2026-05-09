const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['sol', 'src'];
const OUTPUT_FILE = path.join(ROOT, 'index.json');

/**
 * Recursively walks a directory and finds all HTML files
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} Array of file paths
 */
async function walk(dir) {
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const files = [];
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            try {
                if (entry.isDirectory()) {
                    files.push(...await walk(fullPath));
                } else if (entry.isFile()) {
                    const lowerName = entry.name.toLowerCase();
                    if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
                        files.push(fullPath);
                    }
                }
            } catch (err) {
                console.warn(`Warning: Could not process entry ${fullPath}: ${err.message}`);
            }
        }
        return files;
    } catch (err) {
        console.warn(`Warning: Could not read directory ${dir}: ${err.message}`);
        return [];
    }
}

/**
 * Converts absolute file path to relative normalized path (forward slashes)
 * @param {string} filePath - Absolute file path
 * @returns {string} Relative path with forward slashes
 */
function normalizePath(filePath) {
    const relativePath = path.relative(ROOT, filePath);
    return relativePath.split(path.sep).join('/');
}

/**
 * Validates that a path string is valid
 * @param {string} pathStr - Path to validate
 * @returns {boolean} True if valid
 */
function validatePath(pathStr) {
    if (typeof pathStr !== 'string' || pathStr.trim().length === 0) {
        return false;
    }
    // Check for valid HTML file extension
    if (!pathStr.toLowerCase().endsWith('.html') && !pathStr.toLowerCase().endsWith('.htm')) {
        return false;
    }
    // Check that path starts with sol/ or src/
    if (!/^(sol|src)\//i.test(pathStr)) {
        return false;
    }
    return true;
}

/**
 * Main function to generate index.json from HTML files in sol/ and src/
 */
async function main() {
    console.log('Starting HTML file discovery...');
    console.log(`Root directory: ${ROOT}`);
    console.log(`Search directories: ${SEARCH_DIRS.join(', ')}`);
    
    const htmlFiles = [];
    
    // Walk each search directory
    for (const dirName of SEARCH_DIRS) {
        const dirPath = path.join(ROOT, dirName);
        
        if (!fs.existsSync(dirPath)) {
            console.warn(`Directory does not exist: ${dirPath}`);
            continue;
        }
        
        console.log(`Searching: ${dirPath}`);
        const found = await walk(dirPath);
        console.log(`  Found ${found.length} HTML files`);
        htmlFiles.push(...found);
    }

    if (htmlFiles.length === 0) {
        console.warn('No HTML files found in search directories');
    }

    // Sort files
    htmlFiles.sort((a, b) => 
        normalizePath(a).localeCompare(normalizePath(b), undefined, { numeric: true, sensitivity: 'base' })
    );

    // Build and validate payload
    const payload = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const filePath of htmlFiles) {
        const normalizedPath = normalizePath(filePath);
        
        if (validatePath(normalizedPath)) {
            payload.push({ path: normalizedPath });
            validCount++;
        } else {
            console.warn(`Invalid path (skipped): ${normalizedPath}`);
            invalidCount++;
        }
    }

    if (invalidCount > 0) {
        console.warn(`Skipped ${invalidCount} invalid entries`);
    }

    // Generate and validate JSON
    let jsonContent;
    try {
        jsonContent = JSON.stringify(payload, null, 4);
    } catch (err) {
        console.error(`Failed to stringify payload to JSON: ${err.message}`);
        process.exit(1);
    }

    // Validate JSON by parsing it
    try {
        JSON.parse(jsonContent);
    } catch (err) {
        console.error(`Generated JSON is invalid: ${err.message}`);
        process.exit(1);
    }

    // Write to file
    try {
        await fs.promises.writeFile(OUTPUT_FILE, jsonContent, 'utf8');
        console.log(`✓ Successfully generated ${OUTPUT_FILE}`);
        console.log(`  Total entries: ${validCount}`);
        console.log(`  File size: ${jsonContent.length} bytes`);
    } catch (err) {
        console.error(`Failed to write output file: ${err.message}`);
        process.exit(1);
    }

    console.log('Done.');
}

// Execute main with error handling
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});