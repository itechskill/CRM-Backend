const Client = require('../models/Client');
const Deal = require('../models/Deal');
const Lead = require('../models/Lead');
const { notifyRoleHelper } = require('./notificationController');

// CLIENTS API
const getClients = async (req, res) => {
  try {
    const clients = await Client.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: clients.length, data: clients });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving clients.' });
  }
};

const createClient = async (req, res) => {
  try {
    const { name, company, email, phone, industry, status, totalValue, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Client name is required.' });

    const client = await Client.create({
      name: name.trim(),
      company: company ? company.trim() : '',
      email: email ? email.trim() : '',
      phone: phone ? phone.trim() : '',
      industry: industry || 'Technology',
      status: status || 'Active',
      totalValue: totalValue ? Number(totalValue) : 0,
      notes: notes || '',
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Client added successfully.', data: client });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating client.' });
  }
};

const deleteClient = async (req, res) => {
  try {
    await Client.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Client deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting client.' });
  }
};

// DEALS API
const getDeals = async (req, res) => {
  try {
    const deals = await Deal.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: deals.length, data: deals });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving deals.' });
  }
};

const createDeal = async (req, res) => {
  try {
    const { title, clientName, value, stage, probability, closingDate, leadId } = req.body;
    if (!title || !clientName) return res.status(400).json({ success: false, message: 'Title and client name are required.' });

    const deal = await Deal.create({
      title: title.trim(),
      clientName: clientName.trim(),
      value: value ? Number(value) : 0,
      stage: stage || 'Qualification',
      probability: probability ? Number(probability) : 50,
      closingDate: closingDate || null,
      leadId: leadId || null,
      createdBy: req.user._id
    });

    if (leadId) {
      await Lead.findByIdAndUpdate(leadId, { status: 'Converted' });
    }

    // Auto-create client if won or converted
    const existingClient = await Client.findOne({ name: deal.clientName });
    if (!existingClient) {
      await Client.create({
        name: deal.clientName,
        company: deal.clientName,
        email: '',
        phone: '',
        industry: 'Technology',
        status: 'Active',
        totalValue: deal.value || 0,
        createdBy: req.user._id
      });
    }

    await notifyRoleHelper({
      role: 'accountant',
      sender: req.user._id,
      title: 'New Deal Ready for Invoice',
      message: `Deal "${deal.title}" for ${deal.clientName} ($${(deal.value || 0).toLocaleString()}) created by Sales is ready for invoice.`,
      type: 'deal'
    });

    return res.status(201).json({ success: true, message: 'Deal created successfully.', data: deal });
  } catch (error) {
    console.error('[Create Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating deal.' });
  }
};

const updateDeal = async (req, res) => {
  try {
    const deal = await Deal.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }

    // Auto-create client & notify Accountant when deal is won
    if (['Closed Won', 'Won'].includes(deal.stage)) {
      const existingClient = await Client.findOne({ name: deal.clientName });
      if (!existingClient) {
        await Client.create({
          name: deal.clientName,
          company: deal.clientName,
          email: '',
          phone: '',
          industry: 'Technology',
          status: 'Active',
          totalValue: deal.value || 0,
          createdBy: req.user._id
        });
      }

      await notifyRoleHelper({
        role: 'accountant',
        sender: req.user._id,
        title: 'New Deal Won — Ready for Invoice',
        message: `Deal "${deal.title}" for ${deal.clientName} ($${(deal.value || 0).toLocaleString()}) was won. Click to generate invoice.`,
        type: 'deal'
      });
    }

    return res.status(200).json({ success: true, message: 'Deal updated successfully.', data: deal });
  } catch (error) {
    console.error('[Update Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating deal.' });
  }
};

const deleteDeal = async (req, res) => {
  try {
    const deal = await Deal.findByIdAndDelete(req.params.id);
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found.' });
    }
    return res.status(200).json({ success: true, message: 'Deal deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting deal.' });
  }
};

// LEADS API
const getLeads = async (req, res) => {
  try {
    const leads = await Lead.find()
      .populate('assignedTo', 'fullName email role')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: leads.length, data: leads });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving leads.' });
  }
};

const createLead = async (req, res) => {
  try {
    const { name, company, email, phone, status, value, source, campaign, notes, assignedTo } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Lead name is required.' });

    const lead = await Lead.create({
      name: name.trim(),
      company: company ? company.trim() : '',
      email: email ? email.trim() : '',
      phone: phone ? phone.trim() : '',
      status: status || 'New',
      value: value ? Number(value) : 0,
      source: source || 'Website',
      campaign: campaign || '',
      notes: notes || '',
      assignedTo: assignedTo || null,
      createdBy: req.user._id
    });

    if (status === 'Qualified') {
      await notifyRoleHelper({
        role: 'sales_manager',
        sender: req.user._id,
        title: 'New Qualified Lead Handed Off',
        message: `Qualified lead "${lead.name}" (${lead.company || 'Direct'}) was handed off from Marketing.`,
        type: 'lead'
      });
    }

    return res.status(201).json({ success: true, message: 'Lead created successfully.', data: lead });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating lead.' });
  }
};

const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }

    if (req.body.status === 'Qualified') {
      await notifyRoleHelper({
        role: 'sales_manager',
        sender: req.user._id,
        title: 'Lead Qualified & Handed Off',
        message: `Lead "${lead.name}" (${lead.company || 'Direct'}) is now Qualified and ready for Sales engagement.`,
        type: 'lead'
      });
    }

    return res.status(200).json({ success: true, message: 'Lead updated successfully.', data: lead });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating lead.' });
  }
};

const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }
    return res.status(200).json({ success: true, message: 'Lead deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting lead.' });
  }
};

module.exports = {
  getClients,
  createClient,
  deleteClient,
  getDeals,
  createDeal,
  updateDeal,
  deleteDeal,
  getLeads,
  createLead,
  updateLead,
  deleteLead
};
