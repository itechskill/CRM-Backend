const Counter = require('../models/Counter');
const SalesOrder = require('../models/SalesOrder');
const { getCounterKey } = require('./counterKey');

const formatSalesOrderNumber = (sequence) => `SO-${String(sequence).padStart(4, '0')}`;

const allocateSalesOrderNumber = async (session = null) => {
  const counterKey = getCounterKey('sales-order-number');
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { sequence: 1 } },
    { new: false, session }
  );

  if (!counter) {
    const error = new Error('The sales-order-number counter has not been initialized. Run the approved seed before creating Sales Orders.');
    error.statusCode = 503;
    throw error;
  }

  const orderNumber = formatSalesOrderNumber(counter.sequence);
  const duplicate = await SalesOrder.exists({
    $or: [{ orderNumber }, { orderReference: orderNumber }]
  }).session(session || null);
  if (duplicate) {
    const error = new Error(`Sales Order number ${orderNumber} already exists. Reconcile the sales-order-number counter before retrying.`);
    error.statusCode = 409;
    throw error;
  }

  return orderNumber;
};

module.exports = { allocateSalesOrderNumber, formatSalesOrderNumber };
