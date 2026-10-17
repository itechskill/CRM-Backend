const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const LocalPayable = require('../models/LocalPayable');
const FinancialCharge = require('../models/FinancialCharge');
const SalesOrder = require('../models/SalesOrder');
const ProductFile = require('../models/ProductFile');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Shipment = require('../models/Shipment');
const logAudit = require('../utils/auditLogger');
const { createNotificationHelper, notifyRoleHelper } = require('./notificationController');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findExistingLocalPayable = async ({ supplierPOId, poNumber, salesOrderId }) => {
  const duplicateChecks = [];
  if (supplierPOId) duplicateChecks.push({ supplierPO: supplierPOId });
  if (salesOrderId) duplicateChecks.push({ salesOrderId });
  if (poNumber) {
    duplicateChecks.push({
      poNumber: { $regex: `^${escapeRegex(poNumber.trim())}$`, $options: 'i' }
    });
  }
  if (duplicateChecks.length === 0) return null;
  return LocalPayable.findOne({ $or: duplicateChecks });
};

const ensureLocalPayableForSupplierPO = async ({ po, linkedOrder, user }) => {
  const salesOrderId = po.salesOrderId || linkedOrder?._id || null;
  const existingPayable = await findExistingLocalPayable({
    supplierPOId: po._id,
    poNumber: po.poNumber,
    salesOrderId
  });
  if (existingPayable) return { payable: existingPayable, created: false };

  let isBlocked = false;
  let blockReason = '';
  if (linkedOrder && (linkedOrder.advanceRequired || linkedOrder.advanceRequiredAmount > 0)) {
    const received = linkedOrder.advanceReceived ? (linkedOrder.netAmount || 1) : (linkedOrder.advanceReceivedAmount || 0);
    const required = linkedOrder.advanceRequiredAmount || 1;
    if (!linkedOrder.advanceReceived && received < required) {
      isBlocked = true;
      blockReason = `Required customer advance has not been received (Received: PKR ${received.toLocaleString()}).`;
    }
  }

  const payableNumber = `LP-${Date.now().toString().slice(-6)}`;
  const payable = await LocalPayable.create({
    payableNumber,
    supplier: po.supplier || null,
    supplierName: po.supplierName,
    supplierPO: po._id,
    poNumber: po.poNumber,
    salesOrderId,
    salesOrderNumber: po.salesOrderNumber || linkedOrder?.orderNumber || linkedOrder?.orderReference || '',
    paymentMethod: '',
    paymentTerms: po.paymentTerms || '',
    amount: Number(po.totalAmount) || 0,
    paymentDate: null,
    status: isBlocked ? 'Payment Blocked – Awaiting Customer Advance' : 'Pending',
    isBlockedByAdvance: isBlocked,
    remarks: isBlocked
      ? `[BLOCKED] ${blockReason} | Automatically created from Local Supplier PO ${po.poNumber}.`
      : `Automatically created from Local Supplier PO ${po.poNumber}.`,
    createdBy: user._id,
    createdByName: user.fullName
  });

  return { payable, created: true };
};

// ── SUPPLIER MANAGEMENT ────────────────────────────────────────────────────────
exports.getSuppliers = async (req, res) => {
  try {
    const { supplierType, type, search } = req.query;
    const filter = {};
    const targetType = supplierType || type;
    if (targetType) filter.supplierType = targetType;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } }
      ];
    }
    const suppliers = await Supplier.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: suppliers.length, data: suppliers, suppliers });
  } catch (error) {
    console.error('Get Suppliers Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching suppliers.' });
  }
};

exports.createSupplier = async (req, res) => {
  try {
    const { name, supplierType, country, contactPerson, email, phone, address, taxId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Supplier name is required.' });
    }
    const supplier = await Supplier.create({
      name: name.trim(),
      supplierType: supplierType === 'Global' ? 'Global' : 'Local',
      country: country || (supplierType === 'Global' ? 'International' : 'Pakistan'),
      contactPerson: contactPerson || '',
      email: email || '',
      phone: phone || '',
      address: address || '',
      taxId: taxId || '',
      createdBy: req.user._id
    });
    return res.status(201).json({ success: true, message: 'Supplier created successfully.', data: supplier, supplier });
  } catch (error) {
    console.error('Create Supplier Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating supplier.' });
  }
};

// ── SUPPLIER PURCHASE ORDERS ──────────────────────────────────────────────────
exports.getSupplierPOs = async (req, res) => {
  try {
    const { poType, subType, type, status, search } = req.query;
    const filter = {};
    const targetType = poType || subType || type;
    if (targetType) filter.poType = targetType;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }
    const pos = await SupplierPO.find(filter).populate('supplier').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: pos.length, data: pos, pos });
  } catch (error) {
    console.error('Get Supplier POs Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching purchase orders.' });
  }
};

exports.createSupplierPO = async (req, res) => {
  try {
    const { supplierId, supplierName, supplierCountry, supplierContact, poType, subType, items, notes, remarks, expectedDeliveryDate, salesOrderId } = req.body;

    const type = poType || subType || (req.user.purchaserSubDept === 'Global' ? 'Global' : 'Local');
    const prefix = type === 'Global' ? 'GPO' : 'LPO';
    const poNumber = req.body.poNumber || `${prefix}-${Date.now().toString().slice(-6)}`;

    // Resolve or auto-create supplier
    let supplier = null;
    const mongoose = require('mongoose');
    if (supplierId && supplierId !== 'NEW' && mongoose.Types.ObjectId.isValid(supplierId)) {
      supplier = await Supplier.findById(supplierId);
    }
    const resolvedName = (supplierName || req.body.supplier || (supplier ? supplier.name : '')).trim();
    if (!supplier && resolvedName) {
      supplier = await Supplier.findOne({ name: new RegExp('^' + resolvedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
      if (!supplier) {
        supplier = await Supplier.create({
          name: resolvedName,
          contactPerson: supplierContact || req.body.supplierPhone || '',
          phone: req.body.supplierPhone || '',
          email: req.body.supplierEmail || '',
          country: supplierCountry || (type === 'Global' ? 'China' : 'Pakistan'),
          supplierType: type === 'Global' ? 'Global' : 'Local'
        });
      }
    }
    if (!supplier && !resolvedName) {
      return res.status(400).json({ success: false, message: 'Supplier name or selection is required.' });
    }
    const finalSupplierName = supplier ? supplier.name : resolvedName;
    const finalSupplierCountry = supplier?.country || supplierCountry || (type === 'Global' ? 'China' : 'Pakistan');

    let totalAmount = 0;
    const formattedItems = (items || []).map(item => {
      const qty = Number(item.quantity || item.requiredQty || item.quantityOrdered) || 1;
      const price = Number(item.unitPrice || item.unitPricePKR) || 0;
      const itemTotal = Number(item.totalPricePKR || item.total) || (qty * price);
      totalAmount += itemTotal;
      return {
        productName: item.productName || item.description || 'Product Item',
        description: item.description || '',
        quantity: qty,
        unitPrice: price,
        totalAmount: itemTotal
      };
    });

    if (totalAmount === 0 && (req.body.totalAmountPKR || req.body.totalAmount)) {
      totalAmount = Number(req.body.totalAmountPKR || req.body.totalAmount);
    }

    // Check if linked SalesOrder has shortage and customer advance status
    let initialStatus = 'Issued';
    let linkedOrder = null;
    if (salesOrderId) {
      linkedOrder = await SalesOrder.findById(salesOrderId);
      if (linkedOrder && (linkedOrder.advanceRequired || linkedOrder.advanceRequiredAmount > 0)) {
        const rec = linkedOrder.advanceReceived ? (linkedOrder.netAmount || 1) : (linkedOrder.advanceReceivedAmount || 0);
        const reqAdv = linkedOrder.advanceRequiredAmount || 1;
        if (!linkedOrder.advanceReceived && rec < reqAdv) {
          initialStatus = 'Payment Blocked – Customer Advance Required';
        }
      }
    }

    const po = await SupplierPO.create({
      poNumber,
      supplier: supplier ? supplier._id : null,
      supplierName: finalSupplierName,
      supplierCountry: finalSupplierCountry,
      supplierContact: supplier?.contactPerson || supplierContact || '',
      supplierEmail: supplier?.email || req.body.supplierEmail || '',
      supplierPhone: supplier?.phone || req.body.supplierPhone || '',
      salesOrderId: linkedOrder ? linkedOrder._id : null,
      salesOrderNumber: linkedOrder ? (linkedOrder.orderNumber || linkedOrder.orderReference) : '',
      poType: type,
      items: formattedItems,
      totalAmount,
      currency: 'PKR',
      status: initialStatus,
      notes: notes || remarks || '',
      expectedDeliveryDate: expectedDeliveryDate || null,
      portOfLoading: req.body.portOfLoading || '',
      portOfDischarge: req.body.portOfDischarge || 'Karachi Port',
      paymentTerms: req.body.paymentTerms || '',
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });

    if (type === 'Local') {
      await ensureLocalPayableForSupplierPO({ po, linkedOrder, user: req.user });
    }

    if (linkedOrder) {
      linkedOrder.supplierPO = {
        poNumber,
        poType: type === 'Global' ? 'International' : 'Local',
        supplierName: finalSupplierName,
        supplierCountry: finalSupplierCountry,
        supplierEmail: supplier?.email || '',
        supplierPhone: supplier?.phone || '',
        issueDate: new Date(),
        status: initialStatus,
        items: formattedItems,
        totalAmount,
        currency: 'PKR',
        notes: notes || remarks || '',
        issuedBy: req.user._id,
        issuedByName: req.user.fullName,
        issuedAt: new Date()
      };
      linkedOrder.supplierPoId = po._id;
      linkedOrder.supplierPoNumber = poNumber;
      if (type === 'Global') {
        linkedOrder.workflowStatus = 'International Supplier PO Issued';
      } else {
        linkedOrder.workflowStatus = 'Local Supplier PO Issued';
      }
      linkedOrder.lastAction = `Supplier PO ${poNumber} created for ${finalSupplierName}`;
      linkedOrder.lastActionBy = req.user._id;
      linkedOrder.lastActionByName = req.user.fullName;
      linkedOrder.lastActionAt = new Date();
      await linkedOrder.save();
    }

    // Log creation audit
    try {
      const EditAuditLog = require('../models/EditAuditLog');
      await EditAuditLog.create({
        documentType: 'SupplierPO',
        documentId: String(po._id),
        documentNumber: poNumber,
        editedByUserId: req.user._id,
        editedByName: req.user.fullName || 'Purchaser',
        editedByRole: req.user.role || 'purchaser',
        editedByDepartment: req.user.department || (type === 'Global' ? 'Global Purchaser' : 'Local Purchaser'),
        permissionType: 'DIRECT_EDIT',
        changes: [{ field: 'status', oldValue: null, newValue: initialStatus }],
        reason: `Supplier PO ${poNumber} issued by ${type} Purchaser.`
      });
    } catch (auditErr) {
      console.warn('EditAuditLog creation notice:', auditErr.message);
    }

    return res.status(201).json({ success: true, message: `Purchase Order ${poNumber} issued successfully to ${finalSupplierName}.`, data: po, po });
  } catch (error) {
    console.error('Create Supplier PO Error:', error);
    return res.status(500).json({ success: false, message: 'Server error issuing purchase order.' });
  }
};

// ── DIRECT EDIT SUPPLIER PO (Category A - Purchaser Direct Edit) ───────────────
exports.updateSupplierPO = async (req, res) => {
  try {
    const { id } = req.params;
    const { supplierName, items, notes, expectedDeliveryDate, status, remarks } = req.body;

    const po = await SupplierPO.findById(id);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Supplier Purchase Order not found.' });
    }

    // Check if GRNs already exist for this PO
    const existingGRNs = await PurchaserGRN.find({ supplierPO: po._id });
    if (existingGRNs.length > 0) {
      // Calculate received quantities per product
      const receivedTotals = {};
      existingGRNs.forEach(grn => {
        (grn.items || []).forEach(it => {
          const name = (it.productName || '').trim().toLowerCase();
          receivedTotals[name] = (receivedTotals[name] || 0) + (Number(it.receivedQty) || 0);
        });
      });

      // Verify new items don't lower quantity below received total or alter product names
      if (items && items.length > 0) {
        for (const newItem of items) {
          const name = (newItem.productName || newItem.description || '').trim().toLowerCase();
          const newQty = Number(newItem.quantity) || 0;
          const recQty = receivedTotals[name] || 0;
          if (newQty < recQty) {
            return res.status(400).json({
              success: false,
              message: `Cannot reduce quantity for "${newItem.productName}" to ${newQty}. A total of ${recQty} has already been received in GRNs.`
            });
          }
        }
      }
    }

    const changes = [];
    if (supplierName && supplierName !== po.supplierName) {
      changes.push({ field: 'supplierName', oldValue: po.supplierName, newValue: supplierName });
      po.supplierName = supplierName;
    }
    if (expectedDeliveryDate) {
      changes.push({ field: 'expectedDeliveryDate', oldValue: po.expectedDeliveryDate, newValue: expectedDeliveryDate });
      po.expectedDeliveryDate = expectedDeliveryDate;
    }
    if (notes !== undefined) {
      changes.push({ field: 'notes', oldValue: po.notes, newValue: notes });
      po.notes = notes;
    }

    if (items && items.length > 0) {
      let totalAmount = 0;
      const formattedItems = items.map(item => {
        const qty = Number(item.quantity) || 1;
        const price = Number(item.unitPrice || item.unitPricePKR) || 0;
        const itemTotal = qty * price;
        totalAmount += itemTotal;
        return {
          productName: item.productName || item.description || 'Product Item',
          description: item.description || '',
          quantity: qty,
          unitPrice: price,
          totalAmount: itemTotal
        };
      });
      changes.push({ field: 'items', oldValue: po.items.length, newValue: formattedItems.length });
      changes.push({ field: 'totalAmount', oldValue: po.totalAmount, newValue: totalAmount });
      po.items = formattedItems;
      po.totalAmount = totalAmount;
    }

    await po.save();

    // Log edit audit
    try {
      const { logCategoryAEdit } = require('../utils/editPermissionHelper');
      await logCategoryAEdit({
        documentType: 'Supplier PO',
        documentId: po._id,
        documentNumber: po.poNumber,
        changedBy: req.user,
        changes,
        reason: remarks || 'Direct Supplier PO edit by Purchaser.'
      });
    } catch (auditErr) {
      console.warn('EditAuditLog creation notice for Supplier PO:', auditErr.message);
    }

    return res.status(200).json({ success: true, message: `Supplier PO ${po.poNumber} updated successfully.`, data: po });
  } catch (error) {
    console.error('Update Supplier PO Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating purchase order.' });
  }
};

exports.deleteSupplierPO = async (req, res) => {
  try {
    const { id } = req.params;
    const po = await SupplierPO.findById(id);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Supplier Purchase Order not found.' });
    }
    
    // Check if GRNs exist for this PO
    const existingGRNs = await PurchaserGRN.find({ supplierPO: po._id });
    if (existingGRNs.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete PO #${po.poNumber} because ${existingGRNs.length} GRN(s) have already been generated for it.`
      });
    }

    await SupplierPO.findByIdAndDelete(id);

    return res.status(200).json({ success: true, message: `Supplier PO #${po.poNumber} deleted successfully.` });
  } catch (error) {
    console.error('Delete Supplier PO Error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting purchase order.' });
  }
};

// ── GOODS RECEIVED NOTES (GRN) - STRICT PO PRODUCT & QTY MATCHING ─────────────
exports.getPurchaserGRNs = async (req, res) => {
  try {
    const { grnType, search } = req.query;
    const filter = {};
    if (grnType) filter.grnType = grnType;
    if (search) {
      filter.$or = [
        { grnNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } }
      ];
    }
    const grns = await PurchaserGRN.find(filter).populate('supplierPO supplier salesOrder').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: grns.length, data: grns, grns });
  } catch (error) {
    console.error('Get GRNs Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching Goods Received Notes.' });
  }
};

exports.createPurchaserGRN = async (req, res) => {
  try {
    const { supplierPoId, supplierPOId, supplierPONumber, poNumber: inputPoNumber, items, remarks } = req.body;
    let targetPoId = supplierPoId || supplierPOId;
    let po = null;
    const mongoose = require('mongoose');
    if (targetPoId && mongoose.Types.ObjectId.isValid(targetPoId)) {
      po = await SupplierPO.findById(targetPoId);
    }
    const targetPoNum = (supplierPONumber || inputPoNumber || '').trim();
    if (!po && targetPoNum) {
      po = await SupplierPO.findOne({ poNumber: targetPoNum });
    }
    if (!po && req.body.supplierName) {
      po = await SupplierPO.findOne({ supplierName: new RegExp('^' + req.body.supplierName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).sort({ createdAt: -1 });
    }
    if (!po) {
      return res.status(400).json({ success: false, message: 'Supplier Purchase Order reference is required.' });
    }

    // Fetch all previous GRNs for this PO to calculate previously received quantities
    const previousGRNs = await PurchaserGRN.find({ supplierPO: po._id });
    const previouslyReceivedMap = {};
    previousGRNs.forEach(grn => {
      (grn.items || []).forEach(it => {
        const key = (it.productName || '').trim().toLowerCase();
        previouslyReceivedMap[key] = (previouslyReceivedMap[key] || 0) + (Number(it.receivedQty) || 0);
      });
    });

    const grnNumber = `GRN-${po.poNumber}-${Date.now().toString().slice(-4)}`;
    const formattedItems = [];

    const inputItems = (items && items.length > 0) ? items : po.items;

    for (const item of inputItems) {
      const inputName = (item.productName || item.description || '').trim();
      const inputKey = inputName.toLowerCase();

      // Find matching item in Supplier PO
      const poItem = po.items.find(p => (p.productName || '').trim().toLowerCase() === inputKey);
      if (!poItem) {
        return res.status(400).json({
          success: false,
          message: `Product "${inputName}" does not exist in Supplier PO #${po.poNumber}. Unrelated product substitution is strictly prohibited.`
        });
      }

      const poOrderedQty = Number(poItem.quantity) || 0;
      const prevRec = previouslyReceivedMap[inputKey] || 0;
      const maxReceivable = Math.max(0, poOrderedQty - prevRec);

      const requestedRecQty = Number(item.receivedQty !== undefined ? item.receivedQty : poItem.quantity) || 0;

      if (requestedRecQty > maxReceivable) {
        return res.status(400).json({
          success: false,
          message: `Cannot receive ${requestedRecQty} units for "${inputName}". Maximum remaining receivable quantity is ${maxReceivable} (PO Total: ${poOrderedQty}, Previously Received: ${prevRec}).`
        });
      }

      const newRemaining = Math.max(0, maxReceivable - requestedRecQty);

      formattedItems.push({
        productName: poItem.productName,
        orderedQty: poOrderedQty,
        receivedQty: requestedRecQty,
        remainingQty: newRemaining
      });
    }

    const isComplete = formattedItems.every(i => i.remainingQty === 0);
    const grn = await PurchaserGRN.create({
      grnNumber,
      grnType: 'Supplier',
      supplier: po.supplier,
      supplierName: po.supplierName,
      supplierPO: po._id,
      supplierPOId: po._id,
      poNumber: po.poNumber,
      salesOrder: po.salesOrderId || null,
      salesOrderId: po.salesOrderId || null,
      salesOrderNumber: po.salesOrderNumber || '',
      items: formattedItems,
      status: isComplete ? 'Completed' : 'Partial',
      remarks: remarks || '',
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });

    // Update Supplier PO status
    po.status = isComplete ? 'Fully Received' : 'Partially Received';
    await po.save();

    if (po.salesOrderId) {
      const linkedSo = await SalesOrder.findById(po.salesOrderId);
      if (linkedSo) {
        linkedSo.currentDepartment = 'Support';
        linkedSo.departmentResponsible = 'Support';
        linkedSo.workflowStatus = 'Goods Received in Office';
        linkedSo.status = 'Goods Received in Office';
        const totalReceivedQty = formattedItems.reduce((s, i) => s + (Number(i.receivedQty) || 0), 0);
        linkedSo.goodsReceivedInOffice = {
          received: true,
          receivedQuantity: totalReceivedQty,
          receivingDate: new Date(),
          remarks: `GRN ${grnNumber} generated by Local Purchaser (${isComplete ? 'Fully Received' : 'Partially Received'}). Ready for DN.`
        };
        linkedSo.lastAction = `GRN ${grnNumber} generated — moved to Support for Delivery Note creation`;
        linkedSo.lastActionBy = req.user._id;
        linkedSo.lastActionByName = req.user.fullName;
        linkedSo.lastActionAt = new Date();
        if (!linkedSo.workflowHistory) linkedSo.workflowHistory = [];
        linkedSo.workflowHistory.push({
          action: 'Goods Received in Office (GRN Created)',
          department: 'Support',
          notes: `GRN ${grnNumber} issued by Local Purchaser. Order moved to Support for Delivery Note (DN) creation.`,
          timestamp: new Date()
        });
        await linkedSo.save();
      }
    }

    return res.status(201).json({ success: true, message: `GRN ${grnNumber} generated successfully.`, data: grn });
  } catch (error) {
    console.error('Create GRN Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating GRN.' });
  }
};

// ── LOCAL PAYABLES & SUPPLIER PAYMENT ENFORCEMENT ──────────────────────────────
exports.getLocalPayables = async (req, res) => {
  try {
    const { paymentMethod, status, search } = req.query;
    const filter = {};
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { payableNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } },
        { chequeNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
        { salesOrderNumber: { $regex: search, $options: 'i' } }
      ];
    }
    const payables = await LocalPayable.find(filter).populate('supplier supplierPO grn').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: payables.length, data: payables, payables });
  } catch (error) {
    console.error('Get Local Payables Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching payables.' });
  }
};

exports.createLocalPayable = async (req, res) => {
  try {
    const { supplierId, supplierName, supplierPoId, supplierPONumber, grnId, paymentMethod, amount, amountPKR, paymentDate, chequeNumber, bankName, chequeDate, pdcDate, remarks, salesOrderId } = req.body;
    const finalAmount = Number(amount !== undefined && amount !== '' ? amount : amountPKR) || 0;
    if (!paymentMethod || finalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment method and valid amount are required.' });
    }

    const mongoose = require('mongoose');
    let supplier = null;
    if (supplierId && supplierId !== 'NEW' && mongoose.Types.ObjectId.isValid(supplierId)) {
      supplier = await Supplier.findById(supplierId);
    }
    const resolvedName = (supplierName || req.body.supplier || (supplier ? supplier.name : '')).trim();
    if (!supplier && resolvedName) {
      supplier = await Supplier.findOne({ name: new RegExp('^' + resolvedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
      if (!supplier) {
        supplier = await Supplier.create({
          name: resolvedName,
          contactPerson: req.body.supplierContact || '',
          phone: req.body.supplierPhone || '',
          supplierType: 'Local'
        });
      }
    }
    const finalSupplierName = supplier ? supplier.name : (resolvedName || 'Local Supplier');
    const finalSupplierId = supplier ? supplier._id : null;

    let poNumber = '';
    let targetPoId = supplierPoId;
    let targetPo = null;
    let linkedOrder = null;
    if (targetPoId && mongoose.Types.ObjectId.isValid(targetPoId)) {
      targetPo = await SupplierPO.findById(targetPoId);
      if (targetPo) poNumber = targetPo.poNumber;
    }
    if (!poNumber && supplierPONumber) {
      targetPo = await SupplierPO.findOne({ poNumber: supplierPONumber.trim() });
      if (targetPo) {
        poNumber = targetPo.poNumber;
        targetPoId = targetPo._id;
      }
    }
    if (salesOrderId) {
      linkedOrder = await SalesOrder.findById(salesOrderId);
    } else if (targetPo?.salesOrderId) {
      linkedOrder = await SalesOrder.findById(targetPo.salesOrderId);
    }

    const existingPayable = await findExistingLocalPayable({
      supplierPOId: targetPoId,
      poNumber: poNumber || supplierPONumber,
      salesOrderId: linkedOrder?._id || salesOrderId
    });
    if (existingPayable) {
      return res.status(409).json({
        success: false,
        message: `A Local Payable already exists for ${existingPayable.salesOrderNumber ? `Sales Order ${existingPayable.salesOrderNumber}` : `Supplier PO ${existingPayable.poNumber || supplierPONumber}`}.`,
        data: existingPayable
      });
    }

    // SERVER-SIDE FINANCIAL CONTROL: Customer Advance Check
    let isBlocked = false;
    let blockReason = '';
    if (linkedOrder && (linkedOrder.advanceRequired || linkedOrder.advanceRequiredAmount > 0)) {
      const rec = linkedOrder.advanceReceived ? (linkedOrder.netAmount || 1) : (linkedOrder.advanceReceivedAmount || 0);
      const reqAdv = linkedOrder.advanceRequiredAmount || 1;
      if (!linkedOrder.advanceReceived && rec < reqAdv) {
        isBlocked = true;
        blockReason = `Required customer advance has not been received (Received: PKR ${rec.toLocaleString()}).`;
      }
    }

    if (isBlocked && (paymentMethod === 'Cash' || paymentMethod === 'Cheque')) {
      return res.status(400).json({
        success: false,
        message: `Supplier payment cannot be processed. ${blockReason}`
      });
    }

    const payableNumber = `LP-${Date.now().toString().slice(-6)}`;
    const payable = await LocalPayable.create({
      payableNumber,
      supplier: finalSupplierId,
      supplierName: finalSupplierName,
      supplierPO: targetPoId || null,
      poNumber,
      salesOrderId: linkedOrder ? linkedOrder._id : (salesOrderId || null),
      salesOrderNumber: linkedOrder ? (linkedOrder.orderNumber || linkedOrder.orderReference) : '',
      grn: grnId || null,
      paymentMethod,
      paymentTerms: req.body.paymentTerms || targetPo?.paymentTerms || '',
      amount: finalAmount,
      paymentDate: paymentDate || Date.now(),
      chequeNumber: chequeNumber || '',
      bankName: bankName || '',
      chequeDate: chequeDate || null,
      pdcDate: pdcDate || null,
      status: isBlocked ? 'Payment Blocked – Awaiting Customer Advance' : (paymentMethod === 'PDC' ? 'Pending' : 'Paid'),
      isBlockedByAdvance: isBlocked,
      remarks: isBlocked ? `[BLOCKED] ${blockReason} | ${remarks || ''}` : (remarks || ''),
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });

    if (linkedOrder) {
      linkedOrder.currentDepartment = 'Support';
      linkedOrder.departmentResponsible = 'Support';
      if (!['Delivery Note Created', 'Delivery Note Delivered', 'Invoice Draft Created', 'Invoice Finalized'].includes(linkedOrder.workflowStatus)) {
        linkedOrder.workflowStatus = 'Goods Received in Office';
        linkedOrder.status = 'Goods Received in Office';
      }
      linkedOrder.lastAction = `Local Payable ${payableNumber} created — Order is in Support for Delivery Note creation`;
      linkedOrder.lastActionBy = req.user._id;
      linkedOrder.lastActionByName = req.user.fullName;
      linkedOrder.lastActionAt = new Date();
      if (!linkedOrder.workflowHistory) linkedOrder.workflowHistory = [];
      linkedOrder.workflowHistory.push({
        action: 'Local Payable Recorded',
        department: 'Support',
        notes: `Local Payable ${payableNumber} created (${paymentMethod}). Ready for Delivery Note generation.`,
        timestamp: new Date()
      });
      await linkedOrder.save();
    }

    return res.status(201).json({
      success: true,
      message: isBlocked
        ? `Local Payable ${payableNumber} created in BLOCKED status. Customer advance required before releasing payment.`
        : `Local Payable record ${payableNumber} created via ${paymentMethod}.`,
      data: payable
    });
  } catch (error) {
    console.error('Create Local Payable Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating local payable.' });
  }
};

// ── FINANCIAL CHARGES & AUTOMATIC 3% LATE CHARGE FOR OVERDUE INVOICES ─────────────
const syncOverdueInvoiceCharges = async (systemUserId) => {
  try {
    const overdueInvoices = await Invoice.find({
      dueDate: { $lt: new Date() },
      status: { $nin: ['Paid', 'Cancelled'] }
    });

    for (const inv of overdueInvoices) {
      const invNumber = inv.invoiceNumber || `INV-${inv._id}`;
      const existingCharge = await FinancialCharge.findOne({
        relatedDocumentType: 'Invoice',
        relatedDocumentNumber: invNumber,
        chargeType: 'Overdue Financial Charge'
      });

      const invAmount = Number(inv.amount || inv.subtotal || 0);
      if (invAmount > 0 && !existingCharge) {
        const lateAmount = Number((invAmount * 0.03).toFixed(2));
        const chargeNumber = `FC-OVD-${invNumber.replace(/[^a-zA-Z0-9]/g, '')}`;

        await FinancialCharge.create({
          chargeNumber,
          chargeType: 'Overdue Financial Charge',
          description: `Automatic 3% Late Financial Charge applied to Overdue Invoice ${invNumber} (Original Amount: PKR ${invAmount.toLocaleString()})`,
          amount: lateAmount,
          currency: 'PKR',
          date: new Date(),
          relatedDocumentType: 'Invoice',
          relatedDocumentNumber: invNumber,
          status: 'Recorded',
          createdBy: systemUserId || inv.createdBy || inv._id,
          createdByName: 'Automatic System Rule'
        });

        inv.lateChargeAmount = lateAmount;
        inv.lateChargePercentage = 3;
        inv.lateChargeApplied = true;
        if (inv.status !== 'Paid') {
          inv.status = 'Overdue';
        }
        await inv.save();
      }
    }
  } catch (err) {
    console.error('[syncOverdueInvoiceCharges Error]:', err);
  }
};

exports.getFinancialCharges = async (req, res) => {
  try {
    // Sync 3% overdue invoice charges automatically
    await syncOverdueInvoiceCharges(req.user?._id);

    const { chargeType, status, search } = req.query;
    const filter = {};
    if (chargeType) filter.chargeType = chargeType;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { chargeNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { relatedDocumentNumber: { $regex: search, $options: 'i' } }
      ];
    }
    const charges = await FinancialCharge.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: charges.length, data: charges });
  } catch (error) {
    console.error('Get Financial Charges Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching financial charges.' });
  }
};

exports.createFinancialCharge = async (req, res) => {
  try {
    const { chargeType, description, amount, date, relatedDocumentType, relatedDocumentNumber } = req.body;
    if (!chargeType || !description || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Charge type, description, and positive amount are required.' });
    }

    const chargeNumber = `FC-${Date.now().toString().slice(-6)}`;
    const charge = await FinancialCharge.create({
      chargeNumber,
      chargeType,
      description: description.trim(),
      amount: Number(amount),
      currency: 'PKR',
      date: date || Date.now(),
      relatedDocumentType: relatedDocumentType || 'General',
      relatedDocumentNumber: relatedDocumentNumber || '',
      status: 'Recorded',
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });

    return res.status(201).json({ success: true, message: `Financial charge ${chargeNumber} of PKR ${Number(amount).toLocaleString()} recorded.`, data: charge });
  } catch (error) {
    console.error('Create Financial Charge Error:', error);
    return res.status(500).json({ success: false, message: 'Server error recording financial charge.' });
  }
};

// ── DASHBOARD AGGREGATE STATS FOR LOCAL & GLOBAL PURCHASER ─────────────────────
exports.getPurchaserDashboardStats = async (req, res) => {
  try {
    const subDept = req.query.subDept || req.query.type || req.user.purchaserSubDept || 'Local';

    const [pos, grns, payables, products, pendingOrders] = await Promise.all([
      SupplierPO.find({ poType: subDept }),
      PurchaserGRN.find({ grnType: 'Supplier' }),
      LocalPayable.find(),
      ProductFile.find(),
      SalesOrder.countDocuments({
        $or: [
          { departmentResponsible: subDept === 'Global' ? 'Global Purchaser' : 'Local Purchaser' },
          { currentDepartment: subDept === 'Global' ? 'Global Purchaser' : 'Local Purchaser' },
          { workflowStatus: subDept === 'Global' ? 'Pending Global Procurement' : 'Pending Local Procurement' },
          { fileType: subDept === 'Global' ? 'Blue' : 'Green', financeApprovedBy: { $ne: null }, workflowStatus: { $nin: ['Pending Delivery Note', 'Draft Invoice Created', 'Invoice Finalized', 'Completed'] } }
        ]
      })
    ]);

    const totalPOs = pos.length;
    const pendingPOs = pos.filter(p => p.status === 'Issued' || p.status === 'Partially Received').length;
    const totalGRNs = grns.length;
    const pendingGRNs = grns.filter(g => g.status === 'Partial').length;
    const totalPayablesAmount = payables.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalValuePKR = pos.reduce((sum, p) => sum + (Number(p.totalAmountPKR || p.totalAmount) || 0), 0);

    const statsObj = {
      subDept,
      totalPOs,
      pendingPOs,
      totalGRNs,
      pendingGRNs,
      totalPayablesAmount,
      totalProducts: products.length,
      totalSuppliers: await Supplier.countDocuments(subDept === 'Global' ? { type: 'Global' } : {}),
      totalValuePKR,
      pendingOrdersCount: pendingOrders,
      recentPOs: pos.slice(-5).reverse()
    };

    return res.status(200).json({
      success: true,
      data: statsObj,
      stats: statsObj
    });
  } catch (error) {
    console.error('Purchaser Dashboard Stats Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching purchaser dashboard statistics.' });
  }
};

// ── MASTER WORKFLOW: PENDING PURCHASER ORDERS ─────────────────────────────────
exports.getPendingPurchaserOrders = async (req, res) => {
  try {
    const subDept = req.query.subDept || req.query.type || req.user.purchaserSubDept || 'Local';
    const deptRole = subDept === 'Global' ? 'Global Purchaser' : 'Local Purchaser';
    const statusQuery = subDept === 'Global'
      ? ['Pending Global Procurement']
      : ['Pending Local Procurement', 'Local Supplier PO Issued'];
    const approvedFileFallback = subDept === 'Global'
      ? {
          fileType: 'Blue',
          financeApprovedBy: { $ne: null },
          currentDepartment: { $nin: ['Logistics', 'Support', 'Accounts', 'Completed'] },
          workflowStatus: { $nin: ['In Logistics', 'Pending Delivery Note', 'Draft Invoice Created', 'Invoice Finalized', 'Completed'] }
        }
      : {
          fileType: 'Green',
          financeApprovedBy: { $ne: null },
          workflowStatus: { $nin: ['Pending Delivery Note', 'Draft Invoice Created', 'Invoice Finalized', 'Completed'] }
        };

    const orders = await SalesOrder.find({
      $or: [
        { departmentResponsible: deptRole },
        { currentDepartment: deptRole },
        { workflowStatus: { $in: statusQuery } },
        { status: { $in: statusQuery } },
        approvedFileFallback
      ]
    }).populate('salesPerson', 'fullName email').sort({ updatedAt: -1 });

    return res.status(200).json({ success: true, count: orders.length, orders: orders, data: orders });
  } catch (error) {
    console.error('Get Pending Purchaser Orders Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching pending purchaser orders.' });
  }
};

exports.performInventoryCheck = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await SalesOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    const InventoryItem = require('../models/InventoryItem');
    const [products, inventoryItems] = await Promise.all([
      ProductFile.find().lean(),
      InventoryItem.find().lean()
    ]);
    let totalOrdered = 0;
    let totalAvailable = 0;
    let totalStockValue = 0;
    let shortageFound = false;

    const itemAnalysis = (order.items || []).map(item => {
      const targetName = (item.description || item.productName || '').trim().toLowerCase();
      const targetCode = (item.productCode || item.sku || '').trim().toLowerCase();

      // Check InventoryItem first
      const invMatch = inventoryItems.find(inv =>
        (inv.name || '').trim().toLowerCase() === targetName ||
        (inv.sku && inv.sku.trim().toLowerCase() === targetCode)
      );

      // Check ProductFile next
      const prodMatch = products.find(p =>
        (p.productName || p.name || '').trim().toLowerCase() === targetName ||
        (p.productCode || p.sku || '').trim().toLowerCase() === targetCode
      );

      const reqQty = Number(item.quantity) || 1;
      let availQty = 0;
      if (invMatch) {
        availQty = Math.max(0, (Number(invMatch.quantityOnHand) || 0) - (Number(invMatch.reservedQuantity) || 0));
      } else if (prodMatch) {
        availQty = Number(prodMatch.quantity) || Number(prodMatch.availableStock) || 0;
      }

      const unitPrice = Number(item.unitPrice) || Number(invMatch?.unitPrice) || Number(prodMatch?.unitPrice) || 0;
      const itemTotalPrice = Number(item.total) || (reqQty * unitPrice);
      const itemStatus = availQty >= reqQty ? 'In Stock' : 'Shortage';
      if (itemStatus === 'Shortage') shortageFound = true;

      totalOrdered += reqQty;
      totalAvailable += Math.min(availQty, reqQty);
      totalStockValue += Math.min(availQty, reqQty) * unitPrice;

      return {
        productId: invMatch?._id || prodMatch?._id || '',
        productName: item.description || item.productName || 'Product Item',
        requiredQuantity: reqQty,
        availableQuantity: availQty,
        shortageQuantity: Math.max(0, reqQty - availQty),
        unitPrice,
        totalPrice: itemTotalPrice,
        status: itemStatus
      };
    });

    order.inventoryCheckStatus = shortageFound ? 'Shortage' : 'In Stock';
    order.inventoryAnalysis = itemAnalysis.map(it => ({
      productId: String(it.productId || ''),
      productName: it.productName,
      orderedQty: it.requiredQuantity,
      availableQty: it.availableQuantity,
      shortageQty: it.shortageQuantity,
      status: it.status
    }));
    order.lastAction = `Inventory Check Completed — ${shortageFound ? 'Shortage Detected' : 'All Goods Present in Stock'}`;
    order.lastActionBy = req.user._id;
    order.lastActionByName = req.user.fullName;
    order.lastActionAt = new Date();

    await order.save();

    return res.status(200).json({
      success: true,
      message: shortageFound
        ? 'Inventory check completed. Stock shortage detected — Local Supplier PO required.'
        : 'Inventory check completed. All goods are present and available in warehouse inventory!',
      data: {
        order,
        itemAnalysis,
        status: shortageFound ? 'Shortage' : 'In Stock',
        totalOrdered,
        totalAvailable,
        totalStockValue,
        orderTotalAmount: Number(order.netAmount || order.totalAmount || 0)
      }
    });
  } catch (error) {
    console.error('Perform Inventory Check Error:', error);
    return res.status(500).json({ success: false, message: 'Server error performing inventory check.' });
  }
};

exports.completeProcurementAndSendToSupport = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await SalesOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    const { supplierName, poNumber, paymentTerms, remarks, items, totalAmountPKR } = req.body;
    const finalSupplierName = (supplierName || '').trim();
    const finalPoNumber = (poNumber || '').trim();
    if (!finalSupplierName || !finalPoNumber) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name and Local PO number are required before completing procurement.'
      });
    }

    const existingPO = await SupplierPO.findOne({ poNumber: finalPoNumber });
    if (existingPO) {
      return res.status(400).json({
        success: false,
        message: `Supplier PO #${finalPoNumber} already exists.`
      });
    }

    let calculatedTotal = 0;
    const poItems = ((Array.isArray(items) && items.length > 0) ? items : (order.items || [])).map(item => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPricePKR ?? item.unitPrice) || 0;
      const totalAmount = Number(item.totalPricePKR ?? item.total) || (quantity * unitPrice);
      calculatedTotal += totalAmount;
      return {
        productName: item.productName || item.description || 'Product Item',
        description: item.description || '',
        quantity,
        unitPrice,
        totalAmount
      };
    });
    const poTotal = Number(totalAmountPKR ?? req.body.totalAmount) || calculatedTotal || Number(order.netAmount || order.totalAmount) || 0;
    const issuedAt = new Date();

    const supplierPO = await SupplierPO.create({
      poNumber: finalPoNumber,
      supplierName: finalSupplierName,
      supplierCountry: 'Pakistan',
      poType: 'Local',
      poDate: issuedAt,
      paymentTerms: paymentTerms || '',
      items: poItems,
      totalAmount: poTotal,
      salesOrderId: order._id,
      salesOrderNumber: order.orderNumber || order.orderReference || '',
      currency: 'PKR',
      status: 'Issued',
      notes: remarks || '',
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });

    order.supplierPO = {
      poNumber: finalPoNumber,
      poType: 'Local',
      supplierName: finalSupplierName,
      supplierCountry: 'Pakistan',
      issueDate: issuedAt,
      status: 'Issued',
      items: poItems.map(item => ({
        description: item.description || item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.totalAmount
      })),
      totalAmount: poTotal,
      currency: 'PKR',
      notes: remarks || '',
      issuedBy: req.user._id,
      issuedByName: req.user.fullName,
      issuedAt
    };

    const totalQty = (order.items || []).reduce((s, i) => s + (Number(i.quantity) || 1), 0);

    order.inventoryCheckStatus = 'Procurement Completed';
    order.workflowStatus = 'Goods Received in Office';
    order.status = 'Goods Received in Office';
    order.departmentResponsible = 'Support';
    order.currentDepartment = 'Support';
    order.currentStatus = 'GOODS_IN_STOCK_ROUTED_TO_SUPPORT';
    order.previousDepartment = 'Local Purchaser';
    order.previousStatus = 'Pending Local Procurement';
    order.goodsReceivedInOffice = {
      received: true,
      receivedQuantity: totalQty,
      orderedQuantity: totalQty,
      receivingDate: new Date(),
      remarks: 'Goods brought to the office and handed to Support for Inventory IN and Delivery Note.'
    };
    order.lastAction = `Local Supplier PO ${finalPoNumber} Issued - Moved to Support for Inventory IN and Delivery Note`;
    order.lastActionBy = req.user._id;
    order.lastActionByName = req.user.fullName;
    order.lastActionAt = new Date();

    if (!order.workflowHistory) order.workflowHistory = [];
    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: 'Local Purchaser',
      action: 'Local Supplier PO Issued and Moved to Support',
      previousStatus: 'Pending Local Procurement',
      newStatus: 'Goods Received in Office',
      timestamp: new Date(),
      notes: `Local Supplier PO ${finalPoNumber} was issued to ${finalSupplierName}. Goods for Sales Order ${order.orderNumber || order.orderReference} were brought to the office and moved to Support for Inventory IN and Delivery Note (DN) creation.`
    });

    await order.save();

    await ensureLocalPayableForSupplierPO({ po: supplierPO, linkedOrder: order, user: req.user });

    await notifyRoleHelper(['support', 'operations', 'admin', 'ceo'], {
      type: 'order',
      title: 'New Order Ready for Delivery Note in Support',
      message: `Green File Order ${order.orderNumber || order.orderReference} with Local Supplier PO ${finalPoNumber} arrived at the office and is ready for Support Inventory IN and Delivery Note creation.`,
      link: '/support/orders',
      sender: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Local Supplier PO ${finalPoNumber} saved and Sales Order ${order.orderNumber || order.orderReference} successfully moved to Support for Inventory IN and Delivery Note creation!`,
      data: order
    });
  } catch (error) {
    console.error('Complete Procurement Error:', error);
    return res.status(500).json({ success: false, message: 'Server error completing procurement and moving to support.' });
  }
};

exports.globalProcurementSendToLogistics = async (req, res) => {
  try {
    const { id } = req.params;
    const { supplierName, supplierCountry, paymentTerms, items, remarks } = req.body;

    const order = await SalesOrder.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    const poNum = `GPO-${Date.now().toString().slice(-6)}`;
    order.supplierPO = {
      poNumber: poNum,
      poType: 'International',
      supplierName: supplierName || 'Global Vendor',
      supplierCountry: supplierCountry || 'China',
      issueDate: new Date(),
      status: 'Issued',
      items: items && items.length > 0 ? items : (order.items || []),
      totalAmount: order.totalAmount || order.netAmount || 0,
      currency: 'PKR',
      notes: remarks || `Global Supplier PO issued with ${paymentTerms || 'LC'} terms`,
      issuedBy: req.user._id,
      issuedByName: req.user.fullName,
      issuedAt: new Date()
    };

    // Keep the Blue file with Global Purchasing until all procurement checkpoints are complete.
    order.workflowStatus = 'Pending Global Procurement';
    order.status = 'Pending Global Procurement';
    order.departmentResponsible = 'Global Purchaser';
    order.currentDepartment = 'Global Purchaser';
    order.currentStatus = 'BLUE_FILE_GLOBAL_PURCHASER';
    order.lastAction = 'Global Supplier PO Created';
    order.lastActionBy = req.user._id;
    order.lastActionByName = req.user.fullName;
    order.lastActionAt = new Date();

    // Also persist SupplierPO document for Global Purchaser POs record list
    let poDoc = await SupplierPO.findOne({ poNumber: poNum });
    if (!poDoc) {
      poDoc = await SupplierPO.create({
        poNumber: poNum,
        supplierName: supplierName || 'Global Vendor',
        supplierCountry: supplierCountry || 'China',
        poType: 'Global',
        items: items && items.length > 0 ? items : (order.items || []),
        totalAmount: order.totalAmount || order.netAmount || 0,
        currency: 'PKR',
        status: 'Issued',
        salesOrderId: order._id,
        salesOrderNumber: order.orderNumber || order.orderReference,
        notes: remarks || '',
        paymentTerms: paymentTerms || '',
        createdBy: req.user._id,
        createdByName: req.user.fullName
      });
    }
    order.supplierPoId = poDoc._id;
    order.supplierPoNumber = poNum;

    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: 'Global Purchaser',
      action: 'Global Supplier PO Created',
      previousStatus: 'Pending Global Procurement',
      newStatus: 'Pending Global Procurement',
      timestamp: new Date(),
      notes: `Global Supplier PO #${poNum} created by ${req.user.fullName}. Awaiting manufacturing and pick-up checkpoints.`
    });

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Global Supplier PO ${poNum} created. Order ${order.orderNumber || order.orderReference} remains with Global Purchasing for checkpoint updates.`,
      data: order
    });
  } catch (error) {
    console.error('Global Procurement Send To Logistics Error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating global PO.' });
  }
};

const handoffGlobalOrderToLogistics = async (order, user) => {
  const previousStatus = order.workflowStatus;
  const effectivePoNumber = order.supplierPO?.poNumber || order.supplierPoNumber || `GPO-${Date.now().toString().slice(-6)}`;

  order.previousStatus = previousStatus;
  order.previousDepartment = 'Global Purchaser';
  order.workflowStatus = 'In Logistics';
  order.status = 'In Logistics';
  order.departmentResponsible = 'Logistics';
  order.currentDepartment = 'Logistics';
  order.currentStatus = 'GLOBAL_PO_ISSUED_IN_LOGISTICS';
  order.lastAction = 'Ready to Pick Up confirmed; order sent to Logistics';
  order.lastActionBy = user._id;
  order.lastActionByName = user.fullName;
  order.lastActionAt = new Date();

  await SupplierPO.updateMany(
    { salesOrderId: order._id },
    { $set: { status: 'In Logistics' } }
  );
  order.workflowHistory.push({
    user: user._id,
    userName: user.fullName,
    department: 'Global Purchaser',
    action: 'Ready to Pick Up - Sent to Logistics',
    previousStatus,
    newStatus: 'In Logistics',
    timestamp: new Date(),
    notes: `Global Supplier PO #${effectivePoNumber} handed to Logistics. Logistics will confirm Picked Up and enter shipment details.`
  });
  await order.save();

  await notifyRoleHelper(['logistics', 'admin', 'ceo'], {
    type: 'order',
    title: 'Blue File Ready for Logistics Pick Up',
    message: `Global Supplier PO #${effectivePoNumber} for Sales Order ${order.orderNumber || order.orderReference} is ready for Logistics.`,
    link: '/logistics/shipments',
    sender: user._id
  });

  return null;
};

/**
 * @desc Record the next ordered Global Purchasing checkpoint for a Blue file
 * @route POST /api/purchaser/orders/:id/global-checkpoint
 */
exports.updateGlobalProcurementCheckpoint = async (req, res) => {
  try {
    const checkpoints = ['In Manufacturing', 'Ready to Pick Up'];
    const checkpoint = req.body.checkpoint;
    if (!checkpoints.includes(checkpoint)) {
      return res.status(400).json({ success: false, message: 'A valid Global Purchasing checkpoint is required.' });
    }

    const order = await SalesOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }
    if (order.fileType !== 'Blue') {
      return res.status(400).json({ success: false, message: 'Global Purchasing checkpoints apply only to Blue file orders.' });
    }
    if (order.currentDepartment !== 'Global Purchaser' || order.workflowStatus === 'In Logistics') {
      return res.status(409).json({ success: false, message: 'This order has already been sent to Logistics.' });
    }
    if (!order.supplierPO || !order.supplierPO.poNumber) {
      return res.status(400).json({ success: false, message: 'Create the Global Supplier PO before updating procurement checkpoints.' });
    }

    const currentStatus = order.supplierPO.status || 'Issued';
    const currentIndex = checkpoints.indexOf(currentStatus);
    const requestedIndex = checkpoints.indexOf(checkpoint);

    if (checkpoint === 'Ready to Pick Up') {
      const existingShipment = await Shipment.findOne({ salesOrder: order._id }).select('shipmentId').lean();
      if (existingShipment) {
        return res.status(409).json({
          success: false,
          message: `Shipment ${existingShipment.shipmentId} already exists for this Sales Order.`
        });
      }
    }

    if (requestedIndex <= currentIndex) {
      return res.status(200).json({ success: true, message: `${checkpoint} is already complete.`, data: order });
    }
    if (requestedIndex !== currentIndex + 1) {
      return res.status(400).json({ success: false, message: `Complete ${checkpoints[currentIndex + 1]} before ${checkpoint}.` });
    }

    order.supplierPO.status = checkpoint;
    if (checkpoint !== 'Ready to Pick Up') {
      order.workflowStatus = 'Pending Global Procurement';
      order.status = 'Pending Global Procurement';
      order.departmentResponsible = 'Global Purchaser';
      order.currentDepartment = 'Global Purchaser';
      order.currentStatus = 'BLUE_FILE_GLOBAL_PURCHASER';
    }
    order.lastAction = `Global procurement checkpoint completed: ${checkpoint}`;
    order.lastActionBy = req.user._id;
    order.lastActionByName = req.user.fullName;
    order.lastActionAt = new Date();
    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: 'Global Purchaser',
      action: `Global procurement checkpoint completed: ${checkpoint}`,
      previousStatus: currentStatus,
      newStatus: checkpoint,
      timestamp: new Date(),
      notes: `Global Supplier PO #${order.supplierPO.poNumber}: ${checkpoint}.`
    });

    if (checkpoint === 'Ready to Pick Up') {
      await handoffGlobalOrderToLogistics(order, req.user);
    } else {
      await SupplierPO.updateMany(
        { salesOrderId: order._id },
        { $set: { status: checkpoint } }
      );
      await order.save();
    }

    return res.status(200).json({
      success: true,
      message: checkpoint === 'Ready to Pick Up'
        ? 'Ready to Pick Up recorded. The order has been sent to Logistics.'
        : `${checkpoint} recorded. The order remains with Global Purchasing.`,
      data: order
    });
  } catch (error) {
    console.error('Update Global Procurement Checkpoint Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating Global Purchasing checkpoint.' });
  }
};

/**
 * @desc Move Supplier PO & Blue File Order to Logistics with full shipment tracking details
 * @route POST /api/purchaser/orders/:id/send-to-logistics
 */
exports.sendGlobalOrderToLogistics = async (req, res) => {
  try {
    const { id } = req.params;
    let order = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      order = await SalesOrder.findById(id);
      if (!order) {
        const po = await SupplierPO.findById(id);
        if (po?.salesOrderId) order = await SalesOrder.findById(po.salesOrderId);
        else if (po?.salesOrderNumber) order = await SalesOrder.findOne({ orderNumber: po.salesOrderNumber });
      }
    }
    if (!order && req.body.salesOrderId && mongoose.Types.ObjectId.isValid(req.body.salesOrderId)) {
      order = await SalesOrder.findById(req.body.salesOrderId);
    }
    if (!order && req.body.salesOrderNumber) {
      order = await SalesOrder.findOne({ orderNumber: req.body.salesOrderNumber });
    }
    if (!order) {
      return res.status(404).json({ success: false, message: 'Associated Sales Order not found for moving to Logistics.' });
    }

    const alreadySentToLogistics =
      ['Logistics', 'Support', 'Accounts', 'Completed'].includes(order.currentDepartment) ||
      ['In Logistics', 'Pending Delivery Note', 'Draft Invoice Created', 'Invoice Finalized', 'Completed'].includes(order.workflowStatus);
    if (alreadySentToLogistics) {
      return res.status(409).json({
        success: false,
        message: 'This order has already been sent to Logistics.'
      });
    }
    const existingShipment = await Shipment.findOne({ salesOrder: order._id }).select('shipmentId').lean();
    if (existingShipment) {
      return res.status(409).json({
        success: false,
        message: `Shipment ${existingShipment.shipmentId} already exists for this Sales Order.`
      });
    }
    if (!['Ready to Pick Up', 'Picked Up'].includes(order.supplierPO?.status)) {
      return res.status(400).json({
        success: false,
        message: 'Complete the Ready to Pick Up checkpoint before moving this order to Logistics.'
      });
    }

    const shipment = await handoffGlobalOrderToLogistics(order, req.user);
    return res.status(200).json({
      success: true,
      message: `Sales Order ${order.orderNumber || order.orderReference} and Supplier PO successfully moved to Logistics Department!`,
      data: { order, shipment }
    });
  } catch (error) {
    console.error('Send Global Order to Logistics Error:', error);
    return res.status(500).json({ success: false, message: 'Server error moving order to Logistics.' });
  }
};

// ── INVENTORY MANAGEMENT FOR PURCHASER ─────────────────────────────────────────
exports.getPurchaserInventory = async (req, res) => {
  try {
    const InventoryItem = require('../models/InventoryItem');
    const { search, status, category } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (category && category !== 'all') query.category = category;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: regex }, { sku: regex }, { category: regex }, { location: regex }];
    }
    const items = await InventoryItem.find(query).sort({ updatedAt: -1 });
    return res.status(200).json({ success: true, count: items.length, inventory: items, data: items });
  } catch (error) {
    console.error('Get Purchaser Inventory Error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching inventory.' });
  }
};

exports.createOrUpdatePurchaserInventory = async (req, res) => {
  try {
    if (req.user?.role === 'purchaser' && req.user.purchaserSubDept !== 'Global') {
      return res.status(403).json({
        success: false,
        message: 'Inventory updates are handled by the Support team.'
      });
    }

    const InventoryItem = require('../models/InventoryItem');
    const targetId = req.params.id || req.body.id || req.body._id;
    const { name, productName, sku, productCode, category, unit, quantityOnHand, quantity, minStockLevel, unitPrice, location, description } = req.body;

    const finalName = (name || productName || '').trim();
    if (!finalName && !targetId) {
      return res.status(400).json({ success: false, message: 'Product name is required.' });
    }
    const finalSku = sku || productCode || (targetId ? undefined : `SKU-${Date.now().toString().slice(-6)}`);
    const finalQty = quantityOnHand !== undefined ? Number(quantityOnHand) : (quantity !== undefined ? Number(quantity) : undefined);
    const finalPrice = unitPrice !== undefined ? Number(unitPrice) : undefined;
    const finalMin = minStockLevel !== undefined ? Number(minStockLevel) : undefined;

    let item;
    const mongoose = require('mongoose');
    if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
      const updateData = {};
      if (finalName) updateData.name = finalName;
      if (finalSku !== undefined) updateData.sku = finalSku;
      if (category) updateData.category = category;
      if (unit) updateData.unit = unit;
      if (finalQty !== undefined) updateData.quantityOnHand = finalQty;
      if (finalMin !== undefined) updateData.minStockLevel = finalMin;
      if (finalPrice !== undefined) updateData.unitPrice = finalPrice;
      if (location !== undefined) updateData.location = location;
      if (description !== undefined) updateData.description = description;

      item = await InventoryItem.findByIdAndUpdate(
        targetId,
        updateData,
        { new: true, runValidators: true }
      );
      if (!item) {
        return res.status(404).json({ success: false, message: 'Inventory item not found.' });
      }
    } else {
      // Check if product with this name already exists
      item = await InventoryItem.findOne({ name: new RegExp('^' + finalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
      if (item) {
        item.quantityOnHand = (item.quantityOnHand || 0) + (finalQty !== undefined ? finalQty : 0);
        if (finalPrice !== undefined && finalPrice > 0) item.unitPrice = finalPrice;
        if (location) item.location = location;
        if (finalSku) item.sku = finalSku;
        if (category) item.category = category;
        if (unit) item.unit = unit;
        if (minStockLevel !== undefined) item.minStockLevel = finalMin;
        if (description) item.description = description;
        await item.save();
      } else {
        item = await InventoryItem.create({
          name: finalName,
          sku: finalSku || `SKU-${Date.now().toString().slice(-6)}`,
          category: category || 'General',
          unit: unit || 'pcs',
          quantityOnHand: finalQty !== undefined ? finalQty : 0,
          minStockLevel: finalMin !== undefined ? finalMin : 5,
          unitPrice: finalPrice !== undefined ? finalPrice : 0,
          location: location || '',
          description: description || ''
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Product "${item.name}" saved to inventory with ${item.quantityOnHand} ${item.unit || 'units'}.`,
      data: item,
      item
    });
  } catch (error) {
    console.error('Save Purchaser Inventory Error:', error);
    return res.status(500).json({ success: false, message: 'Server error saving inventory product.' });
  }
};

exports.deletePurchaserInventoryItem = async (req, res) => {
  try {
    if (req.user?.role === 'purchaser' && req.user.purchaserSubDept !== 'Global') {
      return res.status(403).json({
        success: false,
        message: 'Inventory updates are handled by the Support team.'
      });
    }

    const InventoryItem = require('../models/InventoryItem');
    const { id } = req.params;
    const mongoose = require('mongoose');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid inventory item ID.' });
    }
    const item = await InventoryItem.findByIdAndDelete(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Inventory item not found.' });
    }
    return res.status(200).json({
      success: true,
      message: `Product "${item.name}" removed from inventory successfully.`,
      data: item
    });
  } catch (error) {
    console.error('Delete Purchaser Inventory Error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting inventory product.' });
  }
};
