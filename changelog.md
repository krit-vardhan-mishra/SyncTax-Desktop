# Changelog

## v4.0.0-alpha.4 - The New Beginning (SyncTax Desktop Rebirth)
*July 4, 2026*

This release marks the official transition of the application from SyncTax Desktop to **SyncTax Desktop**—reborn as a premium, hybrid desktop player that integrates local audio libraries with online streaming capabilities.

---

### Major Highlights

* **Rebranding to SyncTax Desktop**: Renamed product configurations, titles, tray settings, and metadata to align with the SyncTax Android music player.
* **Premium Custom Theme**: Updated the core HSL color system to use a vibrant crimson-red primary accent and deep charcoal-gray panel surfaces.
* **Redesigned Selection States**: Selected sidebar routes, filter chips, and currently playing song items display in red text for enhanced contrast and premium look.
* **Distinguished Error Handling**: Restart buttons for application errors now use red borders and distinct background colors for high contrast and accessibility.
* **Ad-Free Online Audio Streaming**: Seamlessly search and stream millions of tracks on-demand directly via YouTube Music APIs.
* **Windows SMTC Artwork Buffering**: Online track thumbnails are pre-fetched on the main process and fed locally, bypassing Content Security Policy (CSP) fetch restrictions and fixing missing Windows OS media control artwork.
* **Silent Auto-Updates**: Silent update checks during app launch to avoid annoying popup notifications on start.
* **yt-dlp Startup Guard**: Added safety checks to prevent format error crashes when restoring online tracks on first-run.
