import { evaluateOffer } from '../calculator.js';
import { saveOrdersDebounced } from '../storage.js';
import { parseSpokenOffer } from '../voice-parser.js';
import { showToast } from './toast.js';

const DEADHEAD_HINTS = {
  '1': 'Ends in zone (1.0x mi)',
  '1.5': 'Partial return (+50% mi)',
  '2': 'Full round trip (2.0x mi)',
};

const EXAMPLE_PRESETS = {
  chipotle: { payout: '13.50', miles: '4.2', minutes: '21', deadhead: '1', wait: '0', type: 'food', merchant: 'Chipotle' },
  outback: { payout: '12.00', miles: '5.0', minutes: '22', deadhead: '1.5', wait: '5', type: 'food', merchant: 'Outback' },
  popeyes: { payout: '4.50', miles: '6.1', minutes: '24', deadhead: '2', wait: '5', type: 'food', merchant: 'Popeyes' },
  target: { payout: '19.25', miles: '4.8', minutes: '32', deadhead: '1', wait: '0', type: 'shop', merchant: 'Target' },
};

export function initEvaluateController({ state, els, onOrdersMutated }) {
  function syncDeadheadUI(valStr) {
    state.deadheadMultiplier = parseFloat(valStr);
    document.querySelectorAll('[data-deadhead]').forEach((b) => {
      b.classList.toggle('active', b.dataset.deadhead === valStr);
    });
    els.deadheadHint.textContent = DEADHEAD_HINTS[valStr] || '';
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
    state.waitMinutes = 0;
    state.orderType = 'food';

    syncDeadheadUI('1');
    document.querySelectorAll('[data-wait]').forEach((b) => {
      b.classList.toggle('active', b.dataset.wait === '0');
    });
    document.querySelectorAll('[data-type]').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === 'food');
    });
    updateEvaluation();
  }

  function useTripMiles(miles) {
    els.inputMiles.value = miles.toFixed(1);
    // Real GPS miles already include return leg -> set deadhead to In Zone (1.0x)
    syncDeadheadUI('1');
    updateEvaluation();
    showToast(els.toast, `Applied ${miles.toFixed(1)} GPS miles (1.0x In Zone)`);
  }

  function applySpokenOffer(parsed) {
    if (parsed.payout !== null) els.inputPayout.value = parsed.payout.toFixed(2);
    if (parsed.miles !== null) els.inputMiles.value = parsed.miles.toFixed(1);
    if (parsed.minutes !== null) els.inputMinutes.value = String(parsed.minutes);
    if (parsed.deadhead) syncDeadheadUI(parsed.deadhead);
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
      isSample: false,
      ...state.lastEvaluation,
    };

    state.orders.unshift(entry);
    saveOrdersDebounced(state.orders);
    onOrdersMutated();
    showToast(els.toast, decision === 'take' ? 'Logged as Taken' : 'Logged as Passed');
    resetOfferForm();
  }

  function bind() {
    [els.inputPayout, els.inputMiles, els.inputMinutes].forEach((input) => {
      input.addEventListener('input', updateEvaluation);
    });

    document.querySelectorAll('[data-time]').forEach((chip) => {
      chip.addEventListener('click', () => {
        els.inputMinutes.value = chip.dataset.time;
        updateEvaluation();
      });
    });

    document.querySelectorAll('[data-deadhead]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncDeadheadUI(btn.dataset.deadhead);
        updateEvaluation();
      });
    });

    document.querySelectorAll('[data-wait]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.waitMinutes = parseInt(btn.dataset.wait, 10) || 0;
        document.querySelectorAll('[data-wait]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        updateEvaluation();
      });
    });

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

    document.querySelectorAll('[data-example]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const ex = EXAMPLE_PRESETS[chip.dataset.example];
        if (!ex) return;
        els.inputPayout.value = ex.payout;
        els.inputMiles.value = ex.miles;
        els.inputMinutes.value = ex.minutes;
        els.inputMerchant.value = ex.merchant;
        syncDeadheadUI(ex.deadhead);
        state.waitMinutes = parseInt(ex.wait, 10);
        state.orderType = ex.type;
        document.querySelectorAll('[data-wait]').forEach((b) => b.classList.toggle('active', b.dataset.wait === ex.wait));
        document.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === ex.type));
        updateEvaluation();
        showToast(els.toast, `Loaded example: ${ex.merchant}`);
      });
    });

    let recognition = null;
    let isListening = false;
    els.btnVoice.addEventListener('click', () => {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        showToast(els.toast, 'Voice input requires HTTPS in Safari');
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
        showToast(els.toast, 'Microphone unavailable — check Safari permissions');
      };
      recognition.onend = () => {
        isListening = false;
        els.btnVoice.classList.remove('listening');
        els.voiceBtnLabel.textContent = 'Speak Offer (e.g. "$13.50, 4.2 mi, 21 min")';
      };
      recognition.start();
    });
  }

  return { bind, updateEvaluation, useTripMiles };
}
