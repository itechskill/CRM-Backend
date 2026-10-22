const mongoose = require('mongoose');
require('dotenv').config();

mongoose.set('autoIndex', false);

const Counter = require('../models/Counter');
const DeliveryNote = require('../models/DeliveryNote');
const { getCounterKey } = require('../utils/counterKey');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');
const valueFor = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};
const databaseName = String(valueFor('--db-name') || '').trim();

const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured.');
  if (!databaseName || databaseName.toLowerCase() === 'test') throw new Error('Pass an explicit non-test database with --db-name.');
  if (dryRun === apply) throw new Error('Choose exactly one mode: --dry-run or --apply.');

  await mongoose.connect(process.env.MONGODB_URI, { dbName: databaseName });
  if (mongoose.connection.name !== databaseName) throw new Error(`STOP: Expected ${databaseName}, connected to ${mongoose.connection.name}.`);

  const counterKey = getCounterKey('delivery-note-number');
  const [notes, existingCounter] = await Promise.all([
    DeliveryNote.find({
      $or: [
        { deliveryNumber: { $regex: /^WH\/OUT\/\d{5}$/ } },
        { deliveryNoteNumber: { $regex: /^WH\/OUT\/\d{5}$/ } }
      ]
    }).select('deliveryNumber deliveryNoteNumber').lean(),
    Counter.findById(counterKey).lean()
  ]);
  let highestExisting = 0;
  for (const note of notes) {
    for (const value of [note.deliveryNumber, note.deliveryNoteNumber]) {
      const match = String(value || '').match(/^WH\/OUT\/(\d{5})$/);
      if (match) highestExisting = Math.max(highestExisting, Number(match[1]));
    }
  }
  const existingSequence = Number(existingCounter?.sequence) || 0;
  const targetSequence = Math.max(existingSequence, highestExisting + 1);
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply', database: databaseName,
    counterNamespace: String(process.env.COUNTER_NAMESPACE || ''), counterKey,
    exactFormat: 'WH/OUT/ followed by exactly 5 digits', highestExistingDeliveryNote: highestExisting || null,
    existingCounterSequence: existingCounter ? existingSequence : null,
    resultingNextSequence: targetSequence,
    changed: !existingCounter || existingSequence < targetSequence
  };
  if (!dryRun) {
    await Counter.findOneAndUpdate({ _id: counterKey }, { $max: { sequence: targetSequence } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  console.log(JSON.stringify(summary, null, 2));
};

run().then(() => mongoose.disconnect()).catch(async error => {
  console.error(`Delivery Note counter was not changed: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
