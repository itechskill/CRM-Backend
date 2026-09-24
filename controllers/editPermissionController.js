const EditPermissionRequest = require('../models/EditPermissionRequest');
const EditAuditLog = require('../models/EditAuditLog');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const PurchaserGRN = require('../models/PurchaserGRN');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Quotation = require('../models/Quotation');
const SupplierPO = require('../models/SupplierPO');
const { notifyRoleHelper, createNotificationHelper } = require('./notificationController');

// Helper to resolve document reference number and status
const getDocumentDetails = async (documentType, documentId) => {
  try {
    const docTypeLower = (documentType || '').toLowerCase();
    if (docTypeLower.includes('salesorder') || docTypeLower === 'sales order') {
      const doc = await SalesOrder.findById(documentId).lean();
      return {
        number: doc?.orderNumber || doc?.orderReference || 'Sales Order',
        status: doc?.status || 'N/A',
        data: doc
      };
    }
    if (docTypeLower.includes('deliverynote') || docTypeLower === 'delivery note') {
      const doc = await DeliveryNote.findById(documentId).lean();
      return {
        number: doc?.deliveryNumber || doc?.deliveryNoteNumber || 'Delivery Note',
        status: doc?.status || 'N/A',
        data: doc
      };
    }
    if (docTypeLower.includes('grn')) {
      const doc = await PurchaserGRN.findById(documentId).lean();
      return {
        number: doc?.grnNumber || 'GRN',
        status: doc?.status || 'N/A',
        data: doc
      };
    }
    if (docTypeLower.includes('invoice')) {
      const doc = await Invoice.findById(documentId).lean();
      return {
        number: doc?.invoiceNumber || 'Invoice',
        status: doc?.status || 'N/A',
        data: doc
      };
    }
    if (docTypeLower.includes('payment')) {
      const doc = await Payment.findById(documentId).lean();
      return {
        number: doc?.receiptNumber || doc?.paymentNumber || 'Payment',
        status: doc?.status || 'N/A',
        data: doc
      };
    }
    if (docTypeLower.includes('quotation')) {
      const doc = await Quotation.findById(documentId).lean();
      return {
        number: doc?.orderReference || doc?.quotationNumber || 'Quotation',
        status: doc?.status || 'N/A',
        data: doc
      };
    }
    if (docTypeLower.includes('supplierpo') || docTypeLower === 'supplier po') {
      const doc = await SupplierPO.findById(documentId).lean();
      return {
        number: doc?.poNumber || 'Supplier PO',
        status: doc?.status || 'N/A',
        data: doc
      };
    }
    return { number: `${documentType}-${documentId}`, status: 'N/A', data: null };
  } catch (err) {
    return { number: `${documentType}-${documentId}`, status: 'N/A', data: null };
  }
};

// 1. Request Edit Permission
const requestEditPermission = async (req, res) => {
  try {
    const { documentType, documentId, reason, requestType, requestedFields } = req.body;
    if (!documentType || !documentId || !reason) {
      return res.status(400).json({ success: false, message: 'Document type, document ID, and reason are required.' });
    }

    const details = await getDocumentDetails(documentType, documentId);
    const docNumber = details.number;
    const docStatus = details.status;

    // Check if there is already an active pending request from this user
    const existingPending = await EditPermissionRequest.findOne({
      documentType: { $regex: new RegExp(`^${documentType}$`, 'i') },
      documentId: String(documentId),
      requestedByUserId: req.user._id,
      status: 'Pending'
    });

    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: `An edit request for ${documentType} (${docNumber}) is already pending CEO approval.`
      });
    }

    const requestId = `REQ-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    // Prepare requested fields if Type A (SpecificField)
    let processedFields = [];
    if (requestType === 'SpecificField' && Array.isArray(requestedFields)) {
      processedFields = requestedFields.map(rf => ({
        fieldName: rf.fieldName || rf.field,
        label: rf.label || rf.fieldName || rf.field,
        currentValue: rf.currentValue !== undefined ? rf.currentValue : '',
        requestedValue: rf.requestedValue !== undefined ? rf.requestedValue : ''
      }));
    }

    const role = (req.user.role || '').toLowerCase();
    const userDept = req.user.department || (
      role.includes('sales') ? 'Sales' :
      role.includes('purchaser') ? 'Procurement' :
      role.includes('support') ? 'Support' :
      role.includes('account') ? 'Accounts' :
      role.includes('finance') ? 'Finance' : 'Operations'
    );

    const editRequest = await EditPermissionRequest.create({
      requestId,
      documentType,
      documentId: String(documentId),
      documentNumber: docNumber,
      currentDocumentStatus: docStatus,
      requestedByUserId: req.user._id,
      requestedByName: req.user.fullName || req.user.name || 'Staff User',
      requestedByRole: req.user.role || 'employee',
      requestedByDepartment: userDept,
      requestType: requestType === 'SpecificField' ? 'SpecificField' : 'General',
      requestedFields: processedFields,
      reason,
      status: 'Pending'
    });

    // Notify CEO
    await notifyRoleHelper(['ceo'], {
      type: 'system',
      title: 'CEO Edit Permission Requested',
      message: `${req.user.fullName || 'Staff User'} (${req.user.role}) requested edit permission for ${documentType} ${docNumber}. Reason: ${reason}`,
      sender: req.user._id,
      link: '/admin/edit-requests'
    });

    return res.status(201).json({
      success: true,
      message: 'Edit permission request submitted to CEO successfully.',
      data: editRequest
    });
  } catch (error) {
    console.error('[Request Edit Permission Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating edit permission request.' });
  }
};

// 2. Get Edit Permission Requests (CEO & Requester)
const getEditPermissionRequests = async (req, res) => {
  try {
    const { status, documentType, department, search } = req.query;
    const query = {};

    const userRole = (req.user.role || '').toLowerCase();
    const isCEOOrAdmin = ['ceo', 'admin'].includes(userRole);

    if (!isCEOOrAdmin) {
      query.requestedByUserId = req.user._id;
    }

    if (status && status !== 'All') {
      query.status = status;
    }

    if (documentType) {
      query.documentType = { $regex: new RegExp(documentType, 'i') };
    }

    if (department) {
      query.requestedByDepartment = { $regex: new RegExp(department, 'i') };
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { requestId: searchRegex },
        { documentNumber: searchRegex },
        { requestedByName: searchRegex },
        { reason: searchRegex }
      ];
    }

    // Auto-update expired requests
    await EditPermissionRequest.updateMany(
      {
        status: 'Approved',
        permissionUsed: false,
        expiresAt: { $ne: null, $lt: new Date() }
      },
      { status: 'Expired' }
    );

    const requests = await EditPermissionRequest.find(query)
      .populate('requestedByUserId', 'fullName email department role')
      .populate('approvedByUserId', 'fullName email')
      .populate('rejectedByUserId', 'fullName email')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('[Get Edit Requests Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving edit requests.' });
  }
};

// 3. Respond to Edit Request (CEO Action)
const respondToEditPermissionRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, responseNote, permissionScope, allowedFields, expiresInHours } = req.body;

    const userRole = (req.user.role || '').toLowerCase();
    if (!['ceo', 'admin'].includes(userRole)) {
      return res.status(403).json({ success: false, message: 'Only CEO or Administrator can review edit requests.' });
    }

    const editRequest = await EditPermissionRequest.findById(id);
    if (!editRequest) {
      return res.status(404).json({ success: false, message: 'Edit permission request not found.' });
    }

    if (editRequest.status !== 'Pending') {
      return res.status(400).json({ success: false, message: `Request has already been ${editRequest.status.toLowerCase()}.` });
    }

    if (status === 'Approved') {
      editRequest.status = 'Approved';
      editRequest.approvedByUserId = req.user._id;
      editRequest.approvedByName = req.user.fullName || req.user.name || 'CEO';
      editRequest.approvedAt = new Date();
      editRequest.ceoResponseNote = responseNote || '';
      editRequest.permissionScope = permissionScope ? (permissionScope === 'SpecificFields' ? 'SpecificFields' : 'FullDocument') : 'FullDocument';
      
      if (editRequest.permissionScope === 'SpecificFields') {
        if (Array.isArray(allowedFields) && allowedFields.length > 0) {
          editRequest.allowedFields = allowedFields;
        } else if (editRequest.requestType === 'SpecificField' && editRequest.requestedFields.length > 0) {
          editRequest.allowedFields = editRequest.requestedFields.map(f => f.fieldName);
        }
      }

      // Default validity 24 hours
      const hours = Number(expiresInHours) || 24;
      editRequest.expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

      // Notify requester
      await createNotificationHelper(
        editRequest.requestedByUserId,
        'CEO Edit Permission Approved',
        `CEO approved your edit request for ${editRequest.documentType} (${editRequest.documentNumber}). Valid for ${hours} hours.`,
        'success',
        '/edit-permissions'
      );
    } else if (status === 'Rejected') {
      editRequest.status = 'Rejected';
      editRequest.rejectedByUserId = req.user._id;
      editRequest.rejectedByName = req.user.fullName || req.user.name || 'CEO';
      editRequest.rejectedAt = new Date();
      editRequest.rejectionReason = responseNote || 'Request rejected by CEO.';
      editRequest.ceoResponseNote = responseNote || '';

      // Notify requester
      await createNotificationHelper(
        editRequest.requestedByUserId,
        'CEO Edit Permission Rejected',
        `CEO rejected your edit request for ${editRequest.documentType} (${editRequest.documentNumber}). Reason: ${editRequest.rejectionReason}`,
        'warning',
        '/edit-permissions'
      );
    } else {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be Approved or Rejected.' });
    }

    await editRequest.save();

    return res.status(200).json({
      success: true,
      message: `Edit request successfully ${status.toLowerCase()}.`,
      data: editRequest
    });
  } catch (error) {
    console.error('[Respond Edit Request Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error responding to edit request.' });
  }
};

// 4. Check Active Permission Status for a specific document & current user
const checkActiveEditPermission = async (req, res) => {
  try {
    const { documentType, documentId } = req.params;
    const userIdStr = req.user._id;

    // Direct check for CEO or Admin
    const userRole = (req.user.role || '').toLowerCase();
    if (['ceo', 'admin'].includes(userRole)) {
      return res.status(200).json({
        success: true,
        hasPermission: true,
        isCEOOrAdmin: true,
        permission: null
      });
    }

    // Auto-update expired
    await EditPermissionRequest.updateMany(
      {
        documentId: String(documentId),
        requestedByUserId: userIdStr,
        status: 'Approved',
        expiresAt: { $ne: null, $lt: new Date() }
      },
      { status: 'Expired' }
    );

    let activePermission = await EditPermissionRequest.findOne({
      documentType: { $regex: new RegExp(`^${documentType}$`, 'i') },
      documentId: String(documentId),
      requestedByUserId: userIdStr,
      status: 'Approved',
      permissionUsed: false
    }).sort({ approvedAt: -1 });

    if (!activePermission) {
      activePermission = await EditPermissionRequest.findOne({
        documentId: String(documentId),
        requestedByUserId: userIdStr,
        status: 'Approved',
        permissionUsed: false
      }).sort({ approvedAt: -1 });
    }

    const pendingRequest = await EditPermissionRequest.findOne({
      documentId: String(documentId),
      requestedByUserId: userIdStr,
      status: 'Pending'
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      hasPermission: !!activePermission,
      isCEOOrAdmin: false,
      permission: activePermission,
      request: pendingRequest || activePermission || null
    });
  } catch (error) {
    console.error('[Check Active Permission Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error checking edit permission.' });
  }
};

// 5. Get Document Preview for CEO Inspection
const getDocumentPreview = async (req, res) => {
  try {
    const { documentType, documentId } = req.params;
    const details = await getDocumentDetails(documentType, documentId);
    
    if (!details.data) {
      return res.status(404).json({ success: false, message: 'Target document payload not found.' });
    }

    return res.status(200).json({
      success: true,
      documentType,
      documentId,
      documentNumber: details.number,
      documentStatus: details.status,
      payload: details.data
    });
  } catch (error) {
    console.error('[Get Document Preview Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading document preview.' });
  }
};

// 6. Get Centralized Edit Audit Log History (CEO Edit History)
const getAllAuditLogs = async (req, res) => {
  try {
    const { user, role, department, documentType, documentNumber, dateFrom, dateTo } = req.query;
    const query = {};

    if (documentType) query.documentType = { $regex: new RegExp(documentType, 'i') };
    if (documentNumber) query.documentNumber = { $regex: new RegExp(documentNumber, 'i') };
    if (role) query.editedByRole = { $regex: new RegExp(role, 'i') };
    if (department) query.editedByDepartment = { $regex: new RegExp(department, 'i') };
    if (user) query.editedByName = { $regex: new RegExp(user, 'i') };

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const logs = await EditAuditLog.find(query)
      .populate('editedByUserId', 'fullName email role department')
      .populate('editPermissionRequestId')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    console.error('[Get All Audit Logs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving audit logs.' });
  }
};

module.exports = {
  requestEditPermission,
  getEditPermissionRequests,
  respondToEditPermissionRequest,
  checkActiveEditPermission,
  getDocumentPreview,
  getAllAuditLogs
};
