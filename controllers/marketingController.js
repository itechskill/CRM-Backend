const Campaign = require('../models/Campaign');

// GET /api/campaigns
const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving campaigns.' });
  }
};

// POST /api/campaigns
const createCampaign = async (req, res) => {
  try {
    const { name, type, status, budget, reach, leadsGenerated, endDate } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Campaign name is required.' });

    const campaign = await Campaign.create({
      name: name.trim(),
      type: type || 'Email',
      status: status || 'Active',
      budget: budget ? Number(budget) : 0,
      reach: reach ? Number(reach) : 0,
      leadsGenerated: leadsGenerated ? Number(leadsGenerated) : 0,
      endDate: endDate || null,
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Campaign created successfully.', data: campaign });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating campaign.' });
  }
};

const updateCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }
    return res.status(200).json({ success: true, message: 'Campaign updated successfully.', data: campaign });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating campaign.' });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found.' });
    }
    return res.status(200).json({ success: true, message: 'Campaign deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting campaign.' });
  }
};

module.exports = {
  getCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign
};
