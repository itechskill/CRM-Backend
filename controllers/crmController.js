const Client = require('../models/Client');
const Deal = require('../models/Deal');
const Lead = require('../models/Lead');
const SalesContact = require('../models/SalesContact');
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

// SALES CONTACTS API
const getSalesContacts = async (req, res) => {
  try {
    const contacts = await SalesContact.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: contacts.length, data: contacts });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving contacts.' });
  }
};

const createSalesContact = async (req, res) => {
  try {
    const { name, role, company, email, phone, tags, notes, nextFollowUp } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Contact name is required.' });

    const contact = await SalesContact.create({
      name: name.trim(),
      role: role ? role.trim() : '',
      company: company ? company.trim() : '',
      email: email ? email.trim() : '',
      phone: phone ? phone.trim() : '',
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      notes: notes || '',
      nextFollowUp: nextFollowUp || null,
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Contact created successfully.', data: contact });
  } catch (error) {
    console.error('[Create SalesContact Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating contact.' });
  }
};

const deleteSalesContact = async (req, res) => {
  try {
    await SalesContact.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Contact deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting contact.' });
  }
};

// GET /api/crm/sales-summary — Real Sales Manager Dashboard Data
const getSalesSummary = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const [leads, deals, clients] = await Promise.all([
      Lead.find().populate('assignedTo', 'fullName').lean(),
      Deal.find().lean(),
      Client.countDocuments()
    ]);

    const totalLeads = leads.length;
    const qualifiedLeads = leads.filter(l => ['Qualified', 'Converted', 'Won'].includes(l.status)).length;
    const wonDeals = deals.filter(d => ['Closed Won', 'Won'].includes(d.stage)).length;
    const pipelineValue = deals
      .filter(d => !['Closed Won', 'Closed Lost', 'Won', 'Lost'].includes(d.stage))
      .reduce((sum, d) => sum + (d.value || 0), 0);

    // Monthly revenue from won deals this month
    const monthlyRevenue = deals
      .filter(d => ['Closed Won', 'Won'].includes(d.stage) && new Date(d.updatedAt) >= startOfMonth)
      .reduce((sum, d) => sum + (d.value || 0), 0);

    // Conversion rate: converted/total leads
    const convertedLeads = leads.filter(l => ['Converted', 'Won'].includes(l.status)).length;
    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

    // Lead sources breakdown
    const sourceCounts = {};
    const sourceColors = { Website: '#2563EB', Referral: '#10B981', 'Social Media': '#F59E0B', LinkedIn: '#0A66C2', Email: '#EC4899', 'Cold Outreach': '#8B5CF6', 'Trade Show': '#F97316', Other: '#94A3B8' };
    leads.forEach(l => {
      const src = l.source || 'Other';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });
    const leadSourcesData = Object.entries(sourceCounts).map(([name, value]) => ({
      name, value, color: sourceColors[name] || '#64748B'
    }));

    // Revenue by month (last 6 months, from won deals)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueByMonth = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      revenueByMonth[key] = { month: monthNames[d.getMonth()], actual: 0, target: 200 };
    }
    deals
      .filter(d => ['Closed Won', 'Won'].includes(d.stage))
      .forEach(d => {
        const date = new Date(d.updatedAt || d.createdAt);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        if (revenueByMonth[key]) {
          revenueByMonth[key].actual += Math.round((d.value || 0) / 1000);
        }
      });
    const revenueData = Object.values(revenueByMonth);

    // Pipeline stages grouped by deal stage
    const stageConfig = [
      { id: 'Qualification', label: 'QUALIFICATION', headerBg: '#F8FAFC', headerColor: '#334155', badgeBg: '#0F172A' },
      { id: 'Proposal', label: 'PROPOSAL', headerBg: '#EFF6FF', headerColor: '#1D4ED8', badgeBg: '#2563EB' },
      { id: 'Negotiation', label: 'NEGOTIATION', headerBg: '#F5F3FF', headerColor: '#7C3AED', badgeBg: '#8B5CF6' },
      { id: 'Closed Won', label: 'CLOSED WON', headerBg: '#F0FDF4', headerColor: '#15803D', badgeBg: '#16A34A' },
    ];
    const activePipelineDeals = deals.filter(d => !['Closed Lost', 'Lost'].includes(d.stage));
    const pipelineStages = stageConfig.map(stage => {
      const stageDeals = activePipelineDeals.filter(d => d.stage === stage.id || (stage.id === 'Qualification' && !['Proposal', 'Negotiation', 'Closed Won', 'Won'].includes(d.stage)));
      return {
        ...stage,
        count: stageDeals.length,
        pipelineValue: `$${Math.round(stageDeals.reduce((s, d) => s + (d.value || 0), 0) / 1000)}k`,
        deals: stageDeals.slice(0, 4).map(d => ({
          name: d.clientName || d.title,
          company: d.clientName || '',
          value: `$${Math.round((d.value || 0) / 1000)}k`,
          priority: (d.value || 0) >= 100000 ? 'High' : (d.value || 0) >= 50000 ? 'Medium' : 'Low',
          initials: (d.clientName || d.title || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
        }))
      };
    });

    // Meetings scheduled (from meetings if model exists)
    const meetingsScheduled = deals.filter(d => d.stage === 'Negotiation' || d.stage === 'Proposal').length;

    return res.status(200).json({
      success: true,
      data: {
        kpis: {
          totalLeads,
          qualifiedLeads,
          meetingsScheduled,
          proposalsSent: deals.filter(d => d.stage === 'Proposal').length,
          wonClients: wonDeals,
          conversionRate: `${conversionRate}%`,
          monthlyRevenue,
          pipelineValue
        },
        revenueData,
        leadSourcesData,
        pipelineStages,
        totalClients: clients
      }
    });
  } catch (error) {
    console.error('[Sales Summary Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching sales summary.' });
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
  deleteLead,
  getSalesContacts,
  createSalesContact,
  deleteSalesContact,
  getSalesSummary
};
