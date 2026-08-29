const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../config/db');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Campaign = require('../models/Campaign');
const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Invoice = require('../models/Invoice');
const Notification = require('../models/Notification');

const sampleEmployees = [
  { fullName: 'System Administrator', email: 'admin@yourcompany.com', role: 'admin', department: 'Executive Administration', employeeId: 'EMP-001' },
  { fullName: 'Eleanor Vance', email: 'ceo@yourcompany.com', role: 'ceo', department: 'Executive Leadership', employeeId: 'EMP-002' },
  { fullName: 'Marcus Brody', email: 'admin.ops@yourcompany.com', role: 'administration', department: 'Operations Management', employeeId: 'EMP-003' },
  { fullName: 'Priya Sharma', email: 'priya.sharma@yourcompany.com', role: 'hr_manager', department: 'Human Resources', employeeId: 'EMP-004' },
  { fullName: 'David Miller', email: 'david.miller@yourcompany.com', role: 'hr_manager', department: 'Human Resources', employeeId: 'EMP-005' },
  { fullName: 'Sarah Mitchell', email: 'sarah.mitchell@yourcompany.com', role: 'sales_manager', department: 'Sales & Business', employeeId: 'EMP-006' },
  { fullName: 'Aisha Nkosi', email: 'aisha.n@yourcompany.com', role: 'sales_manager', department: 'Sales & Business', employeeId: 'EMP-007' },
  { fullName: 'Daniel Torres', email: 'd.torres@yourcompany.com', role: 'project_manager', department: 'Software Engineering', employeeId: 'EMP-008' },
  { fullName: 'Clara Novak', email: 'clara.n@yourcompany.com', role: 'project_manager', department: 'Software Engineering', employeeId: 'EMP-009' },
  { fullName: 'Liam Chen', email: 'liam.chen@yourcompany.com', role: 'marketing', department: 'Growth Marketing', employeeId: 'EMP-010' },
  { fullName: 'Sophia Martinez', email: 'sophia.m@yourcompany.com', role: 'marketing', department: 'Growth Marketing', employeeId: 'EMP-011' },
  { fullName: 'James Okafor', email: 'james.okafor@yourcompany.com', role: 'accountant', department: 'Finance & Accounting', employeeId: 'EMP-012' },
  { fullName: 'Rachel Okafor', email: 'rachel.o@yourcompany.com', role: 'accountant', department: 'Finance & Accounting', employeeId: 'EMP-013' },
  { fullName: 'Marcus Chen', email: 'marcus.c@yourcompany.com', role: 'employee', department: 'Software Engineering', employeeId: 'EMP-014' },
  { fullName: 'Elena Rostova', email: 'elena.r@yourcompany.com', role: 'employee', department: 'Product Design', employeeId: 'EMP-015' },
  { fullName: 'Carlos Rivera', email: 'carlos.r@yourcompany.com', role: 'employee', department: 'Data Analytics', employeeId: 'EMP-016' },
  { fullName: 'Alex Rivera', email: 'alex.r@yourcompany.com', role: 'employee', department: 'Software Engineering', employeeId: 'EMP-017' },
  { fullName: 'Jessica Taylor', email: 'jessica.t@yourcompany.com', role: 'employee', department: 'Quality Assurance', employeeId: 'EMP-018' },
  { fullName: 'Robert Kim', email: 'robert.k@yourcompany.com', role: 'employee', department: 'DevOps & Cloud', employeeId: 'EMP-019' },
  { fullName: 'Hannah Abbott', email: 'hannah.a@yourcompany.com', role: 'employee', department: 'Customer Success', employeeId: 'EMP-020' },
  { fullName: 'Nathan Drake', email: 'nathan.d@yourcompany.com', role: 'employee', department: 'Software Engineering', employeeId: 'EMP-021' },
  { fullName: 'Chloe Frazer', email: 'chloe.f@yourcompany.com', role: 'employee', department: 'UI/UX Design', employeeId: 'EMP-022' }
];

const seedDirectory = async () => {
  try {
    await connectDB();
    console.log('[Seed Directory] Connected to Database.');

    const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';

    for (const empData of sampleEmployees) {
      let user = await User.findOne({ email: empData.email });
      if (!user) {
        user = new User({
          fullName: empData.fullName,
          email: empData.email,
          password: defaultPassword,
          role: empData.role,
          department: empData.department,
          employeeId: empData.employeeId,
          status: 'active',
          isApproved: true
        });
        await user.save();
        console.log(`[Seed Directory] Created user: ${user.fullName} (${user.role})`);
      } else {
        user.department = empData.department;
        user.employeeId = empData.employeeId;
        user.status = 'active';
        user.isApproved = true;
        await user.save();
      }
    }

    // Seed Attendance
    const allUsers = await User.find({ status: 'active' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const u of allUsers) {
      const existingAtt = await Attendance.findOne({ user: u._id, date: { $gte: today } });
      if (!existingAtt) {
        const statuses = ['Present', 'Present', 'Present', 'Late', 'On Leave'];
        const chosenStatus = statuses[Math.floor(Math.random() * statuses.length)];
        await Attendance.create({
          user: u._id,
          userName: u.fullName,
          date: today,
          status: chosenStatus,
          checkIn: chosenStatus === 'On Leave' ? '—' : '09:05 AM',
          checkOut: chosenStatus === 'On Leave' ? '—' : '06:00 PM',
          notes: chosenStatus === 'Late' ? 'Traffic delay' : ''
        });
      }
    }

    // Seed Leaves
    const empUser = allUsers.find(u => u.role === 'employee');
    if (empUser) {
      const existingLeave = await Leave.findOne({ user: empUser._id });
      if (!existingLeave) {
        await Leave.create({
          user: empUser._id,
          userName: empUser.fullName,
          leaveType: 'Annual Leave',
          startDate: new Date(Date.now() + 86400000),
          endDate: new Date(Date.now() + 86400000 * 3),
          reason: 'Family vacation trip',
          proofDocument: 'flight_ticket.pdf',
          status: 'Pending'
        });
      }
    }

    // Seed Marketing Campaign & Lead
    let campaign = await Campaign.findOne({ name: 'Enterprise Cloud Migration Q3' });
    if (!campaign) {
      const mktUser = allUsers.find(u => u.role === 'marketing') || allUsers[0];
      campaign = await Campaign.create({
        name: 'Enterprise Cloud Migration Q3',
        type: 'Email',
        status: 'Active',
        budget: 15000,
        reach: 45000,
        leadsGenerated: 28,
        createdBy: mktUser._id
      });
    }

    let lead = await Lead.findOne({ name: 'Apex Software Group' });
    if (!lead) {
      const salesUser = allUsers.find(u => u.role === 'sales_manager') || allUsers[0];
      lead = await Lead.create({
        name: 'Apex Software Group',
        company: 'Apex Technologies Inc',
        email: 'info@apextech.com',
        phone: '+1 555 0192',
        status: 'Qualified',
        value: 45000,
        source: 'Campaign: Enterprise Cloud Migration Q3',
        assignedTo: salesUser._id,
        createdBy: salesUser._id
      });
    }

    // Seed Deal & Invoice
    let deal = await Deal.findOne({ title: 'Starlight Security Audit' });
    if (!deal) {
      const salesUser = allUsers.find(u => u.role === 'sales_manager') || allUsers[0];
      deal = await Deal.create({
        title: 'Starlight Security Audit',
        clientName: 'Starlight Ventures',
        value: 60000,
        stage: 'Won',
        probability: 100,
        createdBy: salesUser._id
      });
    }

    // Seed Initial Notification
    const accountantUser = allUsers.find(u => u.role === 'accountant') || allUsers[0];
    const existingNotif = await Notification.findOne({ recipient: accountantUser._id });
    if (!existingNotif) {
      await Notification.create({
        recipient: accountantUser._id,
        title: 'New Deal Won — Ready for Invoice',
        message: `Deal "Starlight Security Audit" ($60,000) for Starlight Ventures was won by Sales!`,
        type: 'deal',
        isRead: false
      });
    }

    console.log('[Seed Directory] Finished seeding database with 20+ employees and initial CRM records.');
    process.exit(0);
  } catch (err) {
    console.error('[Seed Directory Error]:', err);
    process.exit(1);
  }
};

seedDirectory();
