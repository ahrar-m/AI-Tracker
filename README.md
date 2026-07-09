# AI Quota Pacing Tracker

A standalone, visually stunning HTML5 dashboard to track weekly usage limits and pacing for any AI system. It calculates real-time consumption progress, highlights whether you are leading or lagging the ideal linear pacing target, and displays a countdown to your next quota resets.

## Features

- **Generic & Extensible**: Add, edit, and remove as many AI trackers as you want (e.g. Gemini, ChatGPT, Claude Pro, Antigravity, etc.).
- **Mobile First UX**: Fully optimized for mobile screens with touch-friendly sliders, wrapped adjust button grids, and a slide-up settings drawer (bottom sheet) for mobile devices.
- **Pacing Engine**: Instantly computes your "expected" usage percentage based on the exact day and time of your weekly reset.
- **Lead/Lag Analysis**: Compares your actual usage against the target, warning you if you are pacing too fast (risk of running out early) or lagging (under-utilizing and wasting quota).
- **Interactive Timeline Visualizer**: A beautiful custom-colored progress bar showing your current usage, target marker, and the pacing gap.
- **Independent Configuration**: Set unique reset days, times, and timezones (Local vs. UTC) for each tracker.
- **Color Themes**: Pick from multiple vibrant color presets (Cyan, Purple, Indigo, Emerald, Lime, Gold, Orange, Rose, Fuchsia, Carbon Black, Mono White) matching the branding of major AI services.
- **Snapshot Logging**: Track your pacing history over time and save logs locally.
- **No Dependencies**: 100% self-contained HTML/CSS/JavaScript. It requires no installations, runs completely offline, and stores data privately in browser LocalStorage.
- **Backup & Restore**: Export or import database states easily.

## How to Use

1. Simply open [index.html](file:///storage/emulated/0/Documents/Antigravity/AI-Tracker/index.html) in any modern web browser.
2. Tap **Add AI Tracker** to register a new service, choosing its name, reset day/time, timezone, and color accent.
3. Use the edit (✏️) and delete (🗑️) icons on any card to update or remove trackers.
4. Update your current usage slider (or number input) to analyze your pacing lead/lag.
5. Tap **Log Snapshot** to record your progress or **Sync Expected** to match the target pacing instantly.
6. Open the **Data Options** panel to export/import backups or clear the database.
