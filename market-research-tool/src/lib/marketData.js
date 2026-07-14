const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
const US_EXCHANGES = new Set(['NMS', 'NYQ', 'NGM', 'NCM', 'ASE', 'PCX', 'BTS', 'PNK']);

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Request to ${url} failed with status ${res.status}`);
  return res.json();
}

// --- Search ---

async function searchShares(query) {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`,
    { headers: YAHOO_HEADERS }
  );
  const quotes = (data.quotes || []).filter(q => q.quoteType === 'EQUITY');
  return quotes
    .map(q => {
      const isUk = q.symbol.endsWith('.L') || q.exchange === 'LSE';
      const isUs = US_EXCHANGES.has(q.exchange);
      if (!isUk && !isUs) return null;
      return {
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        assetClass: isUk ? 'uk_share' : 'us_share',
        exchange: q.exchDisp || q.exchange,
        sector: q.sector || null
      };
    })
    .filter(Boolean)
    .slice(0, 15);
}

async function searchCrypto(query) {
  const data = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  return (data.coins || [])
    // CoinGecko tracks 10,000+ coins, so name matches pull in a lot of meme/wrapped-token
    // noise - restricting to the top 500 by market cap keeps results to recognisable assets.
    .filter(c => c.market_cap_rank && c.market_cap_rank <= 500)
    .sort((a, b) => a.market_cap_rank - b.market_cap_rank)
    .slice(0, 8)
    .map(c => ({
      symbol: c.id,
      name: `${c.name} (${(c.symbol || '').toUpperCase()})`,
      assetClass: 'crypto',
      exchange: 'CoinGecko',
      sector: null
    }));
}

async function searchAssets(query) {
  const [shares, crypto] = await Promise.allSettled([searchShares(query), searchCrypto(query)]);
  return [
    ...(shares.status === 'fulfilled' ? shares.value : []),
    ...(crypto.status === 'fulfilled' ? crypto.value : [])
  ];
}

// --- Quotes + history ---

function averageOfLast(values, count) {
  const slice = values.filter(v => v !== null && v !== undefined).slice(-count);
  if (slice.length === 0) return null;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function pctChange(from, to) {
  if (from === null || from === undefined || !from || to === null || to === undefined) return null;
  return ((to - from) / from) * 100;
}

async function fetchShareData(symbol) {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
    { headers: YAHOO_HEADERS }
  );
  const result = data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error(`No chart data returned for ${symbol}`);

  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const bars = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: closes[i],
      volume: volumes[i]
    }))
    .filter(b => b.close !== null && b.close !== undefined);

  const price = meta.regularMarketPrice;
  // meta.chartPreviousClose is the close from before the whole requested range (e.g. ~1 year
  // ago for range=1y), not yesterday's close - use the second-to-last daily bar instead.
  const previousClose = bars.length >= 2 ? bars[bars.length - 2].close : meta.chartPreviousClose;
  const avgVolume = averageOfLast(volumes, 30);
  const bars7dAgo = bars[bars.length - 6];
  const bars30dAgo = bars[bars.length - 21];

  return {
    price,
    previousClose,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    volume: meta.regularMarketVolume ?? null,
    avgVolume,
    marketCap: meta.marketCap ?? null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    currency: meta.currency || null,
    marketState: (meta.marketState || 'UNKNOWN').toLowerCase(),
    name: meta.longName || meta.shortName || symbol,
    change24hPct: pctChange(previousClose, price),
    change7dPct: bars7dAgo ? pctChange(bars7dAgo.close, price) : null,
    change30dPct: bars30dAgo ? pctChange(bars30dAgo.close, price) : null,
    bars,
    source: 'yahoo_finance'
  };
}

async function fetchCryptoData(coinId) {
  const [simple, chart] = await Promise.all([
    fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
    ),
    fetchJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=200&interval=daily`)
  ]);

  const priceData = simple[coinId];
  if (!priceData) throw new Error(`No price data returned for ${coinId}`);

  const bars = (chart.prices || []).map(([ts, close], i) => ({
    date: new Date(ts).toISOString().slice(0, 10),
    close,
    volume: chart.total_volumes && chart.total_volumes[i] ? chart.total_volumes[i][1] : null
  }));

  const volumes = bars.map(b => b.volume);
  const avgVolume = averageOfLast(volumes, 30);
  const price = priceData.usd;
  const bars7dAgo = bars[bars.length - 8];
  const bars30dAgo = bars[bars.length - 31];
  const highs = bars.map(b => b.close);

  return {
    price,
    previousClose: price !== null && priceData.usd_24h_change !== undefined
      ? price / (1 + priceData.usd_24h_change / 100)
      : null,
    dayHigh: null,
    dayLow: null,
    volume: priceData.usd_24h_vol ?? null,
    avgVolume,
    marketCap: priceData.usd_market_cap ?? null,
    fiftyTwoWeekHigh: highs.length ? Math.max(...highs) : null,
    fiftyTwoWeekLow: highs.length ? Math.min(...highs) : null,
    currency: 'USD',
    marketState: 'crypto_24h',
    name: null,
    change24hPct: priceData.usd_24h_change ?? null,
    change7dPct: bars7dAgo ? pctChange(bars7dAgo.close, price) : null,
    change30dPct: bars30dAgo ? pctChange(bars30dAgo.close, price) : null,
    bars,
    source: 'coingecko'
  };
}

async function fetchAssetData(asset) {
  if (asset.asset_class === 'crypto') return fetchCryptoData(asset.symbol);
  return fetchShareData(asset.symbol);
}

module.exports = { searchAssets, searchShares, searchCrypto, fetchAssetData, fetchShareData, fetchCryptoData };
