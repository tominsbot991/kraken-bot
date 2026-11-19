const test = require('node:test');
const assert = require('node:assert/strict');
const { PaperTrader } = require('../src/paper-trading/engine');
const { fetchEurTickers } = require('../src/paper-trading/kraken-public');

test('paper buy and sell apply fees and adverse slippage', () => {
  const bot = new PaperTrader({ startingBalanceEUR: 1000 });
  const buy = bot.buy('BTC', 500, 50000);
  assert.equal(buy.side, 'BUY');
  assert.ok(buy.price > 50000);
  assert.ok(buy.feeEUR > 0);
  assert.ok(bot.cashEUR < 500);
  const quantity = bot.positions.BTC;
  const sell = bot.sell('BTC', quantity, 51000);
  assert.equal(sell.side, 'SELL');
  assert.ok(sell.price < 51000);
  assert.equal(bot.positions.BTC, undefined);
  assert.ok(bot.cashEUR > 990);
});

test('paper trader rejects overspending and overselling', () => {
  const bot = new PaperTrader({ startingBalanceEUR: 100 });
  assert.throws(() => bot.buy('BTC', 101, 50000), /insufficient virtual EUR/i);
  assert.throws(() => bot.sell('BTC', 1, 50000), /insufficient virtual position/i);
});

test('paper trader rejects invalid market prices', () => {
  const bot = new PaperTrader();
  assert.throws(() => bot.buy('BTC', 10, 0), /price must be positive/i);
});

test('ticker parser reads Kraken public response without credentials', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ error: [], result: {
    XXBTZEUR: { c: ['60000.0', '1'] }, XETHZEUR: { c: ['2000.0', '1'] }
  } }) });
  assert.deepEqual(await fetchEurTickers(fakeFetch), { BTC: 60000, ETH: 2000 });
});
