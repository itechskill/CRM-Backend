const Client = require('../models/Client');
const Deal = require('../models/Deal');
const Lead = require('../models/Lead');

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
    const { title, clientName, value, stage, probability, closingDate } = req.body;
    if (!title || !clientName) return res.status(400).json({ success: false, message: 'Title and client name are required.' });

    const deal = await Deal.create({
      title: title.trim(),
      clientName: clientName.trim(),
      value: value ? Number(value) : 0,
      stage: stage || 'Prospecting',
      probability: probability ? Number(probability) : 50,
      closingDate: closingDate || null,
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Deal created successfully.', data: deal });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating deal.' });
  }
};

// LEADS API
const getLeads = async (req, res) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: leads.length, data: leads });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving leads.' });
  }
};

const createLead = async (req, res) => {
  try {
    const { name, company, email, phone, status, value, source } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Lead name is required.' });

    const lead = await Lead.create({
      name: name.trim(),
      company: company ? company.trim() : '',
      email: email ? email.trim() : '',
      phone: phone ? phone.trim() : '',
      status: status || 'New',
      value: value ? Number(value) : 0,
      source: source || 'Website',
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Lead created successfully.', data: lead });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating lead.' });
  }
};

module.exports = {
  getClients,
  createClient,
  deleteClient,
  getDeals,
  createDeal,
  getLeads,
  createLead
};
