const User = require('../models/User');

/**
 * Infer branch or city from user fields or email tags
 */
function inferBranchOrCity(user) {
  if (!user) return '';
  if (user.branch && user.branch.trim()) return user.branch.trim();
  if (user.city && user.city.trim()) return user.city.trim();

  const email = (user.email || '').toLowerCase();
  if (email.includes('isb') || email.includes('islamabad')) return 'Islamabad';
  if (email.includes('khi') || email.includes('karachi')) return 'Karachi';
  if (email.includes('lhr') || email.includes('lahore')) return 'Lahore';

  return '';
}

/**
 * Get managed team member IDs, names, and scoping for a given user.
 * 
 * - CEO and Admin: isGlobal = true (full visibility across all branches and managers).
 * - Sales Manager: isGlobal = false (restricted strictly to sales persons created by or assigned to this manager,
 *   or within their designated regional branch e.g. Islamabad, Karachi, Lahore).
 */
async function getSalesManagerScope(user) {
  if (!user) {
    return {
      isGlobal: false,
      managerId: null,
      memberIds: [],
      memberNames: [],
      teamMembers: [],
      branch: ''
    };
  }

  // CEO and System Administrator have full global visibility across all branches and regions
  if (['ceo', 'admin'].includes(user.role)) {
    return {
      isGlobal: true,
      managerId: user._id,
      memberIds: [],
      memberNames: [],
      teamMembers: [],
      branch: inferBranchOrCity(user)
    };
  }

  const branch = inferBranchOrCity(user);
  const orConditions = [
    { createdBy: user._id },
    { manager: user._id }
  ];

  if (branch) {
    const branchRegex = new RegExp(`^${branch}$`, 'i');
    orConditions.push({ branch: branchRegex });
    orConditions.push({ city: branchRegex });

    const code = branch.toLowerCase().slice(0, 3); // 'isb', 'khi', 'lhr'
    if (['isb', 'khi', 'lhr'].includes(code)) {
      orConditions.push({ email: new RegExp(code, 'i') });
    }
  }

  // Query all eligible sales persons under this manager or branch
  const teamMembers = await User.find({
    $or: orConditions,
    role: { $in: ['employee', 'sales_rep', 'sales_member', 'sales_person'] },
    _id: { $ne: user._id }
  }).select('_id fullName email branch city createdBy manager role status position salaryTarget profileImage').sort({ fullName: 1 });

  const memberIds = [user._id, ...teamMembers.map(m => m._id)];
  const memberNames = [user.fullName, ...teamMembers.map(m => m.fullName)].filter(Boolean);

  return {
    isGlobal: false,
    managerId: user._id,
    memberIds,
    memberNames,
    teamMembers,
    branch
  };
}

module.exports = {
  getSalesManagerScope,
  inferBranchOrCity
};
