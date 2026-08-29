const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`[MongoDB] Database Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[MongoDB Error] Connection Failed: ${error.message}`);
    // Non-fatal exit if database is not local/running so Express server can still respond to healthcheck if needed
  }
};

module.exports = connectDB;
