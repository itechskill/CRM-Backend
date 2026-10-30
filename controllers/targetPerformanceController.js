const User = require('../models/User');
const TargetPerformanceSetting = require('../models/TargetPerformanceSetting');
const { SALES_ROLES, loadPerformanceForUsers, monthRange, invalidateTargetPerformanceCache } = require('../utils/targetPerformance');

const getSetting = async () => {
  const setting = await TargetPerformanceSetting.findOne({ key: 'global' }).lean();
  return { showToSalespeople: Boolean(setting?.showToSalespeople), updatedAt: setting?.updatedAt || null };
};

const getVisibility = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await getSetting() });
  } catch (error) {
    console.error('[Target Performance Visibility Error]:', error);
    return res.status(500).json({ success: false, message: 'Could not load Target Performance visibility.' });
  }
};

const getMyTargetPerformance = async (req, res) => {
  try {
    const setting = await getSetting();
    if (!setting.showToSalespeople) {
      return res.status(200).json({ success: true, data: { visible: false, month: monthRange(req.query.month).key } });
    }
    const user = await User.findById(req.user._id).select('_id fullName email role monthlySalesSalaryCents').lean();
    if (!user || !SALES_ROLES.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Target Performance is only available to Sales users.' });
    }
    const [performance] = await loadPerformanceForUsers({ users: [user], month: req.query.month });
    return res.status(200).json({ success: true, data: { visible: true, ...performance } });
  } catch (error) {
    console.error('[My Target Performance Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Could not calculate Target Performance.' });
  }
};

const getAdminTargetPerformance = async (req, res) => {
  try {
    const [users, setting] = await Promise.all([
      User.find({ role: { $in: SALES_ROLES }, status: 'active' })
        .select('_id fullName email role monthlySalesSalaryCents')
        .sort({ fullName: 1 })
        .lean(),
      getSetting()
    ]);
    const rows = await loadPerformanceForUsers({ users, month: req.query.month });
    const salaryVisible = req.user.role === 'admin';
    const presentationRows = rows.map(row => ({
      ...row,
      invoices: row.invoices.filter(invoice => invoice.needsFinance || invoice.costChangedAfterCredit)
    }));
    const data = salaryVisible ? presentationRows : presentationRows.map(row => ({
      ...row, salaryCents: null, targetCents: null, performancePercent: null
    }));
    return res.status(200).json({
      success: true,
      data: { setting, salaryVisible, month: monthRange(req.query.month).key, salespeople: data }
    });
  } catch (error) {
    console.error('[Admin Target Performance Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Could not calculate team Target Performance.' });
  }
};

const updateSalary = async (req, res) => {
  try {
    const monthlySalaryCents = Number(req.body.monthlySalaryCents);
    if (!Number.isSafeInteger(monthlySalaryCents) || monthlySalaryCents < 0) {
      return res.status(400).json({ success: false, message: 'Monthly salary must be a non-negative integer number of cents.' });
    }
    const user = await User.findOneAndUpdate(
      { _id: req.params.userId, role: { $in: SALES_ROLES } },
      { $set: { monthlySalesSalaryCents: monthlySalaryCents } },
      { new: true, runValidators: true }
    ).select('_id fullName email role monthlySalesSalaryCents');
    if (!user) return res.status(404).json({ success: false, message: 'Salesperson not found.' });
    invalidateTargetPerformanceCache();
    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('[Update Target Salary Error]:', error);
    return res.status(500).json({ success: false, message: 'Could not update the monthly salary.' });
  }
};

const updateVisibility = async (req, res) => {
  try {
    if (typeof req.body.showToSalespeople !== 'boolean') {
      return res.status(400).json({ success: false, message: 'showToSalespeople must be true or false.' });
    }
    const setting = await TargetPerformanceSetting.findOneAndUpdate(
      { key: 'global' },
      { $set: { showToSalespeople: req.body.showToSalespeople, updatedBy: req.user._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    invalidateTargetPerformanceCache();
    return res.status(200).json({ success: true, data: setting });
  } catch (error) {
    console.error('[Update Target Performance Visibility Error]:', error);
    return res.status(500).json({ success: false, message: 'Could not update Target Performance visibility.' });
  }
};

const getFinanceOverdueInvoices = async (req, res) => {
  try {
    const users = await User.find({ role: { $in: SALES_ROLES }, status: 'active' })
      .select('_id fullName email role monthlySalesSalaryCents')
      .lean();
    const rows = await loadPerformanceForUsers({ users, month: req.query.month });
    const invoices = rows.flatMap(row => row.invoices
      .filter(invoice => invoice.needsFinance)
      .map(invoice => ({
        ...invoice,
        salespersonId: row.userId,
        salespersonName: row.fullName,
        salespersonEmail: row.email
      })));
    return res.status(200).json({ success: true, count: invoices.length, data: { month: monthRange(req.query.month).key, invoices } });
  } catch (error) {
    console.error('[Finance Late Payment Performance Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Could not load invoices needing Finance.' });
  }
};

module.exports = {
  getVisibility,
  getMyTargetPerformance,
  getAdminTargetPerformance,
  updateSalary,
  updateVisibility,
  getFinanceOverdueInvoices
};
