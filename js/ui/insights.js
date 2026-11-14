import { analyzePatterns, computePeriodSummary } from '../calculator.js';
import {
  createSampleOrders,
  exportExpensesToCsv,
  exportMileageLogToCsv,
  exportOrdersToCsv,
  saveExpenses,
  saveOrders,
} from '../storage.js';
import { showToast } from './toast.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initInsightsController({ state, els, onDataMutated }) {
  function renderPeriodSummary() {
    const liveShiftHours = state.shift.isTiming && state.shift.startedAt
      ? Math.max(0, (Date.now() - state.shift.startedAt) / 3600000)
      : 0;

    const sum = computePeriodSummary({
      orders: state.orders,
      dailyDataByDate: state.dailyDataByDate,
      expenses: state.expenses,
      settings: state.settings,
      range: state.periodRange,
      liveGpsMiles: state.gps.sessionMiles || 0,
      liveShiftHours,
    });

    const netSign = sum.netProfit < 0 ? '-' : '';
    const netAbs = Math.abs(sum.netProfit).toFixed(2);
    const sourceLabel = sum.milesSource === 'gps' ? 'Using GPS miles' : 'Using trip estimates';

    els.insightsIrsBadge.textContent = `@ $${sum.irsRate.toFixed(2)}/mi`;
    els.insightsTodayMiles.textContent = `${sum.totalMiles.toFixed(1)} mi`;
    els.insightsTodayTax.textContent = `$${sum.totalDeductions.toFixed(2)}`;
    els.insightsTodayNet.textContent = `${netSign}$${netAbs}`;
    els.insightsTodayNet.classList.toggle('negative-text', sum.netProfit < 0);
    els.insightsTodayNet.classList.toggle('accent-text', sum.netProfit > 0);
    els.insightsTodayNetHr.textContent = `$${sum.netPerHour.toFixed(2)}/hr`;
    els.insightsTodaySetaside.textContent = `$${sum.setAside.toFixed(2)}`;
    els.insightsTodayGrossCost.textContent =
      `$${sum.grossEarnings.toFixed(0)} / -$${(sum.vehicleCost + sum.otherExpenses).toFixed(2)}`;
    els.insightsTodayBreakdown.textContent =
      `${sourceLabel} • Trips (${sum.ordersCount}): ${sum.tripMiles.toFixed(1)} mi • GPS: ${sum.gpsMiles.toFixed(1)} mi • Manual: ${sum.manualMiles.toFixed(1)} mi • Other exp: $${sum.otherExpenses.toFixed(2)}`;
  }

  function renderExpenses() {
    if (state.expenses.length === 0) {
      els.expensesList.innerHTML = '<p class="empty-state">No extra expenses logged yet.</p>';
      return;
    }
    els.expensesList.innerHTML = state.expenses
      .slice(0, 30)
      .map((e) => {
        const dateStr = new Date(e.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
        const notePart = e.note ? ` • ${escapeHtml(e.note)}` : '';
        return `
          <div class="history-item">
            <div class="history-left">
              <div class="history-title">
                <span class="pill pill-sample">${escapeHtml(e.category)}</span>
                <strong>$${Number(e.amount).toFixed(2)}</strong>
              </div>
              <div class="history-sub">${dateStr}${notePart}</div>
            </div>
            <div class="history-right">
              <button type="button" class="delete-item-btn" data-delete-expense-id="${e.id}" aria-label="Delete expense">×</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function render() {
    renderPeriodSummary();
    renderExpenses();

    const orders = state.orders;
    const realOrders = orders.filter((o) => !o.isSample);
    const takenReal = realOrders.filter((o) => o.decision === 'take');

    const totalNet = takenReal.reduce((sum, o) => sum + o.netProfit, 0);
    const totalMins = takenReal.reduce((sum, o) => sum + o.effectiveMinutes, 0);
    const totalMiles = takenReal.reduce((sum, o) => sum + o.effectiveMiles, 0);
    const totalPayout = takenReal.reduce((sum, o) => sum + o.payout, 0);

    const avgNetHr = totalMins > 0 ? (totalNet / totalMins) * 60 : 0;
    const avgPerMi = totalMiles > 0 ? totalPayout / totalMiles : 0;
    const acceptRate = realOrders.length > 0 ? Math.round((takenReal.length / realOrders.length) * 100) : 0;

    els.kpiNetHr.textContent = `$${avgNetHr.toFixed(2)}`;
    els.kpiTotalNet.textContent = `$${totalNet.toFixed(2)}`;
    els.kpiAvgMi.textContent = `$${avgPerMi.toFixed(2)}`;
    els.kpiAcceptRate.textContent = `${acceptRate}%`;

    const hasSamples = orders.some((o) => o.isSample);
    els.btnRemoveSamples.disabled = !hasSamples;

    const patterns = analyzePatterns(orders);
    if (patterns.length === 0) {
      els.patternsList.innerHTML =
        '<p class="empty-state">Log at least 2 real taken orders to see which order types and distances earn you the most.</p>';
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

    if (orders.length === 0) {
      els.historyList.innerHTML = '<p class="empty-state">No orders logged yet.</p>';
    } else {
      els.historyList.innerHTML = orders
        .slice(0, 40)
        .map((o) => {
          const timeStr = new Date(o.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const badgeClass = o.decision === 'take' ? 'pill-take' : 'pill-pass';
          const badgeLabel = o.decision === 'take' ? 'TAKEN' : 'PASSED';
          const samplePill = o.isSample ? '<span class="pill pill-sample">SAMPLE</span>' : '';
          return `
            <div class="history-item">
              <div class="history-left">
                <div class="history-title">
                  <span class="pill ${badgeClass}">${badgeLabel}</span>
                  ${samplePill}
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

  function bind() {
    document.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.periodRange = btn.dataset.period;
        document.querySelectorAll('[data-period]').forEach((b) => {
          b.classList.toggle('active', b.dataset.period === state.periodRange);
        });
        renderPeriodSummary();
      });
    });

    els.btnAddExpense.addEventListener('click', () => {
      const amount = parseFloat(els.inputExpenseAmount.value);
      if (!(amount > 0)) {
        showToast(els.toast, 'Enter an expense amount > $0');
        return;
      }
      const expense = {
        id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        amount,
        category: els.inputExpenseCategory.value || 'Other',
        note: els.inputExpenseNote.value.trim(),
      };
      state.expenses.unshift(expense);
      saveExpenses(state.expenses);
      els.inputExpenseAmount.value = '';
      els.inputExpenseNote.value = '';
      onDataMutated();
      render();
      showToast(els.toast, `Added $${amount.toFixed(2)} ${expense.category}`);
    });

    els.expensesList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-delete-expense-id]');
      if (!btn) return;
      const id = btn.dataset.deleteExpenseId;
      const removed = state.expenses.find((x) => x.id === id);
      state.expenses = state.expenses.filter((x) => x.id !== id);
      saveExpenses(state.expenses);
      onDataMutated();
      render();
      if (removed) {
        showToast(els.toast, 'Expense removed', {
          onUndo: () => {
            state.expenses.unshift(removed);
            saveExpenses(state.expenses);
            onDataMutated();
            render();
          },
        });
      }
    });

    els.btnClearExpenses.addEventListener('click', () => {
      if (state.expenses.length === 0) return;
      if (!window.confirm('Clear all logged expenses?')) return;
      const backup = [...state.expenses];
      state.expenses = [];
      saveExpenses(state.expenses);
      onDataMutated();
      render();
      showToast(els.toast, 'Expenses cleared', {
        onUndo: () => {
          state.expenses = backup;
          saveExpenses(state.expenses);
          onDataMutated();
          render();
        },
      });
    });

    els.btnSampleData.addEventListener('click', () => {
      const samples = createSampleOrders(state.settings);
      state.orders = [...samples, ...state.orders];
      saveOrders(state.orders);
      onDataMutated();
      render();
      showToast(els.toast, 'Added 7 sample orders (excluded from tax/profit totals)');
    });

    els.btnRemoveSamples.addEventListener('click', () => {
      const before = state.orders.length;
      const backup = [...state.orders];
      state.orders = state.orders.filter((o) => !o.isSample);
      if (state.orders.length === before) return;
      saveOrders(state.orders);
      onDataMutated();
      render();
      showToast(els.toast, 'Removed sample orders', {
        onUndo: () => {
          state.orders = backup;
          saveOrders(state.orders);
          onDataMutated();
          render();
        },
      });
    });

    els.btnExportMileageCsv.addEventListener('click', () => {
      exportMileageLogToCsv({
        orders: state.orders,
        dailyDataByDate: state.dailyDataByDate,
        expenses: state.expenses,
        settings: state.settings,
      });
      showToast(els.toast, 'Exported IRS Mileage Log CSV');
    });

    els.btnExportExpensesCsv.addEventListener('click', () => {
      if (state.expenses.length === 0) {
        showToast(els.toast, 'No expenses to export');
        return;
      }
      exportExpensesToCsv(state.expenses);
      showToast(els.toast, 'Exported Expenses CSV');
    });

    els.btnExportCsv.addEventListener('click', () => {
      if (state.orders.length === 0) {
        showToast(els.toast, 'No orders to export');
        return;
      }
      exportOrdersToCsv(state.orders);
      showToast(els.toast, 'Exported Orders CSV');
    });

    els.btnClearHistory.addEventListener('click', () => {
      if (state.orders.length === 0) return;
      if (!window.confirm('Clear all logged orders? This removes your order history.')) return;
      const backup = [...state.orders];
      state.orders = [];
      saveOrders(state.orders);
      onDataMutated();
      render();
      showToast(els.toast, 'Order log cleared', {
        onUndo: () => {
          state.orders = backup;
          saveOrders(state.orders);
          onDataMutated();
          render();
        },
      });
    });

    els.historyList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-delete-id]');
      if (!btn) return;
      const id = btn.dataset.deleteId;
      const idx = state.orders.findIndex((o) => o.id === id);
      if (idx === -1) return;
      const removed = state.orders[idx];
      state.orders = state.orders.filter((o) => o.id !== id);
      saveOrders(state.orders);
      onDataMutated();
      render();
      showToast(els.toast, 'Order removed', {
        onUndo: () => {
          state.orders.splice(idx, 0, removed);
          saveOrders(state.orders);
          onDataMutated();
          render();
        },
      });
    });
  }

  return { bind, render, renderPeriodSummary };
}
