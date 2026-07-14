const DEFAULT_THRESHOLDS = {
  positiveSetupMinChange: 5,
  positiveSetupMinVolumeRatio: 2,
  sellRiskMinChange: -5,
  sellRiskMinVolumeRatio: 1.5,
  unusualVolumeRatio: 3,
  unusualVolumePriceMove: 3,
  cryptoVolatilityChange: 10,
  cryptoVolatilityVolumeRatio: 1.5,
  pennyPumpChange: 20,
  pennyPumpVolumeRatio: 5,
  highVolatilityPct: 5,
  lowLiquidityVolumeShares: 50000,
  lowLiquidityVolumeCrypto: 1000000,
  largeMoveNoNewsPct: 15,
  pennySharePriceThresholdPence: 10,
  pennyShareHighRiskPriceThresholdPence: 5,
  signalExpiryDays: 3
};

function getThresholds(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const overrides = {};
  for (const row of rows) {
    const num = parseFloat(row.value);
    overrides[row.key] = isNaN(num) ? row.value : num;
  }
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function volumeRatio(snapshot) {
  if (!snapshot.volume || !snapshot.avgVolume) return null;
  return snapshot.volume / snapshot.avgVolume;
}

function strengthFromScore(score) {
  if (score >= 76) return 'very_high';
  if (score >= 51) return 'high';
  if (score >= 31) return 'medium';
  return 'low';
}

// --- Section 13 scoring model, reweighted because this build has no news feed yet
// (news components are dropped and the remaining weights rescaled to still sum to 100). ---

function computePositiveSetupScore(ctx) {
  const { snapshot, indicators } = ctx;
  const momentumPct = snapshot.change24hPct ?? 0;
  const priceMomentum = clamp(momentumPct / 10, 0, 1) * 33;

  const ratio = volumeRatio(snapshot);
  const volumeStrength = ratio !== null ? clamp((ratio - 1) / 2, 0, 1) * 33 : 0;

  const technicalChecks = [indicators.aboveSma20, indicators.aboveSma50, indicators.breakout, indicators.rsiOverbought === false];
  const technicalFraction = technicalChecks.filter(v => v === true).length / technicalChecks.length;
  const technicalSetup = technicalFraction * 34;

  const score = Math.round(priceMomentum + volumeStrength + technicalSetup);
  return {
    score: clamp(score, 0, 100),
    breakdown: [
      { component: 'Price momentum', points: Math.round(priceMomentum), max: 33 },
      { component: 'Volume strength', points: Math.round(volumeStrength), max: 33 },
      { component: 'Technical setup', points: Math.round(technicalSetup), max: 34 }
    ]
  };
}

function computeSellRiskScore(ctx) {
  const { snapshot, indicators, asset } = ctx;
  const momentumPct = snapshot.change24hPct ?? 0;
  const negPrice = momentumPct < 0 ? clamp(-momentumPct / 10, 0, 1) * 29 : 0;

  const ratio = volumeRatio(snapshot);
  const negVolume = momentumPct < 0 && ratio !== null ? clamp((ratio - 1) / 2, 0, 1) * 21 : 0;

  const weaknessChecks = [indicators.aboveSma50 === false, indicators.breakdown === true, indicators.rsiOverbought === true];
  const techWeak = (weaknessChecks.filter(Boolean).length / weaknessChecks.length) * 29;

  const highVol = indicators.volatilityPct !== null && indicators.volatilityPct > 4;
  const thresholds = ctx.thresholds || DEFAULT_THRESHOLDS;
  const lowLiquidity = snapshot.avgVolume !== null && snapshot.avgVolume !== undefined &&
    snapshot.avgVolume < (asset.asset_class === 'crypto' ? thresholds.lowLiquidityVolumeCrypto : thresholds.lowLiquidityVolumeShares);
  const riskChecks = [highVol, lowLiquidity, !!asset.is_penny_share];
  const assetRisk = (riskChecks.filter(Boolean).length / riskChecks.length) * 21;

  const score = Math.round(negPrice + negVolume + techWeak + assetRisk);
  return {
    score: clamp(score, 0, 100),
    breakdown: [
      { component: 'Negative price movement', points: Math.round(negPrice), max: 29 },
      { component: 'Negative volume pattern', points: Math.round(negVolume), max: 21 },
      { component: 'Technical weakness', points: Math.round(techWeak), max: 29 },
      { component: 'Asset-specific risk', points: Math.round(assetRisk), max: 21 }
    ]
  };
}

function computeWatchPriorityScore(ctx) {
  const { snapshot, indicators, hasNotes, asset } = ctx;
  const movePct = Math.abs(snapshot.change24hPct ?? 0);
  const priceMove = clamp(movePct / 8, 0, 1) * 31;

  const ratio = volumeRatio(snapshot);
  const volumeMove = ratio !== null ? clamp((ratio - 1) / 2, 0, 1) * 31 : 0;

  let techProximity = 0;
  if (indicators.resistance && indicators.support && snapshot.price) {
    const distPct = Math.min(
      Math.abs(snapshot.price - indicators.resistance),
      Math.abs(snapshot.price - indicators.support)
    ) / snapshot.price * 100;
    techProximity = clamp((5 - distPct) / 5, 0, 1) * 23;
  }

  const userInterest = (hasNotes || (asset.research_status && asset.research_status !== 'not_reviewed')) ? 15 : 0;

  const score = Math.round(priceMove + volumeMove + techProximity + userInterest);
  return {
    score: clamp(score, 0, 100),
    breakdown: [
      { component: 'Price movement', points: Math.round(priceMove), max: 31 },
      { component: 'Volume movement', points: Math.round(volumeMove), max: 31 },
      { component: 'Technical level proximity', points: Math.round(techProximity), max: 23 },
      { component: 'User interest weighting', points: userInterest, max: 15 }
    ]
  };
}

function computeHighRiskFlag(ctx) {
  const { snapshot, indicators, asset, thresholds } = ctx;
  const t = thresholds || DEFAULT_THRESHOLDS;
  const reasons = [];

  if (asset.asset_class === 'uk_share' && snapshot.price !== null && snapshot.price < t.pennyShareHighRiskPriceThresholdPence) {
    reasons.push(`Very low share price (${snapshot.price.toFixed(2)}p).`);
  }
  if (indicators.volatilityPct !== null && indicators.volatilityPct > t.highVolatilityPct) {
    reasons.push(`Extreme volatility (recent daily volatility ${indicators.volatilityPct.toFixed(1)}%).`);
  }
  const lowLiquidityThreshold = asset.asset_class === 'crypto' ? t.lowLiquidityVolumeCrypto : t.lowLiquidityVolumeShares;
  if (snapshot.avgVolume !== null && snapshot.avgVolume !== undefined && snapshot.avgVolume < lowLiquidityThreshold) {
    reasons.push('Low liquidity (average volume is below the configured threshold).');
  }
  if (snapshot.change24hPct !== null && Math.abs(snapshot.change24hPct) > t.largeMoveNoNewsPct) {
    reasons.push('Large price movement - this build does not yet monitor news, so the cause cannot be confirmed here.');
  }

  return { flag: reasons.length > 0, reasons };
}

// --- Rule engine: turns scores + raw data into candidate signals (FRD section 14) ---

function buildCandidates(ctx) {
  const { asset, snapshot, indicators, thresholds: t } = ctx;
  const candidates = [];
  const ratio = volumeRatio(snapshot);
  const change = snapshot.change24hPct ?? 0;

  const positiveSetup = computePositiveSetupScore(ctx);
  const sellRisk = computeSellRiskScore(ctx);
  const watchPriority = computeWatchPriorityScore(ctx);
  const highRisk = computeHighRiskFlag(ctx);

  if (
    change >= t.positiveSetupMinChange &&
    ratio !== null && ratio >= t.positiveSetupMinVolumeRatio &&
    (indicators.aboveSma20 || indicators.breakout) &&
    sellRisk.score < 50
  ) {
    candidates.push(signal('positive_setup', positiveSetup.score,
      `Positive setup detected. The asset is up ${change.toFixed(1)}% today, volume is ${ratio.toFixed(1)}x the 30-day average and technical indicators support the move.`,
      ['price up >= ' + t.positiveSetupMinChange + '%', 'volume >= ' + t.positiveSetupMinVolumeRatio + 'x average', 'technical setup improving'],
      positiveSetup.breakdown));
  }

  if (indicators.volatilityPct !== null && Math.abs(change) >= indicators.volatilityPct * 2 && ratio !== null && ratio > 1) {
    candidates.push(signal('momentum_alert', watchPriority.score,
      `Momentum alert. Price movement of ${change.toFixed(1)}% is stronger than the recent trend and trading volume is above average.`,
      ['price move exceeds 2x recent volatility', 'volume above average'],
      watchPriority.breakdown));
  }

  if (
    change <= t.sellRiskMinChange &&
    ratio !== null && ratio >= t.sellRiskMinVolumeRatio &&
    (indicators.aboveSma50 === false || indicators.breakdown)
  ) {
    candidates.push(signal('sell_risk', sellRisk.score,
      `Sell-risk signal detected. The asset is down ${change.toFixed(1)}% today, volume is ${ratio.toFixed(1)}x the 30-day average and technical indicators are weakening.`,
      ['price down >= ' + Math.abs(t.sellRiskMinChange) + '%', 'volume >= ' + t.sellRiskMinVolumeRatio + 'x average', 'technical weakness'],
      sellRisk.breakdown));
  }

  if (ratio !== null && ratio >= t.unusualVolumeRatio && Math.abs(change) >= t.unusualVolumePriceMove) {
    candidates.push(signal('unusual_volume', watchPriority.score,
      `Unusual volume detected. Trading volume is ${ratio.toFixed(1)}x the 30-day average and price movement is ${change.toFixed(1)}% today.`,
      ['volume >= ' + t.unusualVolumeRatio + 'x average', 'price move >= ' + t.unusualVolumePriceMove + '%'],
      watchPriority.breakdown));
  }

  if (asset.is_penny_share && change >= t.pennyPumpChange && ratio !== null && ratio >= t.pennyPumpVolumeRatio) {
    candidates.push(signal('high_risk_warning', Math.max(sellRisk.score, 70),
      `High-risk warning. This penny share has moved up ${change.toFixed(1)}% on unusually high volume (${ratio.toFixed(1)}x average) - this build cannot check for supporting news, so treat with caution.`,
      ['penny share', 'price up >= ' + t.pennyPumpChange + '%', 'volume >= ' + t.pennyPumpVolumeRatio + 'x average'],
      sellRisk.breakdown));
  }

  if (asset.asset_class === 'crypto' && Math.abs(change) >= t.cryptoVolatilityChange && ratio !== null && ratio >= t.cryptoVolatilityVolumeRatio) {
    candidates.push(signal('volatility_alert', watchPriority.score,
      `Crypto volatility alert. The asset has moved ${change.toFixed(1)}% in 24 hours with volume ${ratio.toFixed(1)}x the recent average.`,
      ['24h move >= ' + t.cryptoVolatilityChange + '%', 'volume >= ' + t.cryptoVolatilityVolumeRatio + 'x average'],
      watchPriority.breakdown));
  }

  if (indicators.breakout && ratio !== null && ratio > 1) {
    candidates.push(signal('breakout_watch', watchPriority.score,
      `Breakout watch. Price has moved above recent resistance (${indicators.resistance ? indicators.resistance.toFixed(2) : '?'}) with elevated volume.`,
      ['price above recent resistance', 'volume above average'],
      watchPriority.breakdown));
  }

  if (indicators.breakdown && ratio !== null && ratio > 1) {
    candidates.push(signal('breakdown_watch', watchPriority.score,
      `Breakdown watch. Price has moved below recent support (${indicators.support ? indicators.support.toFixed(2) : '?'}) with elevated volume.`,
      ['price below recent support', 'volume above average'],
      watchPriority.breakdown));
  }

  if (highRisk.flag && !(asset.is_penny_share && change >= t.pennyPumpChange)) {
    candidates.push(signal('high_risk_warning', Math.max(sellRisk.score, 60),
      `High-risk warning. ${highRisk.reasons.join(' ')}`,
      highRisk.reasons,
      sellRisk.breakdown));
  }

  if (candidates.length === 0 && watchPriority.score >= 31) {
    candidates.push(signal('watch', watchPriority.score,
      `Watch signal. Activity on this asset has changed enough to warrant monitoring, even though no stronger rule was triggered.`,
      ['watch priority score >= 31'],
      watchPriority.breakdown));
  }

  return candidates;
}

function signal(type, score, explanation, triggeredRules, supportingData) {
  return { type, score: clamp(Math.round(score), 0, 100), strength: strengthFromScore(score), explanation, triggeredRules, supportingData };
}

// --- Persistence: dedup (FR-042), expiry (FR-041), conflicting signals (FR-040) ---

function persistCandidate(db, asset, snapshot, candidate, thresholds) {
  const existing = db.prepare(
    "SELECT * FROM signals WHERE asset_id = ? AND signal_type = ? AND status = 'active'"
  ).get(asset.id, candidate.type);

  if (existing && Math.abs(existing.score - candidate.score) < 5) {
    return null; // not materially different - suppress duplicate (FR-042, FR-048)
  }
  if (existing) {
    db.prepare("UPDATE signals SET status = 'superseded' WHERE id = ?").run(existing.id);
  }

  const expiryDays = thresholds.signalExpiryDays;
  const result = db.prepare(`
    INSERT INTO signals (asset_id, signal_type, score, strength, explanation, triggered_rules, supporting_data, price_at_signal, expiry_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+${expiryDays} days'))
  `).run(
    asset.id, candidate.type, candidate.score, candidate.strength, candidate.explanation,
    JSON.stringify(candidate.triggeredRules), JSON.stringify(candidate.supportingData), snapshot.price
  );

  return db.prepare('SELECT * FROM signals WHERE id = ?').get(result.lastInsertRowid);
}

function markConflicts(db, assetId) {
  const active = db.prepare("SELECT * FROM signals WHERE asset_id = ? AND status = 'active'").all(assetId);
  const positive = active.find(s => s.signal_type === 'positive_setup' && s.score >= 50);
  const risk = active.find(s => s.signal_type === 'sell_risk' && s.score >= 50);
  if (!positive || !risk) return;

  for (const s of [positive, risk]) {
    if (s.explanation.includes('conflicting signals are active')) continue;
    db.prepare('UPDATE signals SET explanation = ? WHERE id = ?').run(
      `${s.explanation} Note: conflicting signals are active for this asset - review carefully before acting.`,
      s.id
    );
  }
}

function expireOldSignals(db) {
  db.prepare("UPDATE signals SET status = 'expired' WHERE status = 'active' AND expiry_at IS NOT NULL AND expiry_at <= datetime('now')").run();
}

function generateSignalsForAsset(db, asset, snapshot, indicators, hasNotes) {
  const thresholds = getThresholds(db);
  const ctx = { asset, snapshot, indicators, hasNotes, thresholds };
  const candidates = buildCandidates(ctx);
  const created = [];
  for (const candidate of candidates) {
    const row = persistCandidate(db, asset, snapshot, candidate, thresholds);
    if (row) created.push(row);
  }
  markConflicts(db, asset.id);
  return created;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  getThresholds,
  strengthFromScore,
  computePositiveSetupScore,
  computeSellRiskScore,
  computeWatchPriorityScore,
  computeHighRiskFlag,
  generateSignalsForAsset,
  expireOldSignals
};
