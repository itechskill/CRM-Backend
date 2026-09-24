const mongoose = require('mongoose');
require('dotenv').config();

async function inspectCollections() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fortCRM';
  await mongoose.connect(uri);
  
  const cols = await mongoose.connection.db.listCollections().toArray();
  console.log('Database Collections & Document Counts:');
  console.log('--------------------------------------');
  
  for (const c of cols) {
    const count = await mongoose.connection.db.collection(c.name).countDocuments();
    console.log(`${c.name}: ${count} documents`);
  }
  
  await mongoose.disconnect();
}

inspectCollections().catch(err => {
  console.error(err);
  process.exit(1);
});
