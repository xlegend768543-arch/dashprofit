import { getLocalDateKey } from './calculator.js';
import {
  loadAllDailyMileage,
  loadDailyMileage,
  loadExpenses,
  loadOrders,
  loadSettings,
} from './storage.js';
import { initEvaluateController } from './ui/evaluate.js';
import { initInsightsController } from './ui/insights.js';
import { initSettingsController } from './ui/settings.js';
import { initTrackerController } from './ui/tracker.js';

const todayKey = getLocalDateKey();
const allDaily = loadAllDailyMileage();

const state = {
  settings: loadSettings(),
  orders: loadOrders(),
  expenses: loadExpenses(),
  dailyDateKey: todayKey,
  dailyDataByDate: allDaily,
  dailyMileage: allDaily[todayKey] || loadDailyMileage(todayKey),
  periodRange: 'today',
  gps: {
    isTracking: false,
    sessionMiles: 0,
    tripMiles: 0,
    watchId: null,
    lastFix: null,
  },
  shift: {
    isTiming: false,
    startedAt: null,
  },
  deadheadMultiplier: 1,
  waitMinutes: 0,
  orderType: 'food',
  lastEvaluation: null,
};

const els = {
  headerSubtitle: document.getElementById('header-subtitle'),
  quickResetBtn: document.getElementById('quick-reset-btn'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),

  // Tracker
  dailyGpsStatus: document.getElementById('daily-gps-status'),
  dailyBreakdownLine: document.getElementById('daily-breakdown-line'),
  btnShiftToggle: document.getElementById('btn-shift-toggle'),
  btnGpsToggle: document.getElementById('btn-gps-toggle'),
  dailyTotalMiles: document.getElementById('daily-total-miles'),
  dailyMilesSourceSub: document.getElementById('daily-miles-source-sub'),
  dailyTaxWriteoff: document.getElementById('daily-tax-writeoff'),
  dailyTaxSetaside: document.getElementById('daily-tax-setaside'),
  dailyNetProfit: document.getElementById('daily-net-profit'),
  dailyNetHr: document.getElementById('daily-net-hr'),
  dailyGoalWrap: document.getElementById('daily-goal-wrap'),
  dailyGoalLabel: document.getElementById('daily-goal-label'),
  dailyGoalStatus: document.getElementById('daily-goal-status'),
  dailyGoalProgressbar: document.getElementById('daily-goal-progressbar'),
  dailyGoalFill: document.getElementById('daily-goal-fill'),
  btnUndoMile: document.getElementById('btn-undo-mile'),
  btnUseTrip: document.getElementById('btn-use-trip'),
  btnToggleOdo: document.getElementById('btn-toggle-odo'),
  dailyManualDrawer: document.getElementById('daily-manual-drawer'),
  inputCustomMiles: document.getElementById('input-custom-miles'),
  btnAddCustomMiles: document.getElementById('btn-add-custom-miles'),
  inputOdoStart: document.getElementById('input-odo-start'),
  inputOdoEnd: document.getElementById('input-odo-end'),
  btnApplyOdo: document.getElementById('btn-apply-odo'),
  manualEntriesList: document.getElementById('manual-entries-list'),
  dailyIrsNote: document.getElementById('daily-irs-note'),
  btnResetDailyMiles: document.getElementById('btn-reset-daily-miles'),
  gpsErrorMsg: document.getElementById('gps-error-msg'),

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
  insightsIrsBadge: document.getElementById('insights-irs-badge'),
  insightsTodayMiles: document.getElementById('insights-today-miles'),
  insightsTodayTax: document.getElementById('insights-today-tax'),
  insightsTodayNet: document.getElementById('insights-today-net'),
  insightsTodayNetHr: document.getElementById('insights-today-net-hr'),
  insightsTodaySetaside: document.getElementById('insights-today-setaside'),
  insightsTodayGrossCost: document.getElementById('insights-today-gross-cost'),
  insightsTodayBreakdown: document.getElementById('insights-today-breakdown'),
  btnExportMileageCsv: document.getElementById('btn-export-mileage-csv'),
  btnExportExpensesCsv: document.getElementById('btn-export-expenses-csv'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  inputExpenseAmount: document.getElementById('input-expense-amount'),
  inputExpenseCategory: document.getElementById('input-expense-category'),
  inputExpenseNote: document.getElementById('input-expense-note'),
  btnAddExpense: document.getElementById('btn-add-expense'),
  btnClearExpenses: document.getElementById('btn-clear-expenses'),
  expensesList: document.getElementById('expenses-list'),
  kpiNetHr: document.getElementById('kpi-net-hr'),
  kpiTotalNet: document.getElementById('kpi-total-net'),
  kpiAvgMi: document.getElementById('kpi-avg-mi'),
  kpiAcceptRate: document.getElementById('kpi-accept-rate'),
  patternsList: document.getElementById('patterns-list'),
  historyList: document.getElementById('history-list'),
  btnSampleData: document.getElementById('btn-sample-data'),
  btnRemoveSamples: document.getElementById('btn-remove-samples'),
  btnClearHistory: document.getElementById('btn-clear-history'),

  // Settings
  setMinHr: document.getElementById('set-min-hr'),
  setMinMi: document.getElementById('set-min-mi'),
  setMinPayout: document.getElementById('set-min-payout'),
  setDailyGoal: document.getElementById('set-daily-goal'),
  setMpg: document.getElementById('set-mpg'),
  setGas: document.getElementById('set-gas'),
  setWear: document.getElementById('set-wear'),
  setIrs: document.getElementById('set-irs'),
  setTaxPct: document.getElementById('set-tax-pct'),
  settingsCostSummary: document.getElementById('settings-cost-summary'),

  toast: document.getElementById('toast'),
};

let activeTab = 'evaluate';
let tracker;
let evaluate;
let insights;
let settings;

function switchTab(tabName) {
  activeTab = tabName;
  els.tabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });

  const subtitles = {
    evaluate: 'Live Offer Evaluator',
    insights: 'Profitability & Tax Insights',
    settings: 'Rules, Goals & Vehicle Cost',
  };
  els.headerSubtitle.textContent = subtitles[tabName] || 'DashProfit';
  els.quickResetBtn.style.visibility = tabName === 'evaluate' ? 'visible' : 'hidden';

  if (tabName === 'insights') {
    insights.render();
  } else if (tabName === 'settings') {
    settings.hydrateInputs();
  }
}

tracker = initTrackerController({
  state,
  els,
  onUseTripMiles: (miles) => evaluate.useTripMiles(miles),
  onDataMutated: () => {
    if (activeTab === 'insights') insights.renderPeriodSummary();
  },
});

evaluate = initEvaluateController({
  state,
  els,
  onOrdersMutated: () => {
    tracker.invalidateCache();
    tracker.render();
    if (activeTab === 'insights') insights.render();
  },
});

insights = initInsightsController({
  state,
  els,
  onDataMutated: () => {
    tracker.invalidateCache();
    tracker.render();
  },
});

settings = initSettingsController({
  state,
  els,
  onSettingsChanged: () => {
    tracker.invalidateCache();
    evaluate.updateEvaluation();
    tracker.render();
    if (activeTab === 'insights') insights.render();
  },
});

els.tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

tracker.bind();
evaluate.bind();
insights.bind();
settings.bind();

evaluate.updateEvaluation();
tracker.render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
