const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const FollowUp = require('../models/FollowUp');
const SalesTarget = require('../models/SalesTarget');
const SalesActivity = require('../models/SalesActivity');
const Invoice = require('../models/Invoice');
const Deal = require('../models/Deal');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const User = require('../models/User');
const { notifyRoleHelper } = require('./notificationController');

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

// ─────────────────────────────────────────────
// Helper: Verify record ownership
// Returns true if user is owner (by matching ID or createdBy/assignedTo)
// ─────────────────────────────────────────────
const checkOwnership = (record, fields, userId) => {
  if (!record) return false;
  const userStr = userId.toString();
  const fieldList = Array.isArray(fields) ? fields : [fields];
  return fieldList.some(field => {
    const val = record[field]?.toString?.() || record[field];
    return val === userStr;
  });
};

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
      SalesOrder.find({ salesPerson: userId }),
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
    const totalOrdersValue = orders.reduce((sum, o) => sum + (o.netAmount || 0), 0);

    // Deal stats
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonDealsValue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
    const activeDeals = deals.filter(d => !['Won', 'Closed Won', 'Closed Lost'].includes(d.stage));
    const pipelineValue = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    // Follow-up stats
    const totalFollowUps = followUps.length;
    const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;
    const pendingFollowUps = totalFollowUps - completedFollowUps;

    // Target stats – use active target or most recent
    const activeTarget = targets.find(t => t.status === 'Active' || t.status === 'Ongoing') || targets[0];
    const monthlyTarget = activeTarget?.targetAmount || 0;
    
    // Auto calculate achieved amount from delivered/confirmed sales orders and won deals
    const ordersAchieved = orders
      .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered'].includes(o.status))
      .reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const salesAchieved = activeTarget?.achievedAmount > 0 
      ? activeTarget.achievedAmount 
      : Math.max(ordersAchieved, wonDealsValue);
    const targetAchievementPct = monthlyTarget > 0 ? Math.min(100, Math.round((salesAchieved / monthlyTarget) * 100)) : 0;
    const remainingTarget = Math.max(0, monthlyTarget - salesAchieved);

    // ── FINANCIAL STATISTICS (Dynamic from DB) ──
    // 1. Invoices
    const totalInvoicesCount = invoices.length;
    const paidInvoices = invoices.filter(i => i.status === 'Paid');
    const paidInvoicesAmount = paidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
    const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
    const invoiceReceivables = unpaidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

    // 2. Receivables: Unpaid Invoices + Outstanding Sales Orders
    const pendingOrders = orders.filter(o => ['Pending', 'Confirmed', 'Processing', 'Shipped'].includes(o.status));
    const orderReceivables = pendingOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const receivables = invoiceReceivables + orderReceivables;

    // 3. Overdue: Payment/Delivery Due Date < Current Date AND Outstanding > 0
    const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
    const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
    const overdueOrders = orders.filter(o => o.deliveryDate && new Date(o.deliveryDate) < now && !['Delivered', 'Cancelled'].includes(o.status));
    const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const overdueAmount = overdueInvoiceAmount + overdueOrderAmount;

    // 4. Salary Target: From employee user record or payroll baseSalary / salesTarget
    const salaryTarget = user?.salaryTarget || payroll?.baseSalary || (monthlyTarget * 0.1) || 0;

    // 5. Liability: Cancelled orders or liabilities
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
    const liability = cancelledOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);

    // 6. Net Revenue
    const netRevenue = ordersAchieved || paidInvoicesAmount || wonDealsValue;

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
        activeTarget: activeTarget ? activeTarget.toJSON() : null,
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
    const { name, company, email, phone, status, value, source, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Lead name is required.' });

    const lead = await Lead.create({
      name: name.trim(),
      company: company?.trim() || '',
      email: email?.trim() || '',
      phone: phone?.trim() || '',
      status: status || 'New',
      value: value ? Number(value) : 0,
      source: source || 'Direct',
      notes: notes || '',
      assignedTo: req.user._id,
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Lead Created',
      description: `Created lead: ${lead.name}${lead.company ? ` from ${lead.company}` : ''}`,
      relatedModel: 'Lead',
      relatedId: lead._id,
      performedBy: req.user._id
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

    if (!checkOwnership(lead, ['assignedTo', 'createdBy'], req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own leads.' });
    }

    const prevStatus = lead.status;
    const allowedFields = ['name', 'company', 'email', 'phone', 'status', 'value', 'source', 'notes'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) lead[field] = req.body[field];
    });

    await lead.save();

    const actType = lead.status === 'Converted' ? 'Lead Converted' : 'Lead Updated';
    await logSalesActivity({
      type: actType,
      description: `Updated lead: ${lead.name} — status: ${lead.status} (was ${prevStatus})`,
      relatedModel: 'Lead',
      relatedId: lead._id,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Lead updated.', data: lead });
  } catch (error) {
    console.error('[Update Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating lead.' });
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
    const { title, clientName, value, stage, probability, closingDate, leadId } = req.body;
    if (!title || !clientName) {
      return res.status(400).json({ success: false, message: 'Deal title and client name are required.' });
    }

    const deal = await Deal.create({
      title: title.trim(),
      clientName: clientName.trim(),
      value: value ? Number(value) : 0,
      stage: stage || 'Qualification',
      probability: probability !== undefined ? Number(probability) : 50,
      closingDate: closingDate || null,
      leadId: leadId || null,
      assignedTo: req.user._id,
      createdBy: req.user._id
    });

    if (leadId) {
      await Lead.findByIdAndUpdate(leadId, { status: 'Converted' });
    }

    await logSalesActivity({
      type: 'Deal Created',
      description: `Created deal "${deal.title}" for ${deal.clientName} ($${Number(deal.value).toLocaleString()})`,
      relatedModel: 'Deal',
      relatedId: deal._id,
      performedBy: req.user._id
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

    if (!checkOwnership(deal, ['assignedTo', 'createdBy'], req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own deals.' });
    }

    const prevStage = deal.stage;
    const allowedFields = ['title', 'clientName', 'value', 'stage', 'probability', 'closingDate', 'leadId'];
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
      await notifyRoleHelper({
        role: 'accountant',
        sender: req.user._id,
        title: 'New Deal Won — Ready for Invoice',
        message: `Deal "${deal.title}" for ${deal.clientName} ($${(deal.value || 0).toLocaleString()}) won by ${req.user.fullName}. Ready for invoice.`,
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
/**
 * @desc    Get my quotations
 * @route   GET /api/sales-employee/quotations
 */
const getMyQuotations = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { createdBy: req.user._id };
    if (status && status !== 'all') query.status = status;

    const quotations = await Quotation.find(query).sort({ createdAt: -1 });
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
    const { clientName, clientEmail, clientPhone, items, totalAmount, discount, tax, netAmount, status, validUntil, notes, leadId } = req.body;
    if (!clientName) return res.status(400).json({ success: false, message: 'Client name is required.' });

    const quotation = await Quotation.create({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || '',
      clientPhone: clientPhone?.trim() || '',
      items: items || [],
      totalAmount: totalAmount || 0,
      discount: discount || 0,
      tax: tax || 0,
      netAmount: netAmount || 0,
      status: status || 'Draft',
      validUntil: validUntil || null,
      notes: notes || '',
      leadId: leadId || null,
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Quotation Created',
      description: `Created quotation ${quotation.quotationNumber} for ${quotation.clientName}`,
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
 * @desc    Update my quotation (ownership enforced)
 * @route   PATCH /api/sales-employee/quotations/:id
 */
const updateMyQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found.' });

    if (!checkOwnership(quotation, 'createdBy', req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own quotations.' });
    }

    const allowedFields = ['clientName', 'clientEmail', 'clientPhone', 'items', 'totalAmount', 'discount', 'tax', 'netAmount', 'status', 'validUntil', 'notes'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) quotation[field] = req.body[field];
    });

    await quotation.save();

    const actType = quotation.status === 'Sent' ? 'Quotation Sent' : quotation.status === 'Accepted' ? 'Quotation Accepted' : quotation.status === 'Rejected' ? 'Quotation Rejected' : 'Quotation Updated';
    await logSalesActivity({
      type: actType,
      description: `Updated quotation ${quotation.quotationNumber} — status: ${quotation.status}`,
      relatedModel: 'Quotation',
      relatedId: quotation._id,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Quotation updated.', data: quotation });
  } catch (error) {
    console.error('[Update Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating quotation.' });
  }
};

// ══════════════════════════════════════════════
// SALES ORDERS
// ══════════════════════════════════════════════
/**
 * @desc    Get my sales orders
 * @route   GET /api/sales-employee/orders
 */
const getMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { salesPerson: req.user._id };
    if (status && status !== 'all') query.status = status;

    const orders = await SalesOrder.find(query).sort({ createdAt: -1 });
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
    const { clientName, clientEmail, clientPhone, items, totalAmount, discount, tax, netAmount, status, deliveryDate, notes, quotationId, leadId } = req.body;
    if (!clientName) return res.status(400).json({ success: false, message: 'Client name is required.' });

    const order = await SalesOrder.create({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || '',
      clientPhone: clientPhone?.trim() || '',
      items: items || [],
      totalAmount: totalAmount || 0,
      discount: discount || 0,
      tax: tax || 0,
      netAmount: netAmount || 0,
      status: status || 'Pending',
      deliveryDate: deliveryDate || null,
      notes: notes || '',
      quotationId: quotationId || null,
      leadId: leadId || null,
      salesPerson: req.user._id
    });

    await logSalesActivity({
      type: 'Sales Order Created',
      description: `Created sales order ${order.orderNumber} for ${order.clientName}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      performedBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Sales order created.', data: order });
  } catch (error) {
    console.error('[Create Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating order.' });
  }
};

/**
 * @desc    Update my sales order (ownership enforced)
 * @route   PATCH /api/sales-employee/orders/:id
 */
const updateMyOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    if (!checkOwnership(order, 'salesPerson', req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own orders.' });
    }

    const allowedFields = ['clientName', 'clientEmail', 'clientPhone', 'items', 'totalAmount', 'discount', 'tax', 'netAmount', 'status', 'deliveryDate', 'notes'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) order[field] = req.body[field];
    });

    await order.save();

    await logSalesActivity({
      type: 'Sales Order Updated',
      description: `Updated order ${order.orderNumber} — status: ${order.status}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Order updated.', data: order });
  } catch (error) {
    console.error('[Update Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating order.' });
  }
};

// ══════════════════════════════════════════════
// DELIVERY NOTES
// ══════════════════════════════════════════════
const getMyDeliveryNotes = async (req, res) => {
  try {
    const notes = await DeliveryNote.find({ createdBy: req.user._id })
      .populate('salesOrder', 'orderNumber clientName')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: notes.length, data: notes });
  } catch (error) {
    console.error('[Get Delivery Notes Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching delivery notes.' });
  }
};

const createMyDeliveryNote = async (req, res) => {
  try {
    const { salesOrderId, recipientName, recipientPhone, deliveryAddress, trackingNumber, carrier, deliveryDate, items, notes } = req.body;

    const deliveryNote = await DeliveryNote.create({
      salesOrder: salesOrderId || null,
      recipientName: recipientName || '',
      recipientPhone: recipientPhone || '',
      deliveryAddress: deliveryAddress || '',
      trackingNumber: trackingNumber || '',
      carrier: carrier || '',
      deliveryDate: deliveryDate || null,
      items: items || [],
      notes: notes || '',
      status: 'Dispatched',
      createdBy: req.user._id
    });

    if (salesOrderId) {
      await SalesOrder.findByIdAndUpdate(salesOrderId, { status: 'Shipped' });
    }

    await logSalesActivity({
      type: 'Delivery Note Created',
      description: `Dispatched delivery note ${deliveryNote.deliveryNoteNumber}`,
      relatedModel: 'DeliveryNote',
      relatedId: deliveryNote._id,
      performedBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Delivery note created.', data: deliveryNote });
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
    const { title, description, contactName, contactEmail, contactPhone, type, scheduledAt, leadId, notes } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Follow-up title is required.' });

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
      notes: notes || '',
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Follow-up Created',
      description: `Scheduled follow-up: "${followUp.title}" (${followUp.type})`,
      relatedModel: 'FollowUp',
      relatedId: followUp._id,
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

    if (!checkOwnership(followUp, 'createdBy', req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const allowedFields = ['title', 'description', 'contactName', 'contactEmail', 'contactPhone', 'type', 'status', 'scheduledAt', 'notes', 'outcome'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) followUp[field] = req.body[field];
    });

    await followUp.save();

    await logSalesActivity({
      type: 'Follow-up Updated',
      description: `Updated follow-up "${followUp.title}" — status: ${followUp.status}`,
      relatedModel: 'FollowUp',
      relatedId: followUp._id,
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
    const targets = await SalesTarget.find({ employee: req.user._id })
      .populate('assignedBy', 'fullName')
      .sort({ createdAt: -1 });
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
          SalesOrder.find({ salesPerson: empId }),
          Deal.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }),
          FollowUp.find({ createdBy: empId }),
          SalesTarget.findOne({ employee: empId, status: { $in: ['Active', 'Ongoing'] } }).sort({ createdAt: -1 }),
          Invoice.find({ createdBy: empId }),
          Payroll.findOne({ user: empId, month: now.getMonth() + 1, year: now.getFullYear() })
        ]);

        const targetAmount = activeTarget?.targetAmount || 0;
        const ordersAchieved = orders
          .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered'].includes(o.status))
          .reduce((sum, o) => sum + (o.netAmount || 0), 0);
        const wonDealsValue = deals
          .filter(d => ['Won', 'Closed Won'].includes(d.stage))
          .reduce((sum, d) => sum + (d.value || 0), 0);
        const achievedAmount = activeTarget?.achievedAmount > 0 
          ? activeTarget.achievedAmount 
          : Math.max(ordersAchieved, wonDealsValue);
        const targetPct = targetAmount > 0 ? Math.min(100, Math.round((achievedAmount / targetAmount) * 100)) : 0;

        const convertedLeads = leads.filter(l => l.status === 'Converted').length;
        const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
        const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;

        // Financials
        const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
        const invoiceReceivables = unpaidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
        const pendingOrders = orders.filter(o => ['Pending', 'Confirmed', 'Processing', 'Shipped'].includes(o.status));
        const orderReceivables = pendingOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);
        const receivables = invoiceReceivables + orderReceivables;

        const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
        const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
        const overdueOrders = orders.filter(o => o.deliveryDate && new Date(o.deliveryDate) < now && !['Delivered', 'Cancelled'].includes(o.status));
        const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);
        const overdueAmount = overdueInvoiceAmount + overdueOrderAmount;

        const salaryTarget = emp.salaryTarget || payroll?.baseSalary || (targetAmount * 0.1) || 0;
        const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
        const liability = cancelledOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);

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

    const [leads, quotations, orders, deliveryNotes, followUps, targets, activities, invoices, deals, payroll] = await Promise.all([
      Lead.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }).sort({ createdAt: -1 }),
      Quotation.find({ createdBy: empId }).sort({ createdAt: -1 }),
      SalesOrder.find({ salesPerson: empId }).sort({ createdAt: -1 }),
      DeliveryNote.find({ createdBy: empId }).populate('salesOrder', 'orderNumber').sort({ createdAt: -1 }),
      FollowUp.find({ createdBy: empId }).populate('lead', 'name company').sort({ scheduledAt: 1 }),
      SalesTarget.find({ employee: empId }).populate('assignedBy', 'fullName').sort({ createdAt: -1 }),
      SalesActivity.find({ performedBy: empId }).sort({ createdAt: -1 }).limit(50),
      Invoice.find({ createdBy: empId }).sort({ createdAt: -1 }),
      Deal.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }).sort({ createdAt: -1 }),
      Payroll.findOne({ user: empId, month: now.getMonth() + 1, year: now.getFullYear() })
    ]);

    // Performance summary
    const totalLeads = leads.length;
    const convertedLeads = leads.filter(l => l.status === 'Converted').length;
    const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
    const totalQuotations = quotations.length;
    const totalOrders = orders.length;
    const totalDeliveryNotes = deliveryNotes.length;
    const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonDealsValue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    const activeTarget = targets.find(t => t.status === 'Active' || t.status === 'Ongoing') || targets[0];
    const monthlyTarget = activeTarget?.targetAmount || 0;
    const ordersAchieved = orders
      .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered'].includes(o.status))
      .reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const salesAchieved = activeTarget?.achievedAmount > 0 
      ? activeTarget.achievedAmount 
      : Math.max(ordersAchieved, wonDealsValue);
    const remainingTarget = Math.max(0, monthlyTarget - salesAchieved);
    const achievementPct = monthlyTarget > 0 ? Math.min(100, Math.round((salesAchieved / monthlyTarget) * 100)) : 0;

    // Financial calculations
    const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
    const invoiceReceivables = unpaidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
    const pendingOrders = orders.filter(o => ['Pending', 'Confirmed', 'Processing', 'Shipped'].includes(o.status));
    const orderReceivables = pendingOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const receivables = invoiceReceivables + orderReceivables;

    const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
    const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
    const overdueOrders = orders.filter(o => o.deliveryDate && new Date(o.deliveryDate) < now && !['Delivered', 'Cancelled'].includes(o.status));
    const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);
    const overdueAmount = overdueInvoiceAmount + overdueOrderAmount;

    const salaryTarget = emp.salaryTarget || payroll?.baseSalary || (monthlyTarget * 0.1) || 0;
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
    const liability = cancelledOrders.reduce((sum, o) => sum + (o.netAmount || 0), 0);

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
        deals
      }
    });
  } catch (error) {
    console.error('[Get Sales Team Member Profile Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching profile.' });
  }
};

module.exports = {
  getMySalesStats,
  getMyLeads,
  createMyLead,
  updateMyLead,
  getMyDeals,
  createMyDeal,
  updateMyDeal,
  getMyInvoices,
  createMyInvoice,
  getMyQuotations,
  createMyQuotation,
  updateMyQuotation,
  getMyOrders,
  createMyOrder,
  updateMyOrder,
  getMyDeliveryNotes,
  createMyDeliveryNote,
  getMyFollowUps,
  createMyFollowUp,
  updateMyFollowUp,
  getMyTargets,
  getMyActivities,
  getSalesTeamMembers,
  getSalesTeamMemberProfile
};
