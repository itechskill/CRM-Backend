const Counter = require('../models/Counter');
const PurchaserGRN = require('../models/PurchaserGRN');
const { getCounterKey } = require('./counterKey');

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const allocateGrnNumber = async (session = null) => {
  const counterKey = getCounterKey('grn-number');
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey, sequence: { $lt: 999999 } },
    { $inc: { sequence: 1 } },
    { new: true, session }
  );
  if (!counter) {
    const exists = await Counter.exists({ _id: counterKey }).session(session || null);
    if (!exists) throw createHttpError(503, 'The GRN counter has not been initialized. Run the approved one-time seed before receiving inventory.');
    throw createHttpError(409, 'The GRN sequence has reached GRN-999999. No further GRNs can be allocated.');
  }
  return `GRN-${String(counter.sequence).padStart(6, '0')}`;
};

const isDuplicateGrnNumberError = (error) => Boolean(
  error?.code === 11000 && (
    error?.keyPattern?.grnNumber ||
    error?.keyValue?.grnNumber ||
    /grnNumber/i.test(String(error?.message || ''))
  )
);

const reconcileGrnCounter = async () => {
  const grns = await PurchaserGRN.find({ grnNumber: { $regex: /^GRN-\d+$/ } })
    .select('grnNumber')
    .lean();
  const highestExisting = grns.reduce((highest, grn) => {
    const match = String(grn.grnNumber || '').match(/^GRN-(\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  if (highestExisting > 0) {
    await Counter.findOneAndUpdate(
      { _id: getCounterKey('grn-number') },
      { $max: { sequence: highestExisting } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return highestExisting;
};

const withGrnDuplicateRecovery = async (session, operation, maxRetries = 2) => {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await session.withTransaction(operation);
    } catch (error) {
      if (!isDuplicateGrnNumberError(error) || attempt === maxRetries) throw error;
      await reconcileGrnCounter();
    }
  }
  return undefined;
};

module.exports = {
  allocateGrnNumber,
  isDuplicateGrnNumberError,
  reconcileGrnCounter,
  withGrnDuplicateRecovery
};
