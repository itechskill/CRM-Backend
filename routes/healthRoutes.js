const express = require('express');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const router = express.Router();

// GET /api/health
router.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  let dbError = null;
  try {
    await connectDB();
    const readyState = mongoose.connection.readyState;
    dbStatus = readyState === 1 ? 'connected' : readyState === 2 ? 'connecting' : 'disconnected';
  } catch (error) {
    dbStatus = 'error';
    dbError = error.message;
  }

  res.status(200).json({
    success: true,
    message: 'CRM API is running',
    environment: process.env.NODE_ENV || 'production',
    isVercel: Boolean(process.env.VERCEL),
    hasMongoUriEnv: Boolean(process.env.MONGODB_URI),
    database: dbStatus,
    dbError: dbError
  });
});

module.exports = router;
