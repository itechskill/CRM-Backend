const CompanyResource = require('../models/CompanyResource');

// GET /api/company-resources
const getResources = async (req, res) => {
  try {
    const resources = await CompanyResource.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: resources.length, data: resources });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving company resources.' });
  }
};

// POST /api/company-resources
const createResource = async (req, res) => {
  try {
    const { title, type, link, department, description, serialNumber, assignedTo, status } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Resource title is required.' });

    const resource = await CompanyResource.create({
      title: title.trim(),
      type: type || 'Hardware',
      link: link ? link.trim() : '',
      department: department || 'All',
      description: description || '',
      serialNumber: serialNumber ? serialNumber.trim() : '',
      assignedTo: assignedTo ? assignedTo.trim() : 'Unassigned',
      status: status || 'In Use',
      uploadedBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Resource created successfully.', data: resource });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating company resource.' });
  }
};

module.exports = {
  getResources,
  createResource
};
