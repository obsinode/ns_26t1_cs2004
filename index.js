/* DOM refs */
const searchInput = document.getElementById('search');
const typeFilter = document.getElementById('typeFilter');
const weekFilter = document.getElementById('weekFilter');
const overviewGrid = document.getElementById('overviewGrid');
const treeContainer = document.getElementById('treeContainer');
const refreshButton = document.getElementById('refreshButton');

/* Constants */
const CACHE_KEY = 'assignment-dashboard-html-files-v2';

/* State */
let currentFiles = [];   // raw normalised file objects  { path }
let parsedFiles = [];   // enriched file objects
let refreshInProgress = false;

/* ─── Normalisation ─────────────────────────────────────────────── */

const normalize = v => v?.toString().toLowerCase() || '';

const normalizePathEntry = entry => {
    const raw = typeof entry === 'string' ? entry : entry?.path;
    if (!raw) return null;
    return { path: String(raw).replace(/\\/g, '/') };
};

const normalizeFileList = list => {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(normalizePathEntry)
        .filter(Boolean)
        .filter(item => {
            const key = item.path.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) =>
            a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })
        );
};

/* ─── Parse a single file path ──────────────────────────────────── */

const parseFile = file => {
    const path = file.path;
    const parts = path.split('/');
    const fileName = parts[parts.length - 1] || '';
    const source = (parts[0] || '').toLowerCase();
    const weekMatch = path.match(/WEEK\s*0*([0-9]+)/i);
    const week = weekMatch
        ? `WEEK ${String(Number(weekMatch[1])).padStart(2, '0')}`
        : null;
    const title = fileName.replace(/\.html?$/i, '');
    return { path, parts, fileName, title, source, week };
};

/* ─── Data rebuild ──────────────────────────────────────────────── */

const rebuildData = files => {
    currentFiles = normalizeFileList(files);
    parsedFiles = currentFiles.map(parseFile);
};

/* ─── Load index.json ──────────────────────────────────────────── */

const loadIndexJson = async () => {
    try {
        const response = await fetch('index.json', {
            headers: { 'Accept': 'application/json' },
            cache: 'no-cache'
        });
        if (!response.ok) {
            console.warn(`Failed to load index.json: HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();

        // Validate that data is an array
        if (!Array.isArray(data)) {
            console.warn('index.json root is not an array:', typeof data);
            return [];
        }

        // Validate and extract paths from each entry
        const files = data
            .filter((item, idx) => {
                if (!item || typeof item !== 'object') {
                    console.warn(`index.json[${idx}] is not an object:`, item);
                    return false;
                }
                if (typeof item.path !== 'string') {
                    console.warn(`index.json[${idx}].path is not a string:`, item.path);
                    return false;
                }
                return true;
            })
            .map(item => ({ path: item.path }));

        if (files.length === 0) {
            console.warn('No valid file entries found in index.json after validation');
        } else {
            console.info(`Successfully loaded ${files.length} files from index.json`);
        }

        return files;
    } catch (err) {
        if (err instanceof SyntaxError) {
            console.error('index.json contains invalid JSON:', err.message);
        } else if (err instanceof TypeError) {
            console.error('Failed to fetch index.json (network error):', err.message);
        } else {
            console.error('Unexpected error loading index.json:', err);
        }
        return [];
    }
};

/* ─── Cache ─────────────────────────────────────────────────────── */

const loadCachedFiles = () => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.files)) {
            console.warn('Cached files is not an array');
            return [];
        }
        return normalizeFileList(parsed.files);
    } catch (err) {
        console.warn('Failed to load cached files:', err.message);
        return [];
    }
};

const saveCachedFiles = files => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), files }));
    } catch (err) {
        console.warn('Failed to save files to cache (quota exceeded?):', err.message);
    }
};

/* ─── Week dropdown ─────────────────────────────────────────────── */

const populateWeekOptions = () => {
    while (weekFilter.options.length > 1) weekFilter.remove(1);

    const weeks = new Set(parsedFiles.map(f => f.week).filter(Boolean));
    const sorted = [...weeks].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );
    sorted.forEach(label => {
        const opt = document.createElement('option');
        opt.value = label;
        opt.textContent = label;
        weekFilter.appendChild(opt);
    });
};

/* ─── Summary cards ─────────────────────────────────────────────── */

const renderSummary = () => {
    const total = parsedFiles.length;
    const srcCount = parsedFiles.filter(f => f.source === 'src').length;
    const solCount = parsedFiles.filter(f => f.source === 'sol').length;
    const activeWeeks = new Set(parsedFiles.map(f => f.week).filter(Boolean)).size;

    overviewGrid.innerHTML = `
        <div class="summary-card">
            <span>Total assignments</span>
            <strong>${total}</strong>
        </div>
        <div class="summary-card">
            <span>Active weeks</span>
            <strong>${activeWeeks}&thinsp;/&thinsp;12</strong>
        </div>
        <div class="summary-card">
            <span>src files</span>
            <strong>${srcCount}</strong>
        </div>
        <div class="summary-card">
            <span>sol files</span>
            <strong>${solCount}</strong>
        </div>
    `;
};

/* ─── Filtering ─────────────────────────────────────────────────── */

const getFilteredFiles = () => {
    const search = normalize(searchInput.value.trim());
    const source = typeFilter.value;
    const week = weekFilter.value;

    return parsedFiles.filter(file => {
        if (source !== 'all' && file.source !== source) return false;
        if (week !== 'all' && file.week !== week) return false;
        if (!search) return true;
        return [file.title, file.fileName, file.week, file.source, file.path]
            .some(v => normalize(v).includes(search));
    });
};

/* ─── Tree data structure ───────────────────────────────────────── */

const buildTree = files => {
    const root = {};
    files.forEach(file => {
        let node = root;
        file.parts.forEach((part, i) => {
            if (i === file.parts.length - 1) {
                if (!node.__files) node.__files = [];
                node.__files.push(file);
            } else {
                if (!node[part]) node[part] = {};
                node = node[part];
            }
        });
    });
    return root;
};

const countLeaves = node => {
    if (!node || typeof node !== 'object') return 0;
    let count = node.__files ? node.__files.length : 0;
    Object.keys(node).forEach(k => {
        if (k !== '__files') count += countLeaves(node[k]);
    });
    return count;
};

/* ─── SVG snippets ──────────────────────────────────────────────── */

const CHEVRON_SVG = `<svg
    class="chevron"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true">
    <path d="M9 18l6-6-6-6"/>
</svg>`;

const FILE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M6 2h9l5 5v15H6V2Zm9 0v5h5"/>
</svg>`;

const ARROW_SVG = `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true">
    <path d="M9 18l6-6-6-6"/>
</svg>`;

/* ─── Collapse / expand toggle ──────────────────────────────────── */

const makeCollapsible = (header, body) => {
    // Check if this is a WEEK node - expand WEEK nodes by default
    const label = header.querySelector('.node-label');
    const isWeekNode = label && /^WEEK\s*\d+/i.test(label.textContent.trim());
    let open = isWeekNode; // WEEK nodes open by default, others closed

    const chevron = header.querySelector('.chevron');

    const update = () => {
        chevron.classList.toggle('open', open);
        header.classList.toggle('is-open', open);
        header.classList.toggle('closed', !open);
        body.classList.toggle('hidden', !open);
    };

    update();
    header.addEventListener('click', () => { open = !open; update(); });
};

/* ─── Depth → CSS level class ───────────────────────────────────── */

const DEPTH_CLASSES = ['level-root', 'level-folder', 'level-week', 'level-inner'];

const depthClass = depth =>
    DEPTH_CLASSES[Math.min(depth, DEPTH_CLASSES.length - 1)];

/* ─── Recursive tree renderer ───────────────────────────────────── */

const renderTree = (nodeObj, depth, container) => {
    if (nodeObj.__files && nodeObj.__files.length > 0) {
        const fileList = buildFileList(nodeObj.__files);
        container.appendChild(fileList);
    }

    const childKeys = Object.keys(nodeObj)
        .filter(k => k !== '__files')
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    childKeys.forEach(key => {
        const child = nodeObj[key];
        const count = countLeaves(child);

        const node = document.createElement('div');
        node.className = `tree-node ${depthClass(depth)}`;

        const header = document.createElement('div');
        header.className = 'tree-node-header closed';
        header.innerHTML = `
            ${CHEVRON_SVG}
            <span class="node-label">${key}</span>
            <span class="node-count">${count} file${count !== 1 ? 's' : ''}</span>
        `;

        const body = document.createElement('div');
        body.className = 'tree-node-body hidden';

        node.appendChild(header);
        node.appendChild(body);
        container.appendChild(node);

        makeCollapsible(header, body);
        renderTree(child, depth + 1, body);
    });
};

/* ─── Build a file-list element ─────────────────────────────────── */

const buildFileList = files => {
    const list = document.createElement('div');
    list.className = 'file-list';

    files.forEach(file => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML = `
            <span class="file-icon">${FILE_SVG}</span>
            <div class="file-info">
                <p class="file-name">${file.title}</p>
                <p class="file-path">${file.path}</p>
            </div>
            <span class="file-badge">${file.source}</span>
            <a
                class="file-open"
                href="${encodeURI(file.path)}"
                target="_blank"
                rel="noopener noreferrer"
            >Open ${ARROW_SVG}</a>
        `;
        list.appendChild(row);
    });

    return list;
};

/* ─── Main render entry-point ───────────────────────────────────── */

const renderFullTree = () => {
    const filtered = getFilteredFiles();
    treeContainer.innerHTML = '';

    if (filtered.length === 0) {
        treeContainer.innerHTML =
            '<div class="empty-state">No matching assignment files found. Try a different search or filter.</div>';
        return;
    }

    const tree = buildTree(filtered);
    renderTree(tree, 0, treeContainer);
};

/* ─── GitHub API refresh ─────────────────────────────────────────── */

const inferGitHubRepo = () => {
    const host = (window.location.hostname || '').toLowerCase();
    if (!host.endsWith('.github.io')) return null;
    const owner = host.slice(0, -'.github.io'.length);
    const segments = window.location.pathname.split('/').filter(Boolean);
    const repo = segments.length > 0 ? segments[0] : `${owner}.github.io`;
    if (!owner || !repo) return null;
    return { owner, repo };
};

const fetchJson = async url => {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
    return res.json();
};

const fetchGitHubFiles = async () => {
    const info = inferGitHubRepo();
    if (!info) return [];

    const meta = await fetchJson(`https://api.github.com/repos/${info.owner}/${info.repo}`);
    const branch = meta?.default_branch || 'main';

    const treeData = await fetchJson(
        `https://api.github.com/repos/${info.owner}/${info.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );

    const nodes = Array.isArray(treeData?.tree) ? treeData.tree : [];

    return normalizeFileList(
        nodes
            .filter(n => n?.type === 'blob' && typeof n.path === 'string')
            .filter(n => /^(sol|src)\//i.test(n.path) && /\.html?$/i.test(n.path))
            .map(n => ({ path: n.path }))
    );
};

const setRefreshState = (busy, label) => {
    refreshButton.disabled = busy;
    refreshButton.textContent = label;
};

const refreshFromGitHub = async (manual = false) => {
    if (refreshInProgress) return;
    refreshInProgress = true;
    if (manual) setRefreshState(true, 'Refreshing…');

    try {
        const remote = await fetchGitHubFiles();
        if (remote.length > 0) {
            const curPaths = currentFiles.map(f => f.path);
            const remPaths = remote.map(f => f.path);
            const changed =
                curPaths.length !== remPaths.length ||
                remPaths.some((p, i) => p !== curPaths[i]);

            if (changed) {
                rebuildData(remote);
                populateWeekOptions();
                renderSummary();
                renderFullTree();
                saveCachedFiles(remote);
            }
        }
    } catch (err) {
        console.warn('GitHub refresh failed:', err);
    } finally {
        setRefreshState(false, 'Refresh data');
        refreshInProgress = false;
    }
};

/* ─── Event listeners ───────────────────────────────────────────── */

searchInput.addEventListener('input', renderFullTree);
typeFilter.addEventListener('change', renderFullTree);
weekFilter.addEventListener('change', renderFullTree);
refreshButton.addEventListener('click', () => refreshFromGitHub(true));

/* ─── Bootstrap ─────────────────────────────────────────────────── */

(() => {
    const initializeApp = async () => {
        // Priority 1: Load from index.json
        let files = await loadIndexJson();

        // Priority 2: Fall back to cache if index.json is empty
        if (files.length === 0) {
            console.info('index.json empty or failed, trying cached data...');
            files = loadCachedFiles();
        }

        // Priority 3: Fall back to static HTML files if both fail
        if (files.length === 0) {
            console.info('Cache empty, using static HTML files...');
            files = normalizeFileList(
                Array.isArray(window.htmlFiles) ? window.htmlFiles : []
            );
        }

        // Initialize with resolved data
        if (files.length === 0) {
            console.warn(
                'No file data available: index.json empty, cache empty, and window.htmlFiles not provided'
            );
        }

        rebuildData(files);
        populateWeekOptions();
        renderSummary();
        renderFullTree();

        // Save successful load to cache for offline usage
        if (files.length > 0) {
            saveCachedFiles(files);
        }

        // Attempt background refresh from GitHub
        await refreshFromGitHub(false);
    };

    initializeApp().catch(err => {
        console.error('App initialization failed:', err);
        // Try fallback with cached data on critical error
        try {
            const cachedFiles = loadCachedFiles();
            if (cachedFiles.length > 0) {
                rebuildData(cachedFiles);
                populateWeekOptions();
                renderSummary();
                renderFullTree();
            }
        } catch (fallbackErr) {
            console.error('Fallback initialization also failed:', fallbackErr);
        }
    });
})();