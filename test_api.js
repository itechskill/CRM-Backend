const http = require('http');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const token = jwt.sign({ id: 'dummy_admin_id', role: 'admin' }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026', { expiresIn: '1h' });

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
  res.on('end', () => console.log('STATUS:', res.statusCode, 'DATA:', data));
});
req.on('error', err => console.error('Error:', err));
req.end();
