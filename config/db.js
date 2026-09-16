const mongoose = require('mongoose');

// Prevent Node.js process crashes on unhandled connection errors
if (!global.__mongooseErrorHandlerRegistered) {
  mongoose.connection.on('error', (err) => {
    console.warn('[MongoDB Event Warning]:', err.message);
  });
  global.__mongooseErrorHandlerRegistered = true;
}

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  const primaryUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fortlinecrm';
  const localFallbackUri = 'mongodb://127.0.0.1:27017/fortlinecrm';

  if (!cached.promise) {
    cached.promise = (async () => {
      try {
        const conn = await mongoose.connect(primaryUri, {
          serverSelectionTimeoutMS: 5000,
        });
        console.log(`[MongoDB] Database Connected: ${conn.connection.host}`);
        return conn;
      } catch (err) {
        if (primaryUri !== localFallbackUri && (primaryUri.includes('mongodb+srv') || primaryUri.includes('mongodb.net'))) {
          console.warn(`[MongoDB Warning] Remote Atlas connection failed (${err.message.split('\n')[0]}).`);
          console.log('[MongoDB Fallback] Switching to Local MongoDB (127.0.0.1:27017)...');
          try {
            await mongoose.disconnect();
            const fallbackConn = await mongoose.connect(localFallbackUri, {
              serverSelectionTimeoutMS: 3000,
            });
            console.log(`[MongoDB Fallback] Successfully connected to Local MongoDB: ${fallbackConn.connection.host}/${fallbackConn.connection.name}`);
            return fallbackConn;
          } catch (fallbackErr) {
            console.error('[MongoDB Fallback Error] Local MongoDB is also unreachable:', fallbackErr.message);
          }
        }
        throw err;
      }
    })();
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
};

module.exports = connectDB;
