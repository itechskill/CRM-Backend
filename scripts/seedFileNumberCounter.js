const mongoose = require('mongoose');
require('dotenv').config();
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');

const args = process.argv.slice(2);
const force = args.includes('--force');
const numericArg = args.find(arg => arg !== '--force');
const nextNumber = numericArg === undefined ? 1022 : Number(numericArg);

const run = async () => {
  if (!Number.isInteger(nextNumber) || nextNumber < 1) {
    throw new Error('Next file number must be a positive integer.');
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const counterKey = getCounterKey('file-number');
  const existing = await Counter.findById(counterKey);
  if (existing && !force) {
    throw new Error('The file-number counter already exists. Re-run with --force only after confirming the intended reset value.');
  }

  await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $set: { sequence: nextNumber - 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`File-number counter initialized for ${counterKey}. The next assigned number will be ${nextNumber}.`);
};

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`File-number counter was not changed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
