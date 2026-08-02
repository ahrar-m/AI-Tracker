# AI Quota Utilization Tracker

A standalone, visually stunning HTML5 dashboard to track weekly and monthly usage limits for any AI system. It calculates real-time consumption progress, highlights whether you are leading or lagging the ideal linear utilization target, and displays a live countdown to your next quota resets.

## Features

- **Generic & Extensible**: Add, edit, and remove as many AI trackers as you want (e.g. Gemini, ChatGPT, Claude Pro, Antigravity, etc.).
- **Bi-Directional Pacing**: Fully supports both **Count-Up** (0% to 100% usage tracking) and **Count-Down** (100% to 0% remaining quota tracking) models with dynamic card labels (e.g., "Expected Quota Remaining" vs "Expected Utilization Target") and automatically inverted lead/lag color-coding.
- **Weekly & Monthly Limits**: Supports both weekly and monthly recurring credit/percentage reset cycles, including month-end clamping for reset dates 29–31.
- **Mobile First UX**: Fully optimized for mobile screens with touch-friendly controls, a usage slider with linked number input, quick −/+ adjust buttons, and a slide-up settings drawer. Full zooming is supported for detailed chart inspection.
- **Utilization Engine**: Instantly computes your "expected" usage percentage based on the exact day and time of your cycle reset. Values are tracked with precise two-decimal accuracy.
- **Lead/Lag Analysis**: Compares your actual usage against the target. Shows a red lead zone if you are over-consuming, and a green/amber buffer zone if you are under budget.
- **Interactive Timeline Visualizer**: A beautiful custom-colored progress bar showing your current usage, expected target marker, and the budget gap.
- **Dynamic Time Axis Charts**: Pacing curve charts dynamically calculate and render x-axis timestamps based on the active cycle's start and end times, supporting local and UTC formats. Plot points adapt in real-time if reset options are modified mid-cycle.
- **Tabbed Interface**: Instantly switch between "Current" utilization and your "History" (a clean SVG bar chart of the last four completed cycles) seamlessly on each card.
- **Per-Tracker Themes**: Each tracker can be assigned its own accent color (indigo, cyan, purple, amber, emerald, or rose) applied across the card, timeline, and history charts.
- **Automatic Reset Archiving**: Detects weekly or monthly resets — even while the tab stays open — archives the final percentage of every completed cycle (including cycles missed while the app was closed), and resets the active cycle's usage to 100.00% (or 0.00%). Archived entries are deduplicated across tabs.
- **No Dependencies**: 100% self-contained HTML/CSS/JavaScript. It requires no installations and stores data privately in browser LocalStorage. (Note: the Google Fonts are fetched from the network when online; the app falls back to system fonts otherwise.)
- **Backup & Restore**: Export or import database states easily. A safety copy of your previous state is kept before any restore or corrupt-state recovery.

## How to Use

1. Simply open [AI Tracker.html](file:///storage/emulated/0/Documents/Antigravity/AI-Tracker/AI%20Tracker.html) in any modern web browser.
2. Tap **Add AI Tracker** to register a new service, choosing its name, tracking mode (Credits or Percentage), reset frequency (Weekly or Monthly), reset day/time, timezone, and theme color.
3. Use the edit (✏️) and delete (🗑️) icons on any card to update or remove trackers.
4. Update your current usage via the slider, the number input, or the −/+ buttons to analyze your utilization lead/lag.
5. Tap **Log Snapshot** to record a custom snapshot of your utilization logs.
6. Switch to the **History** tab on any card to inspect your previous cycles' usage.
7. Open the **Data Options** panel to export/import backups or clear the database.

## Implementation Notes

- All user-supplied text (tracker names, log entries) is HTML-escaped before rendering.
- State is versioned with a `schemaVersion` field; imports are validated and normalized per tracker.
- Cycle archives are capped at 1000 entries total; snapshot logs at 50.
