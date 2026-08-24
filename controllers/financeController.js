const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');

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
    const { clientName, amount, dueDate, description, status } = req.body;
    if (!clientName || !amount || !dueDate) {
      return res.status(400).json({ success: false, message: 'Client name, amount, and due date are required.' });
    }

    const count = await Invoice.countDocuments();
    const invoiceNumber = `INV-${String(count + 1001).padStart(5, '0')}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      clientName: clientName.trim(),
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

module.exports = {
  getInvoices,
  createInvoice,
  getExpenses,
  createExpense
};
