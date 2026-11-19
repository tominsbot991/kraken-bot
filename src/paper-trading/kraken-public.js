const KRAKEN_TICKER_URL = 'https://api.kraken.com/0/public/Ticker?pair=XBTEUR,ETHEUR';

async function fetchEurTickers(fetchImpl = fetch) {
  const response = await fetchImpl(KRAKEN_TICKER_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Kraken HTTP error: ${response.status}`);
  const payload = await response.json();
  if (payload.error?.length) throw new Error(payload.error.join(', '));
  const entries = Object.entries(payload.result || {});
  if (!entries.length) throw new Error('Kraken returned no ticker data');
  const prices = {};
  for (const [key, ticker] of entries) {
    const price = Number(ticker?.c?.[0]);
    if (!(Number.isFinite(price) && price > 0)) throw new Error(`Invalid ticker price for ${key}`);
    const normalized = key.includes('XBT') || key.includes('XXBT') ? 'BTC' : key.includes('ETH') ? 'ETH' : key;
    prices[normalized] = price;
  }
  return prices;
}

module.exports = { fetchEurTickers, KRAKEN_TICKER_URL };
