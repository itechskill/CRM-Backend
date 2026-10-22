const Counter = require('../models/Counter');
const { getCounterKey } = require('./counterKey');

const formatDeliveryNoteNumber = sequence => `WH/OUT/${String(sequence).padStart(5, '0')}`;

const allocateDeliveryNoteNumber = async (session = null) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: getCounterKey('delivery-note-number') },
    { $inc: { sequence: 1 } },
    { new: false, session }
  );
  if (!counter) {
    const error = new Error('The delivery-note-number counter has not been initialized. Run the approved seed before creating Delivery Notes.');
    error.statusCode = 503;
    throw error;
  }
  return formatDeliveryNoteNumber(counter.sequence);
};

module.exports = { allocateDeliveryNoteNumber, formatDeliveryNoteNumber };
