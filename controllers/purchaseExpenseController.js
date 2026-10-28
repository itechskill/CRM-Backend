const mongoose = require('mongoose');
const SupplierPO = require('../models/SupplierPO');
const PurchaseExpenseCategory = require('../models/PurchaseExpenseCategory');
const {
  DEFAULT_EXPENSE_CATEGORIES,
  normalizeCategoryKey,
  buildExpenseValues,
  summarizeExpenses,
  notifyAdminsOfExpense,
  valuesForHistory
} = require('../utils/purchaseExpenses');

const ADD_ROLES = new Set(['finance', 'admin']);
const EDIT_ROLES = new Set(['finance', 'admin']);
const READ_ROLES = new Set([...ADD_ROLES, 'ceo']);
const COSTING_LOCK_MESSAGE = 'Costing is Completed and locked. Admin must authorize a change.';

const getPOType = po => {
  if (po?.poType === 'Global' || po?.supplierType === 'Global' || po?.fileType === 'Blue' || /^(GPO|IPO)-/i.test(po?.poNumber || '')) return 'Global';
  return 'Local';
};

const canAccessPO = (user, po, action = 'read') => {
  const allowedRoles = action === 'add' ? ADD_ROLES : action === 'edit' ? EDIT_ROLES : READ_ROLES;
  if (!user || !allowedRoles.has(user.role)) return false;
  if (user.role !== 'purchaser') return true;
  const subDept = user.purchaserSubDept === 'Global' ? 'Global' : 'Local';
  return getPOType(po) === subDept;
};

const assertCostingEditable = (user, po) => {
  if ((po.costingStatus || 'Incomplete') === 'Completed' && user?.role !== 'admin') {
    const error = new Error(COSTING_LOCK_MESSAGE);
    error.statusCode = 409;
    throw error;
  }
};

const categoryRows = async (session = null) => {
  const overrides = await PurchaseExpenseCategory.find({}).sort({ name: 1 }).session(session || null).lean();
  const byKey = new Map(overrides.map(row => [row.key, row]));
  const rows = DEFAULT_EXPENSE_CATEGORIES.map(name => {
    const key = normalizeCategoryKey(name);
    const override = byKey.get(key);
    byKey.delete(key);
    return override || { _id: `default:${key}`, key, name, isActive: true, isDefault: true, history: [] };
  });
  rows.push(...Array.from(byKey.values()).filter((row, index, source) =>
    source.findIndex(candidate => normalizeCategoryKey(candidate.name) === normalizeCategoryKey(row.name)) === index
  ));
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
};

const ensureCategoryAvailable = async (name, user, session = null) => {
  const key = normalizeCategoryKey(name);
  if (!key) {
    const error = new Error('Expense category is required.');
    error.statusCode = 400;
    throw error;
  }
  const defaultName = DEFAULT_EXPENSE_CATEGORIES.find(item => normalizeCategoryKey(item) === key);
  const existing = await PurchaseExpenseCategory.findOne({ $or: [{ key }, { normalizedName: key }] }).session(session || null);
  if (existing && !existing.isActive) {
    const error = new Error(`Expense category "${existing.name}" is inactive.`);
    error.statusCode = 409;
    throw error;
  }
  if (!existing && !defaultName) {
    try {
      await PurchaseExpenseCategory.create([{
        key,
        name: String(name).trim().replace(/\s+/g, ' '),
        normalizedName: key,
        createdBy: user._id,
        createdByName: user.fullName || ''
      }], { session });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  return existing?.name || defaultName || String(name).trim().replace(/\s+/g, ' ');
};

const poPayload = po => ({
  ...po.toObject(),
  expenseTotals: summarizeExpenses(po)
});

exports.listExpenseCategories = async (_req, res) => {
  try {
    return res.json({ success: true, data: await categoryRows() });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error loading expense categories.' });
  }
};

exports.createExpenseCategory = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });
    const key = normalizeCategoryKey(name);
    const rows = await categoryRows();
    const duplicate = rows.find(row => normalizeCategoryKey(row.name) === key || row.key === key);
    if (duplicate) return res.status(200).json({ success: true, data: duplicate, message: 'Category already exists.' });
    const category = await PurchaseExpenseCategory.create({
      key,
      name,
      normalizedName: key,
      createdBy: req.user._id,
      createdByName: req.user.fullName || ''
    });
    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'That category already exists.' });
    return res.status(500).json({ success: false, message: 'Server error creating expense category.' });
  }
};

exports.updateExpenseCategory = async (req, res) => {
  try {
    const key = normalizeCategoryKey(decodeURIComponent(req.params.key || '').replace(/^default:/, ''));
    const defaultName = DEFAULT_EXPENSE_CATEGORIES.find(item => normalizeCategoryKey(item) === key);
    let category = await PurchaseExpenseCategory.findOne({ key });
    if (!category && !defaultName) return res.status(404).json({ success: false, message: 'Expense category not found.' });
    const oldName = category?.name || defaultName;
    const oldActive = category?.isActive ?? true;
    const name = req.body.name === undefined ? oldName : String(req.body.name).trim().replace(/\s+/g, ' ');
    const isActive = req.body.isActive === undefined ? oldActive : req.body.isActive === true;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });
    const duplicateKey = normalizeCategoryKey(name);
    const rows = await categoryRows();
    if (rows.some(row => row.key !== key && normalizeCategoryKey(row.name) === duplicateKey)) {
      return res.status(409).json({ success: false, message: 'Another category already uses that name.' });
    }
    category = await PurchaseExpenseCategory.findOneAndUpdate(
      { key },
      {
        $set: { name, normalizedName: duplicateKey, isActive, isDefaultOverride: Boolean(defaultName) },
        $setOnInsert: { key, createdBy: req.user._id, createdByName: req.user.fullName || '' },
        $push: { history: { changedBy: req.user._id, changedByName: req.user.fullName || '', oldName, newName: name, oldActive, newActive: isActive } }
      },
      { new: true, upsert: true, runValidators: true }
    );
    return res.json({ success: true, data: category });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'That category already exists.' });
    return res.status(500).json({ success: false, message: 'Server error updating expense category.' });
  }
};

exports.getSupplierPOExpenses = async (req, res) => {
  try {
    const po = await SupplierPO.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Supplier PO not found.' });
    if (!canAccessPO(req.user, po, 'read')) return res.status(403).json({ success: false, message: 'You cannot view costs for this Supplier PO.' });
    return res.json({ success: true, data: poPayload(po) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error loading Supplier PO expenses.' });
  }
};

exports.addSupplierPOExpense = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const po = await SupplierPO.findById(req.params.id).session(session);
      if (!po) { const error = new Error('Supplier PO not found.'); error.statusCode = 404; throw error; }
      if (!canAccessPO(req.user, po, 'add')) { const error = new Error('You cannot add costs to this Supplier PO.'); error.statusCode = 403; throw error; }
      assertCostingEditable(req.user, po);
      const category = await ensureCategoryAvailable(req.body.category, req.user, session);
      const values = buildExpenseValues({ ...req.body, category }, po);
      po.expenses.push({
        ...values,
        grn: mongoose.Types.ObjectId.isValid(req.body.grn) ? req.body.grn : null,
        grnNumber: String(req.body.grnNumber || '').trim(),
        addedBy: req.user._id,
        addedByName: req.user.fullName || '',
        editHistory: [{ action: 'Added', changedBy: req.user._id, changedByName: req.user.fullName || '', newValues: valuesForHistory(values) }]
      });
      const expense = po.expenses[po.expenses.length - 1];
      await po.save({ session });
      await notifyAdminsOfExpense({ po, expense, action: 'Added', user: req.user, newValues: valuesForHistory(expense), session });
      response = poPayload(po);
    });
    return res.status(201).json({ success: true, data: response });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error adding Supplier PO expense.' });
  } finally { await session.endSession(); }
};

exports.updateSupplierPOExpense = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const po = await SupplierPO.findById(req.params.id).session(session);
      if (!po) { const error = new Error('Supplier PO not found.'); error.statusCode = 404; throw error; }
      if (!canAccessPO(req.user, po, 'edit')) { const error = new Error('Only Finance and Admin can edit Supplier PO expenses.'); error.statusCode = 403; throw error; }
      assertCostingEditable(req.user, po);
      const expense = po.expenses.id(req.params.expenseId);
      if (!expense || expense.isDeleted) { const error = new Error('Active expense not found.'); error.statusCode = 404; throw error; }
      const category = await ensureCategoryAvailable(req.body.category ?? expense.category, req.user, session);
      const oldValues = valuesForHistory(expense);
      const values = buildExpenseValues({ ...oldValues, ...req.body, category, attachments: req.body.attachments ?? expense.attachments }, po);
      Object.assign(expense, values);
      expense.editHistory.push({ action: 'Edited', changedBy: req.user._id, changedByName: req.user.fullName || '', oldValues, newValues: valuesForHistory(values) });
      await po.save({ session });
      await notifyAdminsOfExpense({ po, expense, action: 'Edited', user: req.user, oldValues, newValues: valuesForHistory(expense), session });
      response = poPayload(po);
    });
    return res.json({ success: true, data: response });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error updating Supplier PO expense.' });
  } finally { await session.endSession(); }
};

exports.removeSupplierPOExpense = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const po = await SupplierPO.findById(req.params.id).session(session);
      if (!po) { const error = new Error('Supplier PO not found.'); error.statusCode = 404; throw error; }
      if (!canAccessPO(req.user, po, 'edit')) { const error = new Error('Only Finance and Admin can remove Supplier PO expenses.'); error.statusCode = 403; throw error; }
      assertCostingEditable(req.user, po);
      const expense = po.expenses.id(req.params.expenseId);
      if (!expense || expense.isDeleted) { const error = new Error('Active expense not found.'); error.statusCode = 404; throw error; }
      const oldValues = valuesForHistory(expense);
      expense.isDeleted = true;
      expense.deletedBy = req.user._id;
      expense.deletedByName = req.user.fullName || '';
      expense.deletedAt = new Date();
      expense.editHistory.push({ action: 'Removed', changedBy: req.user._id, changedByName: req.user.fullName || '', oldValues, newValues: { isDeleted: true } });
      await po.save({ session });
      await notifyAdminsOfExpense({ po, expense, action: 'Removed', user: req.user, oldValues, newValues: { ...oldValues, isDeleted: true }, session });
      response = poPayload(po);
    });
    return res.json({ success: true, data: response });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error removing Supplier PO expense.' });
  } finally { await session.endSession(); }
};

exports.updateSupplierPOCostingStatus = async (req, res) => {
  try {
    const po = await SupplierPO.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Supplier PO not found.' });
    if (!canAccessPO(req.user, po, 'edit')) {
      return res.status(403).json({ success: false, message: 'Only Finance and Admin can update costing status.' });
    }

    const currentStatus = po.costingStatus || 'Incomplete';
    const nextStatus = String(req.body.status || '').trim();
    if (!['Incomplete', 'Completed'].includes(nextStatus)) {
      return res.status(400).json({ success: false, message: 'Costing status must be Incomplete or Completed.' });
    }
    if (nextStatus === currentStatus) return res.json({ success: true, data: poPayload(po) });

    const reason = String(req.body.reason || '').trim();
    if (nextStatus === 'Incomplete') {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: COSTING_LOCK_MESSAGE });
      }
      if (!reason) {
        return res.status(400).json({ success: false, message: 'A short reason is required to re-open costing.' });
      }
    }

    po.costingStatus = nextStatus;
    po.costingHistory.push({
      action: nextStatus === 'Completed' ? 'Completed' : 'Reopened',
      previousStatus: currentStatus,
      newStatus: nextStatus,
      reason,
      changedBy: req.user._id,
      changedByName: req.user.fullName || ''
    });
    await po.save();
    return res.json({ success: true, data: poPayload(po) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating costing status.' });
  }
};

exports.canAccessPO = canAccessPO;
exports.ensureCategoryAvailable = ensureCategoryAvailable;
exports.COSTING_LOCK_MESSAGE = COSTING_LOCK_MESSAGE;
