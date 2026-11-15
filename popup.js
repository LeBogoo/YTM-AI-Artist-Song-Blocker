/*
 * YTM Ward - Popup Script (Counter Version)
 * Created by Spirit Flame
 */

// DOM Elements
const tabs = document.querySelectorAll('.tab-btn');
const list = document.getElementById('list');
const input = document.getElementById('input');
const addBtn = document.getElementById('add');
const inputArea = document.getElementById('input-area');
const statusLabel = document.getElementById('status');
const btnRefresh = document.getElementById('btn-refresh');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const fileInput = document.getElementById('file-input');
const scanArea = document.getElementById('scan-area');
const btnScan = document.getElementById('btn-scan');
const btnRemoveLiked = document.getElementById('btn-remove-liked');

let currentTab = 'keywords';

const KEYS = {
    keywords: 'blockedKeywords',
    songs: 'blockedTracks',
    artists: 'blockedArtists'
};

// --- UTILS ---

function showStatus(msg, color = '#666') {
    if (!statusLabel) return;
    statusLabel.style.color = color;
    statusLabel.textContent = msg;
    setTimeout(() => { statusLabel.textContent = 'Ready.'; statusLabel.style.color = '#666'; }, 3000);
}

function getDisplayText(item) {
    if (typeof item === 'string') return item;
    if (item && item.title) return `${item.artist || 'Unknown'} - ${item.title}`;
    return JSON.stringify(item);
}

function safeSort(items) {
    if (!Array.isArray(items)) return [];
    return items.sort((a, b) => {
        const textA = getDisplayText(a).toLowerCase();
        const textB = getDisplayText(b).toLowerCase();
        return textA.localeCompare(textB);
    });
}

// --- RENDERING ---

function render() {
    list.innerHTML = '';
    scanArea.style.display = currentTab === 'liked' ? 'flex' : 'none';

    // LIKED SONGS SCAN TAB
    if (currentTab === 'liked') {
        inputArea.style.display = 'none';
        renderLikedScan();
        return;
    }

    // AI TAB (Counter View)
    if (currentTab === 'ai') {
        inputArea.style.display = 'none';
        fetchAIList(false);
        return;
    }

    // LOCAL TABS (List View)
    inputArea.style.display = 'flex';
    const key = KEYS[currentTab];
    
    chrome.storage.local.get([key], (res) => {
        let items = res[key] || [];
        items = safeSort(items);
        
        list.innerHTML = '';
        if (items.length === 0) {
            list.innerHTML = '<li style="justify-content:center; color:#555;">List is empty.</li>';
            return;
        }

        items.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${getDisplayText(item)}</span><span class="delete-btn">✖</span>`;
            
            li.querySelector('.delete-btn').onclick = () => {
                removeItem(key, item);
            };
            list.appendChild(li);
        });
    });
}

// --- LOGIC ---

const AI_MIN_RATING_DEFAULT = 4;
const RATING_OPTIONS = [
    [5, 'Rating 5 only (strongest signals)'],
    [4, 'Rating 4+ (flagged as AI)'],
    [3, 'Rating 3+'],
    [2, 'Rating 2+'],
    [1, 'Everything in the database'],
];

function renderAISummary(aiDb, minRating) {
    const artists = (aiDb && aiDb.artists) || [];
    const blocked = artists.filter(([, rating]) => rating >= minRating).length;
    const updated = aiDb && aiDb.fetchedAt ? new Date(aiDb.fetchedAt).toLocaleString() : 'never';

    list.innerHTML = `
        <li style="display:block; text-align:center; padding-top:30px; border-bottom:none;">
            <div style="font-size:48px; font-weight:800; color:#ff4444; line-height:1;" id="ai-count"></div>
            <div style="font-size:12px; font-weight:bold; color:#aaa; margin-top:5px; text-transform:uppercase; letter-spacing:1px;">AI Artists Blocked</div>
            <div style="font-size:10px; color:#777; margin-top:4px;" id="ai-total"></div>
            <select id="ai-min-rating" style="margin-top:18px; width:100%; padding:6px; background:#2a2a2a; color:#fff; border:1px solid #444; border-radius:4px;"></select>
            <div style="font-size:10px; color:#555; margin-top:14px;">Source: Zoundhub AI Artist Database</div>
            <div style="font-size:10px; color:#555;" id="ai-updated"></div>
        </li>
    `;
    document.getElementById('ai-count').textContent = blocked;
    document.getElementById('ai-total').textContent = `of ${artists.length} artists in the database`;
    document.getElementById('ai-updated').textContent = `Last updated: ${updated}`;

    const select = document.getElementById('ai-min-rating');
    RATING_OPTIONS.forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        opt.selected = value === minRating;
        select.appendChild(opt);
    });
    select.onchange = () => {
        chrome.storage.local.set({ aiMinRating: Number(select.value) }, () => fetchAIList(false));
    };
}

function fetchAIList(forceRefresh) {
    chrome.storage.local.get(['aiDb', 'aiMinRating'], (res) => {
        const minRating = Number.isFinite(res.aiMinRating) ? res.aiMinRating : AI_MIN_RATING_DEFAULT;
        if (res.aiDb && !forceRefresh) {
            renderAISummary(res.aiDb, minRating);
            return;
        }

        list.innerHTML = '<li style="justify-content:center; color:#888;">Checking Database...</li>';
        chrome.runtime.sendMessage({ type: 'refreshAiDb' }, (reply) => {
            if (currentTab !== 'ai') return;
            chrome.storage.local.get(['aiDb'], (fresh) => {
                if (reply && reply.ok) {
                    renderAISummary(fresh.aiDb, minRating);
                    showStatus('Database Sync Active', '#4caf50');
                } else {
                    const error = (reply && reply.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'unknown error';
                    if (fresh.aiDb) {
                        renderAISummary(fresh.aiDb, minRating);
                    } else {
                        const li = document.createElement('li');
                        li.style.cssText = 'justify-content:center; color:#ff4444;';
                        li.textContent = `Connection Failed: ${error}`;
                        list.replaceChildren(li);
                    }
                    showStatus(`Sync failed: ${error}`, '#ff4444');
                }
            });
        });
    });
}

function addItem() {
    const val = input.value.trim();
    if (!val) return;
    
    const key = KEYS[currentTab];
    chrome.storage.local.get([key], (res) => {
        const items = res[key] || [];
        
        const newItem = (currentTab === 'songs') 
            ? { title: val, artist: "Manual Entry" } 
            : val;

        const exists = items.some(i => getDisplayText(i) === getDisplayText(newItem));
        
        if (!exists) {
            items.push(newItem);
            chrome.storage.local.set({ [key]: items }, () => {
                input.value = '';
                render();
                showStatus('Added.');
            });
        } else {
            showStatus('Duplicate entry.', '#ff4444');
        }
    });
}

function removeItem(key, val) {
    chrome.storage.local.get([key], (res) => {
        let items = res[key] || [];
        items = items.filter(i => getDisplayText(i) !== getDisplayText(val));
        chrome.storage.local.set({ [key]: items }, render);
    });
}

// --- LIKED SONGS SCAN ---
// The scan and removal run in the YouTube Music tab (content.js + page-bridge.js), which has
// the signed-in session. Results land in chrome.storage.local.likedScan.

const SCAN_STALE_MS = 60 * 1000; // no progress for this long = scan was interrupted
let deselected = new Set();      // videoIds the user unticked
let removingLiked = false;

function messageLi(text, color) {
    const li = document.createElement('li');
    li.className = 'scan-message';
    if (color) li.style.color = color;
    li.textContent = text;
    return li;
}

function isScanRunning(scan) {
    return scan && scan.status === 'scanning' && Date.now() - (scan.updatedAt || scan.startedAt || 0) < SCAN_STALE_MS;
}

function updateRemoveButton(matches) {
    const count = matches.filter(m => !deselected.has(m.videoId)).length;
    btnRemoveLiked.textContent = `🗑 Remove Selected (${count})`;
    btnRemoveLiked.disabled = removingLiked || count === 0;
}

function renderLikedScan() {
    chrome.storage.local.get(['likedScan'], ({ likedScan: scan }) => {
        if (currentTab !== 'liked') return;
        const running = isScanRunning(scan);
        btnScan.disabled = running || removingLiked;
        btnScan.textContent = running ? '⏳ Scanning…' : '🔍 Scan Liked Songs';

        if (!scan) {
            list.replaceChildren(messageLi('Scan your Liked Music for songs by AI artists from the Zoundhub database.\nYouTube Music must be open in a tab and signed in.'));
            updateRemoveButton([]);
            return;
        }
        if (scan.status === 'scanning') {
            list.replaceChildren(running
                ? messageLi(`Scanning liked songs…\n${scan.scanned || 0} checked so far`)
                : messageLi('The last scan was interrupted. Start a new scan.', '#ff4444'));
            updateRemoveButton([]);
            return;
        }
        if (scan.status === 'error') {
            list.replaceChildren(messageLi(`Scan failed: ${scan.error}`, '#ff4444'));
            updateRemoveButton([]);
            return;
        }

        const matches = scan.matches || [];
        if (matches.length === 0) {
            list.replaceChildren(messageLi(`No AI songs found in ${scan.total} liked songs.`, '#4caf50'));
            updateRemoveButton([]);
            return;
        }

        const header = document.createElement('li');
        header.className = 'scan-header';
        const summary = document.createElement('span');
        summary.textContent = `${matches.length} AI songs in ${scan.total} liked songs`;
        const toggle = document.createElement('a');
        const allSelected = matches.every(m => !deselected.has(m.videoId));
        toggle.textContent = allSelected ? 'Select none' : 'Select all';
        toggle.onclick = () => {
            deselected = allSelected ? new Set(matches.map(m => m.videoId)) : new Set();
            renderLikedScan();
        };
        header.append(summary, toggle);

        const rows = matches.map(m => {
            const li = document.createElement('li');
            li.className = 'scan-item';
            const label = document.createElement('label');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = !deselected.has(m.videoId);
            box.onchange = () => {
                if (box.checked) deselected.delete(m.videoId);
                else deselected.add(m.videoId);
                updateRemoveButton(matches);
            };
            const text = document.createElement('div');
            text.className = 'scan-text';
            const title = document.createElement('div');
            title.textContent = m.title;
            title.title = `${m.title} — ${m.artist}`;
            const sub = document.createElement('div');
            sub.className = 'scan-sub';
            sub.textContent = `${m.artist} · matched "${m.matched}"`;
            text.append(title, sub);
            label.append(box, text);
            li.appendChild(label);
            return li;
        });

        list.replaceChildren(header, ...rows);
        updateRemoveButton(matches);
    });
}

async function sendToYtmTab(message) {
    const ytmTabs = await chrome.tabs.query({ url: 'https://music.youtube.com/*' });
    const tab = ytmTabs.find(t => t.active) || ytmTabs[0];
    if (!tab) throw new Error('Open music.youtube.com in a tab first.');
    try {
        return await chrome.tabs.sendMessage(tab.id, message);
    } catch (e) {
        throw new Error('Reload the YouTube Music tab and try again.');
    }
}

btnScan.onclick = async () => {
    deselected = new Set();
    btnScan.disabled = true;
    showStatus('Scanning liked songs…');
    try {
        const res = await sendToYtmTab({ type: 'scanLiked' });
        if (res && res.ok) showStatus('Scan complete.', '#4caf50');
        else showStatus(`Scan failed: ${(res && res.error) || 'no response'}`, '#ff4444');
    } catch (e) {
        showStatus(e.message, '#ff4444');
    }
    renderLikedScan();
};

btnRemoveLiked.onclick = async () => {
    const { likedScan } = await chrome.storage.local.get('likedScan');
    const videoIds = ((likedScan && likedScan.matches) || [])
        .map(m => m.videoId)
        .filter(id => !deselected.has(id));
    if (videoIds.length === 0) return;

    removingLiked = true;
    btnRemoveLiked.disabled = true;
    btnScan.disabled = true;
    btnRemoveLiked.textContent = `⏳ Removing ${videoIds.length}…`;
    try {
        const res = await sendToYtmTab({ type: 'removeLiked', videoIds });
        if (res && res.ok) {
            showStatus(`Removed ${res.removed} from Liked Music${res.failed ? `, ${res.failed} failed` : ''}.`, res.failed ? '#ff4444' : '#4caf50');
        } else {
            showStatus(`Removal failed: ${(res && res.error) || 'no response'}`, '#ff4444');
        }
    } catch (e) {
        showStatus(e.message, '#ff4444');
    }
    removingLiked = false;
    renderLikedScan();
};

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'likedScan' in changes && currentTab === 'liked') renderLikedScan();
});

// --- EVENTS ---

tabs.forEach(tab => {
    tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        input.value = '';
        input.placeholder = `Add to ${currentTab}...`;
        render();
    };
});

addBtn.onclick = addItem;
input.addEventListener('keypress', e => { if(e.key === 'Enter') addItem(); });

btnRefresh.onclick = () => {
    if(currentTab === 'ai') fetchAIList(true);
    else render();
};

// Cached / transient data that does not belong in a backup
const NON_BACKUP_KEYS = ['aiDb', 'aiDbCheckedAt', 'historyQueue', 'likedScan'];

btnExport.onclick = () => {
    chrome.storage.local.get(null, (data) => {
        NON_BACKUP_KEYS.forEach(k => delete data[k]);
        const blob = new Blob([JSON.stringify(data, null, 2)], {type : 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ytm-ward-backup.json';
        a.click();
        showStatus('Exported.');
    });
};

function importFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            NON_BACKUP_KEYS.forEach(k => delete data[k]);
            chrome.storage.local.set(data, () => {
                render();
                showStatus('Import Successful.', '#4caf50');
            });
        } catch(err) {
            showStatus('Invalid JSON File.', '#ff4444');
        }
    };
    reader.readAsText(file);
}

btnImport.onclick = () => fileInput.click();
fileInput.onchange = (e) => {
    importFile(e.target.files[0]);
    fileInput.value = '';
};

// Dropping a .json file on the Import button imports it directly
const isJsonFile = f => f && (f.type === 'application/json' || f.name.toLowerCase().endsWith('.json'));
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

btnImport.addEventListener('dragenter', e => { if (hasFiles(e)) { e.preventDefault(); btnImport.classList.add('drop-target'); } });
btnImport.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
btnImport.addEventListener('dragleave', () => btnImport.classList.remove('drop-target'));
btnImport.addEventListener('drop', e => {
    e.preventDefault();
    btnImport.classList.remove('drop-target');
    const file = e.dataTransfer.files[0];
    if (isJsonFile(file)) importFile(file);
    else showStatus('Drop a .json backup file.', '#ff4444');
});

// Start
render();