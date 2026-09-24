const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
.then(async () => {
  const admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    console.error('No admin found!');
    process.exit(1);
  }
  
  const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026', { expiresIn: '1h' });
  
  const http = require('http');
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/registration-requests',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  };

  const req = http.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      console.log('DATA:', data);
      process.exit(0);
    });
  });
  req.on('error', err => {
    console.error('Request Error:', err);
    process.exit(1);
  });
  req.end();
}).catch(err => {
  console.error(err);
  process.exit(1);
});
