# AI Quota Pacing Tracker

A standalone, visually stunning HTML5 dashboard to track weekly usage limits and pacing for any AI system. It calculates real-time consumption progress, highlights whether you are leading or lagging the ideal linear pacing target, and displays a countdown to your next quota resets.

## Features

- **Generic & Extensible**: Add, edit, and remove as many AI trackers as you want (e.g. Gemini, ChatGPT, Claude Pro, Antigravity, etc.).
- **Mobile First UX**: Fully optimized for mobile screens with touch-friendly sliders, wrapped adjust button grids, and a slide-up settings drawer (bottom sheet) for mobile devices.
- **Pacing Engine**: Instantly computes your "expected" usage percentage based on the exact day and time of your weekly reset.
- **Lead/Lag Analysis**: Compares your actual usage against the target. Shows a green lag buffer zone if you are under budget, and a red lead zone if you are over-consuming.
- **Interactive Timeline Visualizer**: A beautiful custom-colored progress bar showing your current usage, expected target marker, and the budget gap.
- **4-Week Cycle History**: Automatically stores previous weeks' final usage and displays a clean SVG bar chart for the last four completed cycles.
- **Automatic Reset Archiving**: Detects when a weekly reset occurs, archives the final percentage of the completed week, and resets the active cycle's usage to 0.0%.
- **Unified Indigo Aesthetic**: Features a clean, unified dark design with high-visibility indigo styling and ambient glow effects.
- **Independent Configuration**: Set unique reset days, times, and timezones (Local vs. UTC) for each tracker.
- **No Dependencies**: 100% self-contained HTML/CSS/JavaScript. It requires no installations, runs completely offline, and stores data privately in browser LocalStorage.
- **Backup & Restore**: Export or import database states easily.

## How to Use

1. Simply open [index.html](file:///storage/emulated/0/Documents/Antigravity/AI-Tracker/index.html) in any modern web browser.
2. Tap **Add AI Tracker** to register a new service, choosing its name, reset day/time, and timezone.
3. Use the edit (✏️) and delete (🗑️) icons on any card to update or remove trackers.
4. Update your current usage slider (or number input) to analyze your pacing lead/lag.
5. Tap **Log Snapshot** to record a custom snapshot of your pacing logs.
6. Expand **View 4-Week History** at the bottom of any card to inspect your previous week cycles' usage.
7. Open the **Data Options** panel to export/import backups or clear the database.
