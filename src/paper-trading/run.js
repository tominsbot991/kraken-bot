const { fetchEurTickers } = require('./kraken-public');

async function main() {
  try {
    const prices = await fetchEurTickers();
    console.log('Kraken public EUR prices (read-only):');
    for (const [asset, price] of Object.entries(prices)) console.log(`${asset}/EUR: €${price}`);
    console.log('No account access, API keys, or orders were used.');
  } catch (error) {
    console.error('Public ticker test failed:', error.message);
    process.exitCode = 1;
  }
}

main();
