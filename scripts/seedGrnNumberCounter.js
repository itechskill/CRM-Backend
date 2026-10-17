const mongoose = require('mongoose');
require('dotenv').config();
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');

const args = process.argv.slice(2);
const force = args.includes('--force');
const numericArg = args.find(arg => arg !== '--force');
const nextNumber = numericArg === undefined ? 1 : Number(numericArg);

const run = async () => {
  if (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 999999) {
    throw new Error('Next GRN number must be an integer from 1 to 999999.');
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const counterKey = getCounterKey('grn-number');
  const existing = await Counter.findById(counterKey);
  if (existing && !force) {
    throw new Error('The GRN counter already exists. Re-run with --force only after confirming the intended reset value.');
  }

  await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $set: { sequence: nextNumber - 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`GRN counter initialized for ${counterKey}. The next assigned number will be GRN-${String(nextNumber).padStart(6, '0')}.`);
};

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`GRN counter was not changed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
