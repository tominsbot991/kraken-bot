const test = require('node:test');
const assert = require('node:assert/strict');
const { startPaperMonitor, INTERVAL_MS } = require('../src/paper-trading/watch');

test('paper monitor defaults to one-minute refresh and can stop', async () => {
  assert.equal(INTERVAL_MS, 60000);
  let calls = 0;
  const logs = [];
  const session = await startPaperMonitor({
    intervalMs: 60000,
    fetchPrices: async () => { calls += 1; return { BTC: 60000, ETH: 2000 }; },
    log: (...args) => logs.push(args)
  });
  assert.equal(calls, 1);
  assert.ok(logs.length > 0);
  session.stop();
});
