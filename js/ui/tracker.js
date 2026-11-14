import {
  computeDailySummary,
  getLocalDateKey,
  isValidGpsSegment,
} from '../calculator.js';
import {
  addManualEntryToRecord,
  applyOdometerToRecord,
  clearLiveSessionDraft,
  emptyDailyRecord,
  loadDailyMileage,
  recoverLiveSessionDraft,
  removeManualEntryById,
  saveDailyMileage,
  saveDailyMileageDebounced,
  saveLiveSessionDraft,
  undoLastManualEntryInRecord,
} from '../storage.js';
import { showToast } from './toast.js';

function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initTrackerController({ state, els, onUseTripMiles, onDataMutated }) {
  let cachedDayBase = null;
  let draftIntervalId = null;
  let shiftIntervalId = null;

  function ensureTodayKey() {
    const currentKey = getLocalDateKey();
    if (currentKey !== state.dailyDateKey) {
      state.dailyDateKey = currentKey;
      state.dailyMileage = loadDailyMileage(currentKey);
      state.dailyDataByDate[currentKey] = state.dailyMileage;
      cachedDayBase = null;
    }
  }

  function invalidateCache() {
    cachedDayBase = null;
  }

  function getCachedDailySummary() {
    ensureTodayKey();
    const gpsTotal = (state.dailyMileage.gpsSavedMiles || 0) + (state.gps.sessionMiles || 0);
    const liveShiftSecs = state.shift.isTiming && state.shift.startedAt
      ? Math.max(0, Math.floor((Date.now() - state.shift.startedAt) / 1000))
      : 0;
    const totalShiftHours = ((state.dailyMileage.shiftSeconds || 0) + liveShiftSecs) / 3600;

    if (!cachedDayBase) {
      cachedDayBase = computeDailySummary({
        orders: state.orders,
        manualEntries: state.dailyMileage.entries,
        gpsMiles: gpsTotal,
        expenses: state.expenses,
        shiftHours: totalShiftHours,
        settings: state.settings,
        dateKey: state.dailyDateKey,
      });
      return cachedDayBase;
    }

    // Fast path for 1Hz / GPS ticks without rescanning all orders/expenses
    const tripMiles = cachedDayBase.tripMiles;
    const manualMiles = cachedDayBase.manualMiles;
    const baseMiles = Math.max(gpsTotal, tripMiles);
    const totalMiles = baseMiles + manualMiles;
    const milesSource = gpsTotal >= tripMiles && gpsTotal > 0 ? 'gps' : 'trips';
    const costPerMile = state.settings.gasPrice / Math.max(1, state.settings.mpg) + state.settings.wearPerMile;
    const vehicleCost = totalMiles * costPerMile;
    const netProfit = cachedDayBase.grossEarnings - vehicleCost - cachedDayBase.otherExpenses;
    const taxDeduction = totalMiles * state.settings.irsRate;
    const totalDeductions = taxDeduction + cachedDayBase.otherExpenses;
    const seBase = Math.max(0, cachedDayBase.grossEarnings - taxDeduction - cachedDayBase.otherExpenses);
    const seTax = seBase * 0.9235 * 0.153;
    const incomeTax = Math.max(0, seBase - seTax / 2) * state.settings.incomeTaxSetAsidePct;
    const setAside = seTax + incomeTax;
    const orderHrs = cachedDayBase.hoursWorked > 0 && ((state.dailyMileage.shiftSeconds || 0) === 0 && !state.shift.isTiming)
      ? cachedDayBase.hoursWorked
      : 0;
    const hoursWorked = totalShiftHours > 0 ? totalShiftHours : orderHrs;
    const netPerHour = hoursWorked > 0 ? netProfit / hoursWorked : 0;
    const goal = state.settings.dailyGoal;
    const goalProgress = goal > 0 ? Math.min(1, Math.max(0, netProfit / goal)) : 0;
    const goalRemaining = goal > 0 ? Math.max(0, goal - netProfit) : 0;

    return {
      ...cachedDayBase,
      gpsMiles: gpsTotal,
      totalMiles,
      milesSource,
      vehicleCost,
      netProfit,
      taxDeduction,
      totalDeductions,
      setAside,
      hoursWorked,
      netPerHour,
      goalProgress,
      goalRemaining,
    };
  }

  function persistDraftNow() {
    if (!state.gps.isTracking && !state.shift.isTiming) {
      clearLiveSessionDraft();
      return;
    }
    saveLiveSessionDraft({
      dateKey: state.dailyDateKey,
      gpsSessionMiles: state.gps.sessionMiles,
      isShiftTiming: state.shift.isTiming,
      shiftStartedAt: state.shift.startedAt,
      updatedAt: Date.now(),
    });
  }

  function renderManualEntriesList() {
    const entries = state.dailyMileage.entries || [];
    els.btnUndoMile.disabled = entries.length === 0;
    if (entries.length === 0) {
      els.manualEntriesList.innerHTML = '<p class="muted-small" style="margin:0;">No manual entries today.</p>';
      return;
    }
    els.manualEntriesList.innerHTML = entries
      .slice()
      .reverse()
      .map((e) => {
        const timeStr = new Date(e.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const kindLabel = e.kind === 'odometer' ? 'Odometer' : e.kind === 'quick' ? 'Quick' : 'Custom';
        return `
          <div class="manual-entry-row">
            <span>+${e.miles.toFixed(1)} mi <small class="muted-small">(${kindLabel} • ${timeStr})</small></span>
            <button type="button" class="delete-item-btn" data-delete-manual-id="${e.id}" aria-label="Delete ${e.miles.toFixed(1)} mile entry">×</button>
          </div>
        `;
      })
      .join('');
  }

  function render() {
    const summary = getCachedDailySummary();
    const netSign = summary.netProfit < 0 ? '-' : '';
    const netAbs = Math.abs(summary.netProfit).toFixed(2);

    els.dailyTotalMiles.textContent = `${summary.totalMiles.toFixed(1)} mi`;
    els.dailyTaxWriteoff.textContent = `$${summary.taxDeduction.toFixed(2)}`;
    els.dailyTaxSetaside.textContent = `Set aside: $${summary.setAside.toFixed(2)}`;
    els.dailyNetProfit.textContent = `${netSign}$${netAbs}`;
    els.dailyNetProfit.classList.toggle('negative-text', summary.netProfit < 0);
    els.dailyNetProfit.classList.toggle('accent-text', summary.netProfit > 0);
    els.dailyNetHr.textContent = `$${summary.netPerHour.toFixed(2)}/hr`;

    const sourceLabel = summary.milesSource === 'gps' ? 'Using GPS miles' : 'Using trip estimates';
    els.dailyMilesSourceSub.textContent = summary.milesSource === 'gps' ? 'GPS active' : 'Trip est.';
    els.dailyBreakdownLine.textContent =
      `${sourceLabel} • Trips: ${summary.tripMiles.toFixed(1)} • GPS: ${summary.gpsMiles.toFixed(1)} • Manual: ${summary.manualMiles.toFixed(1)} mi`;
    els.dailyIrsNote.textContent = `IRS rate: $${summary.irsRate.toFixed(2)}/mi`;

    // Use Trip button
    if (state.gps.isTracking && state.gps.tripMiles >= 0.1) {
      els.btnUseTrip.hidden = false;
      els.btnUseTrip.textContent = `Use Trip (${state.gps.tripMiles.toFixed(1)} mi)`;
    } else {
      els.btnUseTrip.hidden = true;
    }

    // Shift timer button
    if (state.shift.isTiming && state.shift.startedAt) {
      const totalSecs = (state.dailyMileage.shiftSeconds || 0) + Math.floor((Date.now() - state.shift.startedAt) / 1000);
      els.btnShiftToggle.textContent = `Stop ${formatElapsed(totalSecs)}`;
      els.btnShiftToggle.classList.add('active');
      els.btnShiftToggle.setAttribute('aria-pressed', 'true');
    } else {
      els.btnShiftToggle.textContent = state.dailyMileage.shiftSeconds > 0
        ? `Resume (${formatElapsed(state.dailyMileage.shiftSeconds)})`
        : 'Start Shift';
      els.btnShiftToggle.classList.remove('active');
      els.btnShiftToggle.setAttribute('aria-pressed', 'false');
    }

    // Daily goal bar
    if (summary.dailyGoal > 0) {
      els.dailyGoalWrap.hidden = false;
      const pct = Math.round(summary.goalProgress * 100);
      els.dailyGoalLabel.textContent = `Daily Goal ($${summary.dailyGoal.toFixed(0)})`;
      els.dailyGoalStatus.textContent = summary.goalRemaining <= 0
        ? 'Goal hit!'
        : `$${summary.goalRemaining.toFixed(2)} to go`;
      els.dailyGoalStatus.classList.toggle('accent-text', summary.goalRemaining <= 0);
      els.dailyGoalFill.style.width = `${pct}%`;
      els.dailyGoalProgressbar.setAttribute('aria-valuenow', String(pct));
    } else {
      els.dailyGoalWrap.hidden = true;
    }

    if (state.dailyMileage.startOdometer !== null && document.activeElement !== els.inputOdoStart) {
      els.inputOdoStart.value = state.dailyMileage.startOdometer;
    }
    if (state.dailyMileage.endOdometer !== null && document.activeElement !== els.inputOdoEnd) {
      els.inputOdoEnd.value = state.dailyMileage.endOdometer;
    }

    renderManualEntriesList();
  }

  function saveCurrentDay(debounced = false) {
    state.dailyDataByDate[state.dailyDateKey] = state.dailyMileage;
    invalidateCache();
    if (debounced) {
      saveDailyMileageDebounced(state.dailyDateKey, state.dailyMileage);
    } else {
      saveDailyMileage(state.dailyDateKey, state.dailyMileage);
    }
    render();
    onDataMutated();
  }

  function addManualMiles(delta, kind = 'quick') {
    const miles = Number(delta);
    if (!(miles > 0)) return;
    ensureTodayKey();
    state.dailyMileage = addManualEntryToRecord(state.dailyMileage, miles, kind);
    saveCurrentDay(false);
    showToast(els.toast, `Added +${miles.toFixed(1)} mi`, {
      onUndo: () => {
        const { nextRecord } = undoLastManualEntryInRecord(state.dailyMileage);
        state.dailyMileage = nextRecord;
        saveCurrentDay(false);
      },
    });
  }

  function undoLastManual() {
    ensureTodayKey();
    const { nextRecord, removed } = undoLastManualEntryInRecord(state.dailyMileage);
    if (!removed) return;
    state.dailyMileage = nextRecord;
    saveCurrentDay(false);
    showToast(els.toast, `Removed +${removed.miles.toFixed(1)} mi entry`);
  }

  function applyOdometer() {
    const start = parseFloat(els.inputOdoStart.value);
    const end = parseFloat(els.inputOdoEnd.value);
    if (!(start >= 0) || !(end > start)) {
      showToast(els.toast, 'End odometer must be greater than start');
      return;
    }
    ensureTodayKey();
    state.dailyMileage = applyOdometerToRecord(state.dailyMileage, start, end);
    saveCurrentDay(false);
    showToast(els.toast, `Applied ${(end - start).toFixed(1)} mi from odometer`);
  }

  function startShiftTimer() {
    if (state.shift.isTiming) return;
    ensureTodayKey();
    state.shift.isTiming = true;
    state.shift.startedAt = Date.now();
    clearInterval(shiftIntervalId);
    shiftIntervalId = setInterval(render, 1000);
    if (!draftIntervalId) {
      draftIntervalId = setInterval(persistDraftNow, 15000);
    }
    persistDraftNow();
    render();
  }

  function stopShiftTimer() {
    if (!state.shift.isTiming) return;
    ensureTodayKey();
    const elapsed = state.shift.startedAt
      ? Math.max(0, Math.round((Date.now() - state.shift.startedAt) / 1000))
      : 0;
    state.dailyMileage.shiftSeconds = (state.dailyMileage.shiftSeconds || 0) + elapsed;
    state.shift.isTiming = false;
    state.shift.startedAt = null;
    clearInterval(shiftIntervalId);
    shiftIntervalId = null;
    if (!state.gps.isTracking && draftIntervalId) {
      clearInterval(draftIntervalId);
      draftIntervalId = null;
    }
    persistDraftNow();
    saveCurrentDay(false);
  }

  function toggleShiftTimer() {
    if (state.shift.isTiming) {
      stopShiftTimer();
      showToast(els.toast, 'Shift timer paused');
    } else {
      startShiftTimer();
      showToast(els.toast, 'Shift timer started');
    }
  }

  function stopGpsTracking() {
    if (state.gps.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.gps.watchId);
    }
    if (state.gps.sessionMiles > 0) {
      ensureTodayKey();
      state.dailyMileage.gpsSavedMiles =
        (state.dailyMileage.gpsSavedMiles || 0) + state.gps.sessionMiles;
      showToast(els.toast, `Saved ${state.gps.sessionMiles.toFixed(2)} GPS miles`);
    }
    state.gps.isTracking = false;
    state.gps.watchId = null;
    state.gps.sessionMiles = 0;
    state.gps.tripMiles = 0;
    state.gps.lastFix = null;
    if (!state.shift.isTiming && draftIntervalId) {
      clearInterval(draftIntervalId);
      draftIntervalId = null;
    }
    persistDraftNow();
    els.btnGpsToggle.textContent = 'Start GPS';
    els.btnGpsToggle.classList.remove('active');
    els.btnGpsToggle.setAttribute('aria-pressed', 'false');
    els.dailyGpsStatus.textContent = "Today's Mileage & Profit";
    saveCurrentDay(false);
  }

  function toggleGpsTracking() {
    if (state.gps.isTracking) {
      stopGpsTracking();
      return;
    }
    if (!('geolocation' in navigator)) {
      els.gpsErrorMsg.hidden = false;
      els.gpsErrorMsg.textContent = 'GPS is not supported by this browser. Use quick-add or odometer.';
      return;
    }
    els.gpsErrorMsg.hidden = true;
    state.gps.isTracking = true;
    state.gps.sessionMiles = 0;
    state.gps.tripMiles = 0;
    state.gps.lastFix = null;
    els.btnGpsToggle.textContent = 'Stop GPS';
    els.btnGpsToggle.classList.add('active');
    els.btnGpsToggle.setAttribute('aria-pressed', 'true');
    els.dailyGpsStatus.textContent = 'Live GPS Tracking...';

    // Auto-start shift timer when GPS starts
    if (!state.shift.isTiming) {
      startShiftTimer();
    }
    if (!draftIntervalId) {
      draftIntervalId = setInterval(persistDraftNow, 15000);
    }

    state.gps.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const fixTime = pos.timestamp || Date.now();
        if (state.gps.lastFix) {
          const check = isValidGpsSegment({
            prevLat: state.gps.lastFix.latitude,
            prevLon: state.gps.lastFix.longitude,
            prevTime: state.gps.lastFix.time,
            lat: latitude,
            lon: longitude,
            time: fixTime,
            accuracy,
          });
          if (check.valid) {
            state.gps.sessionMiles += check.miles;
            state.gps.tripMiles += check.miles;
            state.gps.lastFix = { latitude, longitude, time: fixTime };
            render();
          }
        } else if (typeof accuracy !== 'number' || accuracy <= 65) {
          state.gps.lastFix = { latitude, longitude, time: fixTime };
        }
      },
      (err) => {
        els.gpsErrorMsg.hidden = false;
        els.gpsErrorMsg.textContent =
          err.code === 1
            ? 'Location permission denied. Enable location or use quick-add / odometer.'
            : `GPS unavailable (${err.message}).`;
        stopGpsTracking();
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
    render();
  }

  function bind() {
    els.btnGpsToggle.addEventListener('click', toggleGpsTracking);
    els.btnShiftToggle.addEventListener('click', toggleShiftTimer);

    document.querySelectorAll('.quick-mile-btn').forEach((btn) => {
      btn.addEventListener('click', () => addManualMiles(parseFloat(btn.dataset.addMiles), 'quick'));
    });

    els.btnUndoMile.addEventListener('click', undoLastManual);

    els.btnUseTrip.addEventListener('click', () => {
      if (state.gps.tripMiles < 0.1) return;
      const used = state.gps.tripMiles;
      state.gps.tripMiles = 0;
      onUseTripMiles(used);
      render();
    });

    els.btnToggleOdo.addEventListener('click', () => {
      const nextHidden = !els.dailyManualDrawer.hidden;
      els.dailyManualDrawer.hidden = nextHidden;
      els.btnToggleOdo.setAttribute('aria-expanded', String(!nextHidden));
    });

    els.btnAddCustomMiles.addEventListener('click', () => {
      const val = parseFloat(els.inputCustomMiles.value);
      if (!(val > 0)) {
        showToast(els.toast, 'Enter miles greater than 0');
        return;
      }
      addManualMiles(val, 'custom');
      els.inputCustomMiles.value = '';
    });

    els.btnApplyOdo.addEventListener('click', applyOdometer);

    els.manualEntriesList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-delete-manual-id]');
      if (!btn) return;
      const id = btn.dataset.deleteManualId;
      state.dailyMileage = removeManualEntryById(state.dailyMileage, id);
      saveCurrentDay(false);
      showToast(els.toast, 'Removed mileage entry');
    });

    els.btnResetDailyMiles.addEventListener('click', () => {
      if (!window.confirm("Reset today's manual and GPS miles?")) return;
      ensureTodayKey();
      const snapshot = JSON.parse(JSON.stringify(state.dailyMileage));
      if (state.gps.isTracking) stopGpsTracking();
      state.dailyMileage = emptyDailyRecord();
      els.inputOdoStart.value = '';
      els.inputOdoEnd.value = '';
      saveCurrentDay(false);
      showToast(els.toast, "Reset today's manual & GPS miles", {
        onUndo: () => {
          state.dailyMileage = snapshot;
          saveCurrentDay(false);
        },
      });
    });

    // Recover interrupted GPS/shift session if present
    const recovered = recoverLiveSessionDraft();
    if (recovered) {
      state.dailyMileage = loadDailyMileage(state.dailyDateKey);
      state.dailyDataByDate[state.dailyDateKey] = state.dailyMileage;
      showToast(els.toast, `Recovered ${recovered.gpsMiles.toFixed(2)} GPS mi from last session`);
    }

    window.addEventListener('pagehide', persistDraftNow);
  }

  return { bind, render, invalidateCache, getCachedDailySummary };
}
