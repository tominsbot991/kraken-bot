const test = require('node:test');
const assert = require('node:assert/strict');
const { PaperTrader } = require('../src/paper-trading/engine');
const { updatePaperPortfolio } = require('../src/paper-trading/monitor');

test('live ticker prices are connected to virtual portfolio valuation', async () => {
  const trader = new PaperTrader({ startingBalanceEUR: 1000 });
  trader.buy('BTC', 250, 50000);
  const messages = [];
  const result = await updatePaperPortfolio({
    trader,
    fetchPrices: async () => ({ BTC: 60000, ETH: 2000 }),
    log: message => messages.push(message)
  });
  assert.deepEqual(result.prices, { BTC: 60000, ETH: 2000 });
  assert.equal(result.snapshot.cashEUR, trader.cashEUR);
  assert.ok(result.snapshot.positions.BTC.marketValueEUR > 0);
  assert.ok(result.snapshot.equityEUR > result.snapshot.cashEUR);
  assert.ok(messages.some(message => String(message).includes('No private account access')));
});
