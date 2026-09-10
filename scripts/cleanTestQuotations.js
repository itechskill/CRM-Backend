const mongoose = require('mongoose');
require('dotenv').config();

const Quotation = require('../models/Quotation');

async function cleanTestQuotations() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI not found in env.');
      process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const result = await Quotation.deleteMany({
      $or: [
        { clientName: { $regex: /test/i } },
        { customerName: { $regex: /test/i } },
        { quotationNumber: { $regex: /test/i } },
        { orderReference: { $regex: /test/i } },
        { productSummary: { $regex: /test/i } },
        { notes: { $regex: /dummy|test/i } }
      ]
    });

    console.log(`Successfully cleaned up ${result.deletedCount} test/dummy quotation records.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Clean test quotations error:', err);
    process.exit(1);
  }
}

cleanTestQuotations();
