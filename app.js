    // System Defaults (Starts empty)
    const DEFAULTS = {
      schemaVersion: 1,
      trackers: [],
      history: [],
      historyCycles: []
    };

    const STORAGE_KEY = 'ai_quota_pacing_state';
    const STORAGE_KEY_BAK = STORAGE_KEY + '.bak';

    // Per-tracker theme palettes (primary / secondary)
    const COLOR_THEMES = [
      { primary: '#6366f1', secondary: '#4f46e5' },
      { primary: '#06b6d4', secondary: '#3b82f6' },
      { primary: '#a855f7', secondary: '#ec4899' },
      { primary: '#f59e0b', secondary: '#ef4444' },
      { primary: '#10b981', secondary: '#06b6d4' },
      { primary: '#f43f5e', secondary: '#f97316' }
    ];
    let selectedThemeIndex = 0;

    // HTML-escape user-supplied strings before interpolating into markup
    function escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Convert #rrggbb to rgba() string
    function hexToRgba(hex, alpha) {
      const h = hex.replace('#', '');
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Normalize a tracker record (import safety + legacy data)
    function normalizeTracker(raw, index) {
      const direction = raw.trackingDirection === 'down' ? 'down' : 'up';
      const quotaMode = raw.quotaMode === 'credits' ? 'credits' : 'percentage';
      const maxQuota = quotaMode === 'credits'
        ? (parseFloat(raw.maxQuota) > 0 ? parseFloat(raw.maxQuota) : 100)
        : 100;
      let id = String(raw.id || '');
      id = id.replace(/[^a-zA-Z0-9_-]/g, '') || `ai-${Date.now()}-${index}`;
      let resetDay = parseInt(raw.resetDay, 10);
      if (isNaN(resetDay) || resetDay < 0 || resetDay > 6) resetDay = 0;
      let resetDate = parseInt(raw.resetDate, 10);
      if (isNaN(resetDate) || resetDate < 1) resetDate = 1;
      if (resetDate > 31) resetDate = 31;
      let currentPct = parseFloat(raw.currentPct);
      if (isNaN(currentPct)) currentPct = direction === 'down' ? 100 : 0;
      currentPct = Math.min(100, Math.max(0, currentPct));
      let stepValue = parseFloat(raw.stepValue);
      if (isNaN(stepValue) || stepValue <= 0) stepValue = 1;
      return {
        id,
        name: String(raw.name || '').trim() || `AI Tracker ${index + 1}`,
        trackingDirection: direction,
        quotaMode,
        maxQuota,
        currencySymbol: String(raw.currencySymbol !== undefined && raw.currencySymbol !== null ? raw.currencySymbol : '$').trim() || '$',
        resetFreq: raw.resetFreq === 'monthly' ? 'monthly' : 'weekly',
        resetDay,
        resetDate,
        resetTime: /^\d{2}:\d{2}$/.test(String(raw.resetTime || '')) ? String(raw.resetTime) : '00:00',
        useUtc: !!raw.useUtc,
        themeIndex: Math.min(Math.max(parseInt(raw.themeIndex, 10) || 0, 0), COLOR_THEMES.length - 1),
        lastResetTime: raw.lastResetTime ? String(raw.lastResetTime) : null,
        currentPct,
        stepValue
      };
    }

    // Load Database state from localStorage
    let state;
    const loadErr = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.trackers)) {
          // Corrupt / unrecognized schema: keep a backup copy before resetting
          localStorage.setItem(STORAGE_KEY_BAK, raw);
          return 'backup';
        }
        return parsed;
      } catch (e) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) localStorage.setItem(STORAGE_KEY_BAK, raw);
        } catch (e2) { /* ignore */ }
        return 'backup';
      }
    })();

    state = JSON.parse(JSON.stringify(DEFAULTS));
    if (loadErr && loadErr !== 'backup') {
      const parsed = loadErr;
      state.schemaVersion = parsed.schemaVersion || 1;
      state.trackers = (parsed.trackers || []).map(normalizeTracker);
      state.history = Array.isArray(parsed.history) ? parsed.history : [];
      state.historyCycles = Array.isArray(parsed.historyCycles) ? parsed.historyCycles : [];
      // One-time migration: filter out old default preloaded trackers
      state.trackers = state.trackers.filter(t => t.id !== 'gemini-default' && t.id !== 'antigravity-default');
    }
    saveState();

    // App Initialization on DOM Load
    document.addEventListener("DOMContentLoaded", () => {
      try { checkAndArchiveFinishedCycles(); } catch (e) { console.error('Archive check failed:', e); }
      try { renderDashboard(); } catch (e) { console.error('Dashboard render failed:', e); }
      try { renderHistory(); } catch (e) { console.error('History render failed:', e); }
      try { renderPacingCurveChart(); } catch (e) { console.error('Chart render failed:', e); }
      renderThemeSwatches();

      // Flush any pending debounced saves when leaving the page
      window.addEventListener('beforeunload', saveState);

      // Close modal on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAddEditModal();
      });

      // Update UI clock ticks every 1 second
      setInterval(tickClock, 1000);
    });

    // Check if resets occurred and archive completed cycles automatically.
    // Returns true when state was modified.
    function checkAndArchiveFinishedCycles() {
      const now = new Date();
      let stateChanged = false;

      state.trackers.forEach(tracker => {
        try {
          const { lastReset } = calculateExpectedPace(tracker);
          const savedLastResetStr = tracker.lastResetTime;

          if (!savedLastResetStr) {
            // Initialize baseline
            tracker.lastResetTime = lastReset.toISOString();
            stateChanged = true;
            return;
          }

          const savedLastReset = new Date(savedLastResetStr);
          if (isNaN(savedLastReset.getTime())) {
            tracker.lastResetTime = lastReset.toISOString();
            stateChanged = true;
            return;
          }

          // Archive every missed reset, not just the most recent one
          let anchor = savedLastReset;
          let missedCount = 0;
          const missedResets = [];
          let nextResetDate = nextResetOccurrence(tracker, anchor);

          while (nextResetDate.getTime() - anchor.getTime() > 60 * 1000 &&
                 nextResetDate.getTime() <= now.getTime() &&
                 missedCount < 52) {
            missedResets.push(nextResetDate);
            anchor = nextResetDate;
            nextResetDate = nextResetOccurrence(tracker, anchor);
            missedCount++;
          }

          if (missedResets.length > 0) {
            if (!state.historyCycles) state.historyCycles = [];

            // Dedupe against entries already archived (e.g. from another tab)
            missedResets.forEach((cycleEndDate) => {
              const cycleEndStr = cycleEndDate.toISOString();
              const alreadyArchived = state.historyCycles.some(
                h => h.trackerId === tracker.id && h.cycleEnd === cycleEndStr
              );
              if (!alreadyArchived) {
                state.historyCycles.push({
                  trackerId: tracker.id,
                  cycleEnd: cycleEndStr,
                  finalPct: tracker.currentPct
                });
              }
            });

            // Reset the active cycle's usage
            tracker.currentPct = tracker.trackingDirection === 'down' ? 100.0 : 0.0;
            tracker.lastResetTime = lastReset.toISOString();
            stateChanged = true;

            showToast(`New cycle started for ${tracker.name}!`);
          }
        } catch (e) {
          console.error(`Archive check failed for tracker ${tracker.id}:`, e);
        }
      });

      // Cap archived cycle history to bound storage growth
      if (Array.isArray(state.historyCycles) && state.historyCycles.length > 1000) {
        state.historyCycles = state.historyCycles.slice(-1000);
        stateChanged = true;
      }

      if (stateChanged) {
        saveState();
      }
      return stateChanged;
    }

    // Format utility for displaying usage values
    function formatUsageValue(tracker, pct) {
      const mode = tracker ? (tracker.quotaMode || 'percentage') : 'percentage';
      if (mode === 'credits') {
        const symbol = tracker.currencySymbol !== undefined ? tracker.currencySymbol : '$';
        const maxVal = tracker.maxQuota || 100.0;
        const val = (pct / 100) * maxVal;
        return `${symbol}${val.toFixed(2)} (${pct.toFixed(2)}%)`;
      }
      return `${pct.toFixed(2)}%`;
    }

    // Dynamic Dashboard Renderer
    function renderDashboard() {
      const grid = document.getElementById('trackers-grid');
      
      if (state.trackers.length === 0) {
        grid.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">No AI Trackers Configured</div>
            <p style="color: var(--text-muted); font-size: 0.9rem;">Get started by clicking the "Add AI Tracker" button above.</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = '';
      state.trackers.forEach(tracker => {
        const firstLetter = tracker.name.trim().charAt(0).toUpperCase();
        const isCredits = tracker.quotaMode === 'credits';
        const symbol = tracker.currencySymbol !== undefined ? tracker.currencySymbol : '$';
        const displayVal = isCredits ? ((tracker.currentPct / 100) * tracker.maxQuota).toFixed(2) : tracker.currentPct.toFixed(2);
        const maxVal = isCredits ? tracker.maxQuota : 100;
        const stepVal = isCredits ? 0.01 : 0.1;
        const inputLabel = tracker.trackingDirection === 'down'
          ? (isCredits ? `Update Remaining Quota (${symbol})` : 'Update Remaining Quota (%)')
          : (isCredits ? `Update Current Usage (${symbol})` : 'Update Current Usage (%)');
        const escapedName = escapeHtml(tracker.name);
        const theme = COLOR_THEMES[tracker.themeIndex] || COLOR_THEMES[0];

        const card = document.createElement('div');
        card.className = 'glass-card';
        card.id = `card-${tracker.id}`;
        card.style.setProperty('--theme-primary', theme.primary);
        card.style.setProperty('--theme-secondary', theme.secondary);
        card.style.setProperty('--theme-gradient', `linear-gradient(135deg, ${theme.primary} 0%, ${theme.secondary} 100%)`);
        card.style.setProperty('--theme-glow', hexToRgba(theme.primary, 0.15));
        card.style.setProperty('--theme-icon-bg', hexToRgba(theme.primary, 0.1));
        
        card.innerHTML = `
          <div>
            <div class="card-header">
              <div class="card-title">
                <div class="card-icon" style="background: var(--theme-icon-bg); color: var(--theme-primary); box-shadow: 0 0 10px var(--theme-glow);">${escapeHtml(firstLetter)}</div>
                <span title="${escapedName}">${escapedName}</span>
              </div>
              <div class="card-actions">
                <button class="btn-card-action" onclick="openAddEditModal('${tracker.id}')" title="Edit Schedule" aria-label="Edit ${escapedName}">✏️</button>
                <button class="btn-card-action" onclick="deleteTracker('${tracker.id}')" style="color: var(--color-lead-red);" title="Remove AI" aria-label="Delete ${escapedName}">🗑️</button>
              </div>
            </div>
            
            <div class="card-meta">
              <div class="countdown-box" id="${tracker.id}-countdown">
                <span>Reset in:</span>
                <span class="time" id="${tracker.id}-reset-time">--d --h --m</span>
              </div>
            </div>
 
            <div class="card-tabs" style="display: flex; gap: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 1rem; margin-top: 0.5rem;">
              <button class="tab-btn active" onclick="switchCardTab('${tracker.id}', 'current')" id="${tracker.id}-btn-current" style="background: none; border: none; border-bottom: 2px solid var(--theme-primary); color: var(--text-primary); padding: 0.5rem 0; cursor: pointer; font-size: 0.9rem; font-weight: 600; flex: 1;">Current</button>
              <button class="tab-btn" onclick="switchCardTab('${tracker.id}', 'history')" id="${tracker.id}-btn-history" style="background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); padding: 0.5rem 0; cursor: pointer; font-size: 0.9rem; font-weight: 600; flex: 1;">History</button>
            </div>

            <div id="${tracker.id}-content-current">
              <div class="metric-section">
                <div class="pacing-status" id="${tracker.id}-status-label">
                  <span class="status-dot"></span>
                  <span>Calculating...</span>
                </div>
                <div class="deviation-value" id="${tracker.id}-deviation">±0.0%</div>
                <div class="deviation-desc" id="${tracker.id}-desc">Utilization analytics loading...</div>
              </div>
  
              <!-- Visual timeline progress graph -->
              <div class="timeline-visualizer">
                <div class="timeline-labels">
                  <span>Start</span>
                  <span>Reset</span>
                </div>
                <div class="timeline-bar-bg">
                  <div class="timeline-current-fill" id="${tracker.id}-bar-fill"></div>
                  <div class="lag-zone" id="${tracker.id}-lag-zone"></div>
                  <div class="lead-zone" id="${tracker.id}-lead-zone"></div>
                  <div class="timeline-marker" id="${tracker.id}-marker"></div>
                </div>
              </div>
  
              <div class="pct-row">
                <span class="pct-label" id="${tracker.id}-expected-label">Expected Utilization Target:</span>
                <span class="pct-val" id="${tracker.id}-expected-pct">0.0%</span>
              </div>
              <div class="pct-row">
                <span class="pct-label" id="${tracker.id}-current-label">Your Current Usage:</span>
                <span class="pct-val" id="${tracker.id}-current-pct">0.0%</span>
              </div>
              
              <!-- Input Section -->
              <div class="input-section">
                <div class="input-label-container">
                  <span class="input-label">${inputLabel}</span>
                  <input type="number" class="pct-number-input" id="${tracker.id}-num-input" min="0" max="${maxVal}" step="${stepVal}" value="${displayVal}">
                </div>

                <div class="action-btn-container">
                  <button class="btn-action btn-secondary" onclick="adjustPct('${tracker.id}', -1)" aria-label="Decrease usage by step">−</button>
                  <input type="number" class="step-number-input" id="${tracker.id}-step-input" min="0" step="${stepVal}" value="${tracker.stepValue || 1}" title="Increment amount for +/− buttons">
                  <button class="btn-action btn-primary" onclick="logSnapshot('${tracker.id}')" style="flex: 2;">Log Snapshot</button>
                  <button class="btn-action btn-secondary" onclick="adjustPct('${tracker.id}', 1)" aria-label="Increase usage by step">+</button>
                </div>
              </div>
            </div>
            
            <div id="${tracker.id}-content-history" style="display: none; padding-top: 0.5rem; text-align: center;">
              <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1rem;">Past 4 Cycles History</p>
              ${generateHistoryChartSVG(tracker.id)}
            </div>
          </div>
        `;
        
        grid.appendChild(card);
        
        // Dynamically bind Slider and Input Box listeners together
        initInputBinding(tracker.id);
        
        // Refresh specific tracker analytics immediately
        updateTrackerUI(tracker.id);
      });
      
      renderPacingCurveChart();
    }

    // Toggle 4-Week History Chart Collapse
    
    function switchCardTab(id, tab) {
      const btnCurrent = document.getElementById(`${id}-btn-current`);
      const btnHistory = document.getElementById(`${id}-btn-history`);
      const contentCurrent = document.getElementById(`${id}-content-current`);
      const contentHistory = document.getElementById(`${id}-content-history`);
      
      if (tab === 'current') {
        btnCurrent.style.borderBottomColor = 'var(--theme-primary)';
        btnCurrent.style.color = 'var(--text-primary)';
        btnHistory.style.borderBottomColor = 'transparent';
        btnHistory.style.color = 'var(--text-secondary)';
        contentCurrent.style.display = 'block';
        contentHistory.style.display = 'none';
      } else {
        btnHistory.style.borderBottomColor = 'var(--theme-primary)';
        btnHistory.style.color = 'var(--text-primary)';
        btnCurrent.style.borderBottomColor = 'transparent';
        btnCurrent.style.color = 'var(--text-secondary)';
        contentHistory.style.display = 'block';
        contentCurrent.style.display = 'none';
      }
    }

    // Generate custom SVG bar chart showing the last 4 weekly cycles
    function generateHistoryChartSVG(trackerId) {
      const tracker = state.trackers.find(t => t.id === trackerId);
      const isCredits = tracker && tracker.quotaMode === 'credits';
      const symbol = tracker ? (tracker.currencySymbol || '$') : '$';
      const maxQuota = tracker ? (tracker.maxQuota || 100) : 100;

      const trackerHistory = (state.historyCycles || [])
        .filter(h => h.trackerId === trackerId)
        .sort((a, b) => new Date(a.cycleEnd) - new Date(b.cycleEnd));
      
      const last4 = trackerHistory.slice(-4);
      const paddedHistory = [];
      for (let i = 0; i < 4 - last4.length; i++) {
        paddedHistory.push({ placeholder: true, finalPct: 0 });
      }
      paddedHistory.push(...last4);
      
      const svgHeight = 85;
      const svgWidth = 260;
      const barWidth = 32;
      const barSpacing = 28;
      const startX = 24;
      
      const isMonthly = tracker && tracker.resetFreq === 'monthly';
      const cycleUnit = isMonthly ? 'M' : 'Wk';

      // Single filter definition (no duplicate IDs), gradients themed via CSS vars
      const defsHTML = `
        <defs>
          <linearGradient id="bar-grad-${trackerId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="var(--theme-primary)" />
            <stop offset="100%" stop-color="var(--theme-secondary)" />
          </linearGradient>
          <filter id="glow-bar-${trackerId}">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      `;

      let barsHTML = '';
      let labelsHTML = '';
      
      paddedHistory.forEach((item, index) => {
        const x = startX + index * (barWidth + barSpacing);
        const pct = item.finalPct;
        const barHeight = item.placeholder ? 4 : Math.max(4, (pct / 100) * 60);
        const y = svgHeight - 20 - barHeight;
        
        const label = index === 3 ? 'Latest' : `${cycleUnit} -${3 - index}`;
        const barColor = item.placeholder ? 'rgba(255, 255, 255, 0.08)' : `url(#bar-grad-${trackerId})`;
        const rx = 4;
        
        if (item.placeholder) {
          barsHTML += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${rx}" fill="${barColor}" />`;
        } else {
          const displayText = isCredits ? `${symbol}${((pct / 100) * maxQuota).toFixed(2)}` : `${pct.toFixed(2)}%`;
          barsHTML += `
            <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${rx}" fill="${barColor}" stroke="none" filter="url(#glow-bar-${trackerId})" />
            <text x="${x + barWidth/2}" y="${y - 4}" fill="var(--text-secondary)" font-size="9" text-anchor="middle" font-family="Share Tech Mono">${displayText}</text>
          `;
        }
        
        labelsHTML += `
          <text x="${x + barWidth/2}" y="${svgHeight - 4}" fill="var(--text-muted)" font-size="10" text-anchor="middle" font-family="Inter">${label}</text>
        `;
      });
      
      return `
        <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="${svgHeight}" style="overflow: visible;">
          ${defsHTML}
          ${barsHTML}
          ${labelsHTML}
          <line x1="10" y1="${svgHeight - 20}" x2="${svgWidth - 10}" y2="${svgHeight - 20}" stroke="rgba(255, 255, 255, 0.1)" stroke-width="1" />
        </svg>
      `;
    }


    // Helper: Initialize direct numeric text field listeners
    function initInputBinding(id) {
      const numInput = document.getElementById(`${id}-num-input`);
      if (!numInput) return;

      numInput.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        if (val < 0) val = 0;

        const tracker = state.trackers.find(t => t.id === id);
        if (tracker) {
          const maxVal = tracker.quotaMode === 'credits' ? tracker.maxQuota : 100;
          if (val > maxVal) val = maxVal;
          let pct = tracker.quotaMode === 'credits' ? (val / tracker.maxQuota) * 100 : val;
          updateStatePct(id, pct);
        }
      });

      const stepInput = document.getElementById(`${id}-step-input`);
      if (stepInput) {
        stepInput.addEventListener('input', (e) => {
          let val = parseFloat(e.target.value);
          if (isNaN(val) || val <= 0) val = 1;
          const tracker = state.trackers.find(t => t.id === id);
          if (tracker && tracker.stepValue !== val) {
            tracker.stepValue = val;
            clearTimeout(saveDebounceTimers[id]);
            saveDebounceTimers[id] = setTimeout(saveState, 300);
          }
        });
      }
    }

    // Sync the numeric input with the tracker's current value
    function updateNumericInputs(id) {
      const tracker = state.trackers.find(t => t.id === id);
      if (!tracker) return;
      const isCredits = tracker.quotaMode === 'credits';
      const value = isCredits
        ? ((tracker.currentPct / 100) * tracker.maxQuota).toFixed(2)
        : tracker.currentPct.toFixed(2);
      const numInput = document.getElementById(`${id}-num-input`);
      if (numInput && document.activeElement !== numInput) numInput.value = value;
    }

    const saveDebounceTimers = {};

    function updateStatePct(id, val) {
      const tracker = state.trackers.find(t => t.id === id);
      if (tracker) {
        tracker.currentPct = Math.min(100, Math.max(0, val));
        updateNumericInputs(id);
        updateTrackerUI(id);
        clearTimeout(saveDebounceTimers[id]);
        saveDebounceTimers[id] = setTimeout(saveState, 300);
      }
    }

    // Button trigger: increments/decrements tracker usage in display units
    // (percentage points for % mode, currency units for credits mode)
    // Amount is set by the step input between the +/− buttons
    function adjustPct(id, direction) {
      const tracker = state.trackers.find(t => t.id === id);
      if (!tracker) return;

      const stepInput = document.getElementById(`${id}-step-input`);
      let stepDisplay = stepInput ? parseFloat(stepInput.value) : NaN;
      if (isNaN(stepDisplay) || stepDisplay <= 0) stepDisplay = tracker.stepValue > 0 ? tracker.stepValue : 1;
      const deltaDisplay = direction * stepDisplay;

      const isCredits = tracker.quotaMode === 'credits';
      const deltaPct = isCredits ? (deltaDisplay / tracker.maxQuota) * 100 : deltaDisplay;

      let val = tracker.currentPct + deltaPct;
      if (val < 0) val = 0;
      if (val > 100) val = 100;

      tracker.currentPct = val;

      // Update DOM node directly to prevent re-render focus disruption
      updateNumericInputs(id);

      saveState();
      updateTrackerUI(id);
      const displayDelta = isCredits ? `${tracker.currencySymbol || '$'}${Math.abs(deltaDisplay).toFixed(2)}` : `${Math.abs(deltaDisplay)}%`;
      showToast(`Adjusted ${tracker.name} usage by ${deltaPct >= 0 ? '+' : '-'}${displayDelta}`);
    }

    // Clamp a month's reset day to the actual number of days in that month
    function daysInMonth(year, month, useUtc) {
      if (useUtc) {
        return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      }
      return new Date(year, month + 1, 0).getDate();
    }

    // Monthly reset occurrence for a given year/month (handles day 29-31 rollover)
    function monthlyOccurrence(tracker, year, month, useUtc) {
      const [hours, minutes] = (tracker.resetTime || '00:00').split(':').map(Number);
      const resetDate = Math.min(tracker.resetDate || 1, daysInMonth(year, month, useUtc));
      if (useUtc) {
        return new Date(Date.UTC(year, month, resetDate, hours, minutes, 0, 0));
      }
      return new Date(year, month, resetDate, hours, minutes, 0, 0);
    }

    // Next weekly/monthly reset occurrence strictly after a given date
    function nextResetOccurrence(tracker, afterDate) {
      const [hours, minutes] = (tracker.resetTime || '00:00').split(':').map(Number);
      const useUtc = !!tracker.useUtc;

      if (tracker.resetFreq === 'monthly') {
        let candidate = monthlyOccurrence(tracker, afterDate.getUTCFullYear(), afterDate.getUTCMonth(), useUtc);
        if (candidate.getTime() <= afterDate.getTime()) {
          const nextMonth = afterDate.getUTCMonth() + 1;
          candidate = monthlyOccurrence(tracker, afterDate.getUTCFullYear() + Math.floor(nextMonth / 12), nextMonth % 12, useUtc);
        }
        return candidate;
      }

      // Weekly: advance to the configured reset weekday, then past `afterDate` if needed
      let candidate = new Date(afterDate);
      if (useUtc) {
        const dayDiff = (tracker.resetDay - afterDate.getUTCDay() + 7) % 7;
        candidate.setUTCDate(afterDate.getUTCDate() + dayDiff);
        candidate.setUTCHours(hours, minutes, 0, 0);
        if (candidate.getTime() <= afterDate.getTime()) {
          candidate.setUTCDate(candidate.getUTCDate() + 7);
        }
      } else {
        const dayDiff = (tracker.resetDay - afterDate.getDay() + 7) % 7;
        candidate.setDate(afterDate.getDate() + dayDiff);
        candidate.setHours(hours, minutes, 0, 0);
        if (candidate.getTime() <= afterDate.getTime()) {
          candidate.setDate(candidate.getDate() + 7);
        }
      }
      return candidate;
    }

    // Calculation: expected pacing, reset intervals, and countdown values
    function calculateExpectedPace(tracker) {
      const now = new Date();
      const resetFreq = tracker.resetFreq || 'weekly';
      const useUtc = !!tracker.useUtc;

      let lastReset, nextReset;

      if (resetFreq === 'monthly') {
        // Reset for the current month (with day-of-month rollover handling)
        let currentMonthReset = monthlyOccurrence(tracker, now.getUTCFullYear(), now.getUTCMonth(), useUtc);

        if (now.getTime() >= currentMonthReset.getTime()) {
          lastReset = currentMonthReset;
          const nextMonth = now.getUTCMonth() + 1;
          nextReset = monthlyOccurrence(tracker, now.getUTCFullYear() + Math.floor(nextMonth / 12), nextMonth % 12, useUtc);
        } else {
          nextReset = currentMonthReset;
          const prevMonth = now.getUTCMonth() - 1;
          lastReset = monthlyOccurrence(tracker, now.getUTCFullYear() + Math.floor(prevMonth / 12), ((prevMonth % 12) + 12) % 12, useUtc);
        }
      } else {
        const [hours, minutes] = (tracker.resetTime || '00:00').split(':').map(Number);

        if (useUtc) {
          const currentWeekReset = new Date(now);
          const dayDiff = tracker.resetDay - now.getUTCDay();
          currentWeekReset.setUTCDate(now.getUTCDate() + dayDiff);
          currentWeekReset.setUTCHours(hours, minutes, 0, 0);

          if (now.getTime() >= currentWeekReset.getTime()) {
            lastReset = currentWeekReset;
            nextReset = new Date(currentWeekReset);
            nextReset.setUTCDate(currentWeekReset.getUTCDate() + 7);
          } else {
            nextReset = currentWeekReset;
            lastReset = new Date(currentWeekReset);
            lastReset.setUTCDate(currentWeekReset.getUTCDate() - 7);
          }
        } else {
          const currentWeekReset = new Date(now);
          const dayDiff = tracker.resetDay - now.getDay();
          currentWeekReset.setDate(now.getDate() + dayDiff);
          currentWeekReset.setHours(hours, minutes, 0, 0);

          if (now.getTime() >= currentWeekReset.getTime()) {
            lastReset = currentWeekReset;
            nextReset = new Date(currentWeekReset);
            nextReset.setDate(currentWeekReset.getDate() + 7);
          } else {
            nextReset = currentWeekReset;
            lastReset = new Date(currentWeekReset);
            lastReset.setDate(currentWeekReset.getDate() - 7);
          }
        }
      }

      const totalCycleMs = nextReset.getTime() - lastReset.getTime();
      const elapsedMs = now.getTime() - lastReset.getTime();
      let expectedPct = totalCycleMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalCycleMs) * 100)) : 0;
      if (tracker.trackingDirection === 'down') {
        expectedPct = 100 - expectedPct;
      }
      const remainingMs = Math.max(0, nextReset.getTime() - now.getTime());

      return {
        expectedPct,
        remainingMs,
        lastReset,
        nextReset
      };
    }

    // Refresh UI metrics for individual tracker card
    function updateTrackerUI(id) {
      const tracker = state.trackers.find(t => t.id === id);
      if (!tracker) return;
 
      const data = calculateExpectedPace(tracker);
      const current = tracker.currentPct;
      
      const expectedEl = document.getElementById(`${id}-expected-pct`);
      const currentEl = document.getElementById(`${id}-current-pct`);
      const expectedLabelEl = document.getElementById(`${id}-expected-label`);
      const currentLabelEl = document.getElementById(`${id}-current-label`);
      
      if (expectedLabelEl) {
        expectedLabelEl.innerText = tracker.trackingDirection === 'down' 
          ? 'Expected Quota Remaining:' 
          : 'Expected Utilization Target:';
      }
      if (currentLabelEl) {
        currentLabelEl.innerText = tracker.trackingDirection === 'down' 
          ? 'Current Quota Remaining:' 
          : 'Your Current Usage:';
      }
      if (expectedEl) expectedEl.innerText = formatUsageValue(tracker, data.expectedPct);
      if (currentEl) currentEl.innerText = formatUsageValue(tracker, current);
 
      // Set deviation status & labels
      let deviation = current - data.expectedPct;
      if (tracker.trackingDirection === 'down') {
        deviation = data.expectedPct - current;
      }
      // Normalize -0 to 0 for clean display
      if (Math.abs(deviation) < 0.005) deviation = 0;
      const absDeviation = Math.abs(deviation).toFixed(2);
      
      const isCredits = tracker.quotaMode === 'credits';
      const symbol = tracker.currencySymbol !== undefined ? tracker.currencySymbol : '$';
      const maxVal = tracker.maxQuota || 100.0;
      const devVal = (deviation / 100) * maxVal;
      const absDevVal = Math.abs(devVal).toFixed(2);
      
      const devEl = document.getElementById(`${id}-deviation`);
      const statusLabelEl = document.getElementById(`${id}-status-label`);
      const descEl = document.getElementById(`${id}-desc`);
      
      if (devEl && statusLabelEl && descEl) {
        statusLabelEl.className = "pacing-status";
        
        if (deviation > 2.0) {
          devEl.innerText = isCredits ? `+${symbol}${absDevVal}` : `+${absDeviation}%`;
          devEl.style.color = "var(--color-lead-red)";
          statusLabelEl.classList.add("status-lead");
          statusLabelEl.querySelector("span:not(.status-dot)").innerText = "Over Utilization Limit";
          descEl.innerText = isCredits 
            ? `You are running ${symbol}${absDevVal} ahead of the cycle utilization. You may hit your quota limit early.` 
            : `You are running ${absDeviation}% ahead of the cycle utilization. You may hit your quota limit early.`;
        } else if (deviation < -2.0) {
          devEl.innerText = isCredits ? `-${symbol}${absDevVal}` : `-${absDeviation}%`;
          devEl.style.color = "var(--color-lag-amber)";
          statusLabelEl.classList.add("status-lag");
          statusLabelEl.querySelector("span:not(.status-dot)").innerText = "Under Utilization Limit";
          descEl.innerText = isCredits 
            ? `You are ${symbol}${absDevVal} behind the cycle utilization line. You can safely utilize more.` 
            : `You are ${absDeviation}% behind the cycle utilization line. You can safely utilize more.`;
        } else {
          devEl.innerText = isCredits 
            ? (devVal >= 0 ? `+${symbol}${absDevVal}` : `-${symbol}${absDevVal}`)
            : `${deviation >= 0 ? '+' : '-'}${absDeviation}%`;
          devEl.style.color = "var(--color-track-green)";
          statusLabelEl.classList.add("status-track");
          statusLabelEl.querySelector("span:not(.status-dot)").innerText = "Optimal Utilization";
          descEl.innerText = tracker.trackingDirection === 'down'
            ? `Awesome! You are utilizing perfectly to hit 0% remaining right on schedule.`
            : `Awesome! You are utilizing perfectly to hit 100% usage right on schedule.`;
        }
      }
 
      // Update progress bar visuals
      const barFill = document.getElementById(`${id}-bar-fill`);
      const marker = document.getElementById(`${id}-marker`);
      const lagZone = document.getElementById(`${id}-lag-zone`);
      const leadZone = document.getElementById(`${id}-lead-zone`);
 
      if (barFill && marker && lagZone && leadZone) {
        marker.style.left = `${data.expectedPct}%`;
        barFill.style.width = `${current}%`;
 
        const uiDeviation = current - data.expectedPct;
        if (uiDeviation >= 0) {
          if (tracker.trackingDirection === 'down') {
            lagZone.style.width = '0%';
            leadZone.style.backgroundColor = 'var(--color-lag-green)';
            leadZone.style.left = `${data.expectedPct}%`;
            leadZone.style.width = `${uiDeviation}%`;
          } else {
            lagZone.style.width = '0%';
            leadZone.style.backgroundColor = 'var(--color-lead-red)';
            leadZone.style.left = `${data.expectedPct}%`;
            leadZone.style.width = `${uiDeviation}%`;
          }
        } else {
          if (tracker.trackingDirection === 'down') {
            leadZone.style.width = '0%';
            lagZone.style.backgroundColor = 'var(--color-lead-red)';
            lagZone.style.left = `${current}%`;
            lagZone.style.width = `${Math.abs(uiDeviation)}%`;
          } else {
            leadZone.style.width = '0%';
            lagZone.style.backgroundColor = 'var(--color-lag-green)';
            lagZone.style.left = `${current}%`;
            lagZone.style.width = `${Math.abs(uiDeviation)}%`;
          }
        }
      }
 
      // Update countdown display text
      const resetTimeEl = document.getElementById(`${id}-reset-time`);
      if (resetTimeEl) {
        const days = Math.floor(data.remainingMs / (24 * 3600 * 1000));
        const hours = Math.floor((data.remainingMs % (24 * 3600 * 1000)) / (3600 * 1000));
        const minutes = Math.floor((data.remainingMs % (3600 * 1000)) / (60 * 1000));
        const seconds = Math.floor((data.remainingMs % (60 * 1000)) / 1000);
        
        resetTimeEl.innerText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
      }
    }

    // Tick clock updates for all timers
    function tickClock() {
      if (document.hidden) return;

      // Archive any resets that crossed while the tab stayed open
      let changed = false;
      try {
        changed = checkAndArchiveFinishedCycles();
      } catch (e) {
        console.error('Archive check failed during tick:', e);
      }

      state.trackers.forEach(t => {
        updateTrackerUI(t.id);
      });

      if (changed) {
        renderDashboard();
        renderHistory();
        renderPacingCurveChart();
      }
    }

    // Helper to show/hide modal fields based on selected mode
        function toggleModalFreqFields() {
      const freq = document.getElementById('modal-reset-freq').value;
      if (freq === 'monthly') {
        document.getElementById('modal-reset-day-row').style.display = 'none';
        document.getElementById('modal-reset-date-row').style.display = 'block';
      } else {
        document.getElementById('modal-reset-day-row').style.display = 'block';
        document.getElementById('modal-reset-date-row').style.display = 'none';
      }
    }

    function toggleModalQuotaFields() {
      const mode = document.getElementById('modal-quota-mode').value;
      const maxQuotaRow = document.getElementById('modal-max-quota-row');
      const currencyRow = document.getElementById('modal-currency-row');
      if (mode === 'credits') {
        maxQuotaRow.style.display = 'block';
        currencyRow.style.display = 'block';
      } else {
        maxQuotaRow.style.display = 'none';
        currencyRow.style.display = 'none';
      }
    }

    // Render the theme color swatches inside the modal
    function renderThemeSwatches() {
      const container = document.getElementById('modal-theme-swatches');
      if (!container) return;
      container.innerHTML = COLOR_THEMES.map((t, i) =>
        `<div class="color-swatch" data-index="${i}" title="Theme ${i + 1}" role="radio" aria-label="Theme ${i + 1}" tabindex="0" style="background: linear-gradient(135deg, ${t.primary} 0%, ${t.secondary} 100%);"></div>`
      ).join('');
      selectThemeSwatch(selectedThemeIndex, false);
    }

    function selectThemeSwatch(index, announce = true) {
      selectedThemeIndex = index;
      const container = document.getElementById('modal-theme-swatches');
      if (!container) return;
      container.querySelectorAll('.color-swatch').forEach(sw => {
        sw.classList.toggle('selected', parseInt(sw.dataset.index, 10) === index);
      });
      if (announce) showToast(`Theme color ${index + 1} selected`);
    }

    // Trigger: Open Add or Edit Overlay Drawer Modal
    function openAddEditModal(id = null) {
      const modal = document.getElementById('add-edit-modal');
      const form = document.getElementById('tracker-form');
      const modalTitle = document.getElementById('modal-title');
      const submitBtn = document.getElementById('modal-submit-btn');
      
      form.reset();
      
      if (id) {
        // Edit Mode
        const tracker = state.trackers.find(t => t.id === id);
        if (!tracker) return;
        
        modalTitle.innerText = "Edit AI Tracker";
        submitBtn.innerText = "Save Changes";
        document.getElementById('edit-tracker-id').value = id;
        document.getElementById('modal-name').value = tracker.name;
        document.getElementById('modal-tracking-direction').value = tracker.trackingDirection || 'up';
        document.getElementById('modal-reset-freq').value = tracker.resetFreq || 'weekly';
        document.getElementById('modal-reset-day').value = tracker.resetDay;
        document.getElementById('modal-reset-date').value = tracker.resetDate || 1;
        document.getElementById('modal-reset-time').value = tracker.resetTime;
        document.getElementById('modal-utc').checked = tracker.useUtc;
        
        document.getElementById('modal-quota-mode').value = tracker.quotaMode || 'percentage';
        document.getElementById('modal-max-quota').value = tracker.maxQuota || 20.00;
        document.getElementById('modal-currency').value = tracker.currencySymbol !== undefined ? tracker.currencySymbol : '$';
        selectThemeSwatch(tracker.themeIndex || 0, false);
      } else {
        // Create Mode
        modalTitle.innerText = "Add AI Tracker";
        submitBtn.innerText = "Add Tracker";
        document.getElementById('edit-tracker-id').value = '';
        document.getElementById('modal-tracking-direction').value = 'up';
        document.getElementById('modal-reset-freq').value = 'weekly';
        document.getElementById('modal-reset-date').value = '1';
        document.getElementById('modal-quota-mode').value = 'percentage';
        document.getElementById('modal-max-quota').value = '20.00';
        document.getElementById('modal-currency').value = '$';
        selectThemeSwatch(0, false);
      }
      
      toggleModalQuotaFields();
      toggleModalFreqFields();
      modal.classList.add('open');
      // Move focus into the dialog for keyboard users
      document.getElementById('modal-name').focus();
    }

    function closeAddEditModal() {
      document.getElementById('add-edit-modal').classList.remove('open');
    }

    function handleOverlayClick(e) {
      // Close only if click is outside modal-content
      if (e.target.id === 'add-edit-modal') {
        closeAddEditModal();
      }
    }

    // Form Submit Event Handler: Creates or Updates tracker config
    function saveTracker(e) {
      e.preventDefault();
      
      const id = document.getElementById('edit-tracker-id').value;
      const name = document.getElementById('modal-name').value.trim();
      const trackingDirection = document.getElementById('modal-tracking-direction').value;
      const resetFreq = document.getElementById('modal-reset-freq').value;
      const resetDay = parseInt(document.getElementById('modal-reset-day').value);
      const resetDate = parseInt(document.getElementById('modal-reset-date').value) || 1;
      const resetTime = document.getElementById('modal-reset-time').value || "00:00";
      const useUtc = document.getElementById('modal-utc').checked;
      
      const quotaMode = document.getElementById('modal-quota-mode').value;
      const maxQuota = quotaMode === 'credits' ? parseFloat(document.getElementById('modal-max-quota').value) || 20.00 : 100.0;
      const currencySymbol = document.getElementById('modal-currency').value.trim() || '$';

      if (!name) {
        showToast('Tracker name is required.');
        return;
      }

      // Reject duplicate names (case-insensitive, excluding the tracker being edited)
      const duplicate = state.trackers.some(t => t.id !== id && t.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) {
        showToast(`A tracker named "${name}" already exists.`);
        return;
      }

      if (id) {
        // Update existing
        const tracker = state.trackers.find(t => t.id === id);
        if (tracker) {
          tracker.name = name;
          tracker.trackingDirection = trackingDirection;
          tracker.resetFreq = resetFreq;
          tracker.resetDay = resetDay;
          tracker.resetDate = resetDate;
          tracker.resetTime = resetTime;
          tracker.useUtc = useUtc;
          tracker.quotaMode = quotaMode;
          tracker.maxQuota = maxQuota;
          tracker.currencySymbol = currencySymbol;
          tracker.themeIndex = selectedThemeIndex;
          // Re-baseline the saved reset time so schedule edits never trigger
          // a false "cycle completed" archive on the next load
          try {
            const { lastReset } = calculateExpectedPace(tracker);
            tracker.lastResetTime = lastReset.toISOString();
          } catch (err) {
            tracker.lastResetTime = null;
          }
          showToast(`Updated tracker: ${name}`);
        }
      } else {
        // Insert new
        const newTracker = {
          id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          trackingDirection,
          resetFreq,
          resetDay,
          resetDate,
          resetTime,
          useUtc,
          quotaMode,
          maxQuota,
          currencySymbol,
          themeIndex: selectedThemeIndex,
          currentPct: trackingDirection === 'down' ? 100.0 : 0.0,
          stepValue: 1
        };
        state.trackers.push(newTracker);
        showToast(`Added tracker: ${name}`);
      }
      
      saveState();
      closeAddEditModal();
      renderDashboard();
    }

    // Delete tracker configuration card
    function deleteTracker(id) {
      const tracker = state.trackers.find(t => t.id === id);
      if (!tracker) return;
      
      if (confirm(`Are you sure you want to remove the "${tracker.name}" tracker?`)) {
        state.trackers = state.trackers.filter(t => t.id !== id);
        
        // Remove associated history items
        if (state.history) {
          state.history = state.history.filter(h => h.trackerId !== id);
        }
        // Remove associated archived cycle history
        if (state.historyCycles) {
          state.historyCycles = state.historyCycles.filter(h => h.trackerId !== id);
        }
        
        saveState();
        renderDashboard();
        renderHistory();
        showToast(`Removed tracker: ${tracker.name}`);
      }
    }

    // Toggle settings panel visible
    function toggleSettings() {
      const panel = document.getElementById('settings-panel');
      const icon = document.getElementById('settings-btn-icon');
      const text = document.getElementById('settings-btn-text');
      
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        icon.innerText = "✖";
        text.innerText = "Close Options";
      } else {
        icon.innerText = "⚙️";
        text.innerText = "Data Options";
      }
    }

    // Logging Snapshot History
    function logSnapshot(id) {
      const tracker = state.trackers.find(t => t.id === id);
      if (!tracker) return;

      const data = calculateExpectedPace(tracker);
      const current = tracker.currentPct;
      let deviation = current - data.expectedPct;
      if (tracker.trackingDirection === 'down') {
        deviation = data.expectedPct - current;
      }

      const log = {
        id: Date.now(),
        trackerId: tracker.id,
        timestamp: new Date().toISOString(),
        aiName: tracker.name,
        trackingDirection: tracker.trackingDirection,
        currentPct: current,
        expectedPct: data.expectedPct,
        deviation: deviation
      };

      if (!state.history) state.history = [];
      state.history.unshift(log);
      
      // Limit logs capacity
      if (state.history.length > 50) state.history.pop();

      saveState();
      renderHistory();
      renderPacingCurveChart();
      showToast(`Snapshot logged for ${tracker.name}`);
    }

    // Render pacing logs history list
    function renderHistory() {
      const listEl = document.getElementById('history-list');
      
      if (!state.history || state.history.length === 0) {
        listEl.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 2rem;">No logs recorded yet. Tap "Log Snapshot" on your tracker cards to save history.</div>`;
        return;
      }

      let html = '';
      state.history.forEach(item => {
        const tracker = state.trackers.find(t => t.id === item.trackerId);
        const dateStr = new Date(item.timestamp).toLocaleString();
        const paceColor = item.deviation > 2 ? 'var(--color-lead-red)' : item.deviation < -2 ? 'var(--color-lag-amber)' : 'var(--color-track-green)';
        const paceLabel = item.deviation > 2 ? 'Lead' : item.deviation < -2 ? 'Lag' : 'On Track';
        
        // Format deviation and usage depending on tracking mode
        let usageText = '';
        let deviationText = '';
        if (tracker && tracker.quotaMode === 'credits') {
          const symbol = tracker.currencySymbol !== undefined ? tracker.currencySymbol : '$';
          const maxVal = tracker.maxQuota || 100.0;
          const currentVal = (item.currentPct / 100) * maxVal;
          const devVal = (item.deviation / 100) * maxVal;
          usageText = `${symbol}${currentVal.toFixed(2)}`;
          deviationText = devVal >= 0 ? `+${symbol}${devVal.toFixed(2)}` : `-${symbol}${Math.abs(devVal).toFixed(2)}`;
        } else {
          usageText = `${item.currentPct.toFixed(2)}%`;
          deviationText = item.deviation >= 0 ? `+${item.deviation.toFixed(2)}%` : `${item.deviation.toFixed(2)}%`;
        }

        html += `
          <div class="history-item">
            <div class="history-meta">
              <span class="history-label" title="${escapeHtml(item.aiName)}">${escapeHtml(item.aiName)}</span>
              <span class="history-time">${dateStr}</span>
            </div>
            <div class="history-values">
              <span class="history-usage">${usageText}</span>
              <span class="history-pacing" style="color: ${paceColor}; margin-left: 8px;">
                ${paceLabel} (${deviationText})
              </span>
            </div>
          </div>
        `;
      });
      listEl.innerHTML = html;
    }

    // Format utility for x-axis time labels based on reset options
    function formatAxisDate(date, tracker) {
      const d = new Date(date);
      const useUtc = tracker.useUtc;
      
      const hour = useUtc ? d.getUTCHours() : d.getHours();
      const ampm = hour >= 12 ? 'pm' : 'am';
      const displayHour = hour % 12 === 0 ? 12 : hour % 12;
      const displayMinute = (useUtc ? d.getUTCMinutes() : d.getMinutes()).toString().padStart(2, '0');
      const timeStr = `${displayHour}:${displayMinute}${ampm}${useUtc ? ' UTC' : ''}`;
      
      if (tracker.resetFreq === 'monthly') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = useUtc ? months[d.getUTCMonth()] : months[d.getMonth()];
        const day = useUtc ? d.getUTCDate() : d.getDate();
        return `${month} ${day}, ${timeStr}`;
      } else {
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const weekday = useUtc ? weekdays[d.getUTCDay()] : weekdays[d.getDay()];
        return `${weekday} ${timeStr}`;
      }
    }

    // Generate single pacing curve SVG chart
    function generateSinglePacingChartHTML(tracker) {
      const trackerId = tracker.id;
      const isCredits = tracker.quotaMode === 'credits';
      const symbol = tracker.currencySymbol !== undefined ? tracker.currencySymbol : '$';
      const maxQuota = tracker.maxQuota || 100.0;

      const cycleData = calculateExpectedPace(tracker);
      const lastReset = cycleData.lastReset;
      const nextReset = cycleData.nextReset;
      const totalCycleMs = nextReset.getTime() - lastReset.getTime();

      const midCycleMs = lastReset.getTime() + totalCycleMs / 2;
      const midCycleDate = new Date(midCycleMs);

      const startLabel = formatAxisDate(lastReset, tracker);
      const midLabel = formatAxisDate(midCycleDate, tracker);
      const resetLabel = formatAxisDate(nextReset, tracker);

      const logs = (state.history || [])
        .filter(l => l.trackerId === trackerId && new Date(l.timestamp).getTime() >= lastReset.getTime())
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const svgWidth = 480;
      const svgHeight = 180;
      const padding = { top: 15, right: 20, bottom: 25, left: 45 };
      
      const chartWidth = svgWidth - padding.left - padding.right;
      const chartHeight = svgHeight - padding.top - padding.bottom;
      
      // Diagonal ideal pace line
      const diagX1 = padding.left;
      const diagY1 = tracker.trackingDirection === 'down' ? padding.top : padding.top + chartHeight;
      const diagX2 = padding.left + chartWidth;
      const diagY2 = tracker.trackingDirection === 'down' ? padding.top + chartHeight : padding.top;
      
      let pathHTML = '';
      let pointsHTML = '';
      let shadedAreasHTML = '';
      
      const recentLogs = logs.slice(-15);
      
      // Helpers to calculate dynamic positions relative to current cycle
      function getLogXPct(logTimestamp) {
        const logTime = new Date(logTimestamp).getTime();
        const elapsedMs = logTime - lastReset.getTime();
        return Math.min(100, Math.max(0, (elapsedMs / totalCycleMs) * 100));
      }

      function getExpectedPctAt(logTimestamp) {
        const logTime = new Date(logTimestamp).getTime();
        const elapsedMs = logTime - lastReset.getTime();
        let expected = Math.min(100, Math.max(0, (elapsedMs / totalCycleMs) * 100));
        if (tracker.trackingDirection === 'down') {
          expected = 100 - expected;
        }
        return expected;
      }

      if (recentLogs.length > 0) {
        const firstLogElapsed = getLogXPct(recentLogs[0].timestamp);
        if (firstLogElapsed > 0) {
          recentLogs.unshift({ 
            timestamp: lastReset.toISOString(),
            expectedPct: tracker.trackingDirection === 'down' ? 100 : 0, 
            currentPct: tracker.trackingDirection === 'down' ? 100 : 0 
          });
        }
      }
      
      if (recentLogs.length > 0) {
        let pathD = '';
        recentLogs.forEach((log, index) => {
          const xPct = getLogXPct(log.timestamp);
          const yPct = log.currentPct;
          const x = padding.left + (xPct / 100) * chartWidth;
          const y = padding.top + chartHeight - (yPct / 100) * chartHeight;
          
          if (index === 0) {
            pathD += `M ${x} ${y}`;
          } else {
            pathD += ` L ${x} ${y}`;
          }
          
          if (log.id) {
            const pointLabel = isCredits ? `${symbol}${((yPct / 100) * maxQuota).toFixed(2)}` : `${yPct.toFixed(2)}%`;
            pointsHTML += `<circle cx="${x}" cy="${y}" r="4" fill="var(--theme-primary)" stroke="#ffffff" stroke-width="2" filter="url(#glow-${trackerId})" />`;
            pointsHTML += `<text x="${x}" y="${y - 6}" fill="var(--text-secondary)" font-size="8" text-anchor="middle" font-family="Share Tech Mono">${pointLabel}</text>`;
          }
        });
        
        pathHTML = `<path d="${pathD}" fill="none" stroke="var(--theme-primary)" stroke-width="2" />`;
        pathHTML += `
          <defs>
            <linearGradient id="area-green-${trackerId}" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="rgba(34, 197, 94, 0.4)" />
              <stop offset="100%" stop-color="rgba(34, 197, 94, 0.05)" />
            </linearGradient>
            <linearGradient id="area-red-${trackerId}" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="rgba(239, 68, 68, 0.4)" />
              <stop offset="100%" stop-color="rgba(239, 68, 68, 0.05)" />
            </linearGradient>
            <filter id="glow-${trackerId}">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
        `;
        
        // Background fills for Lead/Lag areas
        if (recentLogs.length > 1) {
          for (let i = 1; i < recentLogs.length; i++) {
            const p1 = recentLogs[i - 1];
            const p2 = recentLogs[i];
            
            const xPct1 = getLogXPct(p1.timestamp);
            const xPct2 = getLogXPct(p2.timestamp);
            const x1 = padding.left + (xPct1 / 100) * chartWidth;
            const y1 = padding.top + chartHeight - (p1.currentPct / 100) * chartHeight;
            
            const x2 = padding.left + (xPct2 / 100) * chartWidth;
            const y2 = padding.top + chartHeight - (p2.currentPct / 100) * chartHeight;
            
            const expectedPct1 = getExpectedPctAt(p1.timestamp);
            const expectedPct2 = getExpectedPctAt(p2.timestamp);
            
            let dev1 = p1.currentPct - expectedPct1;
            let dev2 = p2.currentPct - expectedPct2;
            if (tracker.trackingDirection === 'down') {
              dev1 = expectedPct1 - p1.currentPct;
              dev2 = expectedPct2 - p2.currentPct;
            }
            
            const pathSegment = `M ${x1} ${y1} L ${x2} ${y2} L ${x2} ${padding.top + chartHeight} L ${x1} ${padding.top + chartHeight} Z`;
            
            if (dev1 >= 0 && dev2 >= 0) {
              shadedAreasHTML += `<path d="${pathSegment}" fill="url(#area-red-${trackerId})" stroke="none" />`;
            } else if (dev1 <= 0 && dev2 <= 0) {
              shadedAreasHTML += `<path d="${pathSegment}" fill="url(#area-green-${trackerId})" stroke="none" />`;
            } else {
              const avgDev = (dev1 + dev2) / 2;
              const fillColor = avgDev >= 0 ? `url(#area-red-${trackerId})` : `url(#area-green-${trackerId})`;
              shadedAreasHTML += `<path d="${pathSegment}" fill="${fillColor}" stroke="none" />`;
            }
          }
        }
      } else {
        return `
          <div style="background: transparent; border-radius: 12px; padding: 1.25rem; border: 1px dashed rgba(255,255,255,0.06); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 200px;">
            <h4 style="font-family: 'Outfit', sans-serif; margin-bottom: 0.5rem; color: var(--text-primary);">${tracker.name}</h4>
            <p style="color: var(--text-muted); font-size: 0.8rem; text-align: center;">No logs recorded yet. Tap "Log Snapshot" on the card to show utilization curve.</p>
          </div>
        `;
      }
      
      const label100 = isCredits ? `${symbol}${maxQuota.toFixed(0)}` : '100%';
      const label50 = isCredits ? `${symbol}${(maxQuota/2).toFixed(0)}` : '50%';
      const label0 = isCredits ? `${symbol}0` : '0%';

      return `
        <div style="background: transparent; border-radius: 12px; padding: 1.25rem; border: 1px solid rgba(255,255,255,0.04);">
          <h4 style="font-family: 'Outfit', sans-serif; margin-bottom: 0.75rem; color: var(--text-primary); text-align: center;">${tracker.name}</h4>
          <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="100%" style="overflow: visible;">
            <!-- Grid Lines -->
            <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left + chartWidth}" y2="${padding.top}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
            <line x1="${padding.left}" y1="${padding.top + chartHeight/2}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight/2}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
            <line x1="${padding.left + chartWidth/2}" y1="${padding.top}" x2="${padding.left + chartWidth/2}" y2="${padding.top + chartHeight}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />
            
            <!-- Expected linear slope -->
            <line x1="${diagX1}" y1="${diagY1}" x2="${diagX2}" y2="${diagY2}" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1.5" stroke-dasharray="4,4" />
            
            <!-- Axis Labels -->
            <text x="${padding.left - 8}" y="${padding.top + 3}" fill="var(--text-muted)" font-size="8" text-anchor="end" font-family="Share Tech Mono">${label100}</text>
            <text x="${padding.left - 8}" y="${padding.top + chartHeight/2 + 3}" fill="var(--text-muted)" font-size="8" text-anchor="end" font-family="Share Tech Mono">${label50}</text>
            <text x="${padding.left - 8}" y="${padding.top + chartHeight + 3}" fill="var(--text-muted)" font-size="8" text-anchor="end" font-family="Share Tech Mono">${label0}</text>
            
            <text x="${padding.left}" y="${padding.top + chartHeight + 15}" fill="var(--text-muted)" font-size="8" text-anchor="start">${startLabel}</text>
            <text x="${padding.left + chartWidth/2}" y="${padding.top + chartHeight + 15}" fill="var(--text-muted)" font-size="8" text-anchor="middle">${midLabel}</text>
            <text x="${padding.left + chartWidth}" y="${padding.top + chartHeight + 15}" fill="var(--text-muted)" font-size="8" text-anchor="end">${resetLabel}</text>
            
            <!-- Axes Border -->
            <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="rgba(255, 255, 255, 0.1)" stroke-width="1" />
            <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}" stroke="rgba(255, 255, 255, 0.1)" stroke-width="1" />
            
            <!-- Area Fills -->
            ${shadedAreasHTML}
            
            <!-- Actual paths & points -->
            ${pathHTML}
            ${pointsHTML}
          </svg>
        </div>
      `;
    }

    // Render the SVG chart comparing entered logs against the ideal pace line
    function renderPacingCurveChart() {
      const container = document.getElementById('pacing-chart-container');
      if (!container) return;
      
      if (state.trackers.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; width: 100%; padding: 2.5rem 1rem;">No tracker configured. Add an AI Tracker above to start visualization.</div>`;
        return;
      }
      
      let html = '<div class="charts-grid">';
      state.trackers.forEach(tracker => {
        html += generateSinglePacingChartHTML(tracker);
      });
      html += '</div>';
      container.innerHTML = html;
    }

    // DB: Data Management Functions
    function exportData() {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", url);
      downloadAnchor.setAttribute("download", `ai_quota_pacing_backup_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Backup exported successfully!");
    }

    function importData() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = readerEvent => {
          try {
            const parsed = JSON.parse(readerEvent.target.result);
            if (parsed && Array.isArray(parsed.trackers)) {
              // Preserve a safety copy of the current state before overwriting
              try { localStorage.setItem(STORAGE_KEY_BAK, JSON.stringify(state)); } catch (e2) { /* ignore */ }

              const restored = {
                schemaVersion: parsed.schemaVersion || 1,
                trackers: parsed.trackers.map(normalizeTracker),
                history: Array.isArray(parsed.history) ? parsed.history.filter(l => l && l.trackerId) : [],
                historyCycles: Array.isArray(parsed.historyCycles) ? parsed.historyCycles.filter(c => c && c.trackerId) : []
              };
              state = restored;
              saveState();
              renderDashboard();
              renderHistory();
              renderPacingCurveChart();
              showToast("Backup state database restored!");
            } else {
              alert("Error: File contains invalid backup schema.");
            }
          } catch (err) {
            alert("Error parsing file structure. Make sure you load a valid JSON state backup.");
          }
        }
        reader.readAsText(file);
      }
      input.click();
    }

    function resetToFactoryDefaults() {
      if (confirm("Are you sure you want to clear your local database? All current percentages, custom AI trackers, and log histories will be deleted.")) {
        state = JSON.parse(JSON.stringify(DEFAULTS));
        saveState();
        renderDashboard();
        renderHistory();
        renderPacingCurveChart();
        showToast("State database cleared & reset to defaults.");
      }
    }

    function saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        // Storage quota exceeded / private mode: warn instead of crashing the app
        console.warn('Could not persist state to localStorage:', e);
      }
    }

    // Toast Feedback popup system
    function showToast(message) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast toast-success';
      const icon = document.createElement('span');
      icon.textContent = '✔️';
      const text = document.createElement('span');
      text.textContent = message;
      text.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      toast.appendChild(icon);
      toast.appendChild(text);
      
      container.appendChild(toast);
      
      setTimeout(() => {
        toast.classList.add('show');
      }, 50);

      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          toast.remove();
        }, 300);
      }, 3000);
    }
