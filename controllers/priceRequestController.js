const mongoose = require('mongoose');
const Counter = require('../models/Counter');
const PriceRequest = require('../models/PriceRequest');
const PriceRequestRoutingRule = require('../models/PriceRequestRoutingRule');
const Quotation = require('../models/Quotation');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');
const { createNotificationHelper } = require('./notificationController');

const {
  PRICE_REQUEST_CATEGORIES,
  PRICE_REQUEST_CURRENCIES,
  PRICE_REQUEST_LEAD_SOURCES
} = PriceRequest;
const { ROUTING_RULE_TYPES, ROUTING_PRIORITIES } = PriceRequestRoutingRule;

const PRICE_REQUEST_ROLES = [
  'sales_member',
  'sales_rep',
  'sales_person',
  'sales_manager',
  'purchaser',
  'admin',
  'ceo'
];

const KNOWN_BRANDS = ['Cisco', 'VMware', 'Lenovo', 'Microsoft', 'BDCOM', 'Fortinet', 'Dell', 'HP'];

const normalizeValue = (value) => String(value || '').trim().toLowerCase();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAdminOrCeo = (user) => ['admin', 'ceo'].includes(user?.role);
const isFeatureUser = (user) => Boolean(user && PRICE_REQUEST_ROLES.includes(user.role));

const findEligibleUser = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) return null;
  return User.findOne({
    _id: userId,
    status: 'active',
    isApproved: true,
    role: { $in: PRICE_REQUEST_ROLES }
  }).select('fullName email role purchaserSubDept department priceRequestLabel');
};

const getLabelledUsers = async (req, res) => {
  try {
    const users = await User.find({
      status: 'active',
      isApproved: true,
      role: { $in: PRICE_REQUEST_ROLES }
    })
      .select('_id fullName priceRequestLabel')
      .sort({ fullName: 1 })
      .collation({ locale: 'en', strength: 2 })
      .lean();
    return res.status(200).json({
      success: true,
      count: users.length,
      data: users.map(user => ({
        _id: user._id,
        name: user.fullName,
        label: String(user.priceRequestLabel || '').trim()
      }))
    });
  } catch (error) {
    console.error('[Get Labelled Price Request Users Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving Price Request people.' });
  }
};

const allocateRequestNumber = async () => {
  const counterKey = getCounterKey('price-request-number');
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!counter || counter.sequence > 999999) {
    const error = new Error('The Price Request sequence has reached PR-999999.');
    error.statusCode = 409;
    throw error;
  }
  return `PR-${String(counter.sequence).padStart(6, '0')}`;
};

const populateRequest = (query) => query
  .populate('requestedBy', 'fullName email role purchaserSubDept')
  .populate('requestedFrom', 'fullName email role purchaserSubDept')
  .populate('quotationId', 'orderReference quotationNumber clientName')
  .populate('events.actor', 'fullName email role')
  .populate('events.fromUser', 'fullName email role')
  .populate('events.toUser', 'fullName email role');

const serializeRequest = (request) => {
  const plain = request?.toObject ? request.toObject() : request;
  const created = plain?.createdAt ? new Date(plain.createdAt).getTime() : Date.now();
  const items = normalizeRequestItems(plain);
  const grandTotalCents = items.every(item => Number.isSafeInteger(item.totalPriceCents))
    ? items.reduce((sum, item) => sum + item.totalPriceCents, 0)
    : null;
  return {
    ...plain,
    items,
    itemCount: items.length,
    firstItemName: items[0]?.requirement || items[0]?.partNumber || items[0]?.brand || '',
    grandTotalCents,
    pendingAgeDays: plain?.status === 'Pending'
      ? Math.max(0, Math.floor((Date.now() - created) / 86400000))
      : null
  };
};

function normalizeRequestItems(request = {}) {
  const source = Array.isArray(request.items) && request.items.length ? request.items : [{
    brand: request.brand,
    category: request.category,
    isBulk: request.isBulk,
    partNumber: request.partNumber,
    requirement: request.requirement,
    quantity: request.quantity,
    unitPriceCents: request.unitPriceCents,
    totalPriceCents: request.totalPriceCents
  }];
  return source.map((item, index) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPriceCents = Number.isSafeInteger(item.unitPriceCents) ? item.unitPriceCents : null;
    return {
      ...(item?._id ? { _id: item._id } : { legacyIndex: index }),
      brand: String(item.brand || '').trim(),
      category: item.category,
      isBulk: Boolean(item.isBulk),
      partNumber: String(item.partNumber || '').trim(),
      requirement: String(item.requirement || '').trim(),
      quantity,
      unitPriceCents,
      totalPriceCents: unitPriceCents === null ? null : unitPriceCents * quantity
    };
  });
}

const validateRequestItems = body => {
  const source = Array.isArray(body.items) ? body.items : [body];
  if (source.length < 1 || source.length > 50) return { error: 'Add between 1 and 50 items.' };
  const items = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const brand = String(item.brand || '').trim();
    const requirement = String(item.requirement || '').trim();
    const quantity = Number(item.quantity || 1);
    if (!brand) return { error: `Item ${index + 1}: Brand is required.` };
    if (!requirement) return { error: `Item ${index + 1}: Product / requirement is required.` };
    if (!PRICE_REQUEST_CATEGORIES.includes(item.category)) return { error: `Item ${index + 1}: Select a valid category.` };
    if (!Number.isInteger(quantity) || quantity < 1) return { error: `Item ${index + 1}: Quantity must be a positive whole number.` };
    items.push({
      brand, category: item.category, isBulk: Boolean(item.isBulk),
      partNumber: String(item.partNumber || '').trim(), requirement, quantity,
      unitPriceCents: null, totalPriceCents: null
    });
  }
  return { items };
};

const getPriceRequests = async (req, res) => {
  try {
    const query = {};
    const { status, category, requestedFrom, requestedBy, search } = req.query;

    if (status && ['Pending', 'Priced', 'Declined'].includes(status)) query.status = status;
    if (category && PRICE_REQUEST_CATEGORIES.includes(category)) query.category = category;
    if (requestedFrom && mongoose.Types.ObjectId.isValid(requestedFrom)) query.requestedFrom = requestedFrom;
    if (requestedBy && mongoose.Types.ObjectId.isValid(requestedBy)) query.requestedBy = requestedBy;
    if (search && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), 'i');
      query.$or = [
        { requestNumber: regex },
        { requirement: regex },
        { brand: regex },
        { customerName: regex },
        { reference: regex },
        { partNumber: regex },
        { 'items.requirement': regex },
        { 'items.brand': regex },
        { 'items.partNumber': regex }
      ];
    }

    const [requests, pending] = await Promise.all([
      populateRequest(PriceRequest.find(query).sort({ createdAt: -1 })).lean(),
      PriceRequest.find({ status: 'Pending' })
        .select('requestedFrom category')
        .populate('requestedFrom', 'fullName email role')
        .lean()
    ]);

    const pendingByPersonMap = new Map();
    const pendingByCategoryMap = new Map();
    pending.forEach((item) => {
      const person = item.requestedFrom;
      if (person?._id) {
        const key = String(person._id);
        const current = pendingByPersonMap.get(key) || { user: person, count: 0 };
        current.count += 1;
        pendingByPersonMap.set(key, current);
      }
      pendingByCategoryMap.set(item.category, (pendingByCategoryMap.get(item.category) || 0) + 1);
    });

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests.map(serializeRequest),
      summary: {
        pending: pending.length,
        pendingByPerson: Array.from(pendingByPersonMap.values()).sort((a, b) => b.count - a.count),
        pendingByCategory: Array.from(pendingByCategoryMap, ([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      }
    });
  } catch (error) {
    console.error('[Get Price Requests Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving price requests.' });
  }
};

const createPriceRequest = async (req, res) => {
  try {
    const {
      requestedFrom,
      leadSource,
      leadSourceNote,
      customerName,
      reference,
      pendingNote
    } = req.body;
    const validatedItems = validateRequestItems(req.body);
    if (validatedItems.error) return res.status(400).json({ success: false, message: validatedItems.error });
    const requestItems = validatedItems.items;
    const firstItem = requestItems[0];
    if (!PRICE_REQUEST_LEAD_SOURCES.includes(leadSource)) {
      return res.status(400).json({ success: false, message: 'Select a valid lead source.' });
    }
    const normalizedLeadSourceNote = String(leadSourceNote || '').trim();
    if (normalizedLeadSourceNote.length > 200) {
      return res.status(400).json({ success: false, message: 'Lead source note cannot exceed 200 characters.' });
    }
    const recipient = await findEligibleUser(requestedFrom);
    if (!recipient) {
      return res.status(400).json({ success: false, message: 'Select an active Price Requests user.' });
    }

    const requestNumber = await allocateRequestNumber();
    const note = String(pendingNote || '').trim() || `Awaiting price from ${recipient.fullName}.`;
    const priceRequest = await PriceRequest.create({
      requestNumber,
      requestedBy: req.user._id,
      requestedFrom: recipient._id,
      brand: firstItem.brand,
      category: firstItem.category,
      isBulk: firstItem.isBulk,
      leadSource,
      leadSourceNote: leadSource === 'Other' ? normalizedLeadSourceNote : '',
      customerName: String(customerName || '').trim(),
      reference: String(reference || '').trim(),
      partNumber: firstItem.partNumber,
      requirement: firstItem.requirement,
      quantity: firstItem.quantity,
      items: requestItems,
      pendingNote: note,
      events: [{
        action: 'Created',
        actor: req.user._id,
        toUser: recipient._id,
        note
      }]
    });

    await createNotificationHelper({
      recipient: recipient._id,
      sender: req.user._id,
      title: `Price request ${requestNumber}`,
      message: `${req.user.fullName} requested prices for ${requestItems.length} item${requestItems.length === 1 ? '' : 's'}: ${requestItems.map(item => item.requirement).join(', ')}.`,
      type: 'system',
      link: 'price_requests'
    });

    const populated = await populateRequest(PriceRequest.findById(priceRequest._id));
    return res.status(201).json({ success: true, message: 'Price request created.', data: serializeRequest(populated) });
  } catch (error) {
    console.error('[Create Price Request Error]:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Server error creating price request.'
    });
  }
};

const explainPendingMutationFailure = async (res, requestId, userId, recipientOnly = false) => {
  const existing = mongoose.Types.ObjectId.isValid(requestId) ? await PriceRequest.findById(requestId).lean() : null;
  if (!existing) return res.status(404).json({ success: false, message: 'Price request not found.' });
  if (existing.status !== 'Pending') {
    return res.status(409).json({ success: false, message: `This request is already ${existing.status.toLowerCase()}.` });
  }
  if (recipientOnly && String(existing.requestedFrom) !== String(userId)) {
    return res.status(403).json({ success: false, message: 'Only the current recipient can complete this action.' });
  }
  return res.status(409).json({ success: false, message: 'The request changed while you were working. Refresh and try again.' });
};

const priceRequest = async (req, res) => {
  try {
    const currency = String(req.body.currency || '').toUpperCase();
    if (!PRICE_REQUEST_CURRENCIES.includes(currency)) {
      return res.status(400).json({ success: false, message: 'Select a supported currency.' });
    }

    const validityDate = req.body.validityDate ? new Date(req.body.validityDate) : null;
    if (validityDate && Number.isNaN(validityDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Validity date is invalid.' });
    }

    const existing = mongoose.Types.ObjectId.isValid(req.params.id)
      ? await PriceRequest.findOne({ _id: req.params.id, status: 'Pending', requestedFrom: req.user._id })
      : null;
    if (!existing) return explainPendingMutationFailure(res, req.params.id, req.user._id, true);
    const currentItems = normalizeRequestItems(existing);
    const submitted = Array.isArray(req.body.items)
      ? req.body.items
      : [{ unitPriceCents: req.body.unitPriceCents }];
    if (submitted.length !== currentItems.length) {
      return res.status(400).json({ success: false, message: 'Provide a unit price for every requested item.' });
    }
    const pricedItems = currentItems.map((item, index) => {
      const supplied = submitted[index] || {};
      const unitPriceCents = Number(supplied.unitPriceCents);
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || !Number.isSafeInteger(unitPriceCents * item.quantity)) return null;
      return {
        brand: item.brand, category: item.category, isBulk: item.isBulk,
        partNumber: item.partNumber, requirement: item.requirement, quantity: item.quantity,
        unitPriceCents, totalPriceCents: unitPriceCents * item.quantity
      };
    });
    if (pricedItems.some(item => !item)) {
      return res.status(400).json({ success: false, message: 'Every item requires a valid unit price in integer cents.' });
    }
    const grandTotalCents = pricedItems.reduce((sum, item) => sum + item.totalPriceCents, 0);
    if (!Number.isSafeInteger(grandTotalCents)) return res.status(400).json({ success: false, message: 'The Price Request grand total is too large.' });
    const first = pricedItems[0];
    const priceSummary = pricedItems.map(item => `${item.requirement}: Unit Price ${currency} ${(item.unitPriceCents / 100).toFixed(2)}, Quantity ${item.quantity}, Total Price ${currency} ${(item.totalPriceCents / 100).toFixed(2)}`).join('; ');

    const updated = await PriceRequest.findOneAndUpdate(
      { _id: existing._id, status: 'Pending', requestedFrom: req.user._id },
      {
        $set: {
          status: 'Priced',
          items: pricedItems,
          unitPriceCents: first.unitPriceCents,
          totalPriceCents: first.totalPriceCents,
          grandTotalCents,
          currency,
          validityDate,
          leadTime: String(req.body.leadTime || '').trim(),
          notes: String(req.body.notes || '').trim(),
          pendingNote: ''
        },
        $push: {
          events: {
            action: 'Priced',
            actor: req.user._id,
            note: priceSummary
          }
        }
      },
      { new: true, runValidators: true }
    );
    if (!updated) return explainPendingMutationFailure(res, req.params.id, req.user._id, true);

    await createNotificationHelper({
      recipient: updated.requestedBy,
      sender: req.user._id,
      title: `${updated.requestNumber} priced`,
      message: `${req.user.fullName} priced ${pricedItems.length} item${pricedItems.length === 1 ? '' : 's'}. ${priceSummary}. Grand Total ${currency} ${(grandTotalCents / 100).toFixed(2)}.`,
      type: 'system',
      link: 'price_requests'
    });

    const populated = await populateRequest(PriceRequest.findById(updated._id));
    return res.status(200).json({ success: true, message: 'Price submitted.', data: serializeRequest(populated) });
  } catch (error) {
    console.error('[Price Request Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting price.' });
  }
};

const declinePriceRequest = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'A decline reason is required.' });

    const updated = await PriceRequest.findOneAndUpdate(
      { _id: req.params.id, status: 'Pending', requestedFrom: req.user._id },
      {
        $set: { status: 'Declined', declineReason: reason, pendingNote: '' },
        $push: { events: { action: 'Declined', actor: req.user._id, note: reason } }
      },
      { new: true, runValidators: true }
    );
    if (!updated) return explainPendingMutationFailure(res, req.params.id, req.user._id, true);

    await createNotificationHelper({
      recipient: updated.requestedBy,
      sender: req.user._id,
      title: `${updated.requestNumber} declined`,
      message: `${req.user.fullName} cannot price this request: ${reason}`,
      type: 'system',
      link: 'price_requests'
    });

    const populated = await populateRequest(PriceRequest.findById(updated._id));
    return res.status(200).json({ success: true, message: 'Price request declined.', data: serializeRequest(populated) });
  } catch (error) {
    console.error('[Decline Price Request Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error declining price request.' });
  }
};

const reassignPriceRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Price request not found.' });
    }
    const existing = await PriceRequest.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Price request not found.' });
    if (existing.status !== 'Pending') {
      return res.status(409).json({ success: false, message: 'Only pending requests can be reassigned.' });
    }
    const permitted = isAdminOrCeo(req.user)
      || String(existing.requestedBy) === String(req.user._id)
      || String(existing.requestedFrom) === String(req.user._id);
    if (!permitted) {
      return res.status(403).json({ success: false, message: 'Only the requester, current recipient, Admin, or CEO can reassign.' });
    }

    const recipient = await findEligibleUser(req.body.requestedFrom);
    if (!recipient) return res.status(400).json({ success: false, message: 'Select an active Price Requests user.' });
    const note = String(req.body.pendingNote || '').trim() || `Reassigned to ${recipient.fullName}; awaiting price.`;
    const previousRecipient = existing.requestedFrom;

    const updated = await PriceRequest.findOneAndUpdate(
      { _id: existing._id, status: 'Pending', requestedFrom: previousRecipient },
      {
        $set: { requestedFrom: recipient._id, pendingNote: note },
        $push: {
          events: {
            action: 'Reassigned',
            actor: req.user._id,
            fromUser: previousRecipient,
            toUser: recipient._id,
            note
          }
        }
      },
      { new: true, runValidators: true }
    );
    if (!updated) return explainPendingMutationFailure(res, req.params.id, req.user._id, false);

    await createNotificationHelper({
      recipient: recipient._id,
      sender: req.user._id,
      title: `${updated.requestNumber} assigned to you`,
      message: note,
      type: 'system',
      link: 'price_requests'
    });

    const populated = await populateRequest(PriceRequest.findById(updated._id));
    return res.status(200).json({ success: true, message: 'Price request reassigned.', data: serializeRequest(populated) });
  } catch (error) {
    console.error('[Reassign Price Request Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error reassigning price request.' });
  }
};

const updatePendingNote = async (req, res) => {
  try {
    const note = String(req.body.pendingNote || '').trim();
    if (!note) return res.status(400).json({ success: false, message: 'Pending note is required.' });
    const existing = mongoose.Types.ObjectId.isValid(req.params.id) ? await PriceRequest.findById(req.params.id) : null;
    if (!existing) return res.status(404).json({ success: false, message: 'Price request not found.' });
    if (existing.status !== 'Pending') return res.status(409).json({ success: false, message: 'Only pending requests have a pending note.' });
    const permitted = isAdminOrCeo(req.user)
      || String(existing.requestedBy) === String(req.user._id)
      || String(existing.requestedFrom) === String(req.user._id);
    if (!permitted) return res.status(403).json({ success: false, message: 'You cannot update this pending note.' });

    const updated = await PriceRequest.findOneAndUpdate(
      { _id: existing._id, status: 'Pending' },
      {
        $set: { pendingNote: note },
        $push: { events: { action: 'Pending note updated', actor: req.user._id, note } }
      },
      { new: true, runValidators: true }
    );
    if (!updated) return explainPendingMutationFailure(res, req.params.id, req.user._id, false);
    const populated = await populateRequest(PriceRequest.findById(updated._id));
    return res.status(200).json({ success: true, message: 'Pending note updated.', data: serializeRequest(populated) });
  } catch (error) {
    console.error('[Update Price Request Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating pending note.' });
  }
};

const getAvailableQuotations = async (req, res) => {
  try {
    const query = {};
    if (!isAdminOrCeo(req.user)) query.createdBy = req.user._id;
    if (req.query.search && req.query.search.trim()) {
      const regex = new RegExp(escapeRegex(req.query.search.trim()), 'i');
      query.$or = [{ orderReference: regex }, { quotationNumber: regex }, { clientName: regex }];
    }
    const quotations = await Quotation.find(query)
      .select('orderReference quotationNumber clientName createdBy creationDate')
      .sort({ creationDate: -1, createdAt: -1 })
      .limit(30)
      .lean();
    return res.status(200).json({ success: true, count: quotations.length, data: quotations });
  } catch (error) {
    console.error('[Get Linkable Quotations Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving quotations.' });
  }
};

const linkQuotation = async (req, res) => {
  try {
    const existing = mongoose.Types.ObjectId.isValid(req.params.id) ? await PriceRequest.findById(req.params.id) : null;
    if (!existing) return res.status(404).json({ success: false, message: 'Price request not found.' });
    if (existing.status !== 'Priced') return res.status(409).json({ success: false, message: 'Only priced requests can be linked.' });
    if (String(existing.requestedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only the requester can link a quotation.' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.body.quotationId)) {
      return res.status(400).json({ success: false, message: 'Select a valid quotation.' });
    }
    const quotationQuery = { _id: req.body.quotationId };
    if (!isAdminOrCeo(req.user)) quotationQuery.createdBy = req.user._id;
    const quotation = await Quotation.findOne(quotationQuery).select('orderReference quotationNumber clientName');
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found or not available to you.' });

    existing.quotationId = quotation._id;
    existing.events.push({
      action: 'Quotation linked',
      actor: req.user._id,
      note: quotation.orderReference || quotation.quotationNumber || 'Quotation'
    });
    await existing.save();
    const populated = await populateRequest(PriceRequest.findById(existing._id));
    return res.status(200).json({ success: true, message: 'Quotation linked.', data: serializeRequest(populated) });
  } catch (error) {
    console.error('[Link Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error linking quotation.' });
  }
};

const getRoutingSuggestion = async (req, res) => {
  try {
    let items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items && req.query.items) {
      try { items = JSON.parse(String(req.query.items)); } catch { items = null; }
    }
    if (!Array.isArray(items) || !items.length) items = [{
      category: String(req.query.category || ''),
      brand: String(req.query.brand || ''),
      isBulk: String(req.query.isBulk || '').toLowerCase() === 'true'
    }];
    const rules = await PriceRequestRoutingRule.find({ active: true })
      .populate('assignee', 'fullName role priceRequestLabel')
      .sort({ priority: -1 });
    const matches = items.map(item => {
      const category = String(item.category || '');
      const brand = String(item.brand || '');
      const isBulk = Boolean(item.isBulk);
      const ruleType = category === 'Servers'
        ? 'category'
        : (isBulk && category === 'Desktops/Laptops/Workstations' ? 'bulkCategory' : 'brand');
      const matchValue = ruleType === 'brand' ? brand : category;
      return rules.find(rule => rule.ruleType === ruleType && rule.normalizedMatchValues.includes(normalizeValue(matchValue))) || null;
    });
    if (matches.some(rule => !rule?.assignee || !isFeatureUser(rule.assignee))) {
      return res.status(200).json({ success: true, data: null });
    }
    const assigneeIds = new Set(matches.map(rule => String(rule.assignee._id)));
    if (assigneeIds.size !== 1) return res.status(200).json({ success: true, data: null });
    return res.status(200).json({ success: true, data: { rule: matches[0], assignee: matches[0].assignee, matchedItems: items.length } });
  } catch (error) {
    console.error('[Routing Suggestion Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error resolving routing suggestion.' });
  }
};

const getRoutingRules = async (req, res) => {
  try {
    const rules = await PriceRequestRoutingRule.find()
      .populate('assignee', 'fullName role priceRequestLabel')
      .populate('updatedBy', 'fullName email role')
      .sort({ priority: -1, label: 1 });
    return res.status(200).json({ success: true, count: rules.length, data: rules });
  } catch (error) {
    console.error('[Get Routing Rules Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving routing rules.' });
  }
};

const validateRoutingRuleInput = async (body, editingId = null) => {
  const ruleType = String(body.ruleType || '');
  if (!ROUTING_RULE_TYPES.includes(ruleType)) return { error: 'Select a valid rule type.' };
  const label = String(body.label || '').trim();
  if (!label) return { error: 'Rule label is required.' };
  const matchValues = Array.from(new Set((Array.isArray(body.matchValues) ? body.matchValues : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
  if (matchValues.length === 0) return { error: 'Select at least one match value.' };

  if (ruleType === 'category' && (matchValues.length !== 1 || matchValues[0] !== 'Servers')) {
    return { error: 'The category override must match Servers.' };
  }
  if (ruleType === 'bulkCategory' && (matchValues.length !== 1 || matchValues[0] !== 'Desktops/Laptops/Workstations')) {
    return { error: 'The bulk override must match Desktops/Laptops/Workstations.' };
  }
  if (ruleType === 'brand' && matchValues.some((value) => !KNOWN_BRANDS.includes(value))) {
    return { error: 'Select supported brand values.' };
  }

  const assignee = await findEligibleUser(body.assignee);
  if (!assignee) return { error: 'Select an active Price Requests user.' };
  const normalizedMatchValues = matchValues.map(normalizeValue);
  if (body.active !== false) {
    const overlapQuery = {
      ruleType,
      active: true,
      normalizedMatchValues: { $in: normalizedMatchValues }
    };
    if (editingId) overlapQuery._id = { $ne: editingId };
    if (await PriceRequestRoutingRule.exists(overlapQuery)) {
      return { error: 'An active routing rule already covers one of these values.' };
    }
  }
  return {
    value: {
      label,
      ruleType,
      matchValues,
      normalizedMatchValues,
      assignee: assignee._id,
      active: body.active !== false,
      priority: ROUTING_PRIORITIES[ruleType]
    }
  };
};

const createRoutingRule = async (req, res) => {
  try {
    const validated = await validateRoutingRuleInput(req.body);
    if (validated.error) return res.status(400).json({ success: false, message: validated.error });
    const rule = await PriceRequestRoutingRule.create({
      ...validated.value,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });
    await rule.populate('assignee', 'fullName role priceRequestLabel');
    return res.status(201).json({ success: true, message: 'Routing rule created.', data: rule });
  } catch (error) {
    console.error('[Create Routing Rule Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating routing rule.' });
  }
};

const updateRoutingRule = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Routing rule not found.' });
    }
    const existing = await PriceRequestRoutingRule.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Routing rule not found.' });
    const merged = {
      label: req.body.label ?? existing.label,
      ruleType: req.body.ruleType ?? existing.ruleType,
      matchValues: req.body.matchValues ?? existing.matchValues,
      assignee: req.body.assignee ?? existing.assignee,
      active: req.body.active ?? existing.active
    };
    const validated = await validateRoutingRuleInput(merged, existing._id);
    if (validated.error) return res.status(400).json({ success: false, message: validated.error });
    Object.assign(existing, validated.value, { updatedBy: req.user._id });
    await existing.save();
    await existing.populate('assignee', 'fullName role priceRequestLabel');
    return res.status(200).json({ success: true, message: 'Routing rule updated.', data: existing });
  } catch (error) {
    console.error('[Update Routing Rule Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating routing rule.' });
  }
};

const deleteRoutingRule = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Routing rule not found.' });
    }
    const existing = await PriceRequestRoutingRule.findById(req.params.id).select('active');
    if (!existing) return res.status(404).json({ success: false, message: 'Routing rule not found.' });
    if (existing.active) {
      return res.status(409).json({ success: false, message: 'Deactivate the routing rule before deleting it.' });
    }
    const deleted = await PriceRequestRoutingRule.deleteOne({ _id: existing._id, active: false });
    if (deleted.deletedCount !== 1) {
      return res.status(409).json({ success: false, message: 'The routing rule changed. Refresh and try again.' });
    }
    return res.status(200).json({ success: true, message: 'Routing rule deleted.' });
  } catch (error) {
    console.error('[Delete Routing Rule Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting routing rule.' });
  }
};

module.exports = {
  PRICE_REQUEST_ROLES,
  getLabelledUsers,
  allocateRequestNumber,
  getPriceRequests,
  createPriceRequest,
  priceRequest,
  declinePriceRequest,
  reassignPriceRequest,
  updatePendingNote,
  getAvailableQuotations,
  linkQuotation,
  getRoutingSuggestion,
  getRoutingRules,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule
};
