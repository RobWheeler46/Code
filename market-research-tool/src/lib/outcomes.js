const CHECKPOINTS = [
  { key: '1d', days: 1 },
  { key: '3d', days: 3 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 }
];

// Whether a rising price means the signal "played out" (bullish), a falling price means
// it played out (bearish), or there's no directional call to grade - just "did anything
// notable happen" (neutral). Drives FR-060's outcome classification.
const DIRECTION = {
  positive_setup: 'bullish',
  momentum_alert: 'bullish',
  breakout_watch: 'bullish',
  sell_risk: 'bearish',
  breakdown_watch: 'bearish',
  high_risk_warning: 'bearish',
  watch: 'neutral',
  unusual_volume: 'neutral',
  volatility_alert: 'neutral'
};

const OUTCOME_THRESHOLD_PCT = 3;

function ageDays(createdAt) {
  const createdMs = new Date(createdAt.replace(' ', 'T') + 'Z').getTime();
  return (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
}

function classifyOutcome(signalType, priceAtSignal, checkpointPrice) {
  const pctChange = ((checkpointPrice - priceAtSignal) / priceAtSignal) * 100;
  const direction = DIRECTION[signalType] || 'neutral';

  if (direction === 'bullish') {
    if (pctChange >= OUTCOME_THRESHOLD_PCT) return 'positive';
    if (pctChange <= -OUTCOME_THRESHOLD_PCT) return 'negative';
    return 'neutral';
  }
  if (direction === 'bearish') {
    if (pctChange <= -OUTCOME_THRESHOLD_PCT) return 'positive';
    if (pctChange >= OUTCOME_THRESHOLD_PCT) return 'negative';
    return 'neutral';
  }
  return Math.abs(pctChange) >= OUTCOME_THRESHOLD_PCT ? 'positive' : 'neutral';
}

function bestCheckpoint(signal) {
  for (let i = CHECKPOINTS.length - 1; i >= 0; i--) {
    const value = signal[`outcome_price_${CHECKPOINTS[i].key}`];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function updateOutcomesForAsset(db, asset, latestPrice) {
  if (latestPrice === null || latestPrice === undefined) return;

  const signals = db.prepare('SELECT * FROM signals WHERE asset_id = ?').all(asset.id);

  for (const signal of signals) {
    if (signal.price_at_signal === null || signal.price_at_signal === undefined) {
      if (signal.outcome !== 'insufficient_data') {
        db.prepare("UPDATE signals SET outcome = 'insufficient_data' WHERE id = ?").run(signal.id);
      }
      continue;
    }

    const age = ageDays(signal.created_at);
    for (const cp of CHECKPOINTS) {
      const column = `outcome_price_${cp.key}`;
      if (signal[column] === null && age >= cp.days) {
        db.prepare(`UPDATE signals SET ${column} = ? WHERE id = ?`).run(latestPrice, signal.id);
        signal[column] = latestPrice;
      }
    }

    const checkpointPrice = bestCheckpoint(signal);
    const outcome = checkpointPrice === null
      ? 'still_open'
      : classifyOutcome(signal.signal_type, signal.price_at_signal, checkpointPrice);

    if (outcome !== signal.outcome) {
      db.prepare('UPDATE signals SET outcome = ? WHERE id = ?').run(outcome, signal.id);
    }
  }
}

function rulePerformance(db) {
  const rows = db.prepare('SELECT signal_type, outcome, user_feedback FROM signals').all();
  const bySignalType = {};

  for (const row of rows) {
    if (!bySignalType[row.signal_type]) {
      bySignalType[row.signal_type] = {
        signalType: row.signal_type,
        total: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        stillOpen: 0,
        insufficientData: 0,
        feedbackUseful: 0,
        feedbackNotUseful: 0,
        feedbackFalsePositive: 0,
        feedbackMissedContext: 0,
        feedbackNeedsRuleAdjustment: 0
      };
    }
    const stats = bySignalType[row.signal_type];
    stats.total += 1;
    if (row.outcome === 'positive') stats.positive += 1;
    else if (row.outcome === 'neutral') stats.neutral += 1;
    else if (row.outcome === 'negative') stats.negative += 1;
    else if (row.outcome === 'still_open') stats.stillOpen += 1;
    else if (row.outcome === 'insufficient_data') stats.insufficientData += 1;

    if (row.user_feedback === 'useful') stats.feedbackUseful += 1;
    else if (row.user_feedback === 'not_useful') stats.feedbackNotUseful += 1;
    else if (row.user_feedback === 'false_positive') stats.feedbackFalsePositive += 1;
    else if (row.user_feedback === 'missed_context') stats.feedbackMissedContext += 1;
    else if (row.user_feedback === 'needs_rule_adjustment') stats.feedbackNeedsRuleAdjustment += 1;
  }

  return Object.values(bySignalType)
    .map(s => {
      const graded = s.positive + s.neutral + s.negative;
      return { ...s, positiveRatePct: graded > 0 ? (s.positive / graded) * 100 : null };
    })
    .sort((a, b) => b.total - a.total);
}

module.exports = { CHECKPOINTS, classifyOutcome, updateOutcomesForAsset, rulePerformance };
