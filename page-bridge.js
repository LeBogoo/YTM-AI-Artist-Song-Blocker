/*
 * YTM Ward - Page Bridge (runs in the page's MAIN world)
 * The isolated content script cannot see YouTube Music's `ytcfg` or the player object,
 * so this script performs the InnerTube API calls needed to remove songs from the
 * listening history. It talks to content.js via window.postMessage.
 */
(() => {
    const ORIGIN = location.origin;
    const FROM_CONTENT = 'ytm-ward-content';
    const FROM_PAGE = 'ytm-ward-page';

    const norm = s => (s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

    function cfg(key) {
        const yt = window.ytcfg;
        if (!yt) return undefined;
        if (typeof yt.get === 'function') return yt.get(key);
        return yt.data_ ? yt.data_[key] : undefined;
    }

    function getCookie(name) {
        for (const part of document.cookie.split('; ')) {
            const eq = part.indexOf('=');
            if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
        }
        return null;
    }

    async function sha1Hex(str) {
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Same Authorization scheme YouTube's own web client uses for signed-in requests.
    async function authHeader() {
        const ts = Math.floor(Date.now() / 1000);
        const parts = [];
        for (const [cookie, label] of [
            ['SAPISID', 'SAPISIDHASH'],
            ['__Secure-1PAPISID', 'SAPISID1PHASH'],
            ['__Secure-3PAPISID', 'SAPISID3PHASH'],
        ]) {
            const value = getCookie(cookie);
            if (value) parts.push(`${label} ${ts}_${await sha1Hex(`${ts} ${value} ${ORIGIN}`)}`);
        }
        return parts.join(' ');
    }

    async function innertube(endpoint, body, extraParams = '') {
        const auth = await authHeader();
        if (!auth) throw new Error('signed-out');
        const context = cfg('INNERTUBE_CONTEXT');
        if (!context) throw new Error('ytcfg not ready');

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': auth,
            'X-Origin': ORIGIN,
            'X-Goog-AuthUser': String(cfg('SESSION_INDEX') ?? 0),
            'X-Youtube-Client-Name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') ?? 67),
            'X-Youtube-Client-Version': String(cfg('INNERTUBE_CLIENT_VERSION') ?? context.client?.clientVersion ?? ''),
        };
        const visitor = cfg('VISITOR_DATA');
        if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
        const pageId = cfg('DELEGATED_SESSION_ID'); // brand accounts
        if (pageId) headers['X-Goog-PageId'] = pageId;

        const key = cfg('INNERTUBE_API_KEY');
        const url = `${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false${key ? `&key=${encodeURIComponent(key)}` : ''}${extraParams}`;
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ context, ...body }),
        });
        if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
        return res.json();
    }

    function runsText(column) {
        const runs = column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        return runs.map(r => r.text).join('');
    }

    function findVideoId(node) {
        if (!node || typeof node !== 'object') return null;
        if (typeof node.videoId === 'string') return node.videoId;
        for (const v of Object.values(node)) {
            const id = findVideoId(v);
            if (id) return id;
        }
        return null;
    }

    function removeToken(item) {
        const services = (item.menu?.menuRenderer?.items || [])
            .map(mi => mi.menuServiceItemRenderer)
            .filter(r => r?.serviceEndpoint?.feedbackEndpoint?.feedbackToken);
        const explicit = services.find(r => r.icon?.iconType === 'REMOVE_FROM_HISTORY');
        if (explicit) return explicit.serviceEndpoint.feedbackEndpoint.feedbackToken;
        // History rows only carry one plain feedback action ("Remove from history").
        // Library add/remove lives in toggleMenuServiceItemRenderer and is never used here.
        return services.length === 1 ? services[0].serviceEndpoint.feedbackEndpoint.feedbackToken : null;
    }

    function collectHistoryEntries(node, out = []) {
        if (Array.isArray(node)) {
            for (const n of node) collectHistoryEntries(n, out);
        } else if (node && typeof node === 'object') {
            const item = node.musicResponsiveListItemRenderer;
            if (item) {
                const token = removeToken(item);
                if (token) {
                    out.push({
                        videoId: item.playlistItemData?.videoId || findVideoId(item.overlay) || findVideoId(item.flexColumns),
                        title: runsText(item.flexColumns?.[0]),
                        artist: runsText(item.flexColumns?.[1]),
                        token,
                    });
                }
            } else {
                for (const v of Object.values(node)) collectHistoryEntries(v, out);
            }
        }
        return out;
    }

    function entryMatches(entry, item) {
        if (item.videoId) return entry.videoId === item.videoId;
        // No video ID captured: fall back to title + primary artist
        const primaryArtist = norm((item.artist || '').split('•')[0]);
        return norm(entry.title) === norm(item.title) &&
               (!primaryArtist || norm(entry.artist).includes(primaryArtist));
    }

    function findKey(node, key) {
        if (!node || typeof node !== 'object') return null;
        if (!Array.isArray(node) && node[key]) return node[key];
        for (const v of Object.values(node)) {
            const found = findKey(v, key);
            if (found) return found;
        }
        return null;
    }

    function collectListItems(node, out = []) {
        if (Array.isArray(node)) {
            for (const n of node) collectListItems(n, out);
        } else if (node && typeof node === 'object') {
            if (node.musicResponsiveListItemRenderer) out.push(node.musicResponsiveListItemRenderer);
            else for (const v of Object.values(node)) collectListItems(v, out);
        }
        return out;
    }

    function findContinuation(node) {
        const command = findKey(node, 'continuationCommand');
        if (command && command.token) return { kind: 'command', token: command.token };
        const next = findKey(node, 'nextContinuationData');
        if (next && next.continuation) return { kind: 'next', token: next.continuation };
        return null;
    }

    function parseLikedItem(item) {
        const videoId = item.playlistItemData?.videoId || findVideoId(item.overlay) || findVideoId(item.flexColumns);
        if (!videoId) return null;
        const artistRuns = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        return {
            videoId,
            title: runsText(item.flexColumns?.[0]),
            artistText: artistRuns.map(r => r.text).join(''),
            linkedArtists: artistRuns
                .filter(r => (r.navigationEndpoint?.browseEndpoint?.browseId || '').startsWith('UC'))
                .map(r => r.text),
        };
    }

    const handlers = {
        // Returns the video ID of the track currently loaded in the player,
        // but only if it still matches the title the content script saw.
        getVideoId({ title }) {
            const data = document.getElementById('movie_player')?.getVideoData?.();
            if (!data || !data.video_id) return { videoId: null };
            if (title && data.title && norm(data.title) !== norm(title)) return { videoId: null };
            return { videoId: data.video_id };
        },

        // items: [{ videoId, title, artist }]. Returns indices of items that were removed.
        async removeFromHistory({ items }) {
            const history = await innertube('browse', { browseId: 'FEmusic_history' });
            const entries = collectHistoryEntries(history);

            const tokens = [];
            const tokenOwner = [];
            items.forEach((item, index) => {
                for (const entry of entries) {
                    if (entryMatches(entry, item)) {
                        tokens.push(entry.token);
                        tokenOwner.push(index);
                    }
                }
            });
            if (tokens.length === 0) return { removed: [], scanned: entries.length };

            const res = await innertube('feedback', { feedbackTokens: tokens });
            const responses = res.feedbackResponses || [];
            const removed = new Set();
            const failed = new Set();
            tokenOwner.forEach((index, i) => {
                (responses[i]?.isProcessed ? removed : failed).add(index);
            });
            return { removed: [...removed].filter(i => !failed.has(i)), scanned: entries.length };
        },

        // Walks the whole "Liked Music" playlist (LM), following continuations.
        async getLikedSongs(_, progress) {
            const MAX_PAGES = 300;
            const songs = [];
            const seen = new Set();

            const addItems = items => {
                let added = 0;
                for (const item of items) {
                    const song = parseLikedItem(item);
                    if (song && !seen.has(song.videoId)) {
                        seen.add(song.videoId);
                        songs.push(song);
                        added++;
                    }
                }
                return added;
            };

            const first = await innertube('browse', { browseId: 'VLLM' });
            // Only look inside the playlist shelf so suggestion rows are never included
            const shelf = findKey(first, 'musicPlaylistShelfRenderer') || first;
            addItems(collectListItems(shelf));
            progress(songs.length);
            let continuation = findContinuation(shelf);

            for (let page = 0; continuation && page < MAX_PAGES; page++) {
                const res = continuation.kind === 'command'
                    ? await innertube('browse', { continuation: continuation.token })
                    : await innertube('browse', {}, `&ctoken=${encodeURIComponent(continuation.token)}&continuation=${encodeURIComponent(continuation.token)}&type=next`);
                if (addItems(collectListItems(res)) === 0) break;
                progress(songs.length);
                continuation = findContinuation(res);
            }
            return { songs };
        },

        // Un-likes the given songs (same as clicking the active thumbs-up again).
        async removeLikes({ videoIds }) {
            const removed = [];
            const failed = [];
            for (const videoId of videoIds || []) {
                try {
                    await innertube('like/removelike', { target: { videoId } });
                    removed.push(videoId);
                } catch (err) {
                    if (err.message === 'signed-out') throw err;
                    failed.push(videoId);
                }
            }
            return { removed, failed };
        },
    };

    window.addEventListener('message', async event => {
        if (event.source !== window || !event.data || event.data.source !== FROM_CONTENT) return;
        const { id, op, payload } = event.data;
        let result;
        try {
            if (!handlers[op]) throw new Error(`unknown op ${op}`);
            const progress = value => window.postMessage({ source: FROM_PAGE, id, progress: value }, ORIGIN);
            result = await handlers[op](payload || {}, progress);
        } catch (err) {
            result = { error: err.message };
        }
        window.postMessage({ source: FROM_PAGE, id, result }, ORIGIN);
    });
})();
