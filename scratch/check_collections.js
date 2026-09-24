const mongoose = require('mongoose');
require('dotenv').config();

const AHMED_ID = new mongoose.Types.ObjectId('6a9a5f3d331d4eb8cb2e11bd');

async function inspectAllCollections() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas');

    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('\n--- COLLECTION COUNTS ---');
    for (const col of collections) {
      const count = await mongoose.connection.db.collection(col.name).countDocuments();
      console.log(`${col.name}: ${count} docs`);
    }

    console.log('\n--- AHMED ANJUM RECORDS ---');
    for (const col of collections) {
      const name = col.name;
      const countByCreatedBy = await mongoose.connection.db.collection(name).countDocuments({
        $or: [
          { createdBy: AHMED_ID },
          { salesPerson: AHMED_ID },
          { salePerson: 'Ahmed Anjum' },
          { requestedByUserId: AHMED_ID },
          { user: AHMED_ID }
        ]
      });
      if (countByCreatedBy > 0) {
        console.log(`- ${name}: ${countByCreatedBy} records matching Ahmed Anjum`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

inspectAllCollections();
