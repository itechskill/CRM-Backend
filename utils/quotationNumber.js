const Counter = require('../models/Counter');
const { getCounterKey } = require('./counterKey');

const initialsFromName = (fullName) => String(fullName || '')
  .trim()
  .split(/[^A-Za-z0-9]+/)
  .filter(Boolean)
  .map(part => part[0])
  .join('');

const sanitizeQuotationCode = (value, fullName = '') => {
  const requested = String(value || '').trim() || initialsFromName(fullName);
  return requested.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'SP';
};

const formatQuotationNumber = (serial, code) => (
  `QO-${String(serial).padStart(4, '0')}-${sanitizeQuotationCode(code)}`
);

const allocateQuotationNumber = async ({ creatorId, code, fullName = '', session = null }) => {
  if (!creatorId) {
    const error = new Error('A salesperson is required to allocate a quotation number.');
    error.statusCode = 400;
    throw error;
  }

  const creatorKey = String(creatorId);
  const counter = await Counter.findOneAndUpdate(
    { _id: getCounterKey(`quotation-number:${creatorKey}`) },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  const sanitizedCode = sanitizeQuotationCode(code, fullName);
  return {
    serial: counter.sequence,
    code: sanitizedCode,
    reference: formatQuotationNumber(counter.sequence, sanitizedCode)
  };
};

module.exports = {
  allocateQuotationNumber,
  formatQuotationNumber,
  sanitizeQuotationCode,
  initialsFromName
};
