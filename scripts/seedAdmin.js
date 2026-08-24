const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../config/db');
const User = require('../models/User');

const isValidAdmin = (user) =>
  user &&
  user.role === 'admin' &&
  user.status === 'active' &&
  user.isApproved === true;

const seedAdmin = async () => {
  try {
    await connectDB();

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@yourcompany.com').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.error('[Seed Error] ADMIN_PASSWORD environment variable is required in .env');
      process.exit(1);
    }

    const existingValidAdmin = await User.findOne({
      role: 'admin',
      status: 'active',
      isApproved: true
    });

    if (isValidAdmin(existingValidAdmin)) {
      console.log(
        `[Seed Info] Valid admin already exists (Email: ${existingValidAdmin.email}). Skipping seed.`
      );
      process.exit(0);
    }

    const existingByEmail = await User.findOne({ email: adminEmail }).select('+password');

    if (existingByEmail) {
      const passwordIsValid =
        existingByEmail.password && existingByEmail.password.startsWith('$2')
          ? await bcrypt.compare(adminPassword, existingByEmail.password)
          : false;

      existingByEmail.fullName = 'System Administrator';
      existingByEmail.role = 'admin';
      existingByEmail.status = 'active';
      existingByEmail.isApproved = true;
      existingByEmail.department = existingByEmail.department || 'Executive Administration';

      if (!passwordIsValid) {
        existingByEmail.password = adminPassword;
      }

      await existingByEmail.save();

      console.log('[Seed Success] Existing account promoted to System Administrator:');
      console.log(`- Name: ${existingByEmail.fullName}`);
      console.log(`- Email: ${existingByEmail.email}`);
      console.log(`- Role: ${existingByEmail.role}`);
      console.log(`- Status: ${existingByEmail.status}`);
      console.log(`- Approved: ${existingByEmail.isApproved}`);
      console.log(
        `- Password: ${passwordIsValid ? 'unchanged (already valid)' : 'set from ADMIN_PASSWORD (.env)'}`
      );
      process.exit(0);
    }

    const adminUser = new User({
      fullName: 'System Administrator',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      status: 'active',
      isApproved: true,
      department: 'Executive Administration'
    });

    await adminUser.save();

    console.log('[Seed Success] Initial System Administrator account created successfully:');
    console.log(`- Name: ${adminUser.fullName}`);
    console.log(`- Email: ${adminUser.email}`);
    console.log(`- Role: ${adminUser.role}`);
    console.log(`- Status: ${adminUser.status}`);
    console.log(`- Approved: ${adminUser.isApproved}`);

    process.exit(0);
  } catch (error) {
    console.error(`[Seed Error] Failed to seed Admin user: ${error.message}`);
    process.exit(1);
  }
};

seedAdmin();
