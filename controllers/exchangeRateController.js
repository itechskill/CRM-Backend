const ExchangeRate = require('../models/ExchangeRate');
const { assertSupportedCurrency } = require('../config/currencies');
const { getEffectiveExchangeRate, listEffectiveExchangeRates } = require('../utils/exchangeRates');

exports.getExchangeRates = async (_req, res) => {
  try {
    return res.json({ success: true, data: await listEffectiveExchangeRates() });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error loading exchange rates.' });
  }
};

exports.updateExchangeRate = async (req, res) => {
  try {
    const currency = assertSupportedCurrency(req.params.currency);
    if (currency === 'PKR') {
      return res.status(400).json({ success: false, message: 'PKR is the base currency and its rate is fixed at 1.' });
    }
    const rateToPKR = Number(req.body.rateToPKR);
    if (!Number.isFinite(rateToPKR) || rateToPKR <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a positive exchange rate to PKR.' });
    }
    const note = String(req.body.note || '').trim();
    if (note.length > 500) return res.status(400).json({ success: false, message: 'Note cannot exceed 500 characters.' });
    const current = await getEffectiveExchangeRate(currency, { required: false });
    const now = new Date();
    const row = await ExchangeRate.findOneAndUpdate(
      { currency },
      {
        $set: {
          rateToPKR,
          lastChangedBy: req.user._id,
          lastChangedByName: req.user.fullName || '',
          lastChangedAt: now
        },
        $push: {
          history: {
            changedBy: req.user._id,
            changedByName: req.user.fullName || '',
            changedAt: now,
            oldRate: current.rateToPKR,
            newRate: rateToPKR,
            note
          }
        }
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, message: `${currency} exchange rate updated.`, data: row });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error updating exchange rate.' });
  }
};
