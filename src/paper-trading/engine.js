// Isolated simulation only. This module has no Kraken private-client dependency.
class PaperTrader {
  constructor({ startingBalanceEUR = 1000, feeRate = 0.0026, slippageRate = 0.0005 } = {}) {
    if (!(startingBalanceEUR >= 0) || !(feeRate >= 0) || !(slippageRate >= 0 && slippageRate < 1)) {
      throw new Error('Invalid paper-trading configuration');
    }
    this.cashEUR = startingBalanceEUR;
    this.feeRate = feeRate;
    this.slippageRate = slippageRate;
    this.positions = {};
    this.trades = [];
  }

  buy(asset, amountEUR, marketPrice) {
    this.#validate(asset, marketPrice);
    if (!(amountEUR > 0) || amountEUR > this.cashEUR) throw new Error('Invalid amount or insufficient virtual EUR');
    const executionPrice = marketPrice * (1 + this.slippageRate);
    const quantity = amountEUR / (executionPrice * (1 + this.feeRate));
    const gross = quantity * executionPrice;
    const fee = gross * this.feeRate;
    const total = gross + fee;
    if (total > this.cashEUR + 1e-9) throw new Error('Insufficient virtual EUR');
    this.cashEUR = Math.max(0, this.cashEUR - total);
    this.positions[asset] = (this.positions[asset] || 0) + quantity;
    return this.#record({ side: 'BUY', asset, quantity, price: executionPrice, feeEUR: fee, cashChangeEUR: -total });
  }

  sell(asset, quantity, marketPrice) {
    this.#validate(asset, marketPrice);
    const held = this.positions[asset] || 0;
    if (!(quantity > 0) || quantity > held + 1e-12) throw new Error('Invalid quantity or insufficient virtual position');
    const executionPrice = marketPrice * (1 - this.slippageRate);
    const gross = quantity * executionPrice;
    const fee = gross * this.feeRate;
    const net = gross - fee;
    this.positions[asset] = Math.max(0, held - quantity);
    if (this.positions[asset] < 1e-12) delete this.positions[asset];
    this.cashEUR += net;
    return this.#record({ side: 'SELL', asset, quantity, price: executionPrice, feeEUR: fee, cashChangeEUR: net });
  }

  snapshot(prices = {}) {
    const positions = Object.fromEntries(Object.entries(this.positions).map(([asset, quantity]) => [
      asset, { quantity, marketPriceEUR: prices[asset] ?? null,
        marketValueEUR: prices[asset] == null ? null : quantity * prices[asset] }
    ]));
    const knownPositionValue = Object.values(positions).reduce((sum, p) => sum + (p.marketValueEUR ?? 0), 0);
    return { cashEUR: this.cashEUR, positions, knownPositionValueEUR: knownPositionValue,
      equityEUR: this.cashEUR + knownPositionValue, tradeCount: this.trades.length };
  }

  #validate(asset, price) {
    if (typeof asset !== 'string' || !/^[A-Z0-9]{2,12}$/.test(asset)) throw new Error('Invalid asset symbol');
    if (!(Number.isFinite(price) && price > 0)) throw new Error('Market price must be positive');
  }

  #record(trade) {
    const record = { ...trade, timestamp: new Date().toISOString() };
    this.trades.push(record);
    return record;
  }
}

module.exports = { PaperTrader };
