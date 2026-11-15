New in V1.5

AI database switched from Soul Over AI to [Zoundhub](https://zoundhub.com) (9,000+ artists, adjustable rating threshold)

Blocked songs are removed from your YouTube Music listening history, not just skipped

Liked Songs cleanup: scan your Liked Music for AI artists and remove the ones you pick

New in V1.3

Automated down voting (thumbs down) when an AI song is detected

UI Overhaul

Alphabetical sorting of block lists



# YTM-AI-Artist-Song-Blocker
A chrome extension that automatically blocks AI artists in YouTube Music and allows you to manually block artists, songs and keywords.

# YTM Artist & Song Blocker

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Privacy First](https://img.shields.io/badge/Privacy-Local%20Storage%20Only-green)](#-privacy-policy)
[![Zoundhub](https://img.shields.io/badge/Powered%20by-Zoundhub-ff4e45)](https://zoundhub.com)

**The missing "Block" button for YouTube Music.**

**YTM Artist & Song Blocker** restores your sovereignty over your audio environment. It acts as a ruthless digital gatekeeper, monitoring your playback and instantly incinerating any content that matches your personal blacklist. 

Whether you need to silence a specific artist, remove low-effort AI tracks, or filter out annoying "Sped Up" versions, this extension handles it automatically.

---

## 🚫 Key Features

### 1. Integrated Control
Adds discreet **🚫 Artist** and **🚫 Song** buttons directly into the YouTube Music player bar. One click adds the current track to your blacklist without opening any menus.

### 2. The Zoundhub Integration
The algorithm is increasingly polluted with "AI slop"—mass-produced, soulless noise designed to game the system.
* **Automated Shield:** This extension uses the [Zoundhub](https://zoundhub.com) artist database, which collects signals of AI-generated music (SubmitHub analysis, Deezer AI labels, release patterns) for thousands of artists.
* **Adjustable Strictness:** Every artist has a rating from 1 to 5. By default artists rated **4 or 5** (the ones Zoundhub flags as AI) are blocked. You can change the threshold in the **AI DB** tab.
* **Auto-Sync:** A background service worker refreshes `artists-all.json` every hour (unchanged files are not re-downloaded) and keeps a local copy.
* **Exact Artist Matching:** AI artists are matched against each credited artist of a track, so an AI artist called "Nova" does not block a song titled "Supernova".

### 3. History Cleanup
Skipping alone still leaves the track in your listening history, where it keeps feeding recommendations. Every blocked song (AI database or your own lists) is now **disliked, skipped and removed from your YouTube Music history**. Removal retries for a few minutes in case YouTube records the play late, and pending removals survive a page reload.

### 4. Liked Songs Cleanup
The **Liked** tab scans your entire Liked Music playlist against the AI database. It lists every match (title, artist and which AI artist matched), all ticked by default. Untick anything you want to keep, then click **🗑 Remove Selected** to un-like those songs. Nothing is removed until you click that button. YouTube Music has to be open and signed in in a tab, and you can close the popup while a scan runs.

### 5. Precision Blocking
* **Smart Artist Matching:** Uses intelligent tokenization. Blocking "Prince" will **not** accidentally block "Princess Nokia."
* **Specific Songs:** Blocks specific tracks by checking both the **Title** and the **Artist**. Covers of the same song by other artists will still play.

### 6. Keyword Filtering
Create custom rules to skip tracks based on title keywords.
* *Examples:* Automatically skip anything containing "Sped Up", "Nightcore", "Commentary", or "Live at".

### 7. Privacy First Architecture
* **Local Storage Only:** Your data belongs to you. All blocklists are stored locally on your device using `chrome.storage.local`.
* **No Tracking:** No external servers, no analytics, no accounts required.

---

## 📦 Installation

### Option A: Chrome Web Store
*(Link pending publication)*

### Option B: Developer Mode (Load Unpacked)
1. Download or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** in the top right corner.
4. Click **Load unpacked**.
5. Select the folder containing the extension files.

---

## 🛠️ Usage

### Blocking Content
* **From the Player:** Click the `🚫 Artist` or `🚫 Song` buttons injected into the player bar.
* **From the Popup:** Click the extension icon to manually add Keywords, Artists, or specific Songs.

### Managing the AI Blocklist
1. Open the extension popup.
2. Click the **AI DB** tab.
3. Pick the minimum rating to block (default: 4+, flagged as AI).
4. Click **↻ Reload DB** to manually force a sync.
5. The counter shows how many AI artists are currently being blocked.

### Cleaning Up Liked Songs
1. Open music.youtube.com in a tab (signed in).
2. Open the extension popup and click the **Liked** tab.
3. Click **🔍 Scan Liked Songs** and wait for the results.
4. Untick any songs you want to keep, then click **🗑 Remove Selected**.

### Backup & Restore
You can export your curated blocklist to a JSON file with **⬇ Export JSON**, and restore it with **⬆ Import JSON** (or drop the file onto that button). This allows you to back up your hard work or transfer your list to another computer.

---

## 🔒 Privacy Policy

**1. Data Collection**
This extension does NOT collect, transmit, store, or sell any user data to external servers.

**2. Data Storage**
All data (blocked artists, songs, and keywords) is stored locally on your device.

**3. Permissions**
* `storage`: Used to save your blocklist and a local copy of the AI database.
* `alarms`: Used to refresh the AI database once an hour.
* `music.youtube.com`: Used to read the current song title/artist, to remove blocked songs from your YouTube Music history, and to scan and un-like AI songs in your Liked Music (requests go only to YouTube Music, using your existing session).
* `zoundhub.com`: Used strictly to fetch the public `artists-all.json` file.

---

## 🤝 Credits
* **AI Database:** [Zoundhub](https://zoundhub.com) by [xoundbyte](https://github.com/xoundbyte/zoundhub) (formerly [Soul Over AI](https://github.com/xoundbyte/soul-over-ai))
