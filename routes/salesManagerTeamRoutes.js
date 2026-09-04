const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getSalesTeamMembers, getSalesTeamMemberProfile } = require('../controllers/salesEmployeeController');
const { createNotificationHelper, notifyRoleHelper } = require('../controllers/notificationController');

// Sales Manager, Admin, CEO can view and manage the Sales team
const managerGuard = [protect, authorize('sales_manager', 'admin', 'ceo')];

const SalesTarget = require('../models/SalesTarget');
const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const FollowUp = require('../models/FollowUp');
const SalesActivity = require('../models/SalesActivity');
const Invoice = require('../models/Invoice');
const Task = require('../models/Task');
const User = require('../models/User');
const logAudit = require('../utils/auditLogger');

// ── GET SALES MANAGER DASHBOARD STATS (Aggregated Real MongoDB Data) ───────────
router.get('/dashboard-stats', managerGuard, async (req, res) => {
  try {
    const now = new Date();

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
      User.find({ role: 'employee', department: { $regex: /^sales$/i } }).select('-password'),
      Lead.find().populate('assignedTo', 'fullName email').sort({ createdAt: -1 }),
      Deal.find().populate('assignedTo', 'fullName email').sort({ createdAt: -1 }),
      Quotation.find().sort({ createdAt: -1 }),
      SalesOrder.find().sort({ createdAt: -1 }),
      Invoice.find().sort({ createdAt: -1 }),
      SalesTarget.find().populate('employee', 'fullName email').sort({ createdAt: -1 }),
      SalesActivity.find().populate('performedBy', 'fullName profileImage email').sort({ createdAt: -1 }).limit(10),
      Task.find({ status: { $ne: 'Completed' } }).sort({ createdAt: -1 }).limit(10)
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
        pipelineValue: `$${stageValue.toLocaleString()}`,
        rawValue: stageValue,
        deals: matchingDeals.map(d => ({
          id: d._id,
          name: d.clientName || 'Client',
          title: d.title,
          company: d.clientName,
          value: `$${Number(d.value || 0).toLocaleString()}`,
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
    const paidInvoices = invoices.filter(i => i.status === 'Paid');
    const paidInvoicesAmount = paidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
    const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
    const invoiceReceivables = unpaidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

    const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
    const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

    const pendingOrders = orders.filter(o => ['Pending', 'Confirmed', 'Processing', 'Shipped'].includes(o.status));
    const orderReceivables = pendingOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const totalReceivables = invoiceReceivables + orderReceivables;

    const ordersDelivered = orders.filter(o => o.status === 'Delivered');
    const deliveredOrdersValue = ordersDelivered.reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const totalMonthlyRevenue = wonDealsValue || deliveredOrdersValue || paidInvoicesAmount;

    // 5. Target Aggregation
    const activeTargets = targets.filter(t => t.status === 'Active' || t.status === 'Ongoing');
    const totalTargetAmount = activeTargets.reduce((sum, t) => sum + (t.targetAmount || 0), 0);
    const totalAchievedTarget = activeTargets.reduce((sum, t) => sum + (t.achievedAmount || 0), 0) || wonDealsValue;
    const teamTargetAchievementPct = totalTargetAmount > 0 
      ? Math.min(100, Math.round((totalAchievedTarget / totalTargetAmount) * 100)) 
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
    if (status && ['pending', 'active', 'suspended', 'rejected'].includes(status)) {
      user.status = status;
      if (status === 'active') user.isApproved = true;
    }

    await user.save();

    await logAudit({
      action: 'Sales Member Updated',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Sales Manager ${req.user.fullName} updated details for team member ${user.fullName}`
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

// ── DELETE / DEACTIVATE SALES TEAM MEMBER ─────────────────────────────────────
router.delete('/team-members/:id', managerGuard, async (req, res) => {
  try {
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

    const employee = await User.findOne({
      _id: employeeId,
      role: 'employee',
      department: { $regex: /^sales$/i },
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

    const employee = await User.findOne({
      _id: employeeId,
      role: 'employee',
      department: { $regex: /^sales$/i },
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

    const employee = await User.findOne({
      _id: employeeId,
      role: 'employee',
      department: { $regex: /^sales$/i }
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Sales employee not found.' });
    }

    const target = await SalesTarget.create({
      employee: employeeId,
      period: period || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      periodType: periodType || 'Monthly',
      targetAmount: Number(targetAmount),
      achievedAmount: 0,
      currency: currency || 'USD',
      status: 'Active',
      notes: notes || '',
      assignedBy: req.user._id,
      startDate: startDate || null,
      endDate: endDate || null
    });

    await SalesActivity.create({
      type: 'Target Updated',
      description: `Target of ${currency || 'USD'} ${Number(targetAmount).toLocaleString()} for ${target.period} assigned by ${req.user.fullName}`,
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
      details: `Assigned target of ${targetAmount} ${currency || 'USD'} for ${target.period} to ${employee.fullName}`
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

// ── INVOICE & BILLING MANAGEMENT (SALES MANAGER REVIEW & OVERSIGHT) ──────────

// 1. GET ALL TEAM INVOICES
router.get('/invoices', managerGuard, async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (employeeId && employeeId !== 'all') {
      query.createdBy = employeeId;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { invoiceNumber: regex },
        { clientName: regex },
        { dealTitle: regex },
        { saleReference: regex },
        { customerEmail: regex }
      ];
    }

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
    const invoice = await Invoice.findById(req.params.id)
      .populate('createdBy', 'fullName email profileImage position department phone')
      .populate('reviewedBy', 'fullName email position')
      .populate('dealId');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
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
          notifMsg = `Sales Manager ${req.user.fullName} has approved your invoice ${invoice.invoiceNumber} for ${invoice.clientName} ($${Number(invoice.amount).toLocaleString()}).`;
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
          message: `Invoice ${invoice.invoiceNumber} for ${invoice.clientName} ($${Number(invoice.amount).toLocaleString()}) has been approved by Sales Manager ${req.user.fullName}.`,
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

module.exports = router;

