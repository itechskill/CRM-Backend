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
 * - Sales Manager: isGlobal = false and restricted to their own records only.
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

  return {
    isGlobal: false,
    managerId: user._id,
    memberIds: [user._id],
    memberNames: [user.fullName].filter(Boolean),
    teamMembers: [],
    branch: ''
  };
}

module.exports = {
  getSalesManagerScope,
  inferBranchOrCity
};
