const ExchangeRate = require('../models/ExchangeRate');
const {
  SUPPORTED_CURRENCIES,
  DEFAULT_EXCHANGE_RATES_TO_PKR,
  assertSupportedCurrency
} = require('../config/currencies');

const getEffectiveExchangeRate = async (value, { session = null, required = true } = {}) => {
  const currency = assertSupportedCurrency(value);
  if (currency === 'PKR') return { currency, rateToPKR: 1, source: 'base' };
  const stored = await ExchangeRate.findOne({ currency }).session(session || null).lean();
  if (stored && Number(stored.rateToPKR) > 0) {
    return { currency, rateToPKR: Number(stored.rateToPKR), source: 'admin', stored };
  }
  const defaultRate = DEFAULT_EXCHANGE_RATES_TO_PKR[currency];
  if (Number(defaultRate) > 0) return { currency, rateToPKR: Number(defaultRate), source: 'default' };
  if (!required) return { currency, rateToPKR: null, source: 'unset' };
  const error = new Error(`Exchange rate for ${currency} is not set by Admin.`);
  error.statusCode = 400;
  throw error;
};

const listEffectiveExchangeRates = async () => {
  const storedRows = await ExchangeRate.find({ currency: { $in: SUPPORTED_CURRENCIES } }).lean();
  const byCurrency = new Map(storedRows.map(row => [row.currency, row]));
  return Promise.all(SUPPORTED_CURRENCIES.map(async currency => {
    const effective = await getEffectiveExchangeRate(currency, { required: false });
    const stored = byCurrency.get(currency) || null;
    return {
      currency,
      rateToPKR: effective.rateToPKR,
      isSet: Number(effective.rateToPKR) > 0,
      source: stored ? 'admin' : effective.source,
      lastChangedBy: stored?.lastChangedBy || null,
      lastChangedByName: stored?.lastChangedByName || '',
      lastChangedAt: stored?.lastChangedAt || null,
      history: stored?.history || []
    };
  }));
};

module.exports = { getEffectiveExchangeRate, listEffectiveExchangeRates };
