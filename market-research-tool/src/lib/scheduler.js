const db = require('../db');
const marketData = require('./marketData');
const indicators = require('./indicators');
const signals = require('./signals');
const mailer = require('./mailer');
const outcomes = require('./outcomes');

function logIngestion(source, status, message) {
  db.prepare('INSERT INTO ingestion_log (source, status, message) VALUES (?, ?, ?)').run(source, status, message || null);
}

function upsertDailyBars(assetId, bars) {
  const stmt = db.prepare(`
    INSERT INTO daily_bars (asset_id, bar_date, close, volume)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(asset_id, bar_date) DO UPDATE SET close = excluded.close, volume = excluded.volume
  `);
  for (const bar of bars) {
    if (bar.close === null || bar.close === undefined) continue;
    stmt.run(assetId, bar.date, bar.close, bar.volume ?? null);
  }
}

function severityFor(signal) {
  if (signal.signal_type === 'high_risk_warning' || signal.strength === 'very_high') return 'critical';
  if (signal.strength === 'high') return 'high';
  return 'normal';
}

async function createAlertForSignal(asset, signal) {
  const dedupKey = `${asset.id}:${signal.signal_type}`;
  const recent = db.prepare(
    "SELECT 1 FROM alerts WHERE dedup_key = ? AND created_at > datetime('now', '-6 hours')"
  ).get(dedupKey);
  if (recent) return; // duplicate alert suppression (FR-048)

  const severity = severityFor(signal);
  const message = `${asset.symbol} - ${signal.explanation}`;

  const result = db.prepare(`
    INSERT INTO alerts (asset_id, signal_id, alert_type, severity, message, dedup_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(asset.id, signal.id, signal.signal_type, severity, message, dedupKey);

  if (severity === 'critical' || severity === 'high') {
    try {
      const sent = await mailer.sendAlertEmail(`[${severity.toUpperCase()}] ${asset.symbol} signal`, message);
      if (sent) db.prepare('UPDATE alerts SET emailed = 1 WHERE id = ?').run(result.lastInsertRowid);
    } catch (err) {
      logIngestion('mailer', 'error', err.message);
    }
  }
}

function classifyPennyShare(asset, snapshot, thresholds) {
  if (asset.asset_class !== 'uk_share' || snapshot.price === null || snapshot.price === undefined) return false;
  return snapshot.price < thresholds.pennySharePriceThresholdPence;
}

async function refreshAsset(asset) {
  const thresholds = signals.getThresholds(db);
  try {
    const data = await marketData.fetchAssetData(asset);
    upsertDailyBars(asset.id, data.bars);

    const computedIndicators = indicators.computeIndicators(data.bars);
    const isPenny = classifyPennyShare(asset, data, thresholds) ? 1 : 0;
    const highRisk = signals.computeHighRiskFlag({
      asset: { ...asset, is_penny_share: isPenny },
      snapshot: data,
      indicators: computedIndicators,
      thresholds
    });

    db.prepare('UPDATE assets SET name = COALESCE(?, name), is_penny_share = ?, is_high_risk = ? WHERE id = ?')
      .run(data.name, isPenny, highRisk.flag ? 1 : 0, asset.id);

    db.prepare(`
      INSERT INTO price_snapshots (asset_id, price, previous_close, day_high, day_low, volume, avg_volume, market_cap,
        fifty_two_week_high, fifty_two_week_low, currency, market_state, change_24h_pct, change_7d_pct, change_30d_pct, source, is_stale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      asset.id, data.price, data.previousClose, data.dayHigh, data.dayLow, data.volume, data.avgVolume, data.marketCap,
      data.fiftyTwoWeekHigh, data.fiftyTwoWeekLow, data.currency, data.marketState,
      data.change24hPct, data.change7dPct, data.change30dPct, data.source
    );

    const updatedAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id);
    const hasNotes = !!db.prepare('SELECT 1 FROM notes WHERE asset_id = ? LIMIT 1').get(asset.id);
    const newSignals = signals.generateSignalsForAsset(db, updatedAsset, data, computedIndicators, hasNotes);

    for (const s of newSignals) {
      await createAlertForSignal(updatedAsset, s);
    }

    outcomes.updateOutcomesForAsset(db, updatedAsset, data.price);

    logIngestion(asset.symbol, 'ok', `Refreshed ${asset.symbol}: price ${data.price}`);
  } catch (err) {
    logIngestion(asset.symbol, 'error', err.message);
  }
}

function getWatchedAssets(assetClassFilter) {
  const op = assetClassFilter === 'crypto' ? "= 'crypto'" : "!= 'crypto'";
  return db.prepare(`
    SELECT DISTINCT a.* FROM assets a
    JOIN watchlist_assets wa ON wa.asset_id = a.id
    WHERE a.asset_class ${op}
  `).all();
}

async function refreshBatch(group) {
  signals.expireOldSignals(db);
  const assets = getWatchedAssets(group === 'crypto' ? 'crypto' : 'shares');
  for (const asset of assets) {
    await refreshAsset(asset);
  }
}

let started = false;

function start() {
  if (started) return;
  started = true;
  const sharesMinutes = parseFloat(process.env.REFRESH_MINUTES_SHARES) || 15;
  const cryptoMinutes = parseFloat(process.env.REFRESH_MINUTES_CRYPTO) || 10;

  refreshBatch('shares').catch(err => logIngestion('scheduler', 'error', err.message));
  refreshBatch('crypto').catch(err => logIngestion('scheduler', 'error', err.message));

  setInterval(() => refreshBatch('shares').catch(err => logIngestion('scheduler', 'error', err.message)), sharesMinutes * 60 * 1000);
  setInterval(() => refreshBatch('crypto').catch(err => logIngestion('scheduler', 'error', err.message)), cryptoMinutes * 60 * 1000);
}

module.exports = { start, refreshAsset, refreshBatch };
