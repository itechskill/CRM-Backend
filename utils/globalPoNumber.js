const Counter = require('../models/Counter');
const { getCounterKey } = require('./counterKey');

const formatGlobalPoNumber = sequence => `GPO-${String(sequence).padStart(6, '0')}`;

const allocateGlobalPoNumber = async (session = null) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: getCounterKey('global-po-number') },
    { $inc: { sequence: 1 } },
    { new: false, session }
  );
  if (!counter) {
    const error = new Error('The global-po-number counter has not been initialized. Run the approved seed before issuing a Global PO.');
    error.statusCode = 503;
    throw error;
  }
  return formatGlobalPoNumber(counter.sequence);
};

module.exports = { allocateGlobalPoNumber, formatGlobalPoNumber };
