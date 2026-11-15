/*
 * YTM Ward - Background Service Worker
 * Keeps a local copy of the Zoundhub AI artist database in chrome.storage.local.
 * Fetching here (instead of in the content script) avoids CORS issues and means the
 * ~3 MB file is downloaded once per refresh, not on every YouTube Music page load.
 */

const AI_DB_URL = 'https://zoundhub.com/data/artists-all.json';
const REFRESH_ALARM = 'refresh-ai-db';
const REFRESH_MINUTES = 60;

let inflight = null;

async function fetchAiDb() {
    // 'no-cache' revalidates with the server's ETag, so an unchanged file costs a 304.
    const res = await fetch(AI_DB_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const etag = res.headers.get('etag') || null;
    const stored = await chrome.storage.local.get(['aiDb']);
    if (etag && stored.aiDb && stored.aiDb.etag === etag) {
        await chrome.storage.local.set({ aiDbCheckedAt: Date.now() });
        return stored.aiDb;
    }

    const data = await res.json();
    const list = Array.isArray(data) ? data : data && data.artists;
    if (!Array.isArray(list)) throw new Error('Unexpected database format');

    // Keep only what the blocker needs: [name, rating]
    const artists = list
        .filter(a => a && typeof a.name === 'string' && a.name.trim())
        .map(a => [a.name.trim(), Number(a.rating) || 0]);
    if (artists.length === 0) throw new Error('Database is empty');

    const aiDb = { etag, fetchedAt: Date.now(), artists };
    await chrome.storage.local.set({ aiDb, aiDbCheckedAt: Date.now() });
    console.log(`[YTM Ward] AI database updated: ${artists.length} artists.`);
    return aiDb;
}

function refreshAiDb() {
    if (!inflight) inflight = fetchAiDb().finally(() => { inflight = null; });
    return inflight;
}

function ensureAlarm() {
    chrome.alarms.get(REFRESH_ALARM, alarm => {
        if (!alarm) chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
    });
}

chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm();
    refreshAiDb().catch(e => console.warn('[YTM Ward] AI database refresh failed:', e.message));
});

chrome.runtime.onStartup.addListener(() => {
    ensureAlarm();
    refreshAiDb().catch(e => console.warn('[YTM Ward] AI database refresh failed:', e.message));
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === REFRESH_ALARM) {
        refreshAiDb().catch(e => console.warn('[YTM Ward] AI database refresh failed:', e.message));
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'refreshAiDb') {
        refreshAiDb()
            .then(db => sendResponse({ ok: true, total: db.artists.length, fetchedAt: db.fetchedAt }))
            .catch(e => sendResponse({ ok: false, error: e.message }));
        return true; // async response
    }
});
