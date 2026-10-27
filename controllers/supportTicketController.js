const DeliveryNote = require('../models/DeliveryNote');
const SupportTicket = require('../models/SupportTicket');

const normalizeStatus = value => ['Received', 'Solved'].includes(value) ? value : null;

exports.listSupportTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({})
      .populate('deliveryNote', 'deliveryNumber deliveryNoteNumber clientName status')
      .populate('createdBy', 'fullName role')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: tickets.length, data: tickets });
  } catch (error) {
    console.error('List Support Tickets Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching Support tickets.' });
  }
};

exports.createSupportTicket = async (req, res) => {
  try {
    const deliveryNoteNumber = String(req.body.deliveryNoteNumber || '').trim();
    const complaint = String(req.body.complaint || '').trim();
    const status = req.body.status == null ? 'Received' : normalizeStatus(req.body.status);
    if (!deliveryNoteNumber) return res.status(400).json({ success: false, message: 'Delivery Note number is required.' });
    if (!complaint) return res.status(400).json({ success: false, message: 'Complaint is required.' });
    if (!status) return res.status(400).json({ success: false, message: 'Status must be Received or Solved.' });

    const deliveryNote = await DeliveryNote.findOne({
      $or: [{ deliveryNoteNumber }, { deliveryNumber: deliveryNoteNumber }]
    });
    if (!deliveryNote) return res.status(400).json({ success: false, message: 'Delivery Note number must match an existing Delivery Note.' });

    const ticket = await SupportTicket.create({
      deliveryNote: deliveryNote._id,
      deliveryNoteNumber: deliveryNote.deliveryNoteNumber || deliveryNote.deliveryNumber,
      complaint,
      status,
      solvedAt: status === 'Solved' ? new Date() : null,
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });
    return res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    console.error('Create Support Ticket Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating Support ticket.' });
  }
};

exports.updateSupportTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found.' });
    if (req.body.complaint !== undefined) {
      const complaint = String(req.body.complaint || '').trim();
      if (!complaint) return res.status(400).json({ success: false, message: 'Complaint is required.' });
      ticket.complaint = complaint;
    }
    if (req.body.status !== undefined) {
      const status = normalizeStatus(req.body.status);
      if (!status) return res.status(400).json({ success: false, message: 'Status must be Received or Solved.' });
      ticket.status = status;
      ticket.solvedAt = status === 'Solved' ? (ticket.solvedAt || new Date()) : null;
    }
    await ticket.save();
    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    console.error('Update Support Ticket Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating Support ticket.' });
  }
};
