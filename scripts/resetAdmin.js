/**
 * One-time admin recovery script.
 * Promotes or resets the initial System Administrator account using bcrypt hashing.
 *
 * Usage:
 *   npm run reset:admin              — fix role/status; keep existing password if valid
 *   npm run reset:admin -- --password — also reset password from ADMIN_PASSWORD in .env
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../config/db');
const User = require('../models/User');

const resetPasswordFlag = process.argv.includes('--password');

const resetAdmin = async () => {
  try {
    await connectDB();

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@yourcompany.com').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.error('[Reset Error] ADMIN_PASSWORD environment variable is required in .env');
      process.exit(1);
    }

    let adminUser = await User.findOne({ email: adminEmail }).select('+password');

    if (!adminUser) {
      adminUser = await User.findOne({ role: 'admin' }).select('+password');
    }

    if (!adminUser) {
      console.error('[Reset Error] No admin account found. Run: npm run seed:admin');
      process.exit(1);
    }

    const passwordIsValid =
      adminUser.password && adminUser.password.startsWith('$2')
        ? await bcrypt.compare(adminPassword, adminUser.password)
        : false;

    const shouldResetPassword = resetPasswordFlag || !passwordIsValid;

    adminUser.fullName = 'System Administrator';
    adminUser.email = adminEmail;
    adminUser.role = 'admin';
    adminUser.status = 'active';
    adminUser.isApproved = true;
    adminUser.department = adminUser.department || 'Executive Administration';

    if (shouldResetPassword) {
      adminUser.password = adminPassword;
    }

    await adminUser.save();

    console.log('[Reset Success] System Administrator account restored:');
    console.log(`- Name: ${adminUser.fullName}`);
    console.log(`- Email: ${adminUser.email}`);
    console.log(`- Role: ${adminUser.role}`);
    console.log(`- Status: ${adminUser.status}`);
    console.log(`- Approved: ${adminUser.isApproved}`);
    console.log(
      `- Password: ${shouldResetPassword ? 'reset from ADMIN_PASSWORD (.env)' : 'unchanged (already valid)'}`
    );

    process.exit(0);
  } catch (error) {
    console.error(`[Reset Error] Failed to reset Admin user: ${error.message}`);
    process.exit(1);
  }
};

resetAdmin();
