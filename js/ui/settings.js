import { cleanNumber, getCostPerMile, sanitizeSettings } from '../calculator.js';
import { saveSettingsDebounced } from '../storage.js';

export function initSettingsController({ state, els, onSettingsChanged }) {
  function updateCostSummary() {
    const cpm = getCostPerMile(state.settings);
    els.settingsCostSummary.innerHTML = `Estimated vehicle cost: <strong>$${cpm.toFixed(2)}/mi</strong>`;
  }

  function hydrateInputs() {
    const s = state.settings;
    els.setMinHr.value = s.minNetHourly;
    els.setMinMi.value = s.minPerMile;
    els.setMinPayout.value = s.minPayout;
    els.setDailyGoal.value = s.dailyGoal;
    els.setMpg.value = s.mpg;
    els.setGas.value = s.gasPrice;
    els.setWear.value = s.wearPerMile;
    els.setIrs.value = s.irsRate;
    els.setTaxPct.value = Math.round(s.incomeTaxSetAsidePct * 100);
    updateCostSummary();
  }

  function handleChange() {
    // Preserve mid-typing input values; only sanitize into state.settings
    const taxPctRaw = cleanNumber(els.setTaxPct.value, state.settings.incomeTaxSetAsidePct * 100, 0, 50);
    state.settings = sanitizeSettings({
      minNetHourly: els.setMinHr.value,
      minPerMile: els.setMinMi.value,
      minPayout: els.setMinPayout.value,
      dailyGoal: els.setDailyGoal.value,
      mpg: els.setMpg.value,
      gasPrice: els.setGas.value,
      wearPerMile: els.setWear.value,
      irsRate: els.setIrs.value,
      incomeTaxSetAsidePct: taxPctRaw / 100,
    });
    saveSettingsDebounced(state.settings);
    updateCostSummary();
    onSettingsChanged();
  }

  function bind() {
    [
      els.setMinHr,
      els.setMinMi,
      els.setMinPayout,
      els.setDailyGoal,
      els.setMpg,
      els.setGas,
      els.setWear,
      els.setIrs,
      els.setTaxPct,
    ].forEach((input) => {
      input.addEventListener('input', handleChange);
    });
    hydrateInputs();
  }

  return { bind, hydrateInputs };
}
