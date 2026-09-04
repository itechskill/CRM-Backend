const express = require('express');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const router = express.Router();

// GET /api/health
router.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await connectDB();
    const readyState = mongoose.connection.readyState;
    dbStatus = readyState === 1 ? 'connected' : readyState === 2 ? 'connecting' : 'disconnected';
  } catch (error) {
    dbStatus = `error: ${error.message}`;
  }

  res.status(200).json({
    success: true,
    message: 'CRM API is running',
    environment: process.env.NODE_ENV || 'production',
    hasMongoUri: Boolean(process.env.MONGODB_URI) || 'using_fallback',
    database: dbStatus
  });
});

module.exports = router;
