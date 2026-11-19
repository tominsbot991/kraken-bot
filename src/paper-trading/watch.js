const { PaperTrader } = require('./engine');
const { updatePaperPortfolio } = require('./monitor');

const INTERVAL_MS = 60_000;

async function startPaperMonitor({ intervalMs = INTERVAL_MS, trader = new PaperTrader(), log = console.log, fetchPrices } = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new Error('Refresh interval must be at least 1000 ms');
  let stopped = false;
  let timer = null;
  let inFlight = false;

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const options = { trader, log };
      if (fetchPrices) options.fetchPrices = fetchPrices;
      await updatePaperPortfolio(options);
    } catch (error) {
      log('Paper monitor update failed:', error.message);
    } finally {
      inFlight = false;
    }
  }

  await tick();
  timer = setInterval(tick, intervalMs);
  return { trader, stop() { stopped = true; if (timer) clearInterval(timer); } };
}

if (require.main === module) {
  startPaperMonitor().then(({ stop }) => {
    console.log('Paper monitor refreshing every 60 seconds. Press Ctrl+C to stop.');
    process.once('SIGINT', () => { stop(); process.exit(0); });
    process.once('SIGTERM', () => { stop(); process.exit(0); });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { startPaperMonitor, INTERVAL_MS };
