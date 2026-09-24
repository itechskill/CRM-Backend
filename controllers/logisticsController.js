const mongoose = require('mongoose');
const Shipment = require('../models/Shipment');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const User = require('../models/User');
const InventoryItem = require('../models/InventoryItem');
const { createNotificationHelper, notifyRoleHelper } = require('./notificationController');

/**
 * @desc    Get real Logistics Dashboard statistics
 * @route   GET /api/logistics/stats
 */
const getLogisticsDashboardStats = async (req, res) => {
  try {
    const now = new Date();

    // Get all Sales Order IDs that ALREADY have an initialized shipment
    const initializedOrderIds = await Shipment.distinct('salesOrder');

    const [
      incomingOrdersCount,
      pendingShipmentsCount,
      inTransitCount,
      expectedArrivalsCount,
      receivedCount,
      delayedCount,
      totalActiveCount,
      recentShipments
    ] = await Promise.all([
      // Incoming Blue File Orders awaiting Shipment Initialization (NOT YET INITIALIZED)
      SalesOrder.countDocuments({
        _id: { $nin: initializedOrderIds },
        shipmentId: null,
        fileType: 'Blue',
        $or: [
          { 'supplierPO.poType': 'International' },
          { workflowStatus: { $in: ['International Supplier PO Issued', 'Finance Approved', 'Routed to Logistics', 'In Logistics', 'Pending Logistics Handover'] } }
        ]
      }),
      // Pending Shipments (PO Issued, Shipment Pending, Booked)
      Shipment.countDocuments({
        status: { $in: ['PO Issued', 'Shipment Pending', 'Booked'] },
        receivedInOffice: false
      }),
      // In Transit
      Shipment.countDocuments({
        status: 'In Transit',
        receivedInOffice: false
      }),
      // Expected Arrivals (In Transit or Booked or Dispatched with ETA)
      Shipment.countDocuments({
        status: { $in: ['In Transit', 'Booked', 'Dispatched', 'Arrived'] },
        receivedInOffice: false,
        eta: { $ne: null }
      }),
      // Shipments Received in Office
      Shipment.countDocuments({
        $or: [{ receivedInOffice: true }, { status: 'Received in Office' }]
      }),
      // Delayed Shipments (Explicitly marked Delayed or past ETA and not received)
      Shipment.countDocuments({
        $or: [
          { status: 'Delayed' },
          {
            receivedInOffice: false,
            eta: { $lt: now, $ne: null },
            status: { $nin: ['Received in Office', 'Cancelled'] }
          }
        ]
      }),
      // Total Active Shipments
      Shipment.countDocuments({
        receivedInOffice: false,
        status: { $nin: ['Received in Office', 'Cancelled'] }
      }),
      // 10 most recent shipments for live activity
      Shipment.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('salesPerson', 'fullName email')
        .lean()
    ]);

    return res.status(200).json({
      success: true,
      data: {
        incomingOrders: incomingOrdersCount,
        internationalSupplierPOs: incomingOrdersCount,
        pendingShipments: pendingShipmentsCount,
        inTransit: inTransitCount,
        expectedArrivals: expectedArrivalsCount,
        shipmentsReceived: receivedCount,
        delayedShipments: delayedCount,
        totalActiveShipments: totalActiveCount,
        recentShipments
      }
    });
  } catch (error) {
    console.error('[Logistics Dashboard Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading logistics statistics.' });
  }
};

/**
 * @desc    Get all Shipments with real filters and search
 * @route   GET /api/logistics/shipments
 */
const getShipments = async (req, res) => {
  try {
    const {
      search,
      status,
      supplier,
      salesPerson,
      customer,
      received,
      startDate,
      endDate,
      sort
    } = req.query;

    const query = {};

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Received / Not Received filter
    if (received === 'true') {
      query.$or = [{ receivedInOffice: true }, { status: 'Received in Office' }];
    } else if (received === 'false') {
      query.receivedInOffice = false;
      query.status = { $ne: 'Received in Office' };
    }

    // Supplier filter
    if (supplier && supplier.trim()) {
      query.supplierName = { $regex: supplier.trim(), $options: 'i' };
    }

    // Customer filter
    if (customer && customer.trim()) {
      query.clientName = { $regex: customer.trim(), $options: 'i' };
    }

    // Sales Person filter
    if (salesPerson && salesPerson.trim()) {
      query.$or = [
        { salePerson: { $regex: salesPerson.trim(), $options: 'i' } }
      ];
      if (mongoose.Types.ObjectId.isValid(salesPerson.trim())) {
        query.$or.push({ salesPerson: salesPerson.trim() });
      }
    }

    // Date range filter (ETD or ETA or createdAt)
    if (startDate || endDate) {
      const dateQuery = {};
      if (startDate) dateQuery.$gte = new Date(startDate);
      if (endDate) dateQuery.$lte = new Date(endDate);
      query.createdAt = dateQuery;
    }

    // Full search across all relevant fields
    if (search && search.trim()) {
      const term = search.trim();
      const regex = { $regex: term, $options: 'i' };
      const searchOr = [
        { shipmentId: regex },
        { trackingNumber: regex },
        { salesOrderNumber: regex },
        { deliveryNoteNumber: regex },
        { clientName: regex },
        { salePerson: regex },
        { supplierName: regex },
        { supplierPoNumber: regex },
        { flightNumber: regex },
        { carrier: regex },
        { status: regex },
        { description: regex }
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    const sortOption = { createdAt: -1 };
    if (sort === 'eta_asc') sortOption.eta = 1;
    if (sort === 'eta_desc') sortOption.eta = -1;

    const shipments = await Shipment.find(query)
      .sort(sortOption)
      .populate('salesOrder', 'orderReference orderNumber clientName netAmount totalAmount fileType')
      .populate('salesPerson', 'fullName email phone')
      .populate('receivedInOfficeBy', 'fullName email')
      .lean();

    return res.status(200).json({
      success: true,
      count: shipments.length,
      data: shipments
    });
  } catch (error) {
    console.error('[Get Shipments Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading shipments.' });
  }
};

/**
 * @desc    Get single shipment detail
 * @route   GET /api/logistics/shipments/:id
 */
const getShipmentById = async (req, res) => {
  try {
    let shipment = null;
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      shipment = await Shipment.findById(req.params.id)
        .populate('salesOrder')
        .populate('salesPerson', 'fullName email phone')
        .populate('receivedInOfficeBy', 'fullName email')
        .lean();
    }
    if (!shipment) {
      shipment = await Shipment.findOne({ shipmentId: req.params.id })
        .populate('salesOrder')
        .populate('salesPerson', 'fullName email phone')
        .populate('receivedInOfficeBy', 'fullName email')
        .lean();
    }

    if (!shipment) {
      return res.status(404).json({ success: false, message: 'Shipment not found.' });
    }

    return res.status(200).json({ success: true, data: shipment });
  } catch (error) {
    console.error('[Get Shipment By Id Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading shipment.' });
  }
};

/**
 * @desc    Create a new Shipment manually or for Blue File Sales Order
 * @route   POST /api/logistics/shipments
 */
const createShipment = async (req, res) => {
  try {
    const {
      salesOrderId,
      supplierName,
      supplierCountry,
      supplierPoNumber,
      carrier,
      flightNumber,
      trackingNumber,
      shippingMethod,
      departureLocation,
      arrivalLocation,
      etd,
      eta,
      description,
      referenceDocs,
      remarks,
      items
    } = req.body;

    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales Order ID is required.' });
    }

    const order = await SalesOrder.findById(salesOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    // Check if shipment already exists
    const existing = await Shipment.findOne({ salesOrder: order._id });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Shipment ${existing.shipmentId} already exists for this Sales Order.`,
        data: existing
      });
    }

    const shipment = await Shipment.create({
      salesOrder: order._id,
      salesOrderNumber: order.orderNumber || order.orderReference,
      salesPerson: order.salesPerson || req.user._id,
      salePerson: order.salePerson || req.user.fullName,
      clientName: order.clientName,
      clientEmail: order.clientEmail || '',
      clientPhone: order.clientPhone || '',
      supplierName: supplierName || order.supplierPO?.supplierName || '',
      supplierCountry: supplierCountry || order.supplierPO?.supplierCountry || '',
      supplierPoNumber: supplierPoNumber || order.supplierPO?.poNumber || '',
      supplierPoDate: order.supplierPO?.issueDate || new Date(),
      fileType: 'Blue',
      status: 'PO Issued',
      carrier: carrier || '',
      flightNumber: flightNumber || '',
      trackingNumber: trackingNumber || '',
      shippingMethod: shippingMethod || 'Air Freight',
      departureLocation: departureLocation || '',
      arrivalLocation: arrivalLocation || 'Karachi, Pakistan',
      etd: etd ? new Date(etd) : null,
      eta: eta ? new Date(eta) : null,
      description: description || order.productSummary || '',
      referenceDocs: referenceDocs || '',
      remarks: remarks || '',
      items: items && items.length > 0 ? items : (order.items || []),
      createdBy: req.user._id,
      trackingHistory: [
        {
          status: 'PO Issued',
          location: departureLocation || 'Origin',
          notes: 'Shipment record initialized from International Supplier PO.',
          updatedBy: req.user._id,
          updatedByName: req.user.fullName,
          timestamp: new Date()
        }
      ]
    });

    // Link shipment back to sales order
    order.shipmentId = shipment._id;
    order.shipmentNumber = shipment.shipmentId;
    order.workflowStatus = 'Routed to Logistics';
    order.departmentResponsible = 'Logistics';
    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: 'Logistics',
      action: 'Shipment Initialized',
      previousStatus: order.workflowStatus,
      newStatus: 'Routed to Logistics',
      timestamp: new Date(),
      notes: `Shipment ${shipment.shipmentId} created for Blue File international tracking.`
    });
    await order.save();

    // Notify sales representative
    if (order.salesPerson) {
      await createNotificationHelper({
        recipient: order.salesPerson,
        sender: req.user._id,
        title: 'Shipment Created in Logistics',
        message: `International shipment ${shipment.shipmentId} for Sales Order ${order.orderNumber || order.orderReference} is now in Logistics tracking.`,
        type: 'order',
        link: '/employee/sales/orders'
      });
    }

    return res.status(201).json({
      success: true,
      message: `Shipment ${shipment.shipmentId} successfully created.`,
      data: shipment
    });
  } catch (error) {
    console.error('[Create Shipment Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating shipment.' });
  }
};

/**
 * @desc    Update Shipment tracking information (ETD, ETA, Flight No, Ref Docs, Status, etc.)
 * @route   PATCH /api/logistics/shipments/:id/tracking
 */
const updateShipmentTracking = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) {
      return res.status(404).json({ success: false, message: 'Shipment not found.' });
    }

    const {
      etd,
      eta,
      actualDepartureDate,
      actualArrivalDate,
      flightNumber,
      carrier,
      shippingMethod,
      trackingNumber,
      departureLocation,
      arrivalLocation,
      description,
      referenceDocs,
      remarks,
      status,
      trackingNote
    } = req.body;

    const previousStatus = shipment.status;

    if (etd !== undefined) shipment.etd = etd ? new Date(etd) : null;
    if (eta !== undefined) shipment.eta = eta ? new Date(eta) : null;
    if (actualDepartureDate !== undefined) shipment.actualDepartureDate = actualDepartureDate ? new Date(actualDepartureDate) : null;
    if (actualArrivalDate !== undefined) shipment.actualArrivalDate = actualArrivalDate ? new Date(actualArrivalDate) : null;
    if (flightNumber !== undefined) shipment.flightNumber = flightNumber.trim();
    if (carrier !== undefined) shipment.carrier = carrier.trim();
    if (shippingMethod !== undefined) shipment.shippingMethod = shippingMethod;
    if (trackingNumber !== undefined) shipment.trackingNumber = trackingNumber.trim();
    if (departureLocation !== undefined) shipment.departureLocation = departureLocation.trim();
    if (arrivalLocation !== undefined) shipment.arrivalLocation = arrivalLocation.trim();
    if (description !== undefined) shipment.description = description.trim();
    if (referenceDocs !== undefined) shipment.referenceDocs = referenceDocs.trim();
    if (remarks !== undefined) shipment.remarks = remarks.trim();

    if (status && status !== previousStatus) {
      shipment.status = status;
      shipment.trackingHistory.push({
        status,
        location: departureLocation || arrivalLocation || '',
        notes: trackingNote || `Status updated to ${status}.`,
        updatedBy: req.user._id,
        updatedByName: req.user.fullName,
        timestamp: new Date()
      });
    } else if (trackingNote) {
      shipment.trackingHistory.push({
        status: shipment.status,
        location: departureLocation || arrivalLocation || '',
        notes: trackingNote,
        updatedBy: req.user._id,
        updatedByName: req.user.fullName,
        timestamp: new Date()
      });
    }

    await shipment.save();

    // Also update linked SalesOrder status if shipment status changes
    if (shipment.salesOrder) {
      const order = await SalesOrder.findById(shipment.salesOrder);
      if (order) {
        order.workflowHistory.push({
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Logistics',
          action: 'Shipment Tracking Updated',
          previousStatus: previousStatus,
          newStatus: shipment.status,
          timestamp: new Date(),
          notes: `Shipment ${shipment.shipmentId} tracking updated (Flight: ${shipment.flightNumber || 'N/A'}, ETA: ${shipment.eta ? shipment.eta.toLocaleDateString() : 'N/A'}, Status: ${shipment.status}).`
        });
        await order.save();

        // Notify sales person if delayed or status changed
        if (order.salesPerson) {
          const isDelayed = shipment.status === 'Delayed';
          await createNotificationHelper({
            recipient: order.salesPerson,
            sender: req.user._id,
            title: isDelayed ? `Shipment Delayed: ${shipment.shipmentId}` : `Shipment Tracking Update: ${shipment.shipmentId}`,
            message: isDelayed
              ? `Shipment ${shipment.shipmentId} for Sales Order ${order.orderNumber || order.orderReference} has been marked as delayed.`
              : `Shipment ${shipment.shipmentId} for Sales Order ${order.orderNumber || order.orderReference} has been updated to ${shipment.status}.`,
            type: 'order',
            link: '/employee/sales/orders'
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Shipment ${shipment.shipmentId} tracking information updated.`,
      data: shipment
    });
  } catch (error) {
    console.error('[Update Shipment Tracking Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating shipment tracking.' });
  }
};

/**
 * @desc    Confirm Shipment Received in Office (Logistics Department action)
 * @route   POST /api/logistics/shipments/:id/receive-in-office
 */
const receiveShipmentInOffice = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) {
      return res.status(404).json({ success: false, message: 'Shipment not found.' });
    }

    if (shipment.receivedInOffice) {
      return res.status(400).json({
        success: false,
        message: `Shipment ${shipment.shipmentId} is already marked as received in office.`
      });
    }

    const { receivedDate, remarks } = req.body;
    const rDate = receivedDate ? new Date(receivedDate) : new Date();

    shipment.receivedInOffice = true;
    shipment.receivedInOfficeDate = rDate;
    shipment.receivedInOfficeBy = req.user._id;
    shipment.receivedInOfficeByName = req.user.fullName;
    shipment.status = 'Received in Office';
    if (remarks) shipment.remarks = (shipment.remarks ? shipment.remarks + ' | ' : '') + remarks;

    shipment.trackingHistory.push({
      status: 'Received in Office',
      location: 'Fortline Office',
      notes: remarks || `Confirmed received in office by ${req.user.fullName}.`,
      updatedBy: req.user._id,
      updatedByName: req.user.fullName,
      timestamp: new Date()
    });

    await shipment.save();

    // Update linked Sales Order: advance workflow to Support!
    const order = await SalesOrder.findById(shipment.salesOrder);
    if (order) {
      const prevStatus = order.workflowStatus;
      order.workflowStatus = 'Pending Logistics GRN';
      order.status = 'Pending Logistics GRN';
      order.departmentResponsible = 'Logistics'; // Keep in logistics for GRN
      order.currentDepartment = 'Logistics';
      order.currentStatus = 'PENDING_LOGISTICS_GRN';
      order.previousDepartment = 'Logistics';
      order.previousStatus = prevStatus;
      order.lastAction = `Shipment ${shipment.shipmentId} confirmed received in office by Logistics`;
      order.lastActionBy = req.user._id;
      order.lastActionByName = req.user.fullName;
      order.lastActionAt = new Date();
      order.goodsReceivedInOffice = {
        received: true,
        receivedAt: new Date(),
        receivedBy: req.user._id,
        receivedByName: req.user.fullName,
        receivedQuantity: order.items?.reduce((acc, it) => acc + (it.quantity || 0), 0) || 0,
        orderedQuantity: order.items?.reduce((acc, it) => acc + (it.quantity || 0), 0) || 0,
        remarks: 'Received by Logistics'
      };
      
      order.workflowHistory.push({
        user: req.user._id,
        userName: req.user.fullName,
        department: 'Logistics',
        action: 'Shipment Received in Office',
        previousStatus: prevStatus,
        newStatus: 'Pending Logistics GRN',
        timestamp: new Date(),
        notes: `Shipment ${shipment.shipmentId} confirmed received in office by ${req.user.fullName}. Awaiting GRN creation.`
      });
      await order.save();

      // Notify Logistics team that goods arrived and are ready for GRN
      await notifyRoleHelper(['logistics'], {
        type: 'order',
        title: 'Shipment Received — Awaiting GRN',
        message: `Shipment ${shipment.shipmentId} for Sales Order ${order.orderNumber || order.orderReference} is received. Please create GRN.`,
        link: '/logistics/grn',
        sender: req.user._id
      });

      // Notify Sales Person
      if (order.salesPerson) {
        await createNotificationHelper({
          recipient: order.salesPerson,
          sender: req.user._id,
          title: `Shipment Received: ${shipment.shipmentId}`,
          message: `Shipment ${shipment.shipmentId} for Sales Order ${order.orderNumber || order.orderReference} has arrived and is received in office.`,
          type: 'order',
          link: '/employee/sales/orders'
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Shipment ${shipment.shipmentId} confirmed as received in office. Please create GRN.`,
      data: shipment
    });
  } catch (error) {
    console.error('[Receive Shipment in Office Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error confirming shipment receipt.' });
  }
};

/**
 * @desc    Get Blue File orders with International Supplier PO awaiting Shipment initialization
 * @route   GET /api/logistics/incoming-orders
 */
const getIncomingOrders = async (req, res) => {
  try {
    // Find all Sales Order IDs that ALREADY have an initialized shipment
    const initializedOrderIds = await Shipment.distinct('salesOrder');

    // Sales Orders with Blue file and International PO awaiting shipment initialization (not yet initialized)
    const orders = await SalesOrder.find({
      _id: { $nin: initializedOrderIds },
      shipmentId: null,
      fileType: 'Blue',
      $or: [
        { 'supplierPO.poType': 'International' },
        { workflowStatus: { $in: ['International Supplier PO Issued', 'Finance Approved', 'Routed to Logistics', 'In Logistics', 'Pending Logistics Handover'] } }
      ]
    })
      .populate('salesPerson', 'fullName email')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('[Get Incoming Orders Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading incoming orders.' });
  }
};

/**
 * @desc    Get Delivery Notes linked to Shipments / Blue Files
 * @route   GET /api/logistics/delivery-notes
 */
const getLogisticsDeliveryNotes = async (req, res) => {
  try {
    const deliveryNotes = await DeliveryNote.find({
      $or: [
        { fileType: 'Blue' },
        { shipmentId: { $ne: null } }
      ]
    })
      .populate('salesPerson', 'fullName email')
      .populate('shipmentId')
      .populate('salesOrder', 'orderReference orderNumber')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, count: deliveryNotes.length, data: deliveryNotes });
  } catch (error) {
    console.error('[Get Logistics Delivery Notes Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading delivery notes.' });
  }
};

module.exports = {
  getLogisticsDashboardStats,
  getShipments,
  getShipmentById,
  createShipment,
  updateShipmentTracking,
  receiveShipmentInOffice,
  getIncomingOrders,
  getLogisticsDeliveryNotes
};

/**
 * @desc    Get all Logistics GRNs
 * @route   GET /api/logistics/grns
 */
const getLogisticsGRNs = async (req, res) => {
  try {
    const PurchaserGRN = require('../models/PurchaserGRN');
    const grns = await PurchaserGRN.find({
      $or: [
        { grnType: 'Logistics' },
        { grnType: 'Supplier' },
        { grnType: { $exists: false } }
      ]
    }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, count: grns.length, grns, data: grns });
  } catch (error) {
    console.error('[Get Logistics GRNs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading GRNs.' });
  }
};

module.exports.getLogisticsGRNs = getLogisticsGRNs;

/**
 * @desc    Get orders / shipments pending Logistics GRN
 * @route   GET /api/logistics/pending-grns
 */
const getPendingGRNs = async (req, res) => {
  try {
    const orders = await SalesOrder.find({
      fileType: 'Blue',
      status: { $nin: ['Delivered', 'Cancelled', 'Closed'] },
      $or: [
        { departmentResponsible: 'Logistics' },
        { currentDepartment: 'Logistics' },
        { workflowStatus: { $in: ['Shipment In Transit', 'Customs Clearance', 'Pending Logistics GRN', 'Shipment Received in Office', 'Order Placed with Supplier'] } }
      ]
    }).populate('salesPerson', 'fullName email').sort({ createdAt: -1 }).lean();

    return res.status(200).json({ success: true, count: orders.length, data: orders, orders });
  } catch (error) {
    console.error('[Get Pending GRNs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading pending GRNs.' });
  }
};

module.exports.getPendingGRNs = getPendingGRNs;

const PurchaserGRN = require('../models/PurchaserGRN');

/**
 * @desc    Create GRN in Logistics and hand over to Support (if linked to Sales Order)
 * @route   POST /api/logistics/grn
 */
const createLogisticsGRN = async (req, res) => {
  try {
    const {
      salesOrderId,
      salesOrderNumber,
      supplierName,
      supplierPONumber,
      deliveryNoteNumber,
      inspectionStatus,
      remarks,
      items,
      grnNumber: customGrnNumber
    } = req.body;

    let order = null;
    if (salesOrderId) {
      order = await SalesOrder.findById(salesOrderId);
    }

    const grnCount = await PurchaserGRN.countDocuments();
    const grnNumber = customGrnNumber || `GRN-LOG-${new Date().getFullYear()}-${String(grnCount + 1).padStart(4, '0')}`;

    const formattedItems = (Array.isArray(items) ? items : []).map(it => ({
      productName: it.productName || it.description || 'General Item',
      orderedQty: Number(it.orderedQty) || Number(it.quantity) || 1,
      receivedQty: Number(it.receivedQty || it.quantityReceived || it.quantity) || 1,
      quantity: Number(it.quantity || it.quantityReceived || it.receivedQty) || 1,
      quantityReceived: Number(it.quantityReceived || it.receivedQty || it.quantity) || 1,
      condition: it.condition || 'Good'
    }));

    const grn = await PurchaserGRN.create({
      grnNumber,
      grnType: 'Logistics',
      supplierName: supplierName || (order ? order.supplierName : '') || 'Logistics Inward',
      poNumber: supplierPONumber || '',
      salesOrder: order ? order._id : null,
      salesOrderId: order ? order._id : null,
      salesOrderNumber: salesOrderNumber || (order ? (order.orderNumber || order.orderReference) : ''),
      items: formattedItems.length > 0 ? formattedItems : [{ productName: 'General Goods', orderedQty: 1, receivedQty: 1, quantityReceived: 1, condition: 'Good' }],
      remarks: remarks || 'Logistics Goods Receipt Note',
      status: inspectionStatus || 'Completed',
      createdBy: req.user?._id,
      createdByName: req.user?.fullName || 'Logistics User'
    });

    // Auto add received items into Import Inventory
    try {
      for (const it of formattedItems) {
        const qty = Number(it.quantityReceived || it.receivedQty || it.orderedQty) || 1;
        const itemName = (it.productName || 'Imported Product').trim();

        let itemDoc = await InventoryItem.findOne({
          name: { $regex: new RegExp(`^${itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          $or: [{ category: 'Imported Goods' }, { location: { $regex: 'Logistics|Import', $options: 'i' } }]
        });

        if (itemDoc) {
          itemDoc.quantityOnHand = (itemDoc.quantityOnHand || 0) + qty;
          if (order) itemDoc.orderReference = order.orderNumber || order.orderReference;
          if (supplierName) itemDoc.supplierName = supplierName;
          if (supplierPONumber) itemDoc.supplierPoNumber = supplierPONumber;
          await itemDoc.save();
        } else {
          await InventoryItem.create({
            name: itemName,
            sku: supplierPONumber ? `IMP-${supplierPONumber}` : `IMP-${Date.now().toString().slice(-6)}`,
            category: 'Imported Goods',
            unit: 'pcs',
            quantityOnHand: qty,
            reservedQuantity: 0,
            unitPrice: 0,
            location: 'Logistics / Import WH',
            description: remarks || `Imported via GRN ${grnNumber}`,
            supplierName: supplierName || (order ? order.supplierName : ''),
            supplierPoNumber: supplierPONumber || '',
            orderReference: order ? (order.orderNumber || order.orderReference) : ''
          });
        }
      }
    } catch (invErr) {
      console.warn('[GRN Auto Import Inventory Sync Error]:', invErr.message);
    }

    // Advance Sales Order to Support if order exists
    if (order) {
      const prevStatus = order.workflowStatus;
      order.workflowStatus = 'Shipment Received in Office';
      order.status = 'Shipment Received in Office';
      order.departmentResponsible = 'Support';
      order.currentDepartment = 'Support';
      order.currentStatus = 'SHIPMENT_RECEIVED_IN_OFFICE';
      order.previousDepartment = 'Logistics';
      order.previousStatus = prevStatus;
      order.lastAction = `Logistics GRN ${grnNumber} Created`;
      order.lastActionBy = req.user?._id;
      order.lastActionByName = req.user?.fullName || 'Logistics User';
      order.lastActionAt = new Date();
      
      order.workflowHistory.push({
        user: req.user?._id,
        userName: req.user?.fullName || 'Logistics User',
        department: 'Logistics',
        action: 'Logistics GRN Created',
        previousStatus: prevStatus,
        newStatus: 'Shipment Received in Office',
        timestamp: new Date(),
        notes: `Logistics GRN ${grnNumber} created. Order handed over to Support.`
      });
      
      await order.save();

      try {
        await notifyRoleHelper(['support', 'operations', 'admin'], {
          type: 'order',
          title: 'Logistics GRN Created — Ready for Support',
          message: `Logistics created GRN ${grnNumber} for Sales Order ${order.orderNumber || order.orderReference}. Ready for Support processing.`,
          link: '/support/orders',
          sender: req.user?._id
        });
      } catch (notifyErr) {
        console.warn('Logistics notify error:', notifyErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: `GRN ${grnNumber} created successfully.${order ? ' Order moved to Support.' : ''}`,
      data: grn
    });
  } catch (error) {
    console.error('[Create Logistics GRN Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating Logistics GRN: ' + error.message });
  }
};

module.exports.createLogisticsGRN = createLogisticsGRN;

/**
 * @desc    Get Logistics Import Inventory items
 * @route   GET /api/logistics/import-inventory
 */
const getImportInventory = async (req, res) => {
  try {
    const { search, status } = req.query;
    const query = {
      $or: [
        { category: 'Imported Goods' },
        { location: { $regex: 'Logistics|Import', $options: 'i' } }
      ]
    };

    if (status && status !== 'All') {
      query.status = status;
    }

    if (search && search.trim()) {
      const term = search.trim();
      const regex = { $regex: term, $options: 'i' };
      query.$and = [
        { $or: query.$or },
        {
          $or: [
            { name: regex },
            { sku: regex },
            { supplierName: regex },
            { supplierPoNumber: regex },
            { orderReference: regex },
            { description: regex },
            { location: regex }
          ]
        }
      ];
      delete query.$or;
    }

    const items = await InventoryItem.find(query).sort({ updatedAt: -1 }).lean();

    const totalQty = items.reduce((sum, i) => sum + (i.quantityOnHand || 0), 0);
    const totalValue = items.reduce((sum, i) => sum + ((i.quantityOnHand || 0) * (i.unitPrice || 0)), 0);
    const lowStockCount = items.filter(i => i.status === 'Low Stock' || i.status === 'Out of Stock').length;

    return res.status(200).json({
      success: true,
      count: items.length,
      stats: {
        totalItems: items.length,
        totalQuantityOnHand: totalQty,
        totalInventoryValue: totalValue,
        lowStockItems: lowStockCount
      },
      data: items
    });
  } catch (error) {
    console.error('[Get Import Inventory Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading import inventory.' });
  }
};

/**
 * @desc    Create a new Import Inventory item in Logistics
 * @route   POST /api/logistics/import-inventory
 */
const createImportInventoryItem = async (req, res) => {
  try {
    const {
      name,
      sku,
      unit,
      quantityOnHand,
      minStockLevel,
      unitPrice,
      location,
      description,
      supplierName,
      supplierPoNumber,
      orderReference
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Item name is required.' });
    }

    const item = await InventoryItem.create({
      name: name.trim(),
      sku: sku ? sku.trim() : `IMP-${Date.now().toString().slice(-6)}`,
      category: 'Imported Goods',
      unit: unit || 'pcs',
      quantityOnHand: Number(quantityOnHand) || 0,
      reservedQuantity: 0,
      minStockLevel: Number(minStockLevel) || 5,
      unitPrice: Number(unitPrice) || 0,
      location: location || 'Logistics / Import WH',
      description: description || '',
      supplierName: supplierName || '',
      supplierPoNumber: supplierPoNumber || '',
      orderReference: orderReference || ''
    });

    return res.status(201).json({
      success: true,
      message: `Import inventory item "${item.name}" created successfully.`,
      data: item
    });
  } catch (error) {
    console.error('[Create Import Inventory Item Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating import inventory item.' });
  }
};

/**
 * @desc    Update an Import Inventory item in Logistics
 * @route   PATCH /api/logistics/import-inventory/:id
 */
const updateImportInventoryItem = async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Inventory item not found.' });
    }

    const allowed = ['name', 'sku', 'unit', 'quantityOnHand', 'reservedQuantity', 'minStockLevel', 'unitPrice', 'location', 'description', 'supplierName', 'supplierPoNumber', 'orderReference'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'quantityOnHand' || field === 'reservedQuantity' || field === 'minStockLevel' || field === 'unitPrice') {
          item[field] = Number(req.body[field]);
        } else {
          item[field] = req.body[field];
        }
      }
    });

    await item.save();

    return res.status(200).json({
      success: true,
      message: `Import inventory item "${item.name}" updated successfully.`,
      data: item
    });
  } catch (error) {
    console.error('[Update Import Inventory Item Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating import inventory item.' });
  }
};

module.exports.getImportInventory = getImportInventory;
module.exports.createImportInventoryItem = createImportInventoryItem;
module.exports.updateImportInventoryItem = updateImportInventoryItem;
