const SUPPORTED_CURRENCIES = Object.freeze(['PKR', 'USD', 'EUR', 'AED', 'GBP']);
const DEFAULT_EXCHANGE_RATES_TO_PKR = Object.freeze({ PKR: 1, USD: 295, AED: 80 });

const normalizeCurrency = value => String(value || 'PKR').trim().toUpperCase();

const assertSupportedCurrency = value => {
  const currency = normalizeCurrency(value);
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    const error = new Error(`Unsupported currency: ${currency || 'blank'}.`);
    error.statusCode = 400;
    throw error;
  }
  return currency;
};

module.exports = {
  SUPPORTED_CURRENCIES,
  DEFAULT_EXCHANGE_RATES_TO_PKR,
  normalizeCurrency,
  assertSupportedCurrency
};
