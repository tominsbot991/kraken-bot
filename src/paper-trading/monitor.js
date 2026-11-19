const { PaperTrader } = require('./engine');
const { fetchEurTickers } = require('./kraken-public');

async function updatePaperPortfolio({ trader, fetchPrices = fetchEurTickers, log = console.log } = {}) {
  if (!trader) throw new Error('A PaperTrader instance is required');
  const prices = await fetchPrices();
  const snapshot = trader.snapshot(prices);
  log('LIVE KRAKEN PRICES (PUBLIC / READ-ONLY)');
  for (const [asset, price] of Object.entries(prices)) log(`${asset}/EUR: €${price}`);
  log('VIRTUAL PAPER PORTFOLIO');
  log(JSON.stringify(snapshot, null, 2));
  log('No private account access or real orders were used.');
  return { prices, snapshot };
}

async function main() {
  const trader = new PaperTrader({ startingBalanceEUR: 1000, feeRate: 0.0026, slippageRate: 0.0005 });
  try {
    await updatePaperPortfolio({ trader });
  } catch (error) {
    console.error('Paper portfolio update failed:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { updatePaperPortfolio };
