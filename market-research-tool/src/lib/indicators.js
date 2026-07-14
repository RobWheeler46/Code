function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Standard deviation of daily returns over the period, expressed as a percentage -
// a simple, explainable volatility measure (FRD FR-012).
function volatilityPct(closes, period = 20) {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push((slice[i] - slice[i - 1]) / slice[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

// Resistance/support from the trading range before today (FR-030), and whether
// the latest close has broken above/below it (FR-031, FR-032).
function breakoutBreakdown(closes, period = 20) {
  if (closes.length < period + 1) return { resistance: null, support: null, breakout: false, breakdown: false };
  const priorSlice = closes.slice(-(period + 1), -1);
  const resistance = Math.max(...priorSlice);
  const support = Math.min(...priorSlice);
  const latest = closes[closes.length - 1];
  return { resistance, support, breakout: latest > resistance, breakdown: latest < support };
}

function computeIndicators(bars) {
  const closes = bars.map(b => b.close).filter(c => c !== null && c !== undefined);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const vol = volatilityPct(closes, 20);
  const { resistance, support, breakout, breakdown } = breakoutBreakdown(closes, 20);
  const latest = closes[closes.length - 1] ?? null;

  return {
    sma20,
    sma50,
    sma200,
    rsi14,
    volatilityPct: vol,
    resistance,
    support,
    breakout,
    breakdown,
    aboveSma20: sma20 !== null ? latest > sma20 : null,
    aboveSma50: sma50 !== null ? latest > sma50 : null,
    aboveSma200: sma200 !== null ? latest > sma200 : null,
    rsiOverbought: rsi14 !== null ? rsi14 >= 70 : null,
    rsiOversold: rsi14 !== null ? rsi14 <= 30 : null
  };
}

function explainIndicators(ind) {
  const parts = [];
  if (ind.rsi14 !== null) {
    if (ind.rsiOverbought) parts.push(`RSI is ${ind.rsi14.toFixed(0)}, in overbought territory.`);
    else if (ind.rsiOversold) parts.push(`RSI is ${ind.rsi14.toFixed(0)}, in oversold territory.`);
    else parts.push(`RSI is ${ind.rsi14.toFixed(0)}, a neutral reading.`);
  }
  if (ind.aboveSma50 !== null) {
    parts.push(ind.aboveSma50 ? 'Price is above its 50-day average.' : 'Price is below its 50-day average.');
  }
  if (ind.breakout) parts.push('Price has broken above recent resistance.');
  if (ind.breakdown) parts.push('Price has broken below recent support.');
  if (ind.volatilityPct !== null) parts.push(`Recent daily volatility is around ${ind.volatilityPct.toFixed(1)}%.`);
  return parts.join(' ');
}

module.exports = { sma, rsi, volatilityPct, breakoutBreakdown, computeIndicators, explainIndicators };
