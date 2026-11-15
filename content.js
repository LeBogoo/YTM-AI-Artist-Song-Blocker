/*
 * YTM Ward - Production Engine
 * - Local lists (artists, keywords, songs): whole-word matching against "artist title"
 * - Zoundhub AI database: exact (case-insensitive) match against each credited artist
 * - Every blocked song is disliked, skipped and removed from the YouTube Music history
 */

const AI_MIN_RATING_DEFAULT = 4; // Zoundhub ratings 4-5 = flagged as AI
const HISTORY_RETRY_DELAYS = [15, 30, 60, 120, 300, 600]; // seconds between removal attempts

let termMatchers = [];          // [{ term, regex }] from the user's own lists
let aiArtistSet = new Set();    // normalized AI artist names
let lastProcessedSong = "";

console.log("[YTM Ward] Engine Started. Created by Spirit Flame (spiritflame@tutamail.com)");

const normalizeName = s => (s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function waitForElement(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) return resolve(document.querySelector(selector));
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

function simulateClick(element) {
    ['mousedown', 'mouseup', 'click'].forEach(eventType => {
        element.dispatchEvent(new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window
        }));
    });
}

async function updateBlockList() {
    const data = await chrome.storage.local.get(['blockedArtists', 'blockedKeywords', 'blockedTracks', 'aiDb', 'aiMinRating']);
    const localArtists = data.blockedArtists || [];
    const localKeywords = data.blockedKeywords || [];
    const localTracks = data.blockedTracks || [];

    const trackTitles = localTracks.map(t => (typeof t === 'object' && t.title) ? t.title : t);
    const terms = [...new Set([...localArtists, ...localKeywords, ...trackTitles]
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(s => s.toLowerCase()))];

    // Whole-word regex: "after" matches "after" but NOT "afterpiece"
    termMatchers = terms.map(term => ({
        term,
        regex: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    }));

    const minRating = Number.isFinite(data.aiMinRating) ? data.aiMinRating : AI_MIN_RATING_DEFAULT;
    const aiArtists = (data.aiDb && data.aiDb.artists) || [];
    aiArtistSet = new Set(aiArtists.filter(([, rating]) => rating >= minRating).map(([name]) => normalizeName(name)));

    console.log(`[YTM Ward] Engine Loaded ${termMatchers.length} terms and ${aiArtistSet.size} AI artists.`);
}

function skipTrack() {
    const nextBtn = document.querySelector("ytmusic-player-bar .next-button");
    if (nextBtn) simulateClick(nextBtn);

    setTimeout(() => {
        const video = document.querySelector("video");
        if (video && !video.ended) video.currentTime = video.duration || 99999;
    }, 500);
}

function performDownvoteAndSkip() {
    const dislikeWrapper = document.querySelector(".middle-controls-buttons .dislike") ||
                           document.querySelector("ytmusic-player-bar .dislike");

    if (!dislikeWrapper) { skipTrack(); return; }

    const actualBtn = dislikeWrapper.querySelector("button") || dislikeWrapper;
    const isPressed = dislikeWrapper.getAttribute("aria-pressed") === "true" ||
                      actualBtn.getAttribute("aria-pressed") === "true";

    if (!isPressed) simulateClick(actualBtn);
    else { skipTrack(); return; }

    let attempts = 0;
    const poll = setInterval(() => {
        attempts++;
        const success = dislikeWrapper.getAttribute("aria-pressed") === "true" ||
                        actualBtn.getAttribute("aria-pressed") === "true";

        if (success || attempts >= 20) {
            clearInterval(poll);
            if (success) setTimeout(() => { skipTrack(); }, 2000);
            else skipTrack();
        }
    }, 100);
}

// Individual artist names credited on a track.
// linkedNames: artist link texts; artistText: "Artist A, Artist B & Artist C • Album • 2024"
function creditedArtistNames(linkedNames, artistText, title) {
    const names = new Set(linkedNames);

    const artistPart = (artistText || '').split('•')[0];
    names.add(artistPart);
    artistPart.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s+/i).forEach(n => names.add(n));

    // Featured artists in the title: "Song (feat. Artist B)"
    const feat = (title || '').match(/[(\[](?:feat|ft)\.?\s+([^)\]]+)[)\]]/i);
    if (feat) feat[1].split(/\s*(?:,|&)\s*/).forEach(n => names.add(n));

    return [...names].map(normalizeName).filter(Boolean);
}

function getCreditedArtists(bylineEl, title) {
    // Artist links in the byline point to channel pages (albums point to browse/MPREb...)
    const linked = [...bylineEl.querySelectorAll('a')]
        .filter(a => (a.getAttribute('href') || '').includes('channel/'))
        .map(a => a.textContent);
    return creditedArtistNames(linked, bylineEl.textContent, title);
}

function getSongInfo() {
    const titleEl = document.querySelector("ytmusic-player-bar .title");
    const bylineEl = document.querySelector("ytmusic-player-bar .byline");
    if (!titleEl || !bylineEl) return null;
    const title = titleEl.textContent.trim();
    return {
        title,
        artist: bylineEl.textContent.trim(),
        artists: getCreditedArtists(bylineEl, title)
    };
}

function findBlockReason(song) {
    const aiArtist = song.artists.find(name => aiArtistSet.has(name));
    if (aiArtist) return `AI artist "${aiArtist}" (Zoundhub)`;

    const checkString = (song.artist + " " + song.title).toLowerCase();
    const match = termMatchers.find(m => m.regex.test(checkString));
    if (match) return `whole word "${match.term}"`;

    return null;
}

function blockCurrentSong(song, reason) {
    lastProcessedSong = song.title + "|" + song.artist;
    console.log(`[YTM Ward] 🛑 BLOCKED: ${reason}`);
    queueHistoryRemoval(song);
    performDownvoteAndSkip();
}

function checkAndSkip() {
    const song = getSongInfo();
    if (!song || !song.title) return;
    if (song.title + "|" + song.artist === lastProcessedSong) return;

    const reason = findBlockReason(song);
    if (reason) blockCurrentSong(song, reason);
}

// --- HISTORY REMOVAL ---
// The InnerTube calls live in page-bridge.js (MAIN world); the queue is persisted here
// so pending removals survive page reloads.

let bridgeSeq = 0;
const bridgePending = new Map();

window.addEventListener('message', event => {
    if (event.source !== window || !event.data || event.data.source !== 'ytm-ward-page') return;
    const pending = bridgePending.get(event.data.id);
    if (!pending) return;
    if ('progress' in event.data) {
        if (pending.onProgress) pending.onProgress(event.data.progress);
        return;
    }
    bridgePending.delete(event.data.id);
    pending.resolve(event.data.result || {});
});

function callPageBridge(op, payload, timeoutMs = 30000, onProgress = null) {
    return new Promise(resolve => {
        const id = `${Date.now()}-${++bridgeSeq}`;
        const timer = setTimeout(() => {
            bridgePending.delete(id);
            resolve({ error: 'page bridge timeout' });
        }, timeoutMs);
        bridgePending.set(id, {
            onProgress,
            resolve: result => { clearTimeout(timer); resolve(result); }
        });
        window.postMessage({ source: 'ytm-ward-content', id, op, payload }, location.origin);
    });
}

let queueLock = Promise.resolve();
function withQueueLock(fn) {
    const run = queueLock.then(fn, fn);
    queueLock = run.catch(() => {});
    return run;
}

let historyTimer = null;
function scheduleHistoryProcessing(seconds) {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(processHistoryQueue, seconds * 1000);
}

async function queueHistoryRemoval(song) {
    const { videoId } = await callPageBridge('getVideoId', { title: song.title }, 5000);
    await withQueueLock(async () => {
        const { historyQueue = [] } = await chrome.storage.local.get('historyQueue');
        const duplicate = historyQueue.some(i => videoId
            ? i.videoId === videoId
            : (!i.videoId && i.title === song.title && i.artist === song.artist));
        if (duplicate) return;
        historyQueue.push({ videoId: videoId || null, title: song.title, artist: song.artist, attempts: 0, removed: false });
        await chrome.storage.local.set({ historyQueue });
    });
    scheduleHistoryProcessing(HISTORY_RETRY_DELAYS[0]);
}

async function processHistoryQueue() {
    historyTimer = null;
    const remaining = await withQueueLock(async () => {
        const { historyQueue = [] } = await chrome.storage.local.get('historyQueue');
        if (historyQueue.length === 0) return [];

        const result = await callPageBridge('removeFromHistory', {
            items: historyQueue.map(({ videoId, title, artist }) => ({ videoId, title, artist }))
        });

        if (result.error === 'signed-out') {
            // No account, no history to clean
            await chrome.storage.local.set({ historyQueue: [] });
            return [];
        }
        if (result.error) console.warn(`[YTM Ward] History cleanup failed: ${result.error}`);

        const removedNow = new Set(result.removed || []);
        const next = [];
        historyQueue.forEach((item, index) => {
            const attempts = item.attempts + 1;
            if (removedNow.has(index)) {
                console.log(`[YTM Ward] 🧹 Removed from history: ${item.title}`);
                // Keep it for one more pass in case YouTube records the play again late
                if (attempts < HISTORY_RETRY_DELAYS.length) next.push({ ...item, attempts, removed: true });
            } else if (item.removed && !result.error) {
                // Confirmed gone
            } else if (attempts < HISTORY_RETRY_DELAYS.length) {
                next.push({ ...item, attempts });
            }
        });
        await chrome.storage.local.set({ historyQueue: next });
        return next;
    });

    if (remaining.length > 0) {
        const minAttempts = Math.min(...remaining.map(i => i.attempts));
        scheduleHistoryProcessing(HISTORY_RETRY_DELAYS[minAttempts]);
    }
}

// --- LIKED SONGS SCAN ---
// Triggered from the popup. Results are stored in chrome.storage.local.likedScan so the
// popup can be closed while a scan runs and still show the results when reopened.

async function scanLikedSongs() {
    await updateBlockList();
    const startedAt = Date.now();
    await chrome.storage.local.set({ likedScan: { status: 'scanning', startedAt, updatedAt: startedAt, scanned: 0 } });

    const result = await callPageBridge('getLikedSongs', {}, 10 * 60 * 1000, scanned => {
        chrome.storage.local.set({ likedScan: { status: 'scanning', startedAt, updatedAt: Date.now(), scanned } });
    });

    if (result.error) {
        const error = result.error === 'signed-out' ? 'Not signed in to YouTube Music' : result.error;
        await chrome.storage.local.set({ likedScan: { status: 'error', error, finishedAt: Date.now() } });
        return { ok: false, error };
    }

    const matches = [];
    for (const song of result.songs || []) {
        const hit = creditedArtistNames(song.linkedArtists, song.artistText, song.title).find(n => aiArtistSet.has(n));
        if (hit) matches.push({ videoId: song.videoId, title: song.title, artist: song.artistText, matched: hit });
    }
    const likedScan = { status: 'done', finishedAt: Date.now(), total: (result.songs || []).length, matches };
    await chrome.storage.local.set({ likedScan });
    console.log(`[YTM Ward] Liked songs scan: ${matches.length} AI songs in ${likedScan.total} liked songs.`);
    return { ok: true };
}

async function removeLikedSongs(videoIds) {
    const result = await callPageBridge('removeLikes', { videoIds }, 10 * 60 * 1000);
    if (result.error) {
        const error = result.error === 'signed-out' ? 'Not signed in to YouTube Music' : result.error;
        return { ok: false, error };
    }

    const removed = new Set(result.removed || []);
    const { likedScan } = await chrome.storage.local.get('likedScan');
    if (likedScan && Array.isArray(likedScan.matches)) {
        likedScan.matches = likedScan.matches.filter(m => !removed.has(m.videoId));
        await chrome.storage.local.set({ likedScan });
    }
    console.log(`[YTM Ward] Removed ${removed.size} AI songs from Liked Music (${(result.failed || []).length} failed).`);
    return { ok: true, removed: removed.size, failed: (result.failed || []).length };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'scanLiked') {
        scanLikedSongs().then(sendResponse, e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    if (msg.type === 'removeLiked') {
        removeLikedSongs(msg.videoIds || []).then(sendResponse, e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
});

// --- UI ---

function createButton(text, onClick) {
    const btn = document.createElement("button");
    btn.innerText = text;
    btn.style.cssText = `
        background: rgba(255, 0, 0, 0.2); border: 1px solid #ff4444; color: #ffcccc;
        border-radius: 4px; margin: 0 5px; padding: 6px 12px; cursor: pointer;
        font-size: 11px; font-weight: 800; text-transform: uppercase; z-index: 9999;
    `;
    btn.onmouseenter = () => { btn.style.background = "#ff4444"; btn.style.color = "black"; };
    btn.onmouseleave = () => { btn.style.background = "rgba(255, 0, 0, 0.2)"; btn.style.color = "#ffcccc"; };
    btn.onclick = (e) => { e.stopPropagation(); onClick(); };
    return btn;
}

function injectButtons() {
    if (document.getElementById("ytm-ward-controls")) return;

    // TARGET: The "3 Dots" Menu
    const threeDots = document.querySelector("ytmusic-player-bar .middle-controls-buttons ytmusic-menu-renderer") ||
                      document.querySelector("ytmusic-player-bar ytmusic-menu-renderer");

    const targetParent = threeDots ? threeDots.parentNode : document.querySelector("ytmusic-player-bar .middle-controls-buttons");

    if (targetParent) {
        const container = document.createElement("div");
        container.id = "ytm-ward-controls";
        container.style.display = "inline-flex";
        container.style.alignItems = "center";

        container.appendChild(createButton("🚫 ARTIST", () => {
            const song = getSongInfo();
            if (song) addToBlockList(song.artist, 'blockedArtists', song);
        }));

        container.appendChild(createButton("🚫 SONG", () => {
            const song = getSongInfo();
            if (song) addToBlockList({ title: song.title, artist: song.artist }, 'blockedTracks', song);
        }));

        if (threeDots && threeDots.nextSibling) {
            targetParent.insertBefore(container, threeDots.nextSibling);
        } else {
            targetParent.appendChild(container);
        }
    }
}

async function addToBlockList(term, listName, song) {
    if (!term) return;
    const targetList = listName || 'blockedArtists';

    const localData = await chrome.storage.local.get([targetList]);
    let list = localData[targetList] || [];

    const exists = list.some(item => {
        if (typeof term === 'string') return item === term;
        return item.title === term.title;
    });

    if (!exists) {
        list.push(term);
        const update = {};
        update[targetList] = list;
        await chrome.storage.local.set(update);
        await updateBlockList();
        blockCurrentSong(song, `manually blocked ${targetList === 'blockedTracks' ? 'song' : 'artist'}`);
    }
}

async function init() {
    const { aiDb } = await chrome.storage.local.get('aiDb');
    if (!aiDb) {
        // First run: ask the background worker to download the AI database now
        chrome.runtime.sendMessage({ type: 'refreshAiDb' }).catch(() => {});
    }

    await updateBlockList();
    const playerBar = await waitForElement("ytmusic-player-bar");
    injectButtons();
    checkAndSkip();

    const observer = new MutationObserver(() => {
        checkAndSkip();
        if (!document.getElementById("ytm-ward-controls")) injectButtons();
    });

    observer.observe(playerBar, { subtree: true, childList: true, attributes: true });

    const titleNode = document.querySelector("ytmusic-player-bar .title");
    if (titleNode) {
        new MutationObserver(() => checkAndSkip())
            .observe(titleNode, { characterData: true, subtree: true, childList: true });
    }

    // Finish removals left over from a previous session
    scheduleHistoryProcessing(5);
}

const BLOCKLIST_KEYS = ['blockedArtists', 'blockedKeywords', 'blockedTracks', 'aiDb', 'aiMinRating'];

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && BLOCKLIST_KEYS.some(k => k in changes)) {
        updateBlockList().then(checkAndSkip);
    }
});
