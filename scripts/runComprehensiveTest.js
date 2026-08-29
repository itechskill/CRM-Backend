const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../config/db');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { registerUser, loginUser, logoutUser, getMe, forgotPassword, resetPassword } = require('../controllers/authController');
const { getRegistrationRequests, approveRegistrationRequest, rejectRegistrationRequest } = require('../controllers/adminController');
const { getProfile, updateProfile } = require('../controllers/userController');
const { requireRole, requirePermission, PERMISSIONS } = require('../middleware/roleMiddleware');

const ALL_ROLES = [
  'admin',
  'ceo',
  'administration',
  'hr_manager',
  'sales_manager',
  'project_manager',
  'marketing',
  'accountant',
  'employee'
];

// Helper mock response
const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: null
  };
  res.status = function (s) {
    this.statusCode = s;
    return this;
  };
  res.json = function (d) {
    this.body = d;
    return this;
  };
  return res;
};

const runComprehensiveSuite = async () => {
  console.log('===============================================================');
  console.log('      NEXUS CRM COMPREHENSIVE AUTH & SECURITY TEST SUITE       ');
  console.log('===============================================================\n');

  await connectDB();

  let testPassedCount = 0;
  let testTotalCount = 0;

  const assert = (condition, testName, detail = '') => {
    testTotalCount++;
    if (condition) {
      testPassedCount++;
      console.log(`[PASS] ${testName} ${detail ? `(${detail})` : ''}`);
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
    }
  };

  // Clean test accounts before starting
  await User.deleteMany({ email: /@testsuite\.com$/ });

  // -------------------------------------------------------------
  // SECTION 1: REGISTRATION TESTS
  // -------------------------------------------------------------
  console.log('\n--- SECTION 1: REGISTRATION TESTS ---');

  // 1.1 Valid Registration
  const reqRegValid = {
    body: {
      fullName: 'Test Employee',
      email: 'employee@testsuite.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'employee',
      department: 'Engineering'
    }
  };
  const resRegValid = createMockRes();
  await registerUser(reqRegValid, resRegValid);
  assert(resRegValid.statusCode === 201 && resRegValid.body.success, '1.1 New User Public Registration', 'Status pending, isApproved false');

  // 1.2 Duplicate Email Block
  const resRegDup = createMockRes();
  await registerUser(reqRegValid, resRegDup);
  assert(resRegDup.statusCode === 400 && !resRegDup.body.success, '1.2 Duplicate Email Prevention', resRegDup.body.message);

  // 1.3 Invalid Email Format
  const reqRegBadEmail = {
    body: {
      fullName: 'Bad Email',
      email: 'invalidemailformat',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'employee'
    }
  };
  const resRegBadEmail = createMockRes();
  await registerUser(reqRegBadEmail, resRegBadEmail);
  assert(resRegBadEmail.statusCode === 400, '1.3 Invalid Email Format Validation', resRegBadEmail.body.message);

  // 1.4 Weak Password (< 6 chars)
  const reqRegWeakPass = {
    body: {
      fullName: 'Weak Pass',
      email: 'weakpass@testsuite.com',
      password: '123',
      confirmPassword: '123',
      role: 'employee'
    }
  };
  const resRegWeakPass = createMockRes();
  await registerUser(reqRegWeakPass, resRegWeakPass);
  assert(resRegWeakPass.statusCode === 400, '1.4 Weak Password Validation', resRegWeakPass.body.message);

  // 1.5 Password Mismatch
  const reqRegMismatch = {
    body: {
      fullName: 'Mismatch User',
      email: 'mismatch@testsuite.com',
      password: 'Password123!',
      confirmPassword: 'DifferentPassword123!',
      role: 'employee'
    }
  };
  const resRegMismatch = createMockRes();
  await registerUser(reqRegMismatch, resRegMismatch);
  assert(resRegMismatch.statusCode === 400, '1.5 Password Mismatch Validation', resRegMismatch.body.message);

  // 1.6 Invalid Role Selection
  const reqRegInvalidRole = {
    body: {
      fullName: 'Invalid Role',
      email: 'invalidrole@testsuite.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'super_hacker_role'
    }
  };
  const resRegInvalidRole = createMockRes();
  await registerUser(reqRegInvalidRole, resRegInvalidRole);
  assert(resRegInvalidRole.statusCode === 400, '1.6 Invalid Role Validation', resRegInvalidRole.body.message);

  // 1.7 Admin Registration Guard (Strictly Blocked)
  const reqRegAdminAttempt = {
    body: {
      fullName: 'Evil Admin Attempt',
      email: 'eviladmin@testsuite.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'admin'
    }
  };
  const resRegAdminAttempt = createMockRes();
  await registerUser(reqRegAdminAttempt, resRegAdminAttempt);
  assert(resRegAdminAttempt.statusCode === 403, '1.7 Admin Public Registration Guard', resRegAdminAttempt.body.message);

  // -------------------------------------------------------------
  // SECTION 2: APPROVAL & REJECTION TESTS
  // -------------------------------------------------------------
  console.log('\n--- SECTION 2: APPROVAL & REJECTION TESTS ---');

  // Fetch or Seed System Admin
  let adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    adminUser = new User({
      fullName: 'System Administrator',
      email: 'admin@testsuite.com',
      password: 'AdminPassword123!',
      role: 'admin',
      status: 'active',
      isApproved: true
    });
    await adminUser.save();
  }

  // Register user to be approved & user to be rejected
  const reqUserToApprove = {
    body: {
      fullName: 'Approved HR Manager',
      email: 'hr@testsuite.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'hr_manager',
      department: 'HR'
    }
  };
  await registerUser(reqUserToApprove, createMockRes());
  const hrUserDoc = await User.findOne({ email: 'hr@testsuite.com' });

  const reqUserToReject = {
    body: {
      fullName: 'Rejected Applicant',
      email: 'rejected@testsuite.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'marketing'
    }
  };
  await registerUser(reqUserToReject, createMockRes());
  const rejectUserDoc = await User.findOne({ email: 'rejected@testsuite.com' });

  // 2.1 Admin Approval Test
  const reqApprove = { params: { id: hrUserDoc._id.toString() }, user: adminUser };
  const resApprove = createMockRes();
  await approveRegistrationRequest(reqApprove, resApprove);
  const updatedHR = await User.findById(hrUserDoc._id);
  assert(resApprove.statusCode === 200 && updatedHR.status === 'active' && updatedHR.isApproved === true, '2.1 Admin Registration Approval', `Approved by ${updatedHR.approvedBy}`);

  // 2.2 Admin Rejection Test with Reason
  const reqReject = {
    params: { id: rejectUserDoc._id.toString() },
    user: adminUser,
    body: { rejectionReason: 'Incomplete background credentials' }
  };
  const resReject = createMockRes();
  await rejectRegistrationRequest(reqReject, resReject);
  const updatedReject = await User.findById(rejectUserDoc._id);
  assert(resReject.statusCode === 200 && updatedReject.status === 'rejected' && updatedReject.rejectionReason === 'Incomplete background credentials', '2.2 Admin Registration Rejection', `Reason: ${updatedReject.rejectionReason}`);

  // 2.3 Non-Admin Approval Guard
  const reqUnauthorizedApprove = { params: { id: hrUserDoc._id.toString() }, user: updatedHR };
  const resUnauthorizedApprove = createMockRes();
  const authGuardMiddleware = requireRole('admin');
  authGuardMiddleware(reqUnauthorizedApprove, resUnauthorizedApprove, () => {});
  assert(resUnauthorizedApprove.statusCode === 403, '2.3 Non-Admin Approval Block', resUnauthorizedApprove.body.message);

  // -------------------------------------------------------------
  // SECTION 3: LOGIN TESTS
  // -------------------------------------------------------------
  console.log('\n--- SECTION 3: LOGIN TESTS ---');

  // 3.1 Active Approved Account Login
  const reqLoginActive = { body: { email: 'hr@testsuite.com', password: 'Password123!' } };
  const resLoginActive = createMockRes();
  await loginUser(reqLoginActive, resLoginActive);
  assert(resLoginActive.statusCode === 200 && !!resLoginActive.body.token, '3.1 Active Approved Account Login', 'JWT Token Generated');

  // 3.2 Pending Account Login Block
  const pendingUserDoc = await User.findOne({ email: 'employee@testsuite.com' });
  const reqLoginPending = { body: { email: 'employee@testsuite.com', password: 'Password123!' } };
  const resLoginPending = createMockRes();
  await loginUser(reqLoginPending, resLoginPending);
  assert(resLoginPending.statusCode === 403, '3.2 Pending Account Login Block', resLoginPending.body.message);

  // 3.3 Rejected Account Login Block
  const reqLoginRejected = { body: { email: 'rejected@testsuite.com', password: 'Password123!' } };
  const resLoginRejected = createMockRes();
  await loginUser(reqLoginRejected, resLoginRejected);
  assert(resLoginRejected.statusCode === 403, '3.3 Rejected Account Login Block', resLoginRejected.body.message);

  // 3.4 Suspended Account Login Block
  const suspendedUserDoc = new User({
    fullName: 'Suspended Employee',
    email: 'suspended@testsuite.com',
    password: 'Password123!',
    role: 'employee',
    status: 'suspended',
    isApproved: true
  });
  await suspendedUserDoc.save();

  const reqLoginSuspended = { body: { email: 'suspended@testsuite.com', password: 'Password123!' } };
  const resLoginSuspended = createMockRes();
  await loginUser(reqLoginSuspended, resLoginSuspended);
  assert(resLoginSuspended.statusCode === 403, '3.4 Suspended Account Login Block', resLoginSuspended.body.message);

  // 3.5 Incorrect Password Test
  const reqLoginBadPass = { body: { email: 'hr@testsuite.com', password: 'WrongPassword999!' } };
  const resLoginBadPass = createMockRes();
  await loginUser(reqLoginBadPass, resLoginBadPass);
  assert(resLoginBadPass.statusCode === 401, '3.5 Incorrect Password Block', resLoginBadPass.body.message);

  // 3.6 Non-Existing Email Test
  const reqLoginNoEmail = { body: { email: 'nonexistent999@testsuite.com', password: 'Password123!' } };
  const resLoginNoEmail = createMockRes();
  await loginUser(reqLoginNoEmail, resLoginNoEmail);
  assert(resLoginNoEmail.statusCode === 401, '3.6 Non-Existing Email Block', resLoginNoEmail.body.message);

  // -------------------------------------------------------------
  // SECTION 4: ALL 9 ROLES CROSS-PORTAL AUTHORIZATION MATRIX
  // -------------------------------------------------------------
  console.log('\n--- SECTION 4: ALL 9 ROLES AUTHORIZATION MATRIX TESTS ---');

  // Create active approved users for all 9 roles
  const roleUsers = {};
  for (const role of ALL_ROLES) {
    let u = await User.findOne({ email: `${role}@testsuite.com` });
    if (!u) {
      u = new User({
        fullName: `Test ${role}`,
        email: `${role}@testsuite.com`,
        password: 'Password123!',
        role,
        status: 'active',
        isApproved: true
      });
      await u.save();
    }
    roleUsers[role] = u;
  }

  // Test Admin Access: ONLY 'admin' can pass requireRole('admin')
  for (const role of ALL_ROLES) {
    const middleware = requireRole('admin');
    const req = { user: roleUsers[role] };
    const res = createMockRes();
    middleware(req, res, () => { res.statusCode = 200; });
    const expected = (role === 'admin') ? 200 : 403;
    assert(res.statusCode === expected, `4.1 Admin Portal Guard vs '${role}'`, res.statusCode === 200 ? 'Access Allowed' : 'Access Denied (Forbidden)');
  }

  // Test CEO Access Guard vs Technical Admin Action
  const ceoMiddleware = requirePermission(PERMISSIONS.MANAGE_SYSTEM);
  const ceoReq = { user: roleUsers['ceo'] };
  const ceoRes = createMockRes();
  ceoMiddleware(ceoReq, ceoRes, () => { ceoRes.statusCode = 200; });
  assert(ceoRes.statusCode === 403, '4.2 CEO Technical System Admin Access Guard', ceoRes.body ? ceoRes.body.message : 'Forbidden');

  // Test HR Manager vs Finance Access Guard
  const financeMiddleware = requirePermission(PERMISSIONS.MANAGE_FINANCE);
  const hrReq = { user: roleUsers['hr_manager'] };
  const hrRes = createMockRes();
  financeMiddleware(hrReq, hrRes, () => { hrRes.statusCode = 200; });
  assert(hrRes.statusCode === 403, '4.3 HR Manager Finance Access Guard', 'Forbidden');

  // Test Sales Manager vs HR Access Guard
  const hrMiddleware = requirePermission(PERMISSIONS.MANAGE_HR);
  const salesReq = { user: roleUsers['sales_manager'] };
  const salesRes = createMockRes();
  hrMiddleware(salesReq, salesRes, () => { salesRes.statusCode = 200; });
  assert(salesRes.statusCode === 403, '4.4 Sales Manager HR Access Guard', 'Forbidden');

  // -------------------------------------------------------------
  // SECTION 5: SECURITY & PROFILE TAMPERING GUARDS
  // -------------------------------------------------------------
  console.log('\n--- SECTION 5: SECURITY & PROFILE TAMPERING GUARDS ---');

  // Attempt to escalate role via PATCH /api/users/me
  const empUser = roleUsers['employee'];
  const reqTamper = {
    user: empUser,
    body: {
      fullName: 'Employee Updated',
      role: 'admin', // Tamper attempt
      status: 'active',
      isApproved: true
    }
  };
  const resTamper = createMockRes();
  await updateProfile(reqTamper, resTamper);
  const verifiedEmp = await User.findById(empUser._id);
  assert(resTamper.statusCode === 200 && verifiedEmp.role === 'employee', '5.1 Role Escalation Tampering Prevention', `Role remains '${verifiedEmp.role}'`);

  // Clean test accounts
  await User.deleteMany({ email: /@testsuite\.com$/ });

  console.log('\n===============================================================');
  console.log(`  COMPREHENSIVE TEST SUITE SUMMARY: ${testPassedCount} / ${testTotalCount} PASSED`);
  console.log('===============================================================\n');

  process.exit(0);
};

runComprehensiveSuite().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
