const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');
const Payroll = require('../models/Payroll');
const User = require('../models/User');

// INVOICES API
const getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: invoices.length, data: invoices });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving invoices.' });
  }
};

const createInvoice = async (req, res) => {
  try {
    const { clientName, dealId, dealTitle, amount, dueDate, description, status } = req.body;
    if (!clientName || !amount || !dueDate) {
      return res.status(400).json({ success: false, message: 'Client name, amount, and due date are required.' });
    }

    const count = await Invoice.countDocuments();
    const invoiceNumber = `INV-${String(count + 1001).padStart(5, '0')}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      clientName: clientName.trim(),
      dealId: dealId || null,
      dealTitle: dealTitle || '',
      amount: Number(amount),
      status: status || 'Draft',
      dueDate,
      description: description || '',
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Invoice created successfully.', data: invoice });
  } catch (error) {
    console.error('[Create Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating invoice.' });
  }
};

const updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }
    return res.status(200).json({ success: true, message: 'Invoice updated successfully.', data: invoice });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating invoice.' });
  }
};

const deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }
    return res.status(200).json({ success: true, message: 'Invoice deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting invoice.' });
  }
};

// EXPENSES API
const getExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: expenses.length, data: expenses });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving expenses.' });
  }
};

const createExpense = async (req, res) => {
  try {
    const { title, category, amount, notes } = req.body;
    if (!title || !amount) {
      return res.status(400).json({ success: false, message: 'Title and amount are required.' });
    }

    const expense = await Expense.create({
      title: title.trim(),
      category: category || 'Office Supplies',
      amount: Number(amount),
      submittedBy: req.user._id,
      submittedByName: req.user.fullName,
      notes: notes || '',
      status: 'Pending'
    });

    return res.status(201).json({ success: true, message: 'Expense submitted successfully.', data: expense });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating expense.' });
  }
};

const updateExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }
    return res.status(200).json({ success: true, message: 'Expense updated successfully.', data: expense });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating expense.' });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found.' });
    }
    return res.status(200).json({ success: true, message: 'Expense deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting expense.' });
  }
};

// PAYROLL API
// GET /api/finance/payroll — List payroll records (auto-init missing employees)
const getPayroll = async (req, res) => {
  try {
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();

    // Get all active non-admin employees
    const employees = await User.find({ status: 'active', role: { $nin: ['admin'] } })
      .select('fullName email department role employeeId')
      .sort({ fullName: 1 });

    // Get existing payroll records for this month/year
    const existingPayrolls = await Payroll.find({ month, year })
      .populate('user', 'fullName email department role employeeId');

    const existingUserIds = new Set(existingPayrolls.map(p => p.user?._id?.toString()));

    // Auto-create missing payroll records with $0 defaults
    const toCreate = employees
      .filter(emp => !existingUserIds.has(emp._id.toString()))
      .map(emp => ({
        user: emp._id,
        month,
        year,
        baseSalary: 0,
        bonus: 0,
        taxDeduction: 0,
        netPay: 0,
        status: 'Pending'
      }));

    if (toCreate.length > 0) {
      await Payroll.insertMany(toCreate, { ordered: false }).catch(() => {});
    }

    // Re-fetch all payroll for this period
    const payrolls = await Payroll.find({ month, year })
      .populate('user', 'fullName email department role employeeId')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: payrolls.length,
      month,
      year,
      data: payrolls
    });
  } catch (error) {
    console.error('[Get Payroll Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving payroll.' });
  }
};

// PATCH /api/finance/payroll/:id — Update a payroll record
const updatePayroll = async (req, res) => {
  try {
    const { baseSalary, bonus, taxDeduction, netPay, status, notes } = req.body;

    const record = await Payroll.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Payroll record not found.' });
    }

    if (baseSalary !== undefined) record.baseSalary = Number(baseSalary);
    if (bonus !== undefined) record.bonus = Number(bonus);
    if (taxDeduction !== undefined) record.taxDeduction = Number(taxDeduction);
    if (notes !== undefined) record.notes = notes;
    if (status !== undefined) record.status = status;

    // Auto-calculate netPay if not provided
    if (netPay !== undefined) {
      record.netPay = Number(netPay);
    } else {
      record.netPay = (record.baseSalary + record.bonus) - record.taxDeduction;
    }

    record.processedBy = req.user._id;
    await record.save();

    const populated = await Payroll.findById(record._id)
      .populate('user', 'fullName email department role employeeId');

    return res.status(200).json({ success: true, message: 'Payroll record updated.', data: populated });
  } catch (error) {
    console.error('[Update Payroll Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating payroll.' });
  }
};

// DELETE /api/finance/payroll/:id
const deletePayroll = async (req, res) => {
  try {
    const record = await Payroll.findByIdAndDelete(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Payroll record not found.' });
    }
    return res.status(200).json({ success: true, message: 'Payroll record deleted.' });
  } catch (error) {
    console.error('[Delete Payroll Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting payroll.' });
  }
};

// GET /api/finance/summary — Aggregated finance data for CEO view
const getFinanceSummary = async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    const expenses = await Expense.find().sort({ createdAt: -1 });

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const payrollRecords = await Payroll.find({ month, year });

    const totalRevenue = invoices
      .filter(inv => inv.status === 'Paid')
      .reduce((sum, inv) => sum + (inv.amount || 0), 0);

    const totalPending = invoices
      .filter(inv => inv.status === 'Pending')
      .reduce((sum, inv) => sum + (inv.amount || 0), 0);

    const totalOverdue = invoices
      .filter(inv => inv.status === 'Overdue')
      .reduce((sum, inv) => sum + (inv.amount || 0), 0);

    const totalExpenses = expenses
      .filter(exp => exp.status === 'Approved')
      .reduce((sum, exp) => sum + (exp.amount || 0), 0);

    const totalPayroll = payrollRecords.reduce((sum, p) => sum + (p.netPay || 0), 0);

    const allDealValues = invoices.map(inv => inv.amount || 0);
    const avgDealSize = allDealValues.length > 0
      ? Math.round(allDealValues.reduce((a, b) => a + b, 0) / allDealValues.length)
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalPending,
        totalOverdue,
        totalExpenses,
        totalPayroll,
        avgDealSize,
        invoiceCount: invoices.length,
        paidCount: invoices.filter(i => i.status === 'Paid').length,
        recentInvoices: invoices.slice(0, 10),
        recentExpenses: expenses.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('[Get Finance Summary Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching finance summary.' });
  }
};

module.exports = {
  getInvoices,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getPayroll,
  updatePayroll,
  deletePayroll,
  getFinanceSummary
};
