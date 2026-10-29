const Counter = require('../models/Counter');
const { getCounterKey } = require('./counterKey');

const formatReceiptVoucherNumber = sequence => `RV-${String(sequence).padStart(6, '0')}`;

const allocateReceiptVoucherNumber = async (session = null) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: getCounterKey('receipt-voucher-number') },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return formatReceiptVoucherNumber(counter.sequence);
};

module.exports = { allocateReceiptVoucherNumber, formatReceiptVoucherNumber };
