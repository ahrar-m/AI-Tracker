# AI Quota Utilization Tracker

A standalone, visually stunning HTML5 dashboard to track weekly and monthly usage limits for any AI system. It calculates real-time consumption progress, highlights whether you are leading or lagging the ideal linear utilization target, and displays a countdown to your next quota resets.

## Features

- **Generic & Extensible**: Add, edit, and remove as many AI trackers as you want (e.g. Gemini, ChatGPT, Claude Pro, Antigravity, etc.).
- **Weekly & Monthly Limits**: Supports both weekly and monthly recurring credit/percentage reset cycles.
- **Mobile First UX**: Fully optimized for mobile screens with touch-friendly sliders, wrapped adjust button grids, and a slide-up settings drawer. Full zooming is supported for detailed chart inspection.
- **Utilization Engine**: Instantly computes your "expected" usage percentage based on the exact day and time of your cycle reset. Values are tracked with precise two-decimal accuracy.
- **Lead/Lag Analysis**: Compares your actual usage against the target. Shows a green buffer zone if you are under budget, and a red lead zone if you are over-consuming.
- **Interactive Timeline Visualizer**: A beautiful custom-colored progress bar showing your current usage, expected target marker, and the budget gap.
- **Utilization Curve Charts**: A specialized visualization linking your log snapshots directly to the x-axis with green/red shaded gradient areas to illustrate utilization clearly over time.
- **Tabbed Interface**: Instantly switch between "Current" utilization and your "History" (a clean SVG bar chart of the last four completed cycles) seamlessly on each card.
- **Automatic Reset Archiving**: Detects when a weekly or monthly reset occurs, archives the final percentage of the completed cycle, and resets the active cycle's usage to 0.00%.
- **No Dependencies**: 100% self-contained HTML/CSS/JavaScript. It requires no installations, runs completely offline, and stores data privately in browser LocalStorage.
- **Backup & Restore**: Export or import database states easily.

## How to Use

1. Simply open [index.html](file:///storage/emulated/0/Documents/Antigravity/AI-Tracker/index.html) in any modern web browser.
2. Tap **Add AI Tracker** to register a new service, choosing its name, tracking mode (Credits or Percentage), reset frequency (Weekly or Monthly), reset day/time, and timezone.
3. Use the edit (✏️) and delete (🗑️) icons on any card to update or remove trackers.
4. Update your current usage slider (or number input) to analyze your utilization lead/lag.
5. Tap **Log Snapshot** to record a custom snapshot of your utilization logs.
6. Switch to the **History** tab on any card to inspect your previous cycles' usage.
7. Open the **Data Options** panel to export/import backups or clear the database.
