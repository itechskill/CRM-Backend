const Counter = require('../models/Counter');
const { getCounterKey } = require('./counterKey');

const formatQuotationNumber = serial => `QO-${String(serial).padStart(6, '0')}`;

const allocateQuotationNumber = async ({ session = null } = {}) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: getCounterKey('quotation-number') },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return {
    serial: counter.sequence,
    reference: formatQuotationNumber(counter.sequence)
  };
};

module.exports = {
  allocateQuotationNumber,
  formatQuotationNumber
};
