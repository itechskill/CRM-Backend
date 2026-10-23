const mongoose = require('mongoose');
require('dotenv').config();

const InventoryItem = require('../models/InventoryItem');

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};
const databaseName = String(valueFor('--db-name') || '').trim();

const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured.');
  if (!databaseName) throw new Error('Pass the database explicitly with --db-name.');
  if (args.some(arg => ['--apply', '--write', '--fix'].includes(arg))) {
    throw new Error('This reconciliation command is read-only and does not support write modes.');
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: databaseName, autoIndex: false });
  if (mongoose.connection.name !== databaseName) {
    throw new Error(`STOP: Expected ${databaseName}, connected to ${mongoose.connection.name}.`);
  }

  const items = await InventoryItem.find({}).select('name sku quantityOnHand reservedQuantity stockMovements').lean();
  const mismatches = items.flatMap(item => {
    const movementBalance = (item.stockMovements || []).reduce((sum, movement) => {
      const quantity = Number(movement.quantity) || 0;
      return sum + (movement.type === 'OUT' ? -quantity : quantity);
    }, 0);
    const quantityOnHand = Number(item.quantityOnHand) || 0;
    if (quantityOnHand === movementBalance) return [];
    return [{
      inventoryItemId: item._id,
      name: item.name,
      sku: item.sku || '',
      quantityOnHand,
      reservedQuantity: Number(item.reservedQuantity) || 0,
      movementBalance,
      difference: quantityOnHand - movementBalance,
      movementCount: (item.stockMovements || []).length
    }];
  });

  console.log(JSON.stringify({
    mode: 'read-only',
    database: databaseName,
    inventoryItemsChecked: items.length,
    mismatchesFound: mismatches.length,
    mismatches
  }, null, 2));
};

run()
  .then(async () => mongoose.disconnect())
  .catch(async error => {
    console.error(`Inventory reconciliation failed without writing data: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
