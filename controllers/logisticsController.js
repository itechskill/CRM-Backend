const mongoose = require('mongoose');
const Shipment = require('../models/Shipment');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const User = require('../models/User');
const { createNotificationHelper, notifyRoleHelper } = require('./notificationController');

/**
 * @desc    Get real Logistics Dashboard statistics
 * @route   GET /api/logistics/stats
 */
const getLogisticsDashboardStats = async (req, res) => {
  try {
    const now = new Date();

    const [
      pendingShipmentsCount,
      intPoCount,
      inTransitCount,
      expectedArrivalsCount,
      receivedCount,
      delayedCount,
      totalActiveCount,
      recentShipments
    ] = await Promise.all([
      // Pending Shipments (PO Issued, Shipment Pending, Booked)
      Shipment.countDocuments({
        status: { $in: ['PO Issued', 'Shipment Pending', 'Booked'] },
        receivedInOffice: false
      }),
      // International Supplier POs (Sales orders with Blue file and International PO, or Shipments with PO Issued)
      SalesOrder.countDocuments({
        fileType: 'Blue',
        'supplierPO.poType': 'International'
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
        pendingShipments: pendingShipmentsCount,
        internationalSupplierPOs: intPoCount,
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
      order.workflowStatus = 'Shipment Received in Office';
      order.status = 'Shipment Received in Office';
      order.departmentResponsible = 'Support'; // Automatically ready for Support processing!
      order.workflowHistory.push({
        user: req.user._id,
        userName: req.user.fullName,
        department: 'Logistics',
        action: 'Shipment Received in Office',
        previousStatus: prevStatus,
        newStatus: 'Shipment Received in Office',
        timestamp: new Date(),
        notes: `Shipment ${shipment.shipmentId} confirmed received in office by ${req.user.fullName}. Handed over to Support for Goods Received & Delivery Note.`
      });
      await order.save();

      // Notify Support team that goods arrived and are ready for receipt / BL input
      await notifyRoleHelper(['support', 'operations', 'admin'], {
        type: 'order',
        title: 'Shipment Received in Office — Ready for Support',
        message: `Shipment ${shipment.shipmentId} for Sales Order ${order.orderNumber || order.orderReference} has been received in office and is ready for Support processing.`,
        link: '/support/orders',
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
      message: `Shipment ${shipment.shipmentId} confirmed as received in office and transitioned to Support!`,
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
    // Sales Orders with Blue file and International PO
    const orders = await SalesOrder.find({
      fileType: 'Blue',
      $or: [
        { 'supplierPO.poType': 'International' },
        { workflowStatus: { $in: ['International Supplier PO Issued', 'Finance Approved', 'Routed to Logistics'] } }
      ]
    })
      .populate('salesPerson', 'fullName email')
      .populate('shipmentId')
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
