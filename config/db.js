const mongoose = require('mongoose');

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://Nexus-user:nexus786@cluster0.tbrgi0q.mongodb.net/?appName=Cluster0';
  if (!uri) {
    console.error('[MongoDB Error] MONGODB_URI environment variable is not defined!');
    return null;
  }

  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      serverSelectionTimeoutMS: 8000,
    };

    cached.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      console.log(`[MongoDB] Database Connected: ${mongooseInstance.connection.host}`);
      return mongooseInstance;
    }).catch((err) => {
      cached.promise = null;
      console.error(`[MongoDB Error] Connection Failed: ${err.message}`);
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    console.error('[MongoDB Connection Error]:', error.message);
    throw error;
  }
};

module.exports = connectDB;
