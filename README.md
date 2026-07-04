<div align="center">

# SyncTax Desktop

### An elegant, hybrid music player for the modern desktop
Built with Electron and React • Offline & Online Playback • Ad-Free Streaming

</div>

---

## 🎯 What is SyncTax Desktop?

**SyncTax Desktop** is a beautiful, modern media player that merges local file organization with online streaming. 

Originally built on top of the elegant offline music player **Nora**, SyncTax Desktop extends the application into a dual-purpose player. It gives you full control over your local library while introducing seamless, ad-free online music searches and playback without the need to download or store files locally.

---

## ✨ Features

### 📁 Legacy (Offline Library Management)
SyncTax Desktop inherits the robust core capabilities of local library playbacks:
* **Library Organization**: Manage songs, artists, albums, and custom playlists.
* **Metadata Editor**: Conveniently update song tags directly within the app.
* **Lyrics Syncing**: View and synchronize offline lyrics.
* **Last.FM Integration**: Scrobble tracks automatically to track your listening history.
* **Mini-Player**: Compact player overlay for distraction-free listening.

### 🌐 New Additions (Online Streaming & Reliability)
We have added features to turn the player into a hybrid streaming platform:
* **Ad-Free Online Streaming**: Search and stream millions of tracks on-demand without commercial interruptions.
* **Smart Up-Next Recommendations**: Automatically queue similar tracks based on your currently playing online song.
* **Premium OS Media Integration**: Correct application naming ("SyncTax Desktop") and artwork rendering in the Windows System Media Transport Controls (SMTC). 
* **Pre-fetched Artwork Buffers**: Online artwork is fetched on the backend and fed locally to the system media integration to bypass browser Content Security Policies (CSP) and ensure thumbnails render correctly.
* **yt-dlp Startup Guard**: Prevents playback startup error popups (like media format errors) by skipping online song restoration on start if the streaming binary is not yet installed.
* **Silent Update Checker**: Background updater checks are completely silent during application startup, saving popup notifications only for manual checks.

---

## 📥 Download & Installation

SyncTax Desktop is ready to use and doesn't require any command-line setup or building from source.

1. Head over to our **[Releases](https://github.com/krit-vardhan-mishra/SyncTax-Desktop/releases)** page on GitHub.
2. Select and download the latest package matching your operating system (e.g., `.exe` for Windows).
3. Run the installer to set up and launch the application on your device.

---

## 📸 Gallery & Screenshots

Here is a preview of the clean, beautiful user interface:
![Support for Online and Offline Lyrics](/resources/other/artwork%201.webp)

![Switch between Dark and Light Modes](/resources/other/artwork%202.webp)

![Support for Last.FM Scrobbling](/resources/other/artwork%209.webp)

![Organize your music library with ease](/resources/other/artwork%203.webp)

![See how your favorite artists appear on songs and albums](/resources/other/artwork%204.webp)

![Keep your favorites closer to you](/resources/other/artwork%205.webp)

![Search through your music library easily and efficiently](/resources/other/artwork%206.webp)

![Edit song metadata and organize your library](/resources/other/artwork%207.webp)

![Listen with the mini player](/resources/other/artwork%208.webp)

---

## 🔗 Credits & Attribution

SyncTax Desktop is built as a customized, extended fork of the excellent open-source project **[Nora](https://github.com/Sandakan/Nora)** created by **[Sandakan Nipunajith](https://github.com/Sandakan)**. 

We are deeply grateful to Sandakan and all contributors of the original repository for creating the clean, elegant foundation of this media player.
