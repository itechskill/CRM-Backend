const mongoose = require('mongoose');
require('dotenv').config();

mongoose.set('autoIndex', false);

const Counter = require('../models/Counter');
const SalesOrder = require('../models/SalesOrder');
const { getCounterKey } = require('../utils/counterKey');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};
const databaseName = String(valueFor('--db-name') || '').trim();

const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured.');
  if (!databaseName || ['test'].includes(databaseName.toLowerCase())) {
    throw new Error('Pass an explicit non-test database with --db-name.');
  }
  if (dryRun === apply) {
    throw new Error('Choose exactly one mode: --dry-run or --apply.');
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: databaseName });
  if (mongoose.connection.name !== databaseName) {
    throw new Error(`STOP: Expected ${databaseName}, connected to ${mongoose.connection.name}.`);
  }

  const counterKey = getCounterKey('sales-order-number');
  const [orders, existingCounter] = await Promise.all([
    SalesOrder.find({
      $or: [
        { orderNumber: { $regex: /^SO-\d{4}$/ } },
        { orderReference: { $regex: /^SO-\d{4}$/ } }
      ]
    }).select('orderNumber orderReference').lean(),
    Counter.findById(counterKey).lean()
  ]);

  let highestExisting = 0;
  for (const order of orders) {
    for (const value of [order.orderNumber, order.orderReference]) {
      const match = String(value || '').match(/^SO-(\d{4})$/);
      if (match) highestExisting = Math.max(highestExisting, Number(match[1]));
    }
  }

  const existingSequence = Number(existingCounter?.sequence) || 0;
  const requiredNext = highestExisting + 1;
  const targetSequence = Math.max(existingSequence, requiredNext);
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    database: databaseName,
    counterNamespace: String(process.env.COUNTER_NAMESPACE || ''),
    counterKey,
    highestExistingSalesOrder: highestExisting || null,
    existingCounterSequence: existingCounter ? existingSequence : null,
    resultingNextSequence: targetSequence,
    changed: existingSequence < targetSequence || !existingCounter
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $max: { sequence: targetSequence } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(JSON.stringify(summary, null, 2));
};

run()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error(`Sales Order counter was not changed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
