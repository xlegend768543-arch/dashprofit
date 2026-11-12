import {
  analyzePatterns,
  evaluateOffer,
  getCostPerMile,
} from './calculator.js';
import {
  createSampleOrders,
  exportOrdersToCsv,
  loadOrders,
  loadSettings,
  saveOrders,
  saveSettings,
} from './storage.js';

const state = {
  settings: loadSettings(),
  orders: loadOrders(),
  deadheadMultiplier: 1,
  waitMinutes: 0,
  orderType: 'food',
  lastEvaluation: null,
};

// Elements
const els = {
  headerSubtitle: document.getElementById('header-subtitle'),
  quickResetBtn: document.getElementById('quick-reset-btn'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),

  // Evaluate
  verdictCard: document.getElementById('verdict-card'),
  verdictBadge: document.getElementById('verdict-badge'),
  verdictTitle: document.getElementById('verdict-title'),
  verdictReason: document.getElementById('verdict-reason'),
  scoreValue: document.getElementById('score-value'),
  metricNetHr: document.getElementById('metric-net-hr'),
  metricGrossHr: document.getElementById('metric-gross-hr'),
  metricEffMi: document.getElementById('metric-eff-mi'),
  metricGrossMi: document.getElementById('metric-gross-mi'),
  metricNetProfit: document.getElementById('metric-net-profit'),
  metricCarCost: document.getElementById('metric-car-cost'),
  metricTax: document.getElementById('metric-tax-deduction'),
  metricEffMiles: document.getElementById('metric-eff-miles'),

  inputPayout: document.getElementById('input-payout'),
  inputMiles: document.getElementById('input-miles'),
  inputMinutes: document.getElementById('input-minutes'),
  inputMerchant: document.getElementById('input-merchant'),
  btnVoice: document.getElementById('btn-voice'),
  voiceBtnLabel: document.getElementById('voice-btn-label'),
  voiceTranscript: document.getElementById('voice-transcript'),
  deadheadHint: document.getElementById('deadhead-hint'),
  btnLogPass: document.getElementById('btn-log-pass'),
  btnLogTake: document.getElementById('btn-log-take'),

  // Insights
  kpiNetHr: document.getElementById('kpi-net-hr'),
  kpiTotalNet: document.getElementById('kpi-total-net'),
  kpiAvgMi: document.getElementById('kpi-avg-mi'),
  kpiAcceptRate: document.getElementById('kpi-accept-rate'),
  patternsList: document.getElementById('patterns-list'),
  historyList: document.getElementById('history-list'),
  btnSampleData: document.getElementById('btn-sample-data'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnClearHistory: document.getElementById('btn-clear-history'),

  // Settings
  setMinHr: document.getElementById('set-min-hr'),
  setMinMi: document.getElementById('set-min-mi'),
  setMinPayout: document.getElementById('set-min-payout'),
  setMpg: document.getElementById('set-mpg'),
  setGas: document.getElementById('set-gas'),
  setWear: document.getElementById('set-wear'),
  setIrs: document.getElementById('set-irs'),
  settingsCostSummary: document.getElementById('settings-cost-summary'),

  toast: document.getElementById('toast'),
};

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function switchTab(tabName) {
  els.tabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });

  const subtitles = {
    evaluate: 'Live Offer Evaluator',
    insights: 'Profitability Insights',
    settings: 'Rules & Vehicle Cost',
  };
  els.headerSubtitle.textContent = subtitles[tabName] || 'DashProfit';
  els.quickResetBtn.style.visibility = tabName === 'evaluate' ? 'visible' : 'hidden';

  if (tabName === 'insights') {
    renderInsights();
  }
}

function updateEvaluation() {
  const offer = {
    payout: parseFloat(els.inputPayout.value),
    miles: parseFloat(els.inputMiles.value),
    minutes: parseFloat(els.inputMinutes.value),
    deadheadMultiplier: state.deadheadMultiplier,
    waitMinutes: state.waitMinutes,
    orderType: state.orderType,
  };

  const result = evaluateOffer(offer, state.settings);
  state.lastEvaluation = result;

  els.verdictCard.classList.remove('verdict-take', 'verdict-maybe', 'verdict-pass', 'verdict-neutral');

  if (!result) {
    els.verdictCard.classList.add('verdict-neutral');
    els.verdictBadge.textContent = 'ENTER OFFER';
    els.verdictTitle.textContent = 'Ready to analyze';
    els.verdictReason.textContent = 'Enter payout, miles, and estimated time to see true net profit and hourly rate.';
    els.scoreValue.textContent = '--';
    els.metricNetHr.textContent = '--';
    els.metricGrossHr.textContent = 'Gross: --';
    els.metricEffMi.textContent = '--';
    els.metricGrossMi.textContent = 'Shown: --';
    els.metricNetProfit.textContent = '--';
    els.metricCarCost.textContent = 'Cost: --';
    els.metricTax.textContent = '--';
    els.metricEffMiles.textContent = 'Eff. mi: --';
    els.btnLogPass.disabled = true;
    els.btnLogTake.disabled = true;
    return;
  }

  els.verdictCard.classList.add(`verdict-${result.verdict}`);
  els.verdictBadge.textContent = result.verdictLabel;
  els.verdictTitle.textContent = result.verdictTitle;
  els.verdictReason.textContent = result.reason;
  els.scoreValue.textContent = String(result.score);

  els.metricNetHr.textContent = `$${result.netHourly.toFixed(2)}`;
  els.metricGrossHr.textContent = `Gross: $${result.grossHourly.toFixed(2)}`;
  els.metricEffMi.textContent = `$${result.effectivePerMile.toFixed(2)}`;
  els.metricGrossMi.textContent = `Shown: $${result.grossPerMile.toFixed(2)}`;
  els.metricNetProfit.textContent = `$${result.netProfit.toFixed(2)}`;
  els.metricCarCost.textContent = `Cost: $${result.vehicleCost.toFixed(2)}`;
  els.metricTax.textContent = `$${result.taxDeduction.toFixed(2)}`;
  els.metricEffMiles.textContent = `Eff. mi: ${result.effectiveMiles.toFixed(1)}`;

  els.btnLogPass.disabled = false;
  els.btnLogTake.disabled = false;
}

function resetOfferForm() {
  els.inputPayout.value = '';
  els.inputMiles.value = '';
  els.inputMinutes.value = '';
  els.inputMerchant.value = '';
  state.deadheadMultiplier = 1;
  state.waitMinutes = 0;
  state.orderType = 'food';

  document.querySelectorAll('[data-deadhead]').forEach((b) => {
    b.classList.toggle('active', b.dataset.deadhead === '1');
  });
  document.querySelectorAll('[data-wait]').forEach((b) => {
    b.classList.toggle('active', b.dataset.wait === '0');
  });
  document.querySelectorAll('[data-type]').forEach((b) => {
    b.classList.toggle('active', b.dataset.type === 'food');
  });
  els.deadheadHint.textContent = 'Ends in zone (1.0x mi)';
  updateEvaluation();
}

function parseSpokenOffer(rawText) {
  const text = (rawText || '').toLowerCase();
  const parsed = { payout: null, miles: null, minutes: null, deadhead: null, orderType: null };

  const milesMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi\b)/);
  if (milesMatch) parsed.miles = parseFloat(milesMatch[1]);

  const hrMinMatch = text.match(/(\d+)\s*(?:hours?|hrs?)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m\b)/);
  if (hrMinMatch) {
    parsed.minutes = parseInt(hrMinMatch[1], 10) * 60 + parseInt(hrMinMatch[2], 10);
  } else {
    const minMatch = text.match(/(\d{1,3})\s*(?:minutes?|mins?|min\b)/);
    if (minMatch) parsed.minutes = parseInt(minMatch[1], 10);
  }

  const dollarMatch = text.match(/\$\s*(\d{1,3}(?:\.\d{1,2})?)/);
  const dcMatch = text.match(/(\d{1,3})\s*dollars?(?:\s*(?:and\s*)?(\d{1,2})\s*cents?)?/);
  const firstNumMatch = text.match(/\b(\d{1,3}(?:\.\d{1,2})?)\b(?!\s*(?:miles?|mi\b|minutes?|mins?|min\b|hours?|hrs?))/);

  if (dollarMatch) {
    parsed.payout = parseFloat(dollarMatch[1]);
  } else if (dcMatch) {
    parsed.payout = parseFloat(dcMatch[1]) + (dcMatch[2] ? parseFloat(dcMatch[2]) / 100 : 0);
  } else if (firstNumMatch) {
    parsed.payout = parseFloat(firstNumMatch[1]);
  }

  if (text.includes('round trip')) parsed.deadhead = '2';
  else if (text.includes('edge') || text.includes('out of zone')) parsed.deadhead = '1.5';

  if (text.includes('shop')) parsed.orderType = 'shop';
  else if (text.includes('stack')) parsed.orderType = 'stack';

  return parsed;
}

function applySpokenOffer(parsed) {
  if (parsed.payout !== null) els.inputPayout.value = parsed.payout.toFixed(2);
  if (parsed.miles !== null) els.inputMiles.value = parsed.miles.toFixed(1);
  if (parsed.minutes !== null) els.inputMinutes.value = String(parsed.minutes);

  if (parsed.deadhead) {
    state.deadheadMultiplier = parseFloat(parsed.deadhead);
    document.querySelectorAll('[data-deadhead]').forEach((b) => {
      b.classList.toggle('active', b.dataset.deadhead === parsed.deadhead);
    });
  }
  if (parsed.orderType) {
    state.orderType = parsed.orderType;
    document.querySelectorAll('[data-type]').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === parsed.orderType);
    });
  }
  updateEvaluation();
}

function logDecision(decision) {
  if (!state.lastEvaluation) return;
  const entry = {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    merchant: els.inputMerchant.value.trim() || 'DoorDash Order',
    orderType: state.orderType,
    deadheadMultiplier: state.deadheadMultiplier,
    waitMinutes: state.waitMinutes,
    decision,
    ...state.lastEvaluation,
  };

  state.orders.unshift(entry);
  saveOrders(state.orders);
  showToast(decision === 'take' ? 'Logged as Taken' : 'Logged as Passed');
  resetOfferForm();
}

function renderInsights() {
  const orders = state.orders;
  const taken = orders.filter((o) => o.decision === 'take');

  const totalNet = taken.reduce((sum, o) => sum + o.netProfit, 0);
  const totalMins = taken.reduce((sum, o) => sum + o.effectiveMinutes, 0);
  const totalMiles = taken.reduce((sum, o) => sum + o.effectiveMiles, 0);
  const totalPayout = taken.reduce((sum, o) => sum + o.payout, 0);

  const avgNetHr = totalMins > 0 ? (totalNet / totalMins) * 60 : 0;
  const avgPerMi = totalMiles > 0 ? totalPayout / totalMiles : 0;
  const acceptRate = orders.length > 0 ? Math.round((taken.length / orders.length) * 100) : 0;

  els.kpiNetHr.textContent = `$${avgNetHr.toFixed(2)}`;
  els.kpiTotalNet.textContent = `$${totalNet.toFixed(2)}`;
  els.kpiAvgMi.textContent = `$${avgPerMi.toFixed(2)}`;
  els.kpiAcceptRate.textContent = `${acceptRate}%`;

  // Patterns
  const patterns = analyzePatterns(orders);
  if (patterns.length === 0) {
    els.patternsList.innerHTML =
      '<p class="empty-state">Log at least 2 taken orders (or tap "Load Sample") to see which order types and distances earn you the most.</p>';
  } else {
    const maxHr = Math.max(...patterns.map((p) => p.netHourly), 1);
    els.patternsList.innerHTML = patterns
      .map((p) => {
        const pct = Math.max(8, Math.min(100, Math.round((p.netHourly / maxHr) * 100)));
        return `
          <div class="pattern-row">
            <div class="pattern-meta">
              <span class="pattern-name">${escapeHtml(p.label)} <small>(${p.count})</small></span>
              <span class="pattern-val">$${p.netHourly.toFixed(2)}/hr • $${p.avgPerMile.toFixed(2)}/mi</span>
            </div>
            <div class="pattern-bar-bg">
              <div class="pattern-bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // History
  if (orders.length === 0) {
    els.historyList.innerHTML = '<p class="empty-state">No orders logged yet.</p>';
  } else {
    els.historyList.innerHTML = orders
      .slice(0, 40)
      .map((o) => {
        const timeStr = new Date(o.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const badgeClass = o.decision === 'take' ? 'pill-take' : 'pill-pass';
        const badgeLabel = o.decision === 'take' ? 'TAKEN' : 'PASSED';
        return `
          <div class="history-item">
            <div class="history-left">
              <div class="history-title">
                <span class="pill ${badgeClass}">${badgeLabel}</span>
                <strong>${escapeHtml(o.merchant)}</strong>
              </div>
              <div class="history-sub">
                ${timeStr} • $${o.payout.toFixed(2)} • ${o.shownMiles.toFixed(1)} mi • ${o.effectiveMinutes}m
              </div>
            </div>
            <div class="history-right">
              <strong class="history-hr">$${o.netHourly.toFixed(2)}/hr</strong>
              <button type="button" class="delete-item-btn" data-delete-id="${o.id}" aria-label="Delete order">×</button>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hydrateSettingsInputs() {
  const s = state.settings;
  els.setMinHr.value = s.minNetHourly;
  els.setMinMi.value = s.minPerMile;
  els.setMinPayout.value = s.minPayout;
  els.setMpg.value = s.mpg;
  els.setGas.value = s.gasPrice;
  els.setWear.value = s.wearPerMile;
  els.setIrs.value = s.irsRate;
  updateCostSummary();
}

function updateCostSummary() {
  const cpm = getCostPerMile(state.settings);
  els.settingsCostSummary.innerHTML = `Estimated vehicle cost: <strong>$${cpm.toFixed(2)}/mi</strong>`;
}

function handleSettingsChange() {
  state.settings = {
    minNetHourly: Math.max(1, parseFloat(els.setMinHr.value) || 22),
    minPerMile: Math.max(0.1, parseFloat(els.setMinMi.value) || 1.75),
    minPayout: Math.max(0, parseFloat(els.setMinPayout.value) || 6.5),
    mpg: Math.max(1, parseFloat(els.setMpg.value) || 28),
    gasPrice: Math.max(0, parseFloat(els.setGas.value) || 3.65),
    wearPerMile: Math.max(0, parseFloat(els.setWear.value) || 0.12),
    irsRate: Math.max(0, parseFloat(els.setIrs.value) || 0.70),
  };
  saveSettings(state.settings);
  updateCostSummary();
  updateEvaluation();
}

function bindEvents() {
  // Navigation
  els.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Inputs
  [els.inputPayout, els.inputMiles, els.inputMinutes].forEach((input) => {
    input.addEventListener('input', updateEvaluation);
  });

  // Time presets
  document.querySelectorAll('[data-time]').forEach((chip) => {
    chip.addEventListener('click', () => {
      els.inputMinutes.value = chip.dataset.time;
      updateEvaluation();
    });
  });

  // Deadhead segmented control
  const deadheadHints = {
    '1': 'Ends in zone (1.0x mi)',
    '1.5': 'Partial return (+50% mi)',
    '2': 'Full round trip (2.0x mi)',
  };
  document.querySelectorAll('[data-deadhead]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.deadheadMultiplier = parseFloat(btn.dataset.deadhead);
      document.querySelectorAll('[data-deadhead]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      els.deadheadHint.textContent = deadheadHints[btn.dataset.deadhead] || '';
      updateEvaluation();
    });
  });

  // Wait risk segmented control
  document.querySelectorAll('[data-wait]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.waitMinutes = parseInt(btn.dataset.wait, 10) || 0;
      document.querySelectorAll('[data-wait]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateEvaluation();
    });
  });

  // Order type segmented control
  document.querySelectorAll('[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.orderType = btn.dataset.type;
      document.querySelectorAll('[data-type]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  els.quickResetBtn.addEventListener('click', resetOfferForm);
  els.btnLogTake.addEventListener('click', () => logDecision('take'));
  els.btnLogPass.addEventListener('click', () => logDecision('pass'));

  // One-tap Example Offers
  const examplePresets = {
    chipotle: { payout: '13.50', miles: '4.2', minutes: '21', deadhead: '1', wait: '0', type: 'food', merchant: 'Chipotle' },
    outback: { payout: '12.00', miles: '5.0', minutes: '22', deadhead: '1.5', wait: '5', type: 'food', merchant: 'Outback' },
    popeyes: { payout: '4.50', miles: '6.1', minutes: '24', deadhead: '2', wait: '5', type: 'food', merchant: 'Popeyes' },
    target: { payout: '19.25', miles: '4.8', minutes: '32', deadhead: '1', wait: '0', type: 'shop', merchant: 'Target' },
  };
  document.querySelectorAll('[data-example]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const ex = examplePresets[chip.dataset.example];
      if (!ex) return;
      els.inputPayout.value = ex.payout;
      els.inputMiles.value = ex.miles;
      els.inputMinutes.value = ex.minutes;
      els.inputMerchant.value = ex.merchant;
      state.deadheadMultiplier = parseFloat(ex.deadhead);
      state.waitMinutes = parseInt(ex.wait, 10);
      state.orderType = ex.type;
      document.querySelectorAll('[data-deadhead]').forEach((b) => b.classList.toggle('active', b.dataset.deadhead === ex.deadhead));
      document.querySelectorAll('[data-wait]').forEach((b) => b.classList.toggle('active', b.dataset.wait === ex.wait));
      document.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === ex.type));
      updateEvaluation();
      showToast(`Loaded example: ${ex.merchant}`);
    });
  });

  // Voice Input (Web Speech API — requires HTTPS on iOS Safari)
  let recognition = null;
  let isListening = false;
  els.btnVoice.addEventListener('click', () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast('Voice input requires HTTPS in Safari');
      return;
    }
    if (isListening && recognition) {
      recognition.stop();
      return;
    }
    recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.onstart = () => {
      isListening = true;
      els.btnVoice.classList.add('listening');
      els.voiceBtnLabel.textContent = 'Listening... Tap to Stop';
      els.voiceTranscript.hidden = false;
      els.voiceTranscript.textContent = 'Say payout, miles, and minutes...';
    };
    recognition.onresult = (event) => {
      const text = Array.from(event.results).map((r) => r[0].transcript).join(' ');
      els.voiceTranscript.textContent = `"${text}"`;
      applySpokenOffer(parseSpokenOffer(text));
    };
    recognition.onerror = () => {
      showToast('Microphone unavailable — check Safari permissions');
    };
    recognition.onend = () => {
      isListening = false;
      els.btnVoice.classList.remove('listening');
      els.voiceBtnLabel.textContent = 'Speak Offer (e.g. "$13.50, 4.2 mi, 21 min")';
    };
    recognition.start();
  });

  // Insights actions
  els.btnSampleData.addEventListener('click', () => {
    const samples = createSampleOrders(state.settings);
    state.orders = [...samples, ...state.orders];
    saveOrders(state.orders);
    renderInsights();
    showToast('Added 7 sample orders');
  });

  els.btnExportCsv.addEventListener('click', () => {
    if (state.orders.length === 0) {
      showToast('No orders to export');
      return;
    }
    exportOrdersToCsv(state.orders);
    showToast('Exported CSV');
  });

  els.btnClearHistory.addEventListener('click', () => {
    if (state.orders.length === 0) return;
    state.orders = [];
    saveOrders(state.orders);
    renderInsights();
    showToast('Order log cleared');
  });

  els.historyList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete-id]');
    if (!btn) return;
    const id = btn.dataset.deleteId;
    state.orders = state.orders.filter((o) => o.id !== id);
    saveOrders(state.orders);
    renderInsights();
    showToast('Order removed');
  });

  // Settings inputs
  [
    els.setMinHr,
    els.setMinMi,
    els.setMinPayout,
    els.setMpg,
    els.setGas,
    els.setWear,
    els.setIrs,
  ].forEach((input) => {
    input.addEventListener('input', handleSettingsChange);
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

hydrateSettingsInputs();
bindEvents();
updateEvaluation();
registerServiceWorker();
