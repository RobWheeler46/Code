const db = require('../db');

const REFRESH_MINUTES = {
  us_share: () => parseFloat(process.env.REFRESH_MINUTES_SHARES) || 15,
  uk_share: () => parseFloat(process.env.REFRESH_MINUTES_SHARES) || 15,
  crypto: () => parseFloat(process.env.REFRESH_MINUTES_CRYPTO) || 10
};

function getLatestSnapshot(assetId) {
  return db.prepare('SELECT * FROM price_snapshots WHERE asset_id = ? ORDER BY id DESC LIMIT 1').get(assetId);
}

function isStale(snapshot, assetClass) {
  if (!snapshot) return true;
  const expectedMinutes = (REFRESH_MINUTES[assetClass] || (() => 15))();
  const ageMs = Date.now() - new Date(snapshot.fetched_at.replace(' ', 'T') + 'Z').getTime();
  return ageMs > expectedMinutes * 2 * 60 * 1000;
}

function serializeAsset(asset) {
  const snapshot = getLatestSnapshot(asset.id);
  return {
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    assetClass: asset.asset_class,
    exchange: asset.exchange,
    sector: asset.sector,
    isPennyShare: !!asset.is_penny_share,
    isHighRisk: !!asset.is_high_risk,
    researchStatus: asset.research_status,
    snapshot: snapshot ? {
      price: snapshot.price,
      previousClose: snapshot.previous_close,
      dayHigh: snapshot.day_high,
      dayLow: snapshot.day_low,
      volume: snapshot.volume,
      avgVolume: snapshot.avg_volume,
      marketCap: snapshot.market_cap,
      fiftyTwoWeekHigh: snapshot.fifty_two_week_high,
      fiftyTwoWeekLow: snapshot.fifty_two_week_low,
      currency: snapshot.currency,
      marketState: snapshot.market_state,
      change24hPct: snapshot.change_24h_pct,
      change7dPct: snapshot.change_7d_pct,
      change30dPct: snapshot.change_30d_pct,
      fetchedAt: snapshot.fetched_at
    } : null,
    isStale: isStale(snapshot, asset.asset_class)
  };
}

function parseJsonSafe(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function serializeSignal(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    signalType: row.signal_type,
    score: row.score,
    strength: row.strength,
    explanation: row.explanation,
    triggeredRules: parseJsonSafe(row.triggered_rules, []),
    supportingData: parseJsonSafe(row.supporting_data, []),
    priceAtSignal: row.price_at_signal,
    status: row.status,
    outcome: row.outcome,
    userFeedback: row.user_feedback,
    createdAt: row.created_at,
    expiryAt: row.expiry_at,
    outcomeCheckpoints: {
      '1d': row.outcome_price_1d,
      '3d': row.outcome_price_3d,
      '7d': row.outcome_price_7d,
      '30d': row.outcome_price_30d,
      '90d': row.outcome_price_90d
    }
  };
}

function serializeAlert(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    signalId: row.signal_id,
    alertType: row.alert_type,
    severity: row.severity,
    message: row.message,
    emailed: !!row.emailed,
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

function serializeNote(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    signalId: row.signal_id,
    noteText: row.note_text,
    tags: parseJsonSafe(row.tags, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { getLatestSnapshot, isStale, serializeAsset, serializeSignal, serializeAlert, serializeNote, parseJsonSafe };
