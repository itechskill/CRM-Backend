const mongoose = require('mongoose');
require('dotenv').config();

async function fullWipe() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fortCRM';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB for complete test data removal...\n');
  
  // Collections that MUST NOT be touched
  const protectedCollections = ['users', 'roles', 'permissions'];
  
  const cols = await mongoose.connection.db.listCollections().toArray();
  
  for (const c of cols) {
    const colName = c.name;
    if (protectedCollections.includes(colName)) {
      console.log(`[SKIPPED PROTECTED] ${colName}`);
    } else {
      const res = await mongoose.connection.db.collection(colName).deleteMany({});
      console.log(`[CLEARED] ${colName}: deleted ${res.deletedCount} documents`);
    }
  }
  
  console.log('\n=================================================');
  console.log('SUCCESS: All testing data has been wiped clean!');
  console.log('User accounts remain intact so you can log in.');
  console.log('=================================================\n');
  
  await mongoose.disconnect();
}

fullWipe().catch(err => {
  console.error('Error during full wipe:', err);
  process.exit(1);
});
