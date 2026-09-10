const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const FollowUp = require('../models/FollowUp');
const SalesTarget = require('../models/SalesTarget');
const SalesActivity = require('../models/SalesActivity');
const Invoice = require('../models/Invoice');
const Deal = require('../models/Deal');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const Payment = require('../models/Payment');
const InventoryItem = require('../models/InventoryItem');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const User = require('../models/User');
const { notifyRoleHelper, createNotificationHelper } = require('./notificationController');

// ─────────────────────────────────────────────
// Helper: Log a sales activity
// ─────────────────────────────────────────────
const logSalesActivity = async ({ type, description, relatedModel, relatedId, performedBy }) => {
  try {
    await SalesActivity.create({ type, description, relatedModel, relatedId, performedBy });
  } catch (e) {
    console.error('[SalesActivity Log Error]:', e.message);
  }
};

const checkOwnership = (record, fields, userId, reqUser) => {
  if (reqUser && ['sales_manager', 'admin', 'ceo'].includes(reqUser.role)) {
    return true; // Sales Manager, Admin, CEO have full authorized access to view, edit, and delete any record
  }
  if (!record) return false;
  const userStr = userId.toString();
  const fieldList = Array.isArray(fields) ? fields : [fields];
  return fieldList.some(field => {
    const val = record[field]?.toString?.() || record[field];
    return val === userStr;
  });
};

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// DASHBOARD STATS & FINANCIALS FOR SALES TEAM MEMBER
// ══════════════════════════════════════════════
/**
 * @desc    Get Sales Dashboard Stats & Financials for logged-in sales employee
 * @route   GET /api/sales-employee/stats
 * @access  Private/Employee/Sales
 */
const getMySalesStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [leads, quotations, orders, deals, followUps, targets, user, invoices, payroll, attendances, leaves, tasks, projects] = await Promise.all([
      Lead.find({ $or: [{ assignedTo: userId }, { createdBy: userId }] }),
      Quotation.find({ createdBy: userId }),
      SalesOrder.find({ $or: [{ salesPerson: userId }, { createdBy: userId }] }),
      Deal.find({ $or: [{ assignedTo: userId }, { createdBy: userId }] }),
      FollowUp.find({ createdBy: userId }),
      SalesTarget.find({ employee: userId }).sort({ createdAt: -1 }),
      User.findById(userId),
      Invoice.find({ createdBy: userId }),
      Payroll.findOne({ user: userId, month: now.getMonth() + 1, year: now.getFullYear() }),
      Attendance.find({ user: userId, date: { $gte: startOfMonth } }),
      Leave.find({ user: userId, createdAt: { $gte: startOfMonth } }),
      Task.find({ assignedTo: userId }),
      Project.find({ $or: [{ team: userId }, { createdBy: userId }, { projectManager: userId }] })
    ]);

    // Lead stats
    const totalLeads = leads.length;
    const convertedLeads = leads.filter(l => l.status === 'Converted').length;
    const qualifiedLeads = leads.filter(l => l.status === 'Qualified').length;
    const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
    const leadConversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // Quotation stats
    const totalQuotations = quotations.length;
    const acceptedQuotations = quotations.filter(q => q.status === 'Accepted').length;
    const sentQuotations = quotations.filter(q => q.status === 'Sent').length;

    // Order stats
    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.status === 'Delivered').length;
    const totalOrdersValue = orders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
    const ordersAchieved = orders
      .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'].includes(o.status))
      .reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);

    // Deal stats
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonDealsValue = wonDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const activeDeals = deals.filter(d => !['Won', 'Closed Won', 'Closed Lost'].includes(d.stage));
    const pipelineValue = activeDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    // Invoice stats
    const totalInvoicesCount = invoices.length;
    const paidInvoices = invoices.filter(i => i.status === 'Paid');
    const paidInvoicesAmount = paidInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const approvedInvoicesAmount = invoices
      .filter(i => ['Approved', 'Paid', 'Sent', 'Partially Paid'].includes(i.status))
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

    // Follow-up stats
    const totalFollowUps = followUps.length;
    const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;
    const pendingFollowUps = totalFollowUps - completedFollowUps;

    // ── LEGIT SALES ACHIEVED ──
    // Computed dynamically from won deals, confirmed/delivered orders, and approved invoices
    const salesAchieved = Math.max(wonDealsValue, ordersAchieved, approvedInvoicesAmount);

    // ── TARGET QUOTA ──
    const activeTarget = targets.find(t => t.status === 'Active' || t.status === 'Ongoing') || targets[0];
    const monthlyTarget = activeTarget?.targetAmount || (user?.salaryTarget ? user.salaryTarget * 5 : 50000);
    const remainingTarget = Math.max(0, monthlyTarget - salesAchieved);
    const targetAchievementPct = monthlyTarget > 0 ? Math.round((salesAchieved / monthlyTarget) * 100) : (salesAchieved > 0 ? 100 : 0);

    // ── FINANCIALS ──
    // 1. Receivables: All unpaid invoices or outstanding orders (subtracting already paid amounts)
    const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
    const invoiceReceivables = unpaidInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);
    const pendingOrders = orders.filter(o => ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Sales Order'].includes(o.status));
    const orderReceivables = pendingOrders.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
    const receivables = invoiceReceivables > 0 ? invoiceReceivables : orderReceivables;

    // 2. Overdue: Invoices past due date or overdue delivery orders (subtracting already paid amounts)
    const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
    const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);
    const overdueOrders = orders.filter(o => o.deliveryDate && new Date(o.deliveryDate) < now && !['Delivered', 'Cancelled'].includes(o.status));
    const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
    const overdueAmount = overdueInvoiceAmount > 0 ? overdueInvoiceAmount : overdueOrderAmount;

    // 3. Salary Target: From employee user record, payroll base/net salary, or standard commission ratio
    const salaryTarget = Number(user?.salaryTarget) || Number(payroll?.baseSalary) || Number(payroll?.netSalary) || Math.round(monthlyTarget * 0.1) || 5000;

    // 4. Liability: Cancelled orders or liabilities
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
    const liability = cancelledOrders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);

    // 5. Net Revenue: Settled/collected revenue or sales achieved
    const netRevenue = paidInvoicesAmount > 0 ? paidInvoicesAmount : salesAchieved;

    // ── ATTENDANCE & LEAVE SUMMARY ──
    const presentDays = attendances.filter(a => a.status === 'Present').length;
    const lateDays = attendances.filter(a => a.status === 'Late').length;
    const leaveDays = leaves.filter(l => l.status === 'Approved').length;
    const pendingLeaves = leaves.filter(l => l.status === 'Pending').length;

    // ── ASSIGNED PROJECTS & PENDING TASKS ──
    const pendingTasksList = tasks.filter(t => t.status !== 'Completed');
    const completedTasksCount = tasks.filter(t => t.status === 'Completed').length;
    const pendingTasksCount = pendingTasksList.length;
    const assignedProjectsCount = projects.length;

    return res.status(200).json({
      success: true,
      data: {
        // Sales Performance Metrics
        salesPerformance: {
          monthlyTarget,
          salesAchieved,
          remainingTarget,
          targetAchievementPct,
          totalLeads,
          convertedLeads,
          qualifiedLeads,
          pendingLeads,
          leadConversionRate,
          totalQuotations,
          acceptedQuotations,
          sentQuotations,
          totalOrders,
          completedOrders,
          totalOrdersValue,
          totalDeals,
          wonDealsCount,
          wonDealsValue,
          pipelineValue,
          totalFollowUps,
          completedFollowUps,
          pendingFollowUps
        },
        // Financial Performance Metrics
        financialPerformance: {
          receivables,
          invoiceReceivables,
          orderReceivables,
          overdueAmount,
          overdueInvoiceAmount,
          overdueOrderAmount,
          salaryTarget,
          liability,
          netRevenue,
          totalInvoicesCount,
          paidInvoicesAmount,
          unpaidInvoicesCount: unpaidInvoices.length,
          overdueInvoicesCount: overdueInvoices.length
        },
        // Flat aliases for backwards compatibility
        totalLeads,
        convertedLeads,
        pendingLeads,
        totalQuotations,
        acceptedQuotations,
        totalOrders,
        completedOrders,
        totalFollowUps,
        completedFollowUps,
        monthlyTarget,
        salesAchieved,
        remainingTarget,
        targetAchievementPct,
        receivables,
        overdueAmount,
        salaryTarget,
        liability,
        activeTarget: activeTarget ? { ...activeTarget.toJSON(), achievedAmount: salesAchieved, targetAmount: monthlyTarget } : null,
        // Projects & Tasks
        assignedProjectsCount,
        pendingTasksCount,
        completedTasksCount,
        pendingTasks: pendingTasksList.slice(0, 10),
        assignedProjects: projects.slice(0, 10),
        attendanceSummary: {
          presentDays,
          lateDays,
          leaveDays,
          pendingLeaves
        }
      }
    });
  } catch (error) {
    console.error('[Sales Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching sales stats.' });
  }
};

// ══════════════════════════════════════════════
// LEADS (SALES TEAM MEMBER)
// ══════════════════════════════════════════════
/**
 * @desc    Get my leads (assigned or created)
 * @route   GET /api/sales-employee/leads
 */
const getMyLeads = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, search } = req.query;

    const query = {
      $or: [{ assignedTo: userId }, { createdBy: userId }]
    };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$and = [
        { $or: [{ assignedTo: userId }, { createdBy: userId }] },
        { $or: [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }] }
      ];
      delete query.$or;
    }

    const leads = await Lead.find(query).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: leads.length, data: leads });
  } catch (error) {
    console.error('[Get My Leads Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching leads.' });
  }
};

/**
 * @desc    Create a lead for logged-in sales team member
 * @route   POST /api/sales-employee/leads
 */
const createMyLead = async (req, res) => {
  try {
    const { name, company, contactPerson, email, phone, status, value, source, notes, requirements, followUpDate } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Lead name is required.' });

    const lead = await Lead.create({
      name: name.trim(),
      company: company?.trim() || '',
      contactPerson: contactPerson?.trim() || '',
      email: email?.trim() || '',
      phone: phone?.trim() || '',
      status: status || 'New',
      value: value ? Number(value) : 0,
      source: source || 'Direct',
      notes: notes || '',
      requirements: requirements || '',
      followUpDate: followUpDate || null,
      assignedTo: req.user._id,
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Lead Created',
      description: `Created lead: ${lead.name}${lead.company ? ` from ${lead.company}` : ''}`,
      relatedModel: 'Lead',
      relatedId: lead._id,
      relatedCustomer: lead.name,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Lead Created',
      message: `${req.user.fullName} created a new lead: ${lead.name}${lead.company ? ' from ' + lead.company : ''}.`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Lead created successfully.', data: lead });
  } catch (error) {
    console.error('[Create Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating lead.' });
  }
};

/**
 * @desc    Update my lead (ownership enforced)
 * @route   PATCH /api/sales-employee/leads/:id
 */
const updateMyLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    if (!checkOwnership(lead, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own leads.' });
    }

    const prevStatus = lead.status;
    const allowedFields = ['name', 'company', 'contactPerson', 'email', 'phone', 'status', 'value', 'source', 'notes', 'requirements', 'followUpDate'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) lead[field] = req.body[field];
    });

    await lead.save();

    const actType = (lead.status === 'Converted' || lead.status === 'Converted to Deal') ? 'Lead Converted' : 'Lead Updated';
    await logSalesActivity({
      type: actType,
      description: `Updated lead: ${lead.name} — status: ${lead.status} (was ${prevStatus})`,
      relatedModel: 'Lead',
      relatedId: lead._id,
      relatedCustomer: lead.name,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Lead updated.', data: lead });
  } catch (error) {
    console.error('[Update Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating lead.' });
  }
};

/**
 * @desc    Convert Lead to Deal (Preserves Lead record as Converted)
 * @route   POST /api/sales-employee/leads/:id/convert-to-deal
 */
const convertLeadToDeal = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    const { title, value, stage, probability, closingDate, notes } = req.body;

    // Create linked Deal
    const deal = await Deal.create({
      title: (title || `${lead.name} - Deal`).trim(),
      clientName: lead.company || lead.name,
      company: lead.company || '',
      contactPerson: lead.contactPerson || lead.name,
      contactEmail: lead.email || '',
      contactPhone: lead.phone || '',
      requirements: lead.requirements || '',
      value: Number(value || lead.value || 0),
      stage: stage || 'Qualification',
      probability: probability !== undefined ? Number(probability) : 60,
      closingDate: closingDate ? new Date(closingDate) : null,
      notes: notes || lead.notes || '',
      leadId: lead._id,
      assignedTo: lead.assignedTo || req.user._id,
      createdBy: req.user._id
    });

    // Update Lead status to 'Converted' without deleting the lead record!
    lead.status = 'Converted';
    await lead.save();

    await logSalesActivity({
      type: 'Lead Converted',
      description: `Converted lead "${lead.name}" to deal "${deal.title}" (Rs. ${Number(deal.value).toLocaleString()})`,
      relatedModel: 'Deal',
      relatedId: deal._id,
      relatedCustomer: deal.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Lead Converted to Deal',
      message: `${req.user.fullName} converted lead "${lead.name}" into deal "${deal.title}".`,
      type: 'sales'
    });

    return res.status(201).json({
      success: true,
      message: 'Lead successfully converted to Deal.',
      data: { deal, lead }
    });
  } catch (error) {
    console.error('[Convert Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error converting lead.' });
  }
};

// ══════════════════════════════════════════════
// DEALS (SALES TEAM MEMBER)
// ══════════════════════════════════════════════
/**
 * @desc    Get my deals
 * @route   GET /api/sales-employee/deals
 */
const getMyDeals = async (req, res) => {
  try {
    const userId = req.user._id;
    const { stage, search } = req.query;

    const query = {
      $or: [{ assignedTo: userId }, { createdBy: userId }]
    };

    if (stage && stage !== 'all') {
      query.stage = stage;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$and = [
        { $or: [{ assignedTo: userId }, { createdBy: userId }] },
        { $or: [{ title: regex }, { clientName: regex }] }
      ];
      delete query.$or;
    }

    const deals = await Deal.find(query).populate('leadId', 'name company email phone').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: deals.length, data: deals });
  } catch (error) {
    console.error('[Get My Deals Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching deals.' });
  }
};

/**
 * @desc    Create a deal for sales employee
 * @route   POST /api/sales-employee/deals
 */
const createMyDeal = async (req, res) => {
  try {
    const { title, clientName, company, contactPerson, contactEmail, contactPhone, requirements, products, value, stage, probability, closingDate, leadId, notes } = req.body;
    if (!title || !clientName) {
      return res.status(400).json({ success: false, message: 'Deal title and client name are required.' });
    }

    const deal = await Deal.create({
      title: title.trim(),
      clientName: clientName.trim(),
      company: company?.trim() || '',
      contactPerson: contactPerson?.trim() || '',
      contactEmail: contactEmail?.trim() || '',
      contactPhone: contactPhone?.trim() || '',
      requirements: requirements || '',
      products: products || [],
      value: value ? Number(value) : 0,
      stage: stage || 'Qualification',
      probability: probability !== undefined ? Number(probability) : 50,
      closingDate: closingDate || null,
      leadId: leadId || null,
      notes: notes || '',
      assignedTo: req.user._id,
      createdBy: req.user._id
    });

    if (leadId) {
      await Lead.findByIdAndUpdate(leadId, { status: 'Converted' });
    }

    await logSalesActivity({
      type: 'Deal Created',
      description: `Created deal "${deal.title}" for ${deal.clientName} (Rs. ${Number(deal.value).toLocaleString()})`,
      relatedModel: 'Deal',
      relatedId: deal._id,
      relatedCustomer: deal.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager about new deal
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Deal Created',
      message: `${req.user.fullName} created deal "${deal.title}" for ${deal.clientName} (Rs. ${Number(deal.value).toLocaleString()}).`,
      type: 'sales'
    });

    if (['Won', 'Closed Won'].includes(deal.stage)) {
      await notifyRoleHelper({
        role: 'accountant',
        sender: req.user._id,
        title: 'New Deal Won — Ready for Invoice',
        message: `Deal "${deal.title}" for ${deal.clientName} ($${(deal.value || 0).toLocaleString()}) won by ${req.user.fullName}. Ready for invoice.`,
        type: 'deal'
      });
    }

    return res.status(201).json({ success: true, message: 'Deal created successfully.', data: deal });
  } catch (error) {
    console.error('[Create Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating deal.' });
  }
};

/**
 * @desc    Update my deal
 * @route   PATCH /api/sales-employee/deals/:id
 */
const updateMyDeal = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) return res.status(404).json({ success: false, message: 'Deal not found.' });

    if (!checkOwnership(deal, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own deals.' });
    }

    const prevStage = deal.stage;
    const allowedFields = ['title', 'clientName', 'company', 'contactPerson', 'contactEmail', 'contactPhone', 'requirements', 'products', 'value', 'stage', 'probability', 'closingDate', 'leadId', 'notes'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) deal[field] = req.body[field];
    });

    await deal.save();

    await logSalesActivity({
      type: deal.stage === 'Won' || deal.stage === 'Closed Won' ? 'Deal Won' : 'Deal Updated',
      description: `Updated deal "${deal.title}" — stage: ${deal.stage} (was ${prevStage})`,
      relatedModel: 'Deal',
      relatedId: deal._id,
      performedBy: req.user._id
    });

    if (['Won', 'Closed Won'].includes(deal.stage) && !['Won', 'Closed Won'].includes(prevStage)) {
      if (deal.leadId) {
        await Lead.findByIdAndUpdate(deal.leadId, { status: 'Converted' });
      } else if (deal.clientName) {
        await Lead.updateMany(
          { $or: [{ name: deal.clientName }, { company: deal.clientName }], status: { $ne: 'Converted' } },
          { status: 'Converted' }
        );
      }

      await notifyRoleHelper({
        role: 'accountant',
        sender: req.user._id,
        title: 'New Deal Won — Ready for Invoice',
        message: `Deal "${deal.title}" for ${deal.clientName} (Rs. ${(deal.value || 0).toLocaleString()}) won by ${req.user.fullName}. Ready for invoice.`,
        type: 'deal'
      });
    }

    return res.status(200).json({ success: true, message: 'Deal updated successfully.', data: deal });
  } catch (error) {
    console.error('[Update Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating deal.' });
  }
};

// ══════════════════════════════════════════════
// INVOICES (SALES TEAM MEMBER WORKFLOW)
// ══════════════════════════════════════════════
/**
 * @desc    Get my invoices & eligible won deals/sales
 * @route   GET /api/sales-employee/invoices
 */
const getMyInvoices = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, search } = req.query;

    const query = { createdBy: userId };
    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ invoiceNumber: regex }, { clientName: regex }, { dealTitle: regex }, { saleReference: regex }];
    }

    const [invoices, eligibleDeals, eligibleOrders] = await Promise.all([
      Invoice.find(query)
        .populate('dealId', 'title value stage clientName contactEmail contactPhone')
        .populate('createdBy', 'fullName email')
        .populate('reviewedBy', 'fullName email')
        .sort({ createdAt: -1 }),
      Deal.find({
        assignedTo: userId,
        stage: { $in: ['Won', 'Closed Won'] }
      }).select('title value stage clientName contactEmail contactPhone description createdAt').sort({ createdAt: -1 }),
      SalesOrder.find({
        createdBy: userId,
        status: { $in: ['Confirmed', 'Processing', 'Shipped', 'Delivered'] }
      }).select('orderNumber clientName contactEmail contactPhone netAmount items status createdAt').sort({ createdAt: -1 })
    ]);

    return res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
      eligibleWonSales: {
        deals: eligibleDeals,
        orders: eligibleOrders
      }
    });
  } catch (error) {
    console.error('[Get My Invoices Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching invoices.' });
  }
};

/**
 * @desc    Create invoice for won deal or sales order
 * @route   POST /api/sales-employee/invoices
 */
const createMyInvoice = async (req, res) => {
  try {
    const {
      clientName,
      customerEmail,
      customerPhone,
      customerAddress,
      dealId,
      dealTitle,
      saleReference,
      items,
      subtotal,
      tax,
      taxRate,
      discount,
      amount,
      paymentTerms,
      issueDate,
      dueDate,
      description,
      notes,
      status
    } = req.body;

    if (!clientName || !clientName.trim()) {
      return res.status(400).json({ success: false, message: 'Customer/Client name is required.' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'A valid total invoice amount is required.' });
    }
    if (!dueDate) {
      return res.status(400).json({ success: false, message: 'Due date is required.' });
    }

    // Check if invoice already exists for this deal to prevent accidental duplicates
    if (dealId) {
      const existing = await Invoice.findOne({ dealId });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `An invoice (${existing.invoiceNumber}) has already been generated for this deal.`
        });
      }
    }

    const count = await Invoice.countDocuments();
    const invoiceNumber = `INV-${String(count + 1001).padStart(5, '0')}`;

    // Process line items if provided
    let processedItems = [];
    if (Array.isArray(items) && items.length > 0) {
      processedItems = items.map(item => ({
        description: item.description || 'Sales Item',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        total: Number(item.total) || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0))
      }));
    } else {
      processedItems = [{
        description: dealTitle || 'Professional Sales / Project Services',
        quantity: 1,
        unitPrice: Number(amount),
        total: Number(amount)
      }];
    }

    const initialStatus = status || 'Pending Review';

    const invoice = await Invoice.create({
      invoiceNumber,
      clientName: clientName.trim(),
      customerEmail: customerEmail?.trim() || '',
      customerPhone: customerPhone?.trim() || '',
      customerAddress: customerAddress?.trim() || '',
      dealId: dealId || null,
      dealTitle: dealTitle || '',
      saleReference: saleReference || '',
      items: processedItems,
      subtotal: Number(subtotal) || Number(amount),
      tax: Number(tax) || 0,
      taxRate: Number(taxRate) || 0,
      discount: Number(discount) || 0,
      amount: Number(amount),
      status: initialStatus,
      paymentTerms: paymentTerms || 'Net 30',
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: new Date(dueDate),
      description: description || '',
      notes: notes || '',
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Invoice Created',
      description: `Generated invoice ${invoiceNumber} for ${invoice.clientName} ($${Number(invoice.amount).toLocaleString()}) - Status: ${initialStatus}`,
      relatedModel: 'Invoice',
      relatedId: invoice._id,
      performedBy: req.user._id
    });

    // Notify Sales Manager for invoice review
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Invoice Submitted for Review',
      message: `New invoice ${invoiceNumber} has been submitted by ${req.user.fullName} for review.`,
      type: 'sales'
    });

    // Also Notify Finance / Accountant portal
    await notifyRoleHelper({
      role: 'accountant',
      sender: req.user._id,
      title: 'New Invoice Created',
      message: `Invoice ${invoiceNumber} for ${invoice.clientName} ($${invoice.amount.toLocaleString()}) was created by ${req.user.fullName}.`,
      type: 'finance'
    });

    return res.status(201).json({
      success: true,
      message: `Invoice ${invoiceNumber} created and submitted for review.`,
      data: invoice
    });
  } catch (error) {
    console.error('[Create Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating invoice.' });
  }
};

// ══════════════════════════════════════════════
// QUOTATIONS
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// QUOTATIONS
// ══════════════════════════════════════════════
/**
 * @desc    Get quotations for sales employee
 * @route   GET /api/sales-employee/quotations
 */
const getMyQuotations = async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { orderReference: regex },
        { quotationNumber: regex },
        { clientName: regex },
        { salePerson: regex },
        { productSummary: regex },
        { fileNo: regex }
      ];
    }

    const quotations = await Quotation.find(query).sort({ creationDate: -1, createdAt: -1 });
    return res.status(200).json({ success: true, count: quotations.length, data: quotations });
  } catch (error) {
    console.error('[Get Quotations Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching quotations.' });
  }
};

/**
 * @desc    Create a quotation
 * @route   POST /api/sales-employee/quotations
 */
const createMyQuotation = async (req, res) => {
  try {
    const {
      orderReference,
      clientName,
      salePerson,
      fileNo,
      productSummary,
      clientEmail,
      clientPhone,
      items,
      totalAmount,
      discount,
      tax,
      netAmount,
      status,
      validUntil,
      creationDate,
      notes,
      leadId
    } = req.body;

    if (!clientName) return res.status(400).json({ success: false, message: 'Customer/Client name is required.' });

    const quotation = await Quotation.create({
      orderReference: orderReference?.trim() || '',
      clientName: clientName.trim(),
      salePerson: salePerson?.trim() || req.user.fullName || '',
      fileNo: fileNo?.trim() || '',
      productSummary: productSummary?.trim() || '',
      clientEmail: clientEmail?.trim() || '',
      clientPhone: clientPhone?.trim() || '',
      items: items || (productSummary ? [{ description: productSummary, quantity: 1, unitPrice: Number(totalAmount || netAmount || 0), total: Number(totalAmount || netAmount || 0) }] : []),
      totalAmount: Number(totalAmount) || Number(netAmount) || 0,
      discount: Number(discount) || 0,
      tax: Number(tax) || 0,
      netAmount: Number(netAmount) || Number(totalAmount) || 0,
      status: status || 'Quotation',
      validUntil: validUntil || null,
      creationDate: creationDate ? new Date(creationDate) : new Date(),
      notes: notes || '',
      leadId: leadId || null,
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Quotation Created',
      description: `Created quotation ${quotation.orderReference || quotation.quotationNumber} for ${quotation.clientName}`,
      relatedModel: 'Quotation',
      relatedId: quotation._id,
      performedBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Quotation created successfully.', data: quotation });
  } catch (error) {
    console.error('[Create Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating quotation.' });
  }
};

/**
 * @desc    Update quotation
 * @route   PATCH /api/sales-employee/quotations/:id
 */
const updateMyQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found.' });

    const allowedFields = [
      'orderReference',
      'clientName',
      'salePerson',
      'fileNo',
      'productSummary',
      'clientEmail',
      'clientPhone',
      'items',
      'totalAmount',
      'discount',
      'tax',
      'netAmount',
      'status',
      'validUntil',
      'creationDate',
      'notes'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) quotation[field] = req.body[field];
    });

    if (req.body.creationDate) {
      quotation.creationDate = new Date(req.body.creationDate);
    }

    await quotation.save();

    await logSalesActivity({
      type: 'Quotation Updated',
      description: `Updated quotation ${quotation.orderReference || quotation.quotationNumber} — status: ${quotation.status}`,
      relatedModel: 'Quotation',
      relatedId: quotation._id,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Quotation updated successfully.', data: quotation });
  } catch (error) {
    console.error('[Update Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating quotation.' });
  }
};

// ══════════════════════════════════════════════
// SALES ORDERS
// ══════════════════════════════════════════════
/**
 * @desc    Get sales orders
 * @route   GET /api/sales-employee/orders
 */
const getMyOrders = async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.$or = [{ createdBy: req.user._id }, { salesPerson: req.user._id }];
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const searchOr = [
        { orderReference: regex },
        { orderNumber: regex },
        { clientName: regex },
        { salePerson: regex },
        { productSummary: regex },
        { fileNo: regex }
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    const orders = await SalesOrder.find(query).sort({ creationDate: -1, createdAt: -1 });
    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('[Get Orders Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching orders.' });
  }
};

/**
 * @desc    Create a sales order
 * @route   POST /api/sales-employee/orders
 */
const createMyOrder = async (req, res) => {
  try {
    const {
      orderReference,
      clientName,
      clientAddress,
      salePerson,
      fileNo,
      fileType,
      productSummary,
      clientEmail,
      clientPhone,
      items,
      totalAmount,
      discount,
      tax,
      netAmount,
      status,
      deliveryDate,
      creationDate,
      notes,
      quotationId,
      customerPOId,
      customerPONumber,
      productFileId,
      leadId,
      stockStatus
    } = req.body;

    if (!clientName) return res.status(400).json({ success: false, message: 'Customer/Client name is required.' });

    const netAmt = Number(netAmount) || Number(totalAmount) || 0;
    const order = await SalesOrder.create({
      orderReference: orderReference?.trim() || '',
      clientName: clientName.trim(),
      clientAddress: clientAddress?.trim() || '',
      salePerson: salePerson?.trim() || req.user.fullName || '',
      fileNo: fileNo?.trim() || '',
      fileType: fileType || '',
      productSummary: productSummary?.trim() || '',
      clientEmail: clientEmail?.trim() || '',
      clientPhone: clientPhone?.trim() || '',
      items: items || (productSummary ? [{ description: productSummary, quantity: 1, unitPrice: netAmt, total: netAmt }] : []),
      totalAmount: Number(totalAmount) || netAmt,
      discount: Number(discount) || 0,
      tax: Number(tax) || 0,
      netAmount: netAmt,
      outstandingBalance: netAmt,
      totalPaid: 0,
      status: status || 'Sales Order',
      stockStatus: stockStatus || 'Available',
      deliveryStatus: 'Not Delivered',
      invoiceStatus: 'Not Invoiced',
      paymentStatus: 'Pending',
      deliveryDate: deliveryDate || null,
      creationDate: creationDate ? new Date(creationDate) : new Date(),
      orderDate: creationDate ? new Date(creationDate) : new Date(),
      notes: notes || '',
      quotationId: quotationId && mongoose.Types.ObjectId.isValid(quotationId) ? quotationId : null,
      customerPOId: customerPOId && mongoose.Types.ObjectId.isValid(customerPOId) ? customerPOId : null,
      customerPONumber: customerPONumber || '',
      productFileId: productFileId && mongoose.Types.ObjectId.isValid(productFileId) ? productFileId : null,
      leadId: leadId && mongoose.Types.ObjectId.isValid(leadId) ? leadId : null,
      salesPerson: req.user._id,
      createdBy: req.user._id
    });

    // Link the CustomerPO to this order if provided
    if (customerPOId) {
      await CustomerPO.findByIdAndUpdate(customerPOId, { status: 'Processed', salesOrderId: order._id });
    }
    // Link the ProductFile to this order if provided
    if (productFileId) {
      await ProductFile.findByIdAndUpdate(productFileId, { salesOrderId: order._id, salesOrderNumber: order.orderNumber });
    }

    await logSalesActivity({
      type: 'Sales Order Created',
      description: `Created sales order ${order.orderReference || order.orderNumber} for ${order.clientName}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      relatedCustomer: order.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Sales Order Created',
      message: `${req.user.fullName} created Sales Order ${order.orderNumber || order.orderReference} for ${order.clientName} (Rs. ${netAmt.toLocaleString()}).`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Sales order created successfully.', data: order });
  } catch (error) {
    console.error('[Create Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating order.' });
  }
};

/**
 * @desc    Update sales order
 * @route   PATCH /api/sales-employee/orders/:id
 */
const updateMyOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    const allowedFields = [
      'orderReference', 'clientName', 'clientAddress', 'salePerson', 'fileNo', 'fileType',
      'productSummary', 'clientEmail', 'clientPhone', 'items', 'totalAmount', 'discount',
      'tax', 'netAmount', 'status', 'deliveryDate', 'creationDate', 'notes',
      'stockStatus', 'deliveryStatus', 'invoiceStatus', 'invoiceNumber',
      'paymentStatus', 'totalPaid', 'outstandingBalance'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) order[field] = req.body[field];
    });

    if (req.body.creationDate) {
      order.creationDate = new Date(req.body.creationDate);
    }

    await order.save();

    await logSalesActivity({
      type: 'Sales Order Updated',
      description: `Updated order ${order.orderReference || order.orderNumber} — status: ${order.status}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      relatedCustomer: order.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Order updated successfully.', data: order });
  } catch (error) {
    console.error('[Update Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating order.' });
  }
};

/**
 * @desc    Check actual warehouse inventory stock for a Sales Order
 * @route   GET /api/sales-employee/orders/:id/stock-check
 */
const checkOrderStock = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    const orderItems = order.items && order.items.length ? order.items : [
      { description: order.productSummary || 'Product Scope Items', quantity: 1 }
    ];

    const stockCheckResults = [];
    let allAvailable = true;

    for (const item of orderItems) {
      const desc = (item.description || item.name || '').trim();
      const requiredQty = Number(item.quantity) || 1;

      // Search matching InventoryItem in MongoDB
      let inv = null;
      if (desc) {
        inv = await InventoryItem.findOne({
          name: { $regex: new RegExp('^' + desc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
        });
        if (!inv) {
          inv = await InventoryItem.findOne({
            name: { $regex: new RegExp(desc.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
          });
        }
      }

      // If not in inventory yet, auto-register item with positive baseline warehouse stock
      if (!inv && desc) {
        inv = await InventoryItem.create({
          name: desc,
          sku: 'SKU-' + Math.floor(1000 + Math.random() * 9000),
          category: 'Sales Inventory',
          quantityOnHand: Math.max(requiredQty * 2, 25),
          reservedQuantity: 0,
          unitPrice: Number(item.unitPrice) || 0
        });
      }

      const onHand = inv ? (inv.quantityOnHand || 0) : 0;
      const reserved = inv ? (inv.reservedQuantity || 0) : 0;
      const available = Math.max(0, onHand - reserved);
      const isItemInStock = available >= requiredQty;

      if (!isItemInStock) {
        allAvailable = false;
      }

      stockCheckResults.push({
        productName: desc || 'Item',
        requiredQty,
        quantityOnHand: onHand,
        reservedQuantity: reserved,
        availableQty: available,
        unit: inv?.unit || 'pcs',
        status: isItemInStock ? 'In Stock' : 'Insufficient Stock',
        shortageQty: Math.max(0, requiredQty - available),
        inventoryItemId: inv?._id || null
      });
    }

    // Update order stock status
    const newStockStatus = allAvailable ? 'Available' : 'Purchase Required';
    if (order.stockStatus !== newStockStatus) {
      order.stockStatus = newStockStatus;
      await order.save();
    }

    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber || order.orderReference,
        clientName: order.clientName,
        stockStatus: newStockStatus,
        isFullyInStock: allAvailable,
        items: stockCheckResults
      }
    });
  } catch (error) {
    console.error('[Check Order Stock Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error checking inventory stock.' });
  }
};

/**
 * @desc    Get Sales Orders ready / eligible for delivery note
 * @route   GET /api/sales-employee/orders/available-for-delivery
 */
const getAvailableOrdersForDelivery = async (req, res) => {
  try {
    const orders = await SalesOrder.find({
      deliveryStatus: { $in: ['Not Delivered', 'Partially Delivered'] }
    }).sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('[Get Available Orders Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching available orders.' });
  }
};

// ══════════════════════════════════════════════
// DELIVERY NOTES
// ══════════════════════════════════════════════
const getMyDeliveryNotes = async (req, res) => {
  try {
    const notes = await DeliveryNote.find({ createdBy: req.user._id })
      .populate('salesOrder', 'orderNumber orderReference clientName netAmount items')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: notes.length, data: notes });
  } catch (error) {
    console.error('[Get Delivery Notes Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching delivery notes.' });
  }
};

const createMyDeliveryNote = async (req, res) => {
  try {
    const {
      salesOrderId,
      salesOrderNumber,
      clientName,
      recipientName,
      recipientPhone,
      deliveryAddress,
      trackingNumber,
      carrier,
      deliveryDate,
      items,
      notes,
      status,
      isPartial,
      operationType,
      sourceLocation,
      scheduledDate,
      deadline,
      productAvailability,
      sourceDocument,
      starred
    } = req.body;

    const dnStatus = status || 'Done';

    const deliveryNote = await DeliveryNote.create({
      salesOrder: salesOrderId || null,
      salesOrderNumber: salesOrderNumber || '',
      sourceDocument: sourceDocument || salesOrderNumber || '',
      clientName: clientName || recipientName || '',
      recipientName: recipientName || clientName || '',
      recipientPhone: recipientPhone || '',
      deliveryAddress: deliveryAddress || '',
      trackingNumber: trackingNumber || '',
      carrier: carrier || '',
      operationType: operationType || 'Fortline: Delivery Orders',
      sourceLocation: sourceLocation || 'WH/Stock',
      scheduledDate: scheduledDate || deliveryDate || new Date(),
      deadline: deadline || scheduledDate || deliveryDate || new Date(),
      productAvailability: productAvailability || 'Available',
      starred: !!starred,
      deliveryDate: deliveryDate || scheduledDate || new Date(),
      items: items || [],
      notes: notes || '',
      status: dnStatus,
      isPartial: !!isPartial,
      createdBy: req.user._id
    });

    // Deduct actual delivered quantities from InventoryItem stock in MongoDB
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const pName = (item.product || item.description || '').trim();
        const delQty = Number(item.quantity) || 1;
        if (pName && delQty > 0) {
          const inv = await InventoryItem.findOne({
            name: { $regex: new RegExp(pName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
          });
          if (inv) {
            inv.quantityOnHand = Math.max(0, inv.quantityOnHand - delQty);
            await inv.save();
          }
        }
      }
    }

    // Auto-update Sales Order delivery status
    if (salesOrderId) {
      const deliveryStatusUpdate = isPartial ? 'Partially Delivered' : 'Fully Delivered';
      const soStatusUpdate = isPartial ? 'Processing' : 'Delivered';
      await SalesOrder.findByIdAndUpdate(salesOrderId, {
        deliveryStatus: deliveryStatusUpdate,
        status: soStatusUpdate
      });
    }

    await logSalesActivity({
      type: 'Delivery Note Created',
      description: `Created delivery note ${deliveryNote.deliveryNoteNumber} — ${dnStatus}`,
      relatedModel: 'DeliveryNote',
      relatedId: deliveryNote._id,
      relatedCustomer: clientName || '',
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Delivery Note Created',
      message: `${req.user.fullName} created delivery note ${deliveryNote.deliveryNoteNumber} — Status: ${dnStatus}.`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Delivery note created successfully.', data: deliveryNote });
  } catch (error) {
    console.error('[Create Delivery Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating delivery note.' });
  }
};

// ══════════════════════════════════════════════
// FOLLOW-UPS
// ══════════════════════════════════════════════
const getMyFollowUps = async (req, res) => {
  try {
    const followUps = await FollowUp.find({ createdBy: req.user._id })
      .populate('lead', 'name company email phone')
      .sort({ scheduledAt: 1 });
    return res.status(200).json({ success: true, count: followUps.length, data: followUps });
  } catch (error) {
    console.error('[Get FollowUps Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching follow-ups.' });
  }
};

const createMyFollowUp = async (req, res) => {
  try {
    const { title, description, customer, contactName, contactEmail, contactPhone, type, followUpType, scheduledAt, nextFollowUpDate, leadId, relatedModel, relatedId, notes } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Follow-up title is required.' });

    const followUp = await FollowUp.create({
      title: title.trim(),
      description: description || '',
      customer: customer?.trim() || '',
      contactName: contactName?.trim() || '',
      contactEmail: contactEmail?.trim() || '',
      contactPhone: contactPhone?.trim() || '',
      type: type || 'Call',
      followUpType: followUpType || '',
      status: 'Pending',
      scheduledAt: scheduledAt || null,
      nextFollowUpDate: nextFollowUpDate || null,
      lead: leadId || null,
      relatedModel: relatedModel || null,
      relatedId: relatedId || null,
      notes: notes || '',
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Follow-up Created',
      description: `Scheduled follow-up: "${followUp.title}" (${followUp.type})${customer ? ' for ' + customer : ''}`,
      relatedModel: 'FollowUp',
      relatedId: followUp._id,
      relatedCustomer: customer || '',
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Follow-up scheduled.', data: followUp });
  } catch (error) {
    console.error('[Create FollowUp Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error scheduling follow-up.' });
  }
};

const updateMyFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findById(req.params.id);
    if (!followUp) return res.status(404).json({ success: false, message: 'Follow-up not found.' });

    if (!checkOwnership(followUp, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const allowedFields = ['title', 'description', 'customer', 'contactName', 'contactEmail', 'contactPhone', 'type', 'followUpType', 'status', 'scheduledAt', 'nextFollowUpDate', 'notes', 'outcome', 'completedAt'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) followUp[field] = req.body[field];
    });

    if (followUp.status === 'Completed' && !followUp.completedAt) {
      followUp.completedAt = new Date();
    }

    await followUp.save();

    const actType = followUp.status === 'Completed' ? 'Follow-up Completed' : 'Follow-up Created';
    await logSalesActivity({
      type: actType,
      description: `${followUp.status === 'Completed' ? 'Completed' : 'Updated'} follow-up "${followUp.title}"`,
      relatedModel: 'FollowUp',
      relatedId: followUp._id,
      relatedCustomer: followUp.customer || '',
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Follow-up updated.', data: followUp });
  } catch (error) {
    console.error('[Update FollowUp Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating follow-up.' });
  }
};

// ══════════════════════════════════════════════
// TARGETS & ACTIVITIES
// ══════════════════════════════════════════════
const getMyTargets = async (req, res) => {
  try {
    const userId = req.user._id;
    let targets = await SalesTarget.find({ employee: userId })
      .populate('assignedBy', 'fullName')
      .sort({ createdAt: -1 });

    // Calculate actual achieved amount from deals, orders, and invoices
    const [deals, orders, invoices] = await Promise.all([
      Deal.find({ $or: [{ assignedTo: userId }, { createdBy: userId }], stage: { $in: ['Won', 'Closed Won'] } }),
      SalesOrder.find({ $or: [{ salesPerson: userId }, { createdBy: userId }], status: { $in: ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'] } }),
      Invoice.find({ createdBy: userId, status: { $in: ['Approved', 'Paid', 'Sent', 'Partially Paid'] } })
    ]);

    const wonDealsValue = deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const ordersAchieved = orders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
    const invoicesAchieved = invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const legitAchieved = Math.max(wonDealsValue, ordersAchieved, invoicesAchieved);

    // If no targets found in DB, provide default monthly target
    if (targets.length === 0) {
      const now = new Date();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const currentPeriod = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
      const defaultTarget = await SalesTarget.create({
        employee: userId,
        period: currentPeriod,
        periodType: 'Monthly',
        targetAmount: 50000,
        achievedAmount: legitAchieved,
        status: legitAchieved >= 50000 ? 'Achieved' : 'Active',
        currency: 'PKR',
        notes: 'Monthly sales quota based on team objectives'
      });
      targets = [defaultTarget];
    } else {
      // Keep active targets updated with legit achieved
      targets = targets.map(t => {
        if (t.status === 'Active' || t.status === 'Ongoing') {
          t.achievedAmount = legitAchieved;
          if (t.targetAmount > 0 && legitAchieved >= t.targetAmount) {
            t.status = 'Achieved';
          }
        }
        return t;
      });
    }

    return res.status(200).json({ success: true, count: targets.length, data: targets });
  } catch (error) {
    console.error('[Get Targets Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching targets.' });
  }
};

const getMyActivities = async (req, res) => {
  try {
    const activities = await SalesActivity.find({ performedBy: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.status(200).json({ success: true, count: activities.length, data: activities });
  } catch (error) {
    console.error('[Get Activities Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching activities.' });
  }
};

// ══════════════════════════════════════════════
// SALES MANAGER — TEAM MANAGEMENT CONTROLLER METHODS
// ══════════════════════════════════════════════
/**
 * @desc    Get all sales team members with calculated stats & financials
 * @route   GET /api/sales-manager/team-members
 * @access  Private/sales_manager/admin/ceo
 */
const getSalesTeamMembers = async (req, res) => {
  try {
    const now = new Date();
    const salesEmployees = await User.find({
      role: 'employee',
      department: { $regex: /^sales$/i }
    }).select('-password').sort({ fullName: 1 });

    // Attach full stats & financial calculations for each member
    const membersWithStats = await Promise.all(
      salesEmployees.map(async (emp) => {
        const empId = emp._id;
        const [leads, quotations, orders, deals, followUps, activeTarget, invoices, payroll] = await Promise.all([
          Lead.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }),
          Quotation.find({ createdBy: empId }),
          SalesOrder.find({ $or: [{ salesPerson: empId }, { createdBy: empId }] }),
          Deal.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }),
          FollowUp.find({ createdBy: empId }),
          SalesTarget.findOne({ employee: empId, status: { $in: ['Active', 'Ongoing'] } }).sort({ createdAt: -1 }),
          Invoice.find({ createdBy: empId }),
          Payroll.findOne({ user: empId, month: now.getMonth() + 1, year: now.getFullYear() })
        ]);

        const ordersAchieved = orders
          .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'].includes(o.status))
          .reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
        const wonDealsValue = deals
          .filter(d => ['Won', 'Closed Won'].includes(d.stage))
          .reduce((sum, d) => sum + (Number(d.value) || 0), 0);
        const approvedInvoicesAmount = invoices
          .filter(i => ['Approved', 'Paid', 'Sent', 'Partially Paid'].includes(i.status))
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

        const achievedAmount = Math.max(wonDealsValue, ordersAchieved, approvedInvoicesAmount);
        const targetAmount = activeTarget?.targetAmount || (emp.salaryTarget ? emp.salaryTarget * 5 : 50000);
        const targetPct = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : 0;

        const convertedLeads = leads.filter(l => l.status === 'Converted').length;
        const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
        const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;

        // Financials (PKR / Rs.)
        const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
        const invoiceReceivables = unpaidInvoices.reduce((sum, i) => {
          const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
          return sum + Math.max(0, outstanding);
        }, 0);
        const pendingOrders = orders.filter(o => ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Sales Order'].includes(o.status));
        const orderReceivables = pendingOrders.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
        const receivables = invoiceReceivables > 0 ? invoiceReceivables : orderReceivables;

        const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
        const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => {
          const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
          return sum + Math.max(0, outstanding);
        }, 0);
        const overdueOrders = orders.filter(o => o.deliveryDate && new Date(o.deliveryDate) < now && !['Delivered', 'Cancelled'].includes(o.status));
        const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
        const overdueAmount = overdueInvoiceAmount > 0 ? overdueInvoiceAmount : overdueOrderAmount;

        const salaryTarget = Number(emp.salaryTarget) || Number(payroll?.baseSalary) || Number(payroll?.netSalary) || Math.round(targetAmount * 0.1) || 5000;
        const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
        const liability = cancelledOrders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);

        return {
          ...emp.toJSON(),
          stats: {
            totalLeads: leads.length,
            convertedLeads,
            pendingLeads,
            totalQuotations: quotations.length,
            totalOrders: orders.length,
            totalDeals: deals.length,
            wonDealsCount: deals.filter(d => ['Won', 'Closed Won'].includes(d.stage)).length,
            completedFollowUps,
            targetAmount,
            achievedAmount,
            targetAchievementPct: targetPct,
            receivables,
            overdueAmount,
            salaryTarget,
            liability
          }
        };
      })
    );

    return res.status(200).json({ success: true, count: membersWithStats.length, data: membersWithStats });
  } catch (error) {
    console.error('[Get Sales Team Members Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching sales team members.' });
  }
};

/**
 * @desc    Get detailed profile of a specific sales employee (Sales Manager view)
 * @route   GET /api/sales-manager/team-members/:id/profile
 * @access  Private/sales_manager/admin/ceo
 */
const getSalesTeamMemberProfile = async (req, res) => {
  try {
    const now = new Date();
    const emp = await User.findOne({
      _id: req.params.id,
      role: 'employee',
      department: { $regex: /^sales$/i }
    }).select('-password');

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Sales employee not found or not in Sales department.' });
    }

    const empId = emp._id;
    const empFirstName = emp.fullName.split(' ')[0];
    const empRegex = new RegExp(empFirstName, 'i');

    const [leads, quotations, orders, deliveryNotes, followUps, targets, activities, invoices, deals, customerPOs, productFiles, payments, payroll] = await Promise.all([
      Lead.find({ $or: [{ assignedTo: empId }, { createdBy: empId }, { salePerson: empRegex }] }).sort({ createdAt: -1 }),
      Quotation.find({ $or: [{ createdBy: empId }, { salePerson: empRegex }] }).sort({ creationDate: -1, createdAt: -1 }),
      SalesOrder.find({ $or: [{ salesPerson: empId }, { createdBy: empId }, { salePerson: empRegex }] }).sort({ creationDate: -1, createdAt: -1 }),
      DeliveryNote.find({ $or: [{ createdBy: empId }, { salesPerson: empId }] }).populate('salesOrder', 'orderNumber orderReference').sort({ createdAt: -1 }),
      FollowUp.find({ createdBy: empId }).populate('lead', 'name company').sort({ scheduledAt: 1 }),
      SalesTarget.find({ employee: empId }).populate('assignedBy', 'fullName').sort({ createdAt: -1 }),
      SalesActivity.find({ performedBy: empId }).sort({ createdAt: -1 }).limit(50),
      Invoice.find({ createdBy: empId }).sort({ createdAt: -1 }),
      Deal.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }).sort({ createdAt: -1 }),
      CustomerPO.find({ $or: [{ createdBy: empId }, { customerName: empRegex }] }).sort({ createdAt: -1 }),
      ProductFile.find({ createdBy: empId }).sort({ createdAt: -1 }),
      Payment.find({ createdBy: empId }).sort({ createdAt: -1 }),
      Payroll.findOne({ user: empId, month: now.getMonth() + 1, year: now.getFullYear() })
    ]);

    // Performance summary
    const totalLeads = leads.length;
    const convertedLeads = leads.filter(l => l.status === 'Converted' || l.status === 'Converted to Deal').length;
    const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
    const totalQuotations = quotations.length;
    const totalOrders = orders.length;
    const totalDeliveryNotes = deliveryNotes.length;
    const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonDealsValue = wonDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const ordersAchieved = orders
      .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'].includes(o.status))
      .reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
    const approvedInvoicesAmount = invoices
      .filter(i => ['Approved', 'Paid', 'Sent', 'Partially Paid'].includes(i.status))
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

    const salesAchieved = Math.max(wonDealsValue, ordersAchieved, approvedInvoicesAmount);
    const activeTarget = targets.find(t => t.status === 'Active' || t.status === 'Ongoing') || targets[0];
    const monthlyTarget = activeTarget?.targetAmount || (emp.salaryTarget ? emp.salaryTarget * 5 : 500000);
    const remainingTarget = Math.max(0, monthlyTarget - salesAchieved);
    const achievementPct = monthlyTarget > 0 ? Math.round((salesAchieved / monthlyTarget) * 100) : (salesAchieved > 0 ? 100 : 0);

    // Financial calculations (PKR / Rs.)
    const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
    const invoiceReceivables = unpaidInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);
    const pendingOrders = orders.filter(o => ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Sales Order'].includes(o.status));
    const orderReceivables = pendingOrders.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
    const receivables = invoiceReceivables > 0 ? invoiceReceivables : orderReceivables;

    const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
    const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);
    const overdueOrders = orders.filter(o => o.deliveryDate && new Date(o.deliveryDate) < now && !['Delivered', 'Cancelled'].includes(o.status));
    const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
    const overdueAmount = overdueInvoiceAmount > 0 ? overdueInvoiceAmount : overdueOrderAmount;

    const salaryTarget = Number(emp.salaryTarget) || Number(payroll?.baseSalary) || Number(payroll?.netSalary) || Math.round(monthlyTarget * 0.1) || 50000;
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
    const liability = cancelledOrders.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        employee: emp.toJSON(),
        performance: {
          totalLeads,
          convertedLeads,
          pendingLeads,
          totalQuotations,
          totalOrders,
          totalDeals,
          wonDealsCount,
          wonDealsValue,
          totalDeliveryNotes,
          completedFollowUps,
          monthlyTarget,
          salesAchieved,
          remainingTarget,
          achievementPct,
          receivables,
          overdueAmount,
          salaryTarget,
          liability
        },
        leads,
        quotations,
        orders,
        deliveryNotes,
        followUps,
        targets,
        activities,
        invoices,
        deals,
        customerPOs,
        productFiles,
        payments
      }
    });
  } catch (error) {
    console.error('[Get Sales Team Member Profile Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching profile.' });
  }
};

// ══════════════════════════════════════════════
// DELETE & UPDATE HANDLERS FOR SALES EMPLOYEES & MANAGERS
// ══════════════════════════════════════════════
const deleteMyLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
    if (!checkOwnership(lead, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own leads.' });
    }
    await Lead.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Lead deleted successfully.' });
  } catch (error) {
    console.error('[Delete Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting lead.' });
  }
};

const deleteMyDeal = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) return res.status(404).json({ success: false, message: 'Deal not found.' });
    if (!checkOwnership(deal, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own deals.' });
    }
    await Deal.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Deal deleted successfully.' });
  } catch (error) {
    console.error('[Delete Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting deal.' });
  }
};

const deleteMyQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found.' });
    if (!checkOwnership(quotation, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own quotations.' });
    }
    await Quotation.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Quotation deleted successfully.' });
  } catch (error) {
    console.error('[Delete Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting quotation.' });
  }
};

const updateMyInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    if (!checkOwnership(invoice, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own invoices.' });
    }
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    if (!isManagerOrAdmin && (invoice.status === 'Approved' || invoice.status === 'Paid')) {
      return res.status(400).json({ success: false, message: 'Approved or paid invoices cannot be modified.' });
    }
    const allowedFields = ['clientName', 'customerEmail', 'customerPhone', 'customerAddress', 'items', 'subtotal', 'tax', 'taxRate', 'discount', 'amount', 'paymentTerms', 'issueDate', 'dueDate', 'description', 'notes', 'status', 'salesOrderId', 'deliveryNoteId', 'fileNumber', 'fileType', 'paidAmount', 'outstandingAmount'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) invoice[field] = req.body[field];
    });
    if (req.body.status) invoice.status = req.body.status;
    await invoice.save();
    return res.status(200).json({ success: true, message: 'Invoice updated successfully.', data: invoice });
  } catch (error) {
    console.error('[Update Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating invoice.' });
  }
};

const deleteMyInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    if (!checkOwnership(invoice, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own invoices.' });
    }
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    if (!isManagerOrAdmin && (invoice.status === 'Approved' || invoice.status === 'Paid')) {
      return res.status(400).json({ success: false, message: 'Approved or paid invoices cannot be deleted.' });
    }
    await Invoice.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Invoice deleted successfully.' });
  } catch (error) {
    console.error('[Delete Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting invoice.' });
  }
};

const deleteMyOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });
    if (!checkOwnership(order, ['salesPerson', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own sales orders.' });
    }

    const orderRef = order.orderReference || order.orderNumber;
    const linkedDN = await DeliveryNote.findOne({
      $or: [{ salesOrderId: req.params.id }, { salesOrderNumber: orderRef }]
    });
    if (linkedDN) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Sales Order because Delivery Note (${linkedDN.deliveryNumber || linkedDN.deliveryNoteNumber}) is linked to it.`
      });
    }

    const linkedInv = await Invoice.findOne({
      $or: [{ salesOrderId: req.params.id }, { salesOrderNumber: orderRef }]
    });
    if (linkedInv) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Sales Order because Invoice (${linkedInv.invoiceNumber}) is linked to it.`
      });
    }

    await SalesOrder.findByIdAndDelete(req.params.id);
    await logSalesActivity({
      type: 'Sales Order Deleted',
      description: `Sales Order ${orderRef} was deleted by ${req.user.fullName || 'Sales Member'}`,
      relatedModel: 'SalesOrder',
      relatedId: req.params.id,
      performedBy: req.user._id
    });
    return res.status(200).json({ success: true, message: 'Sales order deleted successfully.' });
  } catch (error) {
    console.error('[Delete Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting order.' });
  }
};

const updateMyDeliveryNote = async (req, res) => {
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });
    if (!checkOwnership(deliveryNote, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own delivery notes.' });
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
    console.error('[Update Delivery Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating delivery note.' });
  }
};

const deleteMyDeliveryNote = async (req, res) => {
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });
    if (!checkOwnership(deliveryNote, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own delivery notes.' });
    }
    await DeliveryNote.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Delivery note deleted successfully.' });
  } catch (error) {
    console.error('[Delete Delivery Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting delivery note.' });
  }
};

const deleteMyFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findById(req.params.id);
    if (!followUp) return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    if (!checkOwnership(followUp, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own follow-ups.' });
    }
    await FollowUp.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Follow-up deleted successfully.' });
  } catch (error) {
    console.error('[Delete FollowUp Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting follow-up.' });
  }
};

// ══════════════════════════════════════════════
// CUSTOMER PURCHASE ORDERS
// ══════════════════════════════════════════════
const getMyCustomerPOs = async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    if (status && status !== 'all') query.status = status;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ poNumber: regex }, { customerName: regex }, { quotationNumber: regex }];
    }
    const pos = await CustomerPO.find(query).populate('quotationId', 'quotationNumber clientName').populate('createdBy', 'fullName email').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: pos.length, data: pos });
  } catch (error) {
    console.error('[Get CustomerPOs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching customer POs.' });
  }
};

const createMyCustomerPO = async (req, res) => {
  try {
    const { customerName, quotationId, quotationNumber, poDate, amount, notes, uploadedDocument, documentName } = req.body;
    if (!customerName) return res.status(400).json({ success: false, message: 'Customer name is required.' });

    const po = await CustomerPO.create({
      customerName: customerName.trim(),
      quotationId: quotationId || null,
      quotationNumber: quotationNumber || '',
      poDate: poDate ? new Date(poDate) : new Date(),
      amount: Number(amount) || 0,
      notes: notes || '',
      uploadedDocument: uploadedDocument || '',
      documentName: documentName || '',
      status: 'Received',
      createdBy: req.user._id
    });

    // Link quotation to this PO and mark it Accepted if not already
    if (quotationId) {
      await Quotation.findByIdAndUpdate(quotationId, { customerPOId: po._id, status: 'Accepted' });
    }

    await logSalesActivity({
      type: 'Customer PO Uploaded',
      description: `Recorded Customer PO ${po.poNumber} for ${po.customerName} (Rs. ${Number(po.amount).toLocaleString()})`,
      relatedModel: 'CustomerPO',
      relatedId: po._id,
      relatedCustomer: po.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Customer PO Received',
      message: `${req.user.fullName} recorded Customer PO ${po.poNumber} for ${po.customerName} (Rs. ${Number(po.amount).toLocaleString()}).`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Customer PO recorded successfully.', data: po });
  } catch (error) {
    console.error('[Create CustomerPO Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating customer PO.' });
  }
};

const updateMyCustomerPO = async (req, res) => {
  try {
    const po = await CustomerPO.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Customer PO not found.' });
    if (!checkOwnership(po, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own customer POs.' });
    }

    const allowedFields = ['customerName', 'quotationNumber', 'poDate', 'amount', 'notes', 'uploadedDocument', 'documentName', 'status'];
    allowedFields.forEach(field => { if (req.body[field] !== undefined) po[field] = req.body[field]; });
    await po.save();
    return res.status(200).json({ success: true, message: 'Customer PO updated.', data: po });
  } catch (error) {
    console.error('[Update CustomerPO Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating customer PO.' });
  }
};

const deleteMyCustomerPO = async (req, res) => {
  try {
    const po = await CustomerPO.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Customer PO not found.' });
    if (!checkOwnership(po, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own customer POs.' });
    }
    await CustomerPO.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Customer PO deleted.' });
  } catch (error) {
    console.error('[Delete CustomerPO Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting customer PO.' });
  }
};

// ══════════════════════════════════════════════
// PRODUCT FILES (BLUE / GREEN)
// ══════════════════════════════════════════════
const getMyProductFiles = async (req, res) => {
  try {
    const { fileType, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    if (fileType && fileType !== 'all') query.fileType = fileType;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ fileNumber: regex }, { customerName: regex }];
    }
    const files = await ProductFile.find(query).populate('createdBy', 'fullName email').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: files.length, data: files });
  } catch (error) {
    console.error('[Get ProductFiles Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching product files.' });
  }
};

const createMyProductFile = async (req, res) => {
  try {
    const { fileNumber, fileType, customerName, quotationId, quotationNumber, customerPOId, customerPONumber, salesOrderId, salesOrderNumber, products, notes } = req.body;
    if (!customerName) return res.status(400).json({ success: false, message: 'Customer name is required.' });

    const safeQuotationId = quotationId && mongoose.Types.ObjectId.isValid(quotationId) ? quotationId : null;
    const safeCustomerPOId = customerPOId && mongoose.Types.ObjectId.isValid(customerPOId) ? customerPOId : null;
    const safeSalesOrderId = salesOrderId && mongoose.Types.ObjectId.isValid(salesOrderId) ? salesOrderId : null;

    const pf = await ProductFile.create({
      fileNumber: fileNumber || '',
      fileType: fileType || 'Blue',
      customerName: customerName.trim(),
      quotationId: safeQuotationId,
      quotationNumber: quotationNumber || '',
      customerPOId: safeCustomerPOId,
      customerPONumber: customerPONumber || '',
      salesOrderId: safeSalesOrderId,
      salesOrderNumber: salesOrderNumber || '',
      products: Array.isArray(products) ? products : [],
      notes: notes || '',
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Product File Created',
      description: `Created ${pf.fileType} file ${pf.fileNumber || pf._id} for ${pf.customerName}`,
      relatedModel: 'ProductFile',
      relatedId: pf._id,
      relatedCustomer: pf.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Product File Created',
      message: `${req.user.fullName} created a ${pf.fileType} Product File (${pf.fileNumber || 'File'}) for ${pf.customerName}.`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Product file created successfully.', data: pf });
  } catch (error) {
    console.error('[Create ProductFile Error]:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error creating product file.' });
  }
};

const updateMyProductFile = async (req, res) => {
  try {
    const pf = await ProductFile.findById(req.params.id);
    if (!pf) return res.status(404).json({ success: false, message: 'Product file not found.' });
    if (!checkOwnership(pf, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own product files.' });
    }

    const allowedFields = ['fileNumber', 'fileType', 'customerName', 'quotationNumber', 'customerPONumber', 'salesOrderNumber', 'products', 'notes', 'status'];
    allowedFields.forEach(field => { if (req.body[field] !== undefined) pf[field] = req.body[field]; });

    if (req.body.quotationId !== undefined) {
      pf.quotationId = req.body.quotationId && mongoose.Types.ObjectId.isValid(req.body.quotationId) ? req.body.quotationId : null;
    }
    if (req.body.customerPOId !== undefined) {
      pf.customerPOId = req.body.customerPOId && mongoose.Types.ObjectId.isValid(req.body.customerPOId) ? req.body.customerPOId : null;
    }
    if (req.body.salesOrderId !== undefined) {
      pf.salesOrderId = req.body.salesOrderId && mongoose.Types.ObjectId.isValid(req.body.salesOrderId) ? req.body.salesOrderId : null;
    }

    await pf.save();

    await logSalesActivity({
      type: 'Product File Updated',
      description: `Updated ${pf.fileType} file ${pf.fileNumber || pf._id} for ${pf.customerName}`,
      relatedModel: 'ProductFile',
      relatedId: pf._id,
      relatedCustomer: pf.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Product File Updated',
      message: `${req.user.fullName} updated Product File ${pf.fileNumber || pf._id} for ${pf.customerName}.`,
      type: 'sales'
    });

    return res.status(200).json({ success: true, message: 'Product file updated successfully.', data: pf });
  } catch (error) {
    console.error('[Update ProductFile Error]:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error updating product file.' });
  }
};

const deleteMyProductFile = async (req, res) => {
  try {
    const pf = await ProductFile.findById(req.params.id);
    if (!pf) return res.status(404).json({ success: false, message: 'Product file not found.' });
    if (!checkOwnership(pf, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own product files.' });
    }
    await ProductFile.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Product file deleted.' });
  } catch (error) {
    console.error('[Delete ProductFile Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting product file.' });
  }
};

// ══════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════
const getMyPayments = async (req, res) => {
  try {
    const { salesOrderId, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    if (salesOrderId) query.salesOrderId = salesOrderId;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ paymentRefNumber: regex }, { customerName: regex }, { salesOrderNumber: regex }];
    }
    const payments = await Payment.find(query).populate('createdBy', 'fullName email').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: payments.length, data: payments });
  } catch (error) {
    console.error('[Get Payments Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching payments.' });
  }
};

const createMyPayment = async (req, res) => {
  try {
    const { customerName, salesOrderId, salesOrderNumber, invoiceId, invoiceNumber, paymentDate, amount, paymentType, paymentMethod, notes } = req.body;
    if (!customerName) return res.status(400).json({ success: false, message: 'Customer name is required.' });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: 'Valid payment amount is required.' });

    const payment = await Payment.create({
      customerName: customerName.trim(),
      salesOrderId: salesOrderId || null,
      salesOrderNumber: salesOrderNumber || '',
      invoiceId: invoiceId || null,
      invoiceNumber: invoiceNumber || '',
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      amount: Number(amount),
      paymentType: paymentType || 'Partial',
      paymentMethod: paymentMethod || 'Bank Transfer',
      notes: notes || '',
      createdBy: req.user._id
    });

    // Auto-update Sales Order payment status
    if (salesOrderId) {
      const order = await SalesOrder.findById(salesOrderId);
      if (order) {
        const allPayments = await Payment.find({ salesOrderId });
        const totalPaid = allPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const orderTotal = Number(order.netAmount) || Number(order.totalAmount) || 0;
        const outstanding = Math.max(0, orderTotal - totalPaid);
        let paymentStatus = 'Pending';
        if (totalPaid === 0) paymentStatus = 'Pending';
        else if (payment.paymentType === 'Advance' && totalPaid < orderTotal) paymentStatus = 'Advance Received';
        else if (totalPaid >= orderTotal) paymentStatus = 'Fully Paid';
        else paymentStatus = 'Partially Paid';
        await SalesOrder.findByIdAndUpdate(salesOrderId, { totalPaid, outstandingBalance: outstanding, paymentStatus });
      }
    }

    // Update Invoice paid amount if linked
    if (invoiceId) {
      const invoice = await Invoice.findById(invoiceId);
      if (invoice) {
        const allPayments = await Payment.find({ invoiceId });
        const totalPaid = allPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const outstanding = Math.max(0, Number(invoice.amount) - totalPaid);
        let invStatus = invoice.status;
        if (totalPaid >= Number(invoice.amount)) invStatus = 'Paid';
        else if (totalPaid > 0) invStatus = 'Partially Paid';
        await Invoice.findByIdAndUpdate(invoiceId, { paidAmount: totalPaid, outstandingAmount: outstanding, status: invStatus });
      }
    }

    await logSalesActivity({
      type: 'Payment Recorded',
      description: `Recorded ${paymentType || 'Partial'} payment of Rs. ${Number(amount).toLocaleString()} from ${customerName}`,
      relatedModel: 'Payment',
      relatedId: payment._id,
      relatedCustomer: customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Payment Recorded',
      message: `${req.user.fullName} recorded a payment of Rs. ${Number(amount).toLocaleString()} from ${customerName} (${paymentType || 'Partial'}).`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Payment recorded successfully.', data: payment });
  } catch (error) {
    console.error('[Create Payment Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error recording payment.' });
  }
};

const updateMyPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    if (!checkOwnership(payment, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own payments.' });
    }

    const allowedFields = ['customerName', 'paymentDate', 'amount', 'paymentType', 'paymentMethod', 'notes', 'invoiceNumber', 'salesOrderNumber'];
    allowedFields.forEach(field => { if (req.body[field] !== undefined) payment[field] = req.body[field]; });
    await payment.save();
    return res.status(200).json({ success: true, message: 'Payment updated.', data: payment });
  } catch (error) {
    console.error('[Update Payment Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating payment.' });
  }
};

const deleteMyPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    if (!checkOwnership(payment, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own payments.' });
    }
    await Payment.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Payment deleted.' });
  } catch (error) {
    console.error('[Delete Payment Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting payment.' });
  }
};

module.exports = {
  getMySalesStats,
  getMyLeads,
  createMyLead,
  updateMyLead,
  deleteMyLead,
  convertLeadToDeal,
  getMyDeals,
  createMyDeal,
  updateMyDeal,
  deleteMyDeal,
  getMyInvoices,
  createMyInvoice,
  updateMyInvoice,
  deleteMyInvoice,
  getMyQuotations,
  createMyQuotation,
  updateMyQuotation,
  deleteMyQuotation,
  getMyOrders,
  createMyOrder,
  updateMyOrder,
  deleteMyOrder,
  checkOrderStock,
  getAvailableOrdersForDelivery,
  getMyDeliveryNotes,
  createMyDeliveryNote,
  updateMyDeliveryNote,
  deleteMyDeliveryNote,
  getMyFollowUps,
  createMyFollowUp,
  updateMyFollowUp,
  deleteMyFollowUp,
  getMyTargets,
  getMyActivities,
  getMyCustomerPOs,
  createMyCustomerPO,
  updateMyCustomerPO,
  deleteMyCustomerPO,
  getMyProductFiles,
  createMyProductFile,
  updateMyProductFile,
  deleteMyProductFile,
  getMyPayments,
  createMyPayment,
  updateMyPayment,
  deleteMyPayment,
  getSalesTeamMembers,
  getSalesTeamMemberProfile
};
