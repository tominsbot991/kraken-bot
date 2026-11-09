// @ts-check
/**
 * Isolated paper-trading ledger.
 * Uses public Kraken ticker data only; never submits exchange orders.
 */
const fs = require('fs');
const path = require('path');
const { state, DATA_DIR, log } = require('../state');

const FILE = path.join(DATA_DIR, 'paper_trading.json');
function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
const FEE_RATE = Math.min(0.1, Math.max(0, envNumber('PAPER_FEE_RATE', 0.0026)));
const SLIPPAGE_BPS = Math.min(500, Math.max(0, envNumber('PAPER_SLIPPAGE_BPS', 5)));
const INITIAL_EUR = Math.max(1, envNumber('PAPER_INITIAL_EUR', 1000));

let book = null;

function persist() {
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(book, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (e) {
    log('[PAPER] Could not persist paper ledger: ' + e.message);
  }
}

function init() {
  if (book) return book;
  try {
    if (fs.existsSync(FILE)) book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    log('[PAPER] Existing paper ledger unreadable; starting a fresh ledger: ' + e.message);
  }
  if (!book || typeof book.cashEUR !== 'number' || !book.holdings || !book.orders || !book.trades) {
    book = { initialEUR: INITIAL_EUR, cashEUR: INITIAL_EUR, holdings: {}, orders: {}, trades: {}, nextId: 1, createdAt: Date.now() };
    persist();
  }
  publishLedger();
  log('[PAPER] Paper Trading active. Virtual starting cash: ' + book.initialEUR.toFixed(2) + ' EUR');
  return book;
}

function publishLedger() {
  if (!book) return;
  state.fullTradeHistory = { trades: book.trades, lastFetchTime: Date.now(), totalCount: Object.keys(book.trades).length };
  state.trades = Object.values(book.trades).sort((a, b) => b.time - a.time);
  state.paperTrading = {
    enabled: true, mode: 'PAPER', initialEUR: book.initialEUR, cashEUR: book.cashEUR,
    feesEUR: Object.values(book.trades).reduce((s, t) => s + (Number(t.fee) || 0), 0),
    openOrders: Object.keys(book.orders).length,
    tradeCount: Object.keys(book.trades).length
  };
}

function refreshPortfolio() {
  init();
  const wallet = { ZEUR: { asset: 'ZEUR', amount: book.cashEUR, value: book.cashEUR } };
  let total = book.cashEUR;
  for (const [asset, amount] of Object.entries(book.holdings)) {
    if (!(amount > 0)) continue;
    const pair = state.assetToPairMap[asset];
    const price = pair ? Number(state.ticker[pair]?.price || 0) : 0;
    const value = amount * price;
    wallet[asset] = { asset, amount, value };
    total += value;
  }
  state.wallet = wallet;
  state.tradeBalance = total;
  state.orders = toExchangeOrders();
  publishLedger();
  return wallet;
}

function toExchangeOrders() {
  const out = {};
  for (const [id, o] of Object.entries(book.orders)) {
    const pair = state.pairAliases[o.pair] ? o.pair : (state.pairs[o.pair]?.altname || o.pair);
    out[id] = {
      refid: id, status: 'open', vol: String(o.volume), opentm: o.createdAt / 1000,
      descr: { pair, type: o.type, ordertype: o.ordertype, price: String(o.price) }
    };
  }
  return out;
}

function getPairInfo(pair) {
  const internal = state.pairAliases[pair] || pair;
  const info = state.pairs[internal];
  if (!info) throw new Error('Unknown trading pair: ' + pair);
  return { internal, info, asset: info.base };
}
function marketPrice(pair, side) {
  const t = state.ticker[pair];
  if (!t || !(t.price > 0)) return 0;
  const raw = side === 'buy' ? (t.ask || t.price) : (t.bid || t.price);
  const slip = SLIPPAGE_BPS / 10000;
  return side === 'buy' ? raw * (1 + slip) : raw * (1 - slip);
}
function reservedVolume(asset) {
  return Object.values(book.orders).filter(o => o.asset === asset && o.type === 'sell').reduce((s, o) => s + o.volume, 0);
}
function reservedCash() {
  return Object.values(book.orders).filter(o => o.type === 'buy').reduce((s, o) => s + o.volume * o.price * (1 + FEE_RATE), 0);
}
function recordTrade(pair, type, volume, price) {
  const gross = volume * price;
  const fee = gross * FEE_RATE;
  const cost = type === 'buy' ? gross + fee : gross - fee;
  const id = 'PAPER-' + book.nextId++;
  const trade = { pair, type, vol: String(volume), price: String(price), cost: String(cost), fee: String(fee), time: Date.now() / 1000, ordertxid: id };
  book.trades[id] = trade;
  persist();
  publishLedger();
  return trade;
}
function buy(pair, amountEUR, priceOverride = null) {
  init();
  const { asset } = getPairInfo(pair);
  const price = priceOverride || marketPrice(pair, 'buy');
  if (!(price > 0)) return { success: false, error: 'no_price_data' };
  if (!(amountEUR > 0) || amountEUR + reservedCash() > book.cashEUR + 1e-8) return { success: false, error: 'insufficient_paper_cash' };
  const gross = amountEUR / (1 + FEE_RATE);
  const fee = amountEUR - gross;
  const volume = gross / price;
  const min = Number(getPairInfo(pair).info.ordermin || 0);
  if (volume < min) return { success: false, error: 'below_minimum_order_volume' };
  book.cashEUR -= amountEUR;
  book.holdings[asset] = (book.holdings[asset] || 0) + volume;
  const trade = recordTrade(pair, 'buy', volume, price);
  refreshPortfolio();
  log(`[PAPER] BUY ${asset}: ${volume.toFixed(8)} @ ${price} EUR; fee ${fee.toFixed(4)} EUR`);
  return { success: true, paper: true, order: { descr: { order: 'paper market buy' } }, trade };
}
function sell(pair, volume, priceOverride = null) {
  init();
  const { asset } = getPairInfo(pair);
  const available = (book.holdings[asset] || 0) - reservedVolume(asset);
  if (!(volume > 0) || volume > available + 1e-10) return { success: false, error: 'insufficient_paper_asset' };
  const price = priceOverride || marketPrice(pair, 'sell');
  if (!(price > 0)) return { success: false, error: 'no_price_data' };
  const gross = volume * price;
  const fee = gross * FEE_RATE;
  book.holdings[asset] -= volume;
  book.cashEUR += gross - fee;
  const trade = recordTrade(pair, 'sell', volume, price);
  refreshPortfolio();
  log(`[PAPER] SELL ${asset}: ${volume.toFixed(8)} @ ${price} EUR; fee ${fee.toFixed(4)} EUR`);
  return { success: true, paper: true, order: { descr: { order: 'paper sell' } }, trade };
}
function addPending(pair, type, ordertype, volume, price) {
  init();
  const { asset } = getPairInfo(pair);
  if (!(volume > 0) || !(price > 0)) return { success: false, error: 'invalid_order_parameters' };
  const minimum = Number(getPairInfo(pair).info.ordermin || 0);
  if (volume < minimum) return { success: false, error: 'below_minimum_order_volume' };
  if (type === 'sell' && volume > (book.holdings[asset] || 0) - reservedVolume(asset) + 1e-10) {
    return { success: false, error: 'insufficient_paper_asset' };
  }
  if (type === 'buy' && volume * price * (1 + FEE_RATE) + reservedCash() > book.cashEUR + 1e-8) {
    return { success: false, error: 'insufficient_paper_cash' };
  }
  const id = 'PAPER-ORDER-' + book.nextId++;
  book.orders[id] = { id, pair: getPairInfo(pair).internal, asset, type, ordertype, volume, price, createdAt: Date.now() };
  persist();
  refreshPortfolio();
  log(`[PAPER] Open ${ordertype} ${type} ${asset}: ${volume} @ ${price}`);
  processOpenOrders();
  return { success: true, paper: true, order: { txid: [id], descr: { order: 'paper ' + ordertype + ' ' + type } } };
}
function limitBuy(pair, amountEUR, price) {
  const volume = Number((amountEUR / (price * (1 + FEE_RATE))).toFixed(state.pairs[pair]?.lot_decimals || 8));
  return addPending(pair, 'buy', 'limit', volume, price);
}
function limitSell(pair, volume, price) { return addPending(pair, 'sell', 'limit', volume, price); }
function stopLoss(pair, volume, price) { return addPending(pair, 'sell', 'stop-loss', volume, price); }
function marketBuy(pair, amountEUR) { return buy(pair, amountEUR); }
function marketSell(pair, volume) { return sell(pair, volume); }
function cancelOrder(id) {
  init();
  if (!book.orders[id]) return { success: false, error: 'paper_order_not_found' };
  delete book.orders[id];
  persist(); refreshPortfolio();
  log('[PAPER] Cancelled simulated order ' + id);
  return { success: true, paper: true };
}
function editOrder(id, pair, price) {
  init();
  const order = book.orders[id];
  if (!order) return { success: false, error: 'paper_order_not_found' };
  order.price = price;
  persist(); refreshPortfolio(); processOpenOrders();
  return { success: true, paper: true, order: { txid: [id] } };
}
function processOpenOrders() {
  if (!book) return;
  for (const [id, o] of Object.entries(book.orders)) {
    const t = state.ticker[o.pair];
    const current = Number(t?.price || 0);
    if (!(current > 0)) continue;
    let shouldFill = false, fillPrice = current;
    if (o.ordertype === 'limit' && o.type === 'sell' && current >= o.price) { shouldFill = true; fillPrice = o.price; }
    if (o.ordertype === 'limit' && o.type === 'buy' && current <= o.price) { shouldFill = true; fillPrice = o.price; }
    if (o.ordertype === 'stop-loss' && o.type === 'sell' && current <= o.price) { shouldFill = true; fillPrice = marketPrice(o.pair, 'sell'); }
    if (!shouldFill) continue;
    delete book.orders[id];
    if (o.type === 'sell') {
      const result = sell(o.pair, o.volume, fillPrice);
      if (!result.success) log('[PAPER] Simulated sell order failed to fill: ' + result.error);
    } else {
      const cost = o.volume * fillPrice * (1 + FEE_RATE);
      if (cost + reservedCash() <= book.cashEUR + 1e-8) {
        book.cashEUR -= cost;
        book.holdings[o.asset] = (book.holdings[o.asset] || 0) + o.volume;
        recordTrade(o.pair, 'buy', o.volume, fillPrice);
      } else log('[PAPER] Simulated limit buy expired: insufficient virtual cash');
    }
    persist();
  }
  refreshPortfolio();
}

function getSummary() { init(); refreshPortfolio(); return { ...state.paperTrading, holdings: { ...book.holdings }, openOrders: Object.values(book.orders) }; }

module.exports = { init, refreshPortfolio, processOpenOrders, fetchOrders: () => { init(); refreshPortfolio(); return state.orders; }, limitBuy, limitSell, marketBuy, marketSell, stopLoss, editOrder, cancelOrder, getSummary };
