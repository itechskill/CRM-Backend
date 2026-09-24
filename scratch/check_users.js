const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');

async function checkDatabaseUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas');

    const users = await User.find().select('fullName email role department').lean();
    console.log('All Users in DB count:', users.length);
    console.log('All Users in DB:', JSON.stringify(users, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkDatabaseUsers();
