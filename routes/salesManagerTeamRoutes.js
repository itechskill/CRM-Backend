const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { 
  getSalesTeamMembers, 
  getSalesTeamMemberProfile,
  convertLeadToDeal,
  checkOrderStock,
  getAvailableOrdersForDelivery,
  createMyDeliveryNote,
  updateMyDeliveryNote,
  deleteMyDeliveryNote
} = require('../controllers/salesEmployeeController');
const { createNotificationHelper, notifyRoleHelper } = require('../controllers/notificationController');
const { verifyAndConsumeCEOPermission, hasFieldValueChanged } = require('../utils/editPermissionHelper');

// Sales Manager, Admin, CEO can view and manage the Sales team
const managerGuard = [protect, authorize('sales_manager', 'admin', 'ceo')];

// Workflow Action Endpoints
router.post('/leads/:id/convert-to-deal', managerGuard, convertLeadToDeal);
router.get('/orders/:id/stock-check', managerGuard, checkOrderStock);
router.get('/orders/available-for-delivery', managerGuard, getAvailableOrdersForDelivery);
router.post('/delivery-notes', managerGuard, createMyDeliveryNote);

const SalesTarget = require('../models/SalesTarget');
const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const FollowUp = require('../models/FollowUp');
const SalesActivity = require('../models/SalesActivity');
const Invoice = require('../models/Invoice');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const Payment = require('../models/Payment');
const DeliveryNote = require('../models/DeliveryNote');
const Task = require('../models/Task');
const User = require('../models/User');
const logAudit = require('../utils/auditLogger');
const { getSalesManagerScope, inferBranchOrCity } = require('../utils/salesManagerScope');

// ── GET SALES MANAGER DASHBOARD STATS (Aggregated Real MongoDB Data) ───────────
router.get('/dashboard-stats', managerGuard, async (req, res) => {
  try {
    const now = new Date();
    const scope = await getSalesManagerScope(req.user);

    const userQuery = {
      $or: [
        { role: { $in: ['employee', 'sales_rep', 'sales_member', 'sales_person'] }, department: { $regex: /^sales$/i } },
        { role: { $in: ['sales_rep', 'sales_member', 'sales_person'] } },
        { department: { $regex: /^sales$/i } },
        { position: { $regex: /sales/i } }
      ],
      role: { $nin: ['admin', 'ceo', 'hr_manager', 'accountant', 'sales_manager', 'administration', 'project_manager', 'marketing'] }
    };

    let leadQuery = {};
    let dealQuery = {};
    let quoQuery = {};
    let orderQuery = {};
    let invQuery = {};
    let targetQuery = {};
    let actQuery = {};
    let taskQuery = { status: { $ne: 'Completed' } };

    if (!scope.isGlobal) {
      const managedMemberObjectIds = scope.memberIds.filter(id => id.toString() !== req.user._id.toString());
      userQuery._id = { $in: managedMemberObjectIds };

      const memberIds = scope.memberIds;
      const nameRegexes = scope.memberNames.map(n => new RegExp(`^${n}$`, 'i'));

      leadQuery = { $or: [{ assignedTo: { $in: memberIds } }, { createdBy: { $in: memberIds } }] };
      dealQuery = { $or: [{ assignedTo: { $in: memberIds } }, { createdBy: { $in: memberIds } }] };

      const salesDocOr = [
        { createdBy: { $in: memberIds } },
        { salesPerson: { $in: memberIds } }
      ];
      if (nameRegexes.length > 0) {
        salesDocOr.push({ salePerson: { $in: nameRegexes } });
      }

      quoQuery = { $or: salesDocOr };
      orderQuery = { $or: salesDocOr };
      invQuery = { $or: salesDocOr };
      targetQuery = { employee: { $in: memberIds } };
      actQuery = { performedBy: { $in: memberIds } };
      taskQuery = {
        status: { $ne: 'Completed' },
        $or: [{ assignedTo: { $in: memberIds } }, { createdBy: { $in: memberIds } }]
      };
    }

    const [
      teamMembers,
      leads,
      deals,
      quotations,
      orders,
      invoices,
      targets,
      recentActivities,
      pendingTasks
    ] = await Promise.all([
      User.find(userQuery).select('-password'),
      Lead.find(leadQuery).populate('assignedTo', 'fullName email').sort({ createdAt: -1 }),
      Deal.find(dealQuery).populate('assignedTo', 'fullName email').sort({ createdAt: -1 }),
      Quotation.find(quoQuery).sort({ createdAt: -1 }),
      SalesOrder.find(orderQuery).sort({ createdAt: -1 }),
      Invoice.find(invQuery).populate('createdBy', 'fullName email').sort({ createdAt: -1 }),
      SalesTarget.find(targetQuery).populate('employee', 'fullName email').sort({ createdAt: -1 }),
      SalesActivity.find(actQuery).populate('performedBy', 'fullName profileImage email').sort({ createdAt: -1 }).limit(10),
      Task.find(taskQuery).sort({ createdAt: -1 }).limit(10)
    ]);

    // 1. Team Members Count
    const totalTeamMembers = teamMembers.length;
    const activeTeamMembers = teamMembers.filter(m => m.status === 'active').length;

    // 2. Leads Breakdown
    const totalLeads = leads.length;
    const convertedLeads = leads.filter(l => l.status === 'Converted').length;
    const qualifiedLeads = leads.filter(l => l.status === 'Qualified').length;
    const newLeads = leads.filter(l => l.status === 'New').length;
    const contactedLeads = leads.filter(l => l.status === 'Contacted').length;
    const leadConversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';

    // Lead Sources
    const sourceCounts = {};
    leads.forEach(l => {
      const src = l.source || 'Direct';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });
    const leadSources = Object.keys(sourceCounts).map(src => ({
      name: src,
      value: sourceCounts[src]
    }));

    // 3. Deals Breakdown & Pipeline
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonDealsValue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    const activeDeals = deals.filter(d => !['Won', 'Closed Won', 'Closed Lost'].includes(d.stage));
    const totalPipelineValue = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    // Group deals by stage for kanban/pipeline view
    const stages = [
      { id: 'Prospecting', label: 'PROSPECTING' },
      { id: 'Qualification', label: 'QUALIFICATION' },
      { id: 'Proposal', label: 'PROPOSAL SENT' },
      { id: 'Negotiation', label: 'NEGOTIATION' },
      { id: 'Won', label: 'WON CLIENT' }
    ];

    const pipelineStages = stages.map(stg => {
      const matchingDeals = deals.filter(d => {
        if (stg.id === 'Won') return ['Won', 'Closed Won'].includes(d.stage);
        return d.stage === stg.id;
      });
      const stageValue = matchingDeals.reduce((sum, d) => sum + (d.value || 0), 0);
      return {
        id: stg.id.toLowerCase().replace(/\s+/g, '-'),
        label: stg.label,
        count: matchingDeals.length,
        pipelineValue: `Rs. ${stageValue.toLocaleString()}`,
        rawValue: stageValue,
        deals: matchingDeals.map(d => ({
          id: d._id,
          name: d.clientName || 'Client',
          title: d.title,
          company: d.clientName,
          value: `Rs. ${Number(d.value || 0).toLocaleString()}`,
          rawValue: d.value || 0,
          stage: d.stage,
          assignedTo: d.assignedTo?.fullName || 'Sales Team',
          initials: d.assignedTo?.fullName
            ? d.assignedTo.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
            : 'ST'
        }))
      };
    });

    // 4. Invoices & Financials
    const totalInvoices = invoices.length;
    const approvedInvoicesList = invoices.filter(i => ['Approved', 'Sent', 'Partially Paid', 'Overdue', 'Paid'].includes(i.status));
    const approvedInvoicesCount = approvedInvoicesList.length;
    const paidInvoices = invoices.filter(i => i.status === 'Paid');
    const paidInvoicesAmount = invoices.reduce((sum, i) => sum + (Number(i.paidAmount) || (i.status === 'Paid' ? Number(i.amount) : 0)), 0);

    // Receivables: strictly approved / active invoices with remaining unpaid balance + uninvoiced orders
    const approvedReceivableInvoices = invoices.filter(i =>
      ['Approved', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status) &&
      i.status !== 'Paid' &&
      i.status !== 'Cancelled'
    );
    const invoiceReceivables = approvedReceivableInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);

    const uninvoicedOrders = orders.filter(o => o.invoiceStatus !== 'Fully Invoiced' && o.status !== 'Cancelled');
    const orderReceivables = uninvoicedOrders.reduce((sum, o) => {
      return sum + Math.max(0, Number(o.outstandingBalance || o.netAmount || o.totalAmount || 0));
    }, 0);

    const totalReceivables = invoiceReceivables + orderReceivables;

    // Overdue: strictly approved invoices past due date with remaining unpaid balance + uninvoiced orders past due
    const overdueInvoices = invoices.filter(i => {
      const isApproved = ['Approved', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status);
      const isPastDue = i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now);
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return isApproved && isPastDue && outstanding > 0 && i.status !== 'Paid' && i.status !== 'Cancelled';
    });
    const overdueInvoiceAmountPart = overdueInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);

    const overdueOrders = uninvoicedOrders.filter(o => {
      const orderBaseDate = o.orderDate || o.creationDate || o.createdAt;
      const isPastDue = orderBaseDate && (new Date(orderBaseDate).getTime() + 30 * 24 * 60 * 60 * 1000) < now.getTime();
      return isPastDue && (Number(o.outstandingBalance || o.netAmount || o.totalAmount || 0) > 0);
    });
    const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + Math.max(0, Number(o.outstandingBalance || o.netAmount || o.totalAmount || 0)), 0);

    const overdueInvoiceAmount = overdueInvoiceAmountPart + overdueOrderAmount;

    const overdueList = [
      ...overdueInvoices.map(i => {
        const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
        return {
          _id: i._id,
          invoiceNumber: i.invoiceNumber,
          clientName: i.clientName || 'Client',
          salesRep: i.salePerson || i.createdBy?.fullName || 'Sales Team',
          dueDate: i.dueDate,
          issueDate: i.issueDate,
          amount: Number(i.amount) || 0,
          paidAmount: Number(i.paidAmount) || 0,
          remainingBalance: Math.max(0, outstanding),
          status: i.status || 'Overdue',
          type: 'Invoice'
        };
      }),
      ...overdueOrders.map(o => {
        const baseDate = o.orderDate || o.creationDate || o.createdAt;
        const dueDate = new Date(new Date(baseDate).getTime() + 30 * 24 * 60 * 60 * 1000);
        return {
          _id: o._id,
          invoiceNumber: o.orderNumber || o.orderReference,
          clientName: o.clientName || 'Client',
          salesRep: o.salePerson || 'Sales Team',
          dueDate: dueDate,
          issueDate: baseDate,
          amount: Number(o.totalAmount || o.netAmount || 0),
          paidAmount: Number(o.totalPaid || 0),
          remainingBalance: Math.max(0, Number(o.outstandingBalance || o.totalAmount || 0)),
          status: 'Overdue (Pending Invoice)',
          type: 'Sales Order'
        };
      })
    ];

    const receivablesList = [
      ...approvedReceivableInvoices.map(i => {
        const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
        return {
          _id: i._id,
          invoiceNumber: i.invoiceNumber,
          clientName: i.clientName || 'Client',
          salesRep: i.salePerson || i.createdBy?.fullName || 'Sales Team',
          dueDate: i.dueDate,
          issueDate: i.issueDate,
          amount: Number(i.amount) || 0,
          paidAmount: Number(i.paidAmount) || 0,
          remainingBalance: Math.max(0, outstanding),
          status: i.status || 'Pending',
          type: 'Invoice'
        };
      }),
      ...uninvoicedOrders.map(o => {
        const baseDate = o.orderDate || o.creationDate || o.createdAt;
        const dueDate = new Date(new Date(baseDate).getTime() + 30 * 24 * 60 * 60 * 1000);
        return {
          _id: o._id,
          invoiceNumber: o.orderNumber || o.orderReference,
          clientName: o.clientName || 'Client',
          salesRep: o.salePerson || 'Sales Team',
          dueDate: dueDate,
          issueDate: baseDate,
          amount: Number(o.totalAmount || o.netAmount || 0),
          paidAmount: Number(o.totalPaid || 0),
          remainingBalance: Math.max(0, Number(o.outstandingBalance || o.totalAmount || 0)),
          status: 'To Invoice',
          type: 'Sales Order'
        };
      })
    ];

    const ordersDelivered = orders.filter(o => o.status === 'Delivered');
    const deliveredOrdersValue = ordersDelivered.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
    const totalMonthlyRevenue = wonDealsValue || deliveredOrdersValue || paidInvoicesAmount;

    // 5. Target Aggregation
    const activeTargets = targets.filter(t => t.status === 'Active' || t.status === 'Ongoing');
    const totalTargetAmount = activeTargets.reduce((sum, t) => sum + (t.targetAmount || 0), 0);
    const totalAchievedTarget = activeTargets.reduce((sum, t) => sum + (t.achievedAmount || 0), 0) || wonDealsValue;
    const teamTargetAchievementPct = totalTargetAmount > 0 
      ? Math.round((totalAchievedTarget / totalTargetAmount) * 100) 
      : 0;

    // 6. Monthly Revenue Trend (Last 6 Months calculated from real data)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mIdx = d.getMonth();
      const yr = d.getFullYear();
      const monthLabel = monthNames[mIdx];

      // Sum invoices or won deals for this month
      const monthInvoices = invoices.filter(inv => {
        const invDate = new Date(inv.issueDate || inv.createdAt);
        return invDate.getMonth() === mIdx && invDate.getFullYear() === yr;
      });
      const monthOrders = orders.filter(ord => {
        const ordDate = new Date(ord.createdAt);
        return ordDate.getMonth() === mIdx && ordDate.getFullYear() === yr;
      });

      const actualRevenue = monthInvoices.reduce((s, inv) => s + (inv.amount || 0), 0) +
        monthOrders.reduce((s, ord) => s + (ord.netAmount || 0), 0);

      revenueTrend.push({
        month: monthLabel,
        actual: actualRevenue > 0 ? Math.round(actualRevenue / 1000) : 0,
        target: totalTargetAmount > 0 ? Math.round(totalTargetAmount / 1000) : 100
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        totalTeamMembers,
        activeTeamMembers,
        totalLeads,
        convertedLeads,
        qualifiedLeads,
        newLeads,
        contactedLeads,
        leadConversionRate,
        leadSources,
        totalDeals,
        wonDealsCount,
        wonDealsValue,
        totalPipelineValue,
        pipelineStages,
        totalQuotations: quotations.length,
        proposalsSentCount: quotations.filter(q => q.status === 'Sent' || q.status === 'Accepted').length,
        totalOrders: orders.length,
        totalInvoices,
        paidInvoicesAmount,
        totalReceivables,
        overdueInvoiceAmount,
        overdueList,
        receivablesList,
        totalMonthlyRevenue,
        totalTargetAmount,
        totalAchievedTarget,
        teamTargetAchievementPct,
        revenueTrend,
        recentActivities,
        pendingTasks
      }
    });
  } catch (error) {
    console.error('[Sales Manager Dashboard Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving dashboard statistics.' });
  }
});

// ── GET ALL SALES TEAM MEMBERS ───────────────────────────────────────────────
router.get('/team-members', managerGuard, getSalesTeamMembers);

// ── GET SPECIFIC SALES TEAM MEMBER PROFILE ───────────────────────────────────
router.get('/team-members/:id/profile', managerGuard, getSalesTeamMemberProfile);

// ── UPDATE SALES EMPLOYEE DETAILS (Name, Email, Phone, Position, Salary Target, Status) ──
router.patch('/team-members/:id/details', managerGuard, async (req, res) => {
  try {
    const scope = await getSalesManagerScope(req.user);
    if (!scope.isGlobal && !scope.memberIds.some(id => id.toString() === req.params.id.toString())) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update team members belonging to your branch.' });
    }

    const { fullName, email, phone, position, salaryTarget, status } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Sales team member not found.' });
    }

    if (fullName && fullName.trim()) user.fullName = fullName.trim();
    if (email && email.trim()) user.email = email.trim().toLowerCase();
    if (phone !== undefined) user.phone = phone.trim();
    if (position !== undefined) user.position = position.trim();
    if (salaryTarget !== undefined) user.salaryTarget = Number(salaryTarget) || 0;
    if (status && ['pending', 'active', 'inactive', 'suspended', 'rejected'].includes(status)) {
      user.status = status;
      if (status === 'active') user.isApproved = true;
      if (status === 'inactive') user.isApproved = true; // approved but deactivated by manager
    }

    await user.save();

    await logAudit({
      action: 'Sales Member Updated',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Sales Manager ${req.user.fullName} updated status/details for team member ${user.fullName} (Status: ${user.status})`
    });

    return res.status(200).json({
      success: true,
      message: `Employee details updated successfully for ${user.fullName}.`,
      data: user.toJSON()
    });
  } catch (error) {
    console.error('[Update Sales Employee Details Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating employee details.' });
  }
});

// ── INVITE / REGISTER NEW SALES EMPLOYEE (SUBMITTED TO SYSTEM ADMIN FOR APPROVAL) ──
router.post('/invite-member', managerGuard, async (req, res) => {
  try {
    const { fullName, email, phone, position, salaryTarget, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full Name, Email, and temporary Password are required.'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email address already exists.'
      });
    }

    // Create user in pending state requiring System Admin approval (strictly Sales Team Member role)
    const requestedRole = (req.body.role || 'sales_member').toLowerCase().trim();
    if (['admin', 'ceo', 'hr_manager', 'accountant', 'administration', 'project_manager', 'marketing'].includes(requestedRole)) {
      return res.status(403).json({
        success: false,
        message: 'Sales Manager can only create or invite Sales Team Member accounts.'
      });
    }

    const reqPos = (position && position.trim()) ? position.trim() : 'Sales Representative';
    const isSalesPerson = reqPos.toLowerCase().includes('person') || req.body.role === 'sales_person' || req.body.role === 'sales_member';
    const assignedRole = isSalesPerson ? 'sales_person' : 'sales_rep';
    const assignedPosition = isSalesPerson ? 'Sales Person' : 'Sales Representative';
    const targetVal = Number(salaryTarget || req.body.target) || 0;
    const resolvedBranch = (req.body.branch || req.body.city || inferBranchOrCity(req.user) || '').trim();

    const newUser = new User({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      position: assignedPosition,
      salaryTarget: targetVal,
      password: password,
      role: assignedRole,
      department: 'Sales',
      status: 'pending',
      isApproved: false,
      createdBy: req.user._id,
      manager: req.user._id,
      branch: resolvedBranch,
      city: resolvedBranch
    });

    await newUser.save();

    if (targetVal > 0) {
      await SalesTarget.create({
        employee: newUser._id,
        targetAmount: targetVal,
        period: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        periodType: 'Monthly',
        currency: 'PKR',
        status: 'Active',
        assignedBy: req.user._id,
        startDate: new Date(),
        endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
      }).catch(err => console.error('[Create SalesTarget Error]:', err.message));
    }

    // Notify System Admin
    await notifyRoleHelper({
      role: 'admin',
      sender: req.user._id,
      title: 'New Sales Member Registration Request',
      message: `Sales Manager ${req.user.fullName} has registered a new sales employee "${newUser.fullName}" (${newUser.email}). Pending your approval.`,
      type: 'registration'
    });

    await logAudit({
      action: 'Sales Member Invited',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: newUser._id,
      targetUserName: newUser.fullName,
      details: `Sales Manager ${req.user.fullName} submitted registration for ${newUser.fullName} (${newUser.email}). Awaiting System Admin approval.`
    });

    return res.status(201).json({
      success: true,
      message: 'Sales employee registration submitted successfully. Account is pending System Admin approval before login is enabled.',
      data: newUser.toJSON()
    });
  } catch (error) {
    console.error('[Invite Sales Member Error]:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error creating registration request.' });
  }
});

// ── DELETE / DEACTIVATE SALES TEAM MEMBER ─────────────────────────────────────
router.delete('/team-members/:id', managerGuard, async (req, res) => {
  try {
    const scope = await getSalesManagerScope(req.user);
    if (!scope.isGlobal && !scope.memberIds.some(id => id.toString() === req.params.id.toString())) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete team members belonging to your branch.' });
    }

    const member = await User.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Sales team member not found.' });
    }

    if (member._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const memberName = member.fullName;
    const memberEmail = member.email;

    // Delete user account per authentication/user-management rules
    // Historical records (Leads, Quotations, Sales Orders, Invoices, Deals) remain preserved in MongoDB
    await User.findByIdAndDelete(req.params.id);

    await logAudit({
      action: 'Sales Member Deleted',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: member._id,
      targetUserName: memberName,
      details: `Sales Manager ${req.user.fullName} removed sales member account for ${memberName} (${memberEmail})`
    });

    return res.status(200).json({
      success: true,
      message: `Sales team member ${memberName} deleted successfully. Historical sales records remain preserved.`
    });
  } catch (error) {
    console.error('[Delete Sales Team Member Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting team member.' });
  }
});

// ── WORK ASSIGNMENT: ASSIGN LEAD ──────────────────────────────────────────────
router.post('/assign-lead', managerGuard, async (req, res) => {
  try {
    const { leadId, employeeId, name, company, email, phone, status, value, source, notes } = req.body;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required.' });
    }

    const scope = await getSalesManagerScope(req.user);
    if (!scope.isGlobal && !scope.memberIds.some(id => id.toString() === employeeId.toString())) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only assign leads to team members in your branch.' });
    }

    const employee = await User.findOne({
      _id: employeeId,
      $or: [
        { role: { $in: ['employee', 'sales_rep', 'sales_person', 'sales_member'] }, department: { $regex: /^sales$/i } },
        { role: { $in: ['sales_rep', 'sales_person', 'sales_member'] } },
        { department: { $regex: /^sales$/i } }
      ],
      status: 'active'
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Active Sales employee not found.' });
    }

    let lead;
    if (leadId) {
      lead = await Lead.findById(leadId);
      if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
      lead.assignedTo = employeeId;
      await lead.save();
    } else {
      if (!name) return res.status(400).json({ success: false, message: 'Lead name is required.' });
      lead = await Lead.create({
        name: name.trim(),
        company: company?.trim() || '',
        email: email?.trim() || '',
        phone: phone?.trim() || '',
        status: status || 'New',
        value: value ? Number(value) : 0,
        source: source || 'Assigned by Manager',
        notes: notes || '',
        assignedTo: employeeId,
        createdBy: req.user._id
      });
    }

    await SalesActivity.create({
      type: 'Lead Created',
      description: `Lead "${lead.name}" assigned to ${employee.fullName} by ${req.user.fullName}`,
      relatedModel: 'Lead',
      relatedId: lead._id,
      performedBy: employeeId
    });

    await logAudit({
      action: 'Lead Assigned',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: employee._id,
      targetUserName: employee.fullName,
      details: `Manager ${req.user.fullName} assigned lead ${lead.name} to ${employee.fullName}`
    });

    return res.status(200).json({
      success: true,
      message: `Lead "${lead.name}" successfully assigned to ${employee.fullName}.`,
      data: lead
    });
  } catch (error) {
    console.error('[Assign Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error assigning lead.' });
  }
});

// ── WORK ASSIGNMENT: ASSIGN FOLLOW-UP ─────────────────────────────────────────
router.post('/assign-followup', managerGuard, async (req, res) => {
  try {
    const { employeeId, title, description, contactName, contactEmail, contactPhone, type, scheduledAt, leadId } = req.body;

    if (!employeeId || !title) {
      return res.status(400).json({ success: false, message: 'Employee ID and Title are required.' });
    }

    const scope = await getSalesManagerScope(req.user);
    if (!scope.isGlobal && !scope.memberIds.some(id => id.toString() === employeeId.toString())) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only assign follow-ups to team members in your branch.' });
    }

    const employee = await User.findOne({
      _id: employeeId,
      $or: [
        { role: { $in: ['employee', 'sales_rep', 'sales_person', 'sales_member'] }, department: { $regex: /^sales$/i } },
        { role: { $in: ['sales_rep', 'sales_person', 'sales_member'] } },
        { department: { $regex: /^sales$/i } }
      ],
      status: 'active'
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Active Sales employee not found.' });
    }

    const followUp = await FollowUp.create({
      title: title.trim(),
      description: description || '',
      contactName: contactName?.trim() || '',
      contactEmail: contactEmail?.trim() || '',
      contactPhone: contactPhone?.trim() || '',
      type: type || 'Call',
      status: 'Pending',
      scheduledAt: scheduledAt || null,
      lead: leadId || null,
      createdBy: employeeId
    });

    await SalesActivity.create({
      type: 'Follow-up Created',
      description: `Follow-up "${followUp.title}" assigned by ${req.user.fullName}`,
      relatedModel: 'FollowUp',
      relatedId: followUp._id,
      performedBy: employeeId
    });

    return res.status(201).json({
      success: true,
      message: `Follow-up "${followUp.title}" successfully assigned to ${employee.fullName}.`,
      data: followUp
    });
  } catch (error) {
    console.error('[Assign Follow-up Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error assigning follow-up.' });
  }
});

// ── MONTHLY SALES TARGET ASSIGNMENT ───────────────────────────────────────────
router.post('/targets', managerGuard, async (req, res) => {
  try {
    const { employeeId, period, periodType, targetAmount, currency, notes, startDate, endDate } = req.body;

    if (!employeeId || !targetAmount) {
      return res.status(400).json({ success: false, message: 'Employee ID and target amount are required.' });
    }

    const scope = await getSalesManagerScope(req.user);
    if (!scope.isGlobal && !scope.memberIds.some(id => id.toString() === employeeId.toString())) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only assign targets to team members in your branch.' });
    }

    const employee = await User.findOne({
      _id: employeeId,
      $or: [
        { role: { $in: ['employee', 'sales_rep', 'sales_person', 'sales_member'] }, department: { $regex: /^sales$/i } },
        { role: { $in: ['sales_rep', 'sales_person', 'sales_member'] } },
        { department: { $regex: /^sales$/i } }
      ]
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Sales employee not found.' });
    }

    // Replace / Archive previous active targets for this employee to ensure single active target
    await SalesTarget.updateMany(
      { employee: employeeId, status: { $in: ['Active', 'Ongoing'] } },
      { status: 'Archived' }
    );

    const target = await SalesTarget.create({
      employee: employeeId,
      period: period || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      periodType: periodType || 'Monthly',
      targetAmount: Number(targetAmount),
      achievedAmount: 0,
      currency: currency || 'PKR',
      status: 'Active',
      notes: notes || '',
      assignedBy: req.user._id,
      startDate: startDate || null,
      endDate: endDate || null
    });

    await SalesActivity.create({
      type: 'Target Updated',
      description: `Target of ${currency || 'PKR'} ${Number(targetAmount).toLocaleString()} for ${target.period} assigned by ${req.user.fullName}`,
      relatedModel: 'SalesTarget',
      relatedId: target._id,
      performedBy: employeeId
    });

    await logAudit({
      action: 'Sales Target Assigned',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: employee._id,
      targetUserName: employee.fullName,
      details: `Assigned target of PKR ${Number(targetAmount).toLocaleString()} for ${target.period} to ${employee.fullName}`
    });

    const { createNotificationHelper } = require('../controllers/notificationController');
    await createNotificationHelper({
      recipient: employee._id,
      sender: req.user._id,
      title: 'New Sales Target Assigned',
      message: `Sales Manager (${req.user.fullName}) assigned you a sales target of PKR ${Number(targetAmount).toLocaleString()} for ${target.period}.`,
      type: 'sales',
      link: '/employee/sales/sales_targets'
    });

    return res.status(201).json({
      success: true,
      message: `Sales target assigned successfully to ${employee.fullName}.`,
      data: target
    });
  } catch (error) {
    console.error('[Assign Target Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error assigning target.' });
  }
});

// ── UPDATE TARGET ─────────────────────────────────────────────────────────────
router.patch('/targets/:id', managerGuard, async (req, res) => {
  try {
    const target = await SalesTarget.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'Target not found.' });

    const allowedFields = ['targetAmount', 'achievedAmount', 'period', 'periodType', 'status', 'notes', 'startDate', 'endDate'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) target[field] = req.body[field];
    });

    await target.save();
    return res.status(200).json({ success: true, message: 'Target updated successfully.', data: target });
  } catch (error) {
    console.error('[Update Target Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating target.' });
  }
});

// ── DELETE TARGET ─────────────────────────────────────────────────────────────
router.delete('/targets/:id', managerGuard, async (req, res) => {
  try {
    const target = await SalesTarget.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'Target not found.' });

    await SalesTarget.findByIdAndDelete(req.params.id);

    await logAudit({
      action: 'Sales Target Deleted',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      details: `Sales Manager ${req.user.fullName} deleted target for period ${target.period}`
    });

    return res.status(200).json({ success: true, message: 'Assigned target deleted successfully.' });
  } catch (error) {
    console.error('[Delete Target Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting target.' });
  }
});

// ── INVOICE & BILLING MANAGEMENT (SALES MANAGER REVIEW & OVERSIGHT) ──────────

// 1. GET ALL TEAM INVOICES
router.get('/invoices', managerGuard, async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const scope = await getSalesManagerScope(req.user);
    const conditions = [];

    if (!scope.isGlobal) {
      const nameRegexes = scope.memberNames.map(n => new RegExp(`^${n}$`, 'i'));
      const teamScopeConditions = [
        { createdBy: { $in: scope.memberIds } },
        { salesPerson: { $in: scope.memberIds } }
      ];
      if (nameRegexes.length > 0) {
        teamScopeConditions.push({ salePerson: { $in: nameRegexes } });
      }

      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) {
          return res.status(200).json({ success: true, count: 0, data: [] });
        }
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      } else {
        conditions.push({ $or: teamScopeConditions });
      }
    } else {
      if (employeeId && employeeId !== 'all') {
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      }
    }

    if (status && status !== 'all') {
      conditions.push({ status });
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [
          { invoiceNumber: regex },
          { clientName: regex },
          { dealTitle: regex },
          { saleReference: regex },
          { customerEmail: regex }
        ]
      });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const invoices = await Invoice.find(query)
      .populate('createdBy', 'fullName email profileImage position department')
      .populate('reviewedBy', 'fullName email')
      .populate('dealId', 'title value stage clientName contactEmail contactPhone')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    console.error('[Sales Manager Get Invoices Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving invoices.' });
  }
});

// 2. GET SPECIFIC INVOICE
router.get('/invoices/:id', managerGuard, async (req, res) => {
  try {
    const scope = await getSalesManagerScope(req.user);
    const invoice = await Invoice.findById(req.params.id)
      .populate('createdBy', 'fullName email profileImage position department phone')
      .populate('reviewedBy', 'fullName email position')
      .populate('dealId');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    if (!scope.isGlobal) {
      const creatorId = invoice.createdBy?._id || invoice.createdBy;
      const salesPersonId = invoice.salesPerson?._id || invoice.salesPerson;
      const isAllowed = scope.memberIds.some(id => 
        (creatorId && id.toString() === creatorId.toString()) ||
        (salesPersonId && id.toString() === salesPersonId.toString())
      );
      if (!isAllowed) {
        return res.status(403).json({ success: false, message: 'Access denied. You can only view invoices belonging to your branch.' });
      }
    }

    return res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('[Sales Manager Get Single Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving invoice.' });
  }
});

// 3. EDIT / APPROVE / REJECT INVOICE
router.patch('/invoices/:id', managerGuard, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    const changes = {};
    Object.keys(req.body).forEach(field => {
      if (req.body[field] !== undefined && hasFieldValueChanged(invoice[field], req.body[field])) {
        changes[field] = { old: invoice[field], new: req.body[field] };
      }
    });

    const docType = invoice.status === 'Draft' || invoice.type === 'Draft' ? 'Draft Invoice' : 'Final Invoice';
    const check = await verifyAndConsumeCEOPermission({
      documentType: docType,
      documentId: invoice._id,
      documentNumber: invoice.invoiceNumber,
      requestingUser: req.user,
      changes
    });

    if (!check.authorized) {
      return res.status(403).json({ success: false, message: check.message });
    }

    const {
      status,
      rejectionReason,
      clientName,
      customerEmail,
      customerPhone,
      customerAddress,
      items,
      subtotal,
      tax,
      taxRate,
      discount,
      amount,
      paymentTerms,
      dueDate,
      issueDate,
      description,
      notes
    } = req.body;

    const oldStatus = invoice.status;

    // Update fields if provided
    if (clientName !== undefined) invoice.clientName = clientName.trim();
    if (customerEmail !== undefined) invoice.customerEmail = customerEmail.trim();
    if (customerPhone !== undefined) invoice.customerPhone = customerPhone.trim();
    if (customerAddress !== undefined) invoice.customerAddress = customerAddress.trim();
    if (paymentTerms !== undefined) invoice.paymentTerms = paymentTerms;
    if (dueDate !== undefined) invoice.dueDate = new Date(dueDate);
    if (issueDate !== undefined) invoice.issueDate = new Date(issueDate);
    if (description !== undefined) invoice.description = description;
    if (notes !== undefined) invoice.notes = notes;
    if (subtotal !== undefined) invoice.subtotal = Number(subtotal);
    if (tax !== undefined) invoice.tax = Number(tax);
    if (taxRate !== undefined) invoice.taxRate = Number(taxRate);
    if (discount !== undefined) invoice.discount = Number(discount);
    if (amount !== undefined) invoice.amount = Number(amount);

    if (Array.isArray(items)) {
      invoice.items = items.map(item => ({
        description: item.description || 'Sales Item',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        total: Number(item.total) || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0))
      }));
    }

    // Status transitions & review recording
    if (status && status !== oldStatus) {
      invoice.status = status;
      invoice.reviewedBy = req.user._id;
      invoice.reviewedAt = new Date();

      if (status === 'Rejected') {
        invoice.rejectionReason = rejectionReason || 'Rejected by Sales Manager';
      } else if (status === 'Approved') {
        invoice.rejectionReason = '';
      }

      // Notify the Sales Team Member who created this invoice
      if (invoice.createdBy) {
        let notifTitle = `Invoice ${invoice.invoiceNumber} Update`;
        let notifMsg = `Your invoice ${invoice.invoiceNumber} status was changed to ${status} by Sales Manager ${req.user.fullName}.`;
        
        if (status === 'Approved') {
          notifTitle = `Invoice ${invoice.invoiceNumber} Approved!`;
          notifMsg = `Sales Manager ${req.user.fullName} has approved your invoice ${invoice.invoiceNumber} for ${invoice.clientName} (Rs. ${Number(invoice.amount).toLocaleString()}).`;
        } else if (status === 'Rejected') {
          notifTitle = `Invoice ${invoice.invoiceNumber} Rejected`;
          notifMsg = `Invoice ${invoice.invoiceNumber} was rejected by ${req.user.fullName}. Reason: ${invoice.rejectionReason}`;
        }

        await createNotificationHelper({
          recipient: invoice.createdBy,
          sender: req.user._id,
          title: notifTitle,
          message: notifMsg,
          type: 'sales'
        });
      }

      // If approved, notify Finance / Accountant
      if (status === 'Approved') {
        await notifyRoleHelper({
          role: 'accountant',
          sender: req.user._id,
          title: 'Invoice Approved for Processing',
          message: `Invoice ${invoice.invoiceNumber} for ${invoice.clientName} (Rs. ${Number(invoice.amount).toLocaleString()}) has been approved by Sales Manager ${req.user.fullName}.`,
          type: 'finance'
        });
      }
    }

    await invoice.save();

    await SalesActivity.create({
      type: 'Invoice Updated',
      description: `Invoice ${invoice.invoiceNumber} updated by Sales Manager ${req.user.fullName} (Status: ${invoice.status})`,
      relatedModel: 'Invoice',
      relatedId: invoice._id,
      performedBy: req.user._id
    });

    await logAudit({
      action: 'Invoice Updated',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: invoice.createdBy,
      targetUserName: invoice.clientName,
      details: `Sales Manager ${req.user.fullName} updated invoice ${invoice.invoiceNumber} (Status: ${invoice.status})`
    });

    const populated = await Invoice.findById(invoice._id)
      .populate('createdBy', 'fullName email profileImage position department')
      .populate('reviewedBy', 'fullName email')
      .populate('dealId');

    return res.status(200).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} updated successfully.`,
      data: populated
    });
  } catch (error) {
    console.error('[Sales Manager Update Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating invoice.' });
  }
});

// 4. DELETE INVOICE
router.delete('/invoices/:id', managerGuard, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    const invNum = invoice.invoiceNumber;
    const client = invoice.clientName;
    const creatorId = invoice.createdBy;

    await Invoice.findByIdAndDelete(req.params.id);

    // Notify Creator
    if (creatorId) {
      await createNotificationHelper({
        recipient: creatorId,
        sender: req.user._id,
        title: `Invoice ${invNum} Removed`,
        message: `Invoice ${invNum} for ${client} has been deleted by Sales Manager ${req.user.fullName}.`,
        type: 'sales'
      });
    }

    await logAudit({
      action: 'Invoice Deleted',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: creatorId,
      targetUserName: client,
      details: `Sales Manager ${req.user.fullName} deleted invoice ${invNum}`
    });

    return res.status(200).json({
      success: true,
      message: `Invoice ${invNum} deleted successfully.`
    });
  } catch (error) {
    console.error('[Sales Manager Delete Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting invoice.' });
  }
});

// ── GET ALL ORDERS (SALES MANAGER) ──────────────────────────────────────────
router.get('/all-orders', managerGuard, async (req, res) => {
  try {
    const { employeeId, status, deliveryStatus, invoiceStatus, paymentStatus, search } = req.query;
    const scope = await getSalesManagerScope(req.user);
    const conditions = [];

    if (!scope.isGlobal) {
      const nameRegexes = scope.memberNames.map(n => new RegExp(`^${n}$`, 'i'));
      const teamScopeConditions = [
        { createdBy: { $in: scope.memberIds } },
        { salesPerson: { $in: scope.memberIds } }
      ];
      if (nameRegexes.length > 0) {
        teamScopeConditions.push({ salePerson: { $in: nameRegexes } });
      }

      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) {
          return res.status(200).json({ success: true, count: 0, data: [] });
        }
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      } else {
        conditions.push({ $or: teamScopeConditions });
      }
    } else {
      if (employeeId && employeeId !== 'all') {
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      }
    }

    if (status && status !== 'all') conditions.push({ status });
    if (deliveryStatus && deliveryStatus !== 'all') conditions.push({ deliveryStatus });
    if (invoiceStatus && invoiceStatus !== 'all') conditions.push({ invoiceStatus });
    if (paymentStatus && paymentStatus !== 'all') conditions.push({ paymentStatus });

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [
          { orderNumber: regex },
          { orderReference: regex },
          { customerName: regex },
          { clientName: regex },
          { customerPONumber: regex },
          { invoiceNumber: regex },
          { fileNo: regex },
          { productSummary: regex },
          { salePerson: regex }
        ]
      });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const orders = await SalesOrder.find(query)
      .populate('createdBy', 'fullName email position department profileImage')
      .populate('salesPerson', 'fullName email position department profileImage')
      .populate('quotationId')
      .populate('customerPOId')
      .populate('productFileId')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('[Sales Manager Get All Orders Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving orders.' });
  }
});

// ── GET ALL CUSTOMER POS (SALES MANAGER) ────────────────────────────────────
router.get('/all-customer-pos', managerGuard, async (req, res) => {
  try {
    const { employeeId, search } = req.query;
    const scope = await getSalesManagerScope(req.user);
    const conditions = [];

    if (!scope.isGlobal) {
      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) return res.status(200).json({ success: true, count: 0, data: [] });
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      } else {
        conditions.push({
          $or: [{ createdBy: { $in: scope.memberIds } }, { salesPerson: { $in: scope.memberIds } }]
        });
      }
    } else {
      if (employeeId && employeeId !== 'all') {
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      }
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [{ poNumber: regex }, { customerName: regex }, { quotationNumber: regex }] });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const customerPOs = await CustomerPO.find(query)
      .populate('createdBy', 'fullName email position department profileImage')
      .populate('quotationId')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: customerPOs.length, data: customerPOs });
  } catch (error) {
    console.error('[Sales Manager Get All Customer POs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving customer POs.' });
  }
});

// ── GET ALL PRODUCT FILES (SALES MANAGER) ───────────────────────────────────
router.get('/all-product-files', managerGuard, async (req, res) => {
  try {
    const { employeeId, fileType, search } = req.query;
    const scope = await getSalesManagerScope(req.user);
    const conditions = [];

    if (!scope.isGlobal) {
      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) return res.status(200).json({ success: true, count: 0, data: [] });
        conditions.push({ createdBy: employeeId });
      } else {
        conditions.push({ createdBy: { $in: scope.memberIds } });
      }
    } else {
      if (employeeId && employeeId !== 'all') conditions.push({ createdBy: employeeId });
    }

    if (fileType && fileType !== 'all') conditions.push({ fileType });
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [{ fileNumber: regex }, { customerName: regex }, { quotationNumber: regex }, { customerPONumber: regex }, { salesOrderNumber: regex }]
      });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const productFiles = await ProductFile.find(query)
      .populate('createdBy', 'fullName email position department profileImage')
      .populate('quotationId')
      .populate('customerPOId')
      .populate('salesOrderId')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: productFiles.length, data: productFiles });
  } catch (error) {
    console.error('[Sales Manager Get All Product Files Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving product files.' });
  }
});

// ── GET ALL PAYMENTS (SALES MANAGER) ────────────────────────────────────────
router.get('/all-payments', managerGuard, async (req, res) => {
  try {
    const { employeeId, paymentType, search } = req.query;
    const scope = await getSalesManagerScope(req.user);
    const conditions = [];

    if (!scope.isGlobal) {
      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) return res.status(200).json({ success: true, count: 0, data: [] });
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      } else {
        conditions.push({
          $or: [{ createdBy: { $in: scope.memberIds } }, { salesPerson: { $in: scope.memberIds } }]
        });
      }
    } else {
      if (employeeId && employeeId !== 'all') {
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      }
    }

    if (paymentType && paymentType !== 'all') conditions.push({ paymentType });
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [{ paymentRefNumber: regex }, { customerName: regex }, { invoiceNumber: regex }, { salesOrderNumber: regex }]
      });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const payments = await Payment.find(query)
      .populate('createdBy', 'fullName email position department profileImage')
      .populate('salesOrderId')
      .populate('invoiceId')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: payments.length, data: payments });
  } catch (error) {
    console.error('[Sales Manager Get All Payments Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving payments.' });
  }
});

// ── GET ALL ACTIVITIES (SALES MANAGER) ──────────────────────────────────────
router.get('/all-activities', managerGuard, async (req, res) => {
  try {
    const { employeeId, type, search } = req.query;
    const scope = await getSalesManagerScope(req.user);
    const conditions = [];

    if (!scope.isGlobal) {
      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) return res.status(200).json({ success: true, count: 0, data: [] });
        conditions.push({ performedBy: employeeId });
      } else {
        conditions.push({ performedBy: { $in: scope.memberIds } });
      }
    } else {
      if (employeeId && employeeId !== 'all') conditions.push({ performedBy: employeeId });
    }

    if (type && type !== 'all') conditions.push({ type });
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [{ description: regex }, { type: regex }, { relatedCustomer: regex }, { salesMemberName: regex }]
      });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const activities = await SalesActivity.find(query)
      .populate('performedBy', 'fullName email position department profileImage')
      .sort({ createdAt: -1 })
      .limit(200);
    return res.status(200).json({ success: true, count: activities.length, data: activities });
  } catch (error) {
    console.error('[Sales Manager Get All Activities Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving activities.' });
  }
});

// ── GET ALL DELIVERY NOTES (SALES MANAGER) ──────────────────────────────────
router.get('/all-delivery-notes', managerGuard, async (req, res) => {
  try {
    const { employeeId, status, search } = req.query;
    const scope = await getSalesManagerScope(req.user);
    const conditions = [];

    if (!scope.isGlobal) {
      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) return res.status(200).json({ success: true, count: 0, data: [] });
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      } else {
        conditions.push({
          $or: [{ createdBy: { $in: scope.memberIds } }, { salesPerson: { $in: scope.memberIds } }]
        });
      }
    } else {
      if (employeeId && employeeId !== 'all') {
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      }
    }

    if (status && status !== 'all') conditions.push({ status });
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [{ deliveryNoteNumber: regex }, { customerName: regex }, { salesOrderRef: regex }]
      });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const deliveryNotes = await DeliveryNote.find(query)
      .populate('createdBy', 'fullName email position department profileImage')
      .populate('salesOrderId')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: deliveryNotes.length, data: deliveryNotes });
  } catch (error) {
    console.error('[Sales Manager Get All Delivery Notes Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving delivery notes.' });
  }
});

// ── UPDATE DELIVERY NOTE (SALES MANAGER) ──────────────────────────────────
router.patch('/delivery-notes/:id', managerGuard, async (req, res) => {
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });

    const changes = {};
    Object.keys(req.body).forEach(field => {
      if (req.body[field] !== undefined && hasFieldValueChanged(deliveryNote[field], req.body[field])) {
        changes[field] = { old: deliveryNote[field], new: req.body[field] };
      }
    });

    const check = await verifyAndConsumeCEOPermission({
      documentType: 'Delivery Note',
      documentId: deliveryNote._id,
      documentNumber: deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber,
      requestingUser: req.user,
      changes
    });

    if (!check.authorized) {
      return res.status(403).json({ success: false, message: check.message });
    }

    const allowedFields = [
      'clientName',
      'recipientName',
      'recipientPhone',
      'deliveryAddress',
      'trackingNumber',
      'carrier',
      'deliveryDate',
      'items',
      'notes',
      'status',
      'receivedBy',
      'deliveryType',
      'salesOrderId',
      'salesOrderNumber',
      'operationType',
      'sourceLocation',
      'scheduledDate',
      'deadline',
      'productAvailability',
      'sourceDocument',
      'starred'
    ];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) deliveryNote[field] = req.body[field];
    });
    await deliveryNote.save();
    return res.status(200).json({ success: true, message: 'Delivery note updated.', data: deliveryNote });
  } catch (error) {
    console.error('[Sales Manager Update Delivery Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating delivery note.' });
  }
});

// ── DELETE DELIVERY NOTE (SALES MANAGER) ──────────────────────────────────
router.delete('/delivery-notes/:id', managerGuard, async (req, res) => {
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });
    await DeliveryNote.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Delivery note deleted successfully.' });
  } catch (error) {
    console.error('[Sales Manager Delete Delivery Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting delivery note.' });
  }
});

module.exports = router;

