const InventoryItem = require('../models/InventoryItem');

const reservationRemaining = (reservation) => {
  if (reservation?.remainingQuantity !== undefined && reservation?.remainingQuantity !== null) {
    return Math.max(0, Number(reservation.remainingQuantity) || 0);
  }
  return Math.max(
    0,
    (Number(reservation?.quantity) || 0) -
      (Number(reservation?.deliveredQuantity) || 0) -
      (Number(reservation?.releasedQuantity) || 0)
  );
};

const activeReservations = (order) => (order?.inventoryReservations || [])
  .filter((reservation) => (
    reservationRemaining(reservation) > 0 &&
    !['Fulfilled', 'Released'].includes(String(reservation?.status || ''))
  ));

const inventoryStatusStage = {
  $set: {
    status: {
      $let: {
        vars: {
          available: { $subtract: [{ $ifNull: ['$quantityOnHand', 0] }, { $ifNull: ['$reservedQuantity', 0] }] }
        },
        in: {
          $cond: [
            { $lte: ['$$available', 0] },
            'Out of Stock',
            { $cond: [{ $lte: ['$$available', { $ifNull: ['$minStockLevel', 5] }] }, 'Low Stock', 'In Stock'] }
          ]
        }
      }
    }
  }
};

const releaseOrderReservations = async ({ order, user, reason, session = null }) => {
  const reservations = activeReservations(order);
  if (!reservations.length) return 0;

  const byInventoryItem = new Map();
  reservations.forEach((reservation) => {
    const key = String(reservation.inventoryItem || '');
    if (!key) return;
    byInventoryItem.set(key, (byInventoryItem.get(key) || 0) + reservationRemaining(reservation));
  });

  for (const [inventoryItemId, quantity] of byInventoryItem.entries()) {
    const updated = await InventoryItem.findOneAndUpdate(
      { _id: inventoryItemId, reservedQuantity: { $gte: quantity } },
      [
        { $set: { reservedQuantity: { $subtract: [{ $ifNull: ['$reservedQuantity', 0] }, quantity] } } },
        inventoryStatusStage
      ],
      { new: true, session }
    );
    if (!updated) {
      const error = new Error(`Cannot release ${quantity} reserved units because the inventory reservation balance is inconsistent.`);
      error.statusCode = 409;
      throw error;
    }
  }

  const releasedAt = new Date();
  reservations.forEach((reservation) => {
    const quantity = reservationRemaining(reservation);
    reservation.remainingQuantity = 0;
    reservation.releasedQuantity = (Number(reservation.releasedQuantity) || 0) + quantity;
    reservation.status = 'Released';
    reservation.releasedAt = releasedAt;
    reservation.releaseReason = String(reason || 'Order reservation released.');
    reservation.releasedBy = user?._id || null;
    reservation.releasedByName = user?.fullName || '';
  });

  return reservations.reduce((sum, reservation) => sum + (Number(reservation.releasedQuantity) || 0), 0);
};

const releaseDeliveryNoteReservations = async ({ order, deliveryNoteId, user, reason, session = null }) => {
  const reservations = activeReservations(order).filter(
    reservation => reservation.deliveryNote && String(reservation.deliveryNote) === String(deliveryNoteId)
  );
  if (!reservations.length) return 0;

  const byInventoryItem = new Map();
  reservations.forEach((reservation) => {
    const key = String(reservation.inventoryItem || '');
    if (!key) return;
    byInventoryItem.set(key, (byInventoryItem.get(key) || 0) + reservationRemaining(reservation));
  });

  for (const [inventoryItemId, quantity] of byInventoryItem.entries()) {
    const updated = await InventoryItem.findOneAndUpdate(
      { _id: inventoryItemId, reservedQuantity: { $gte: quantity } },
      [
        { $set: { reservedQuantity: { $subtract: [{ $ifNull: ['$reservedQuantity', 0] }, quantity] } } },
        inventoryStatusStage
      ],
      { new: true, session }
    );
    if (!updated) {
      const error = new Error(`Cannot release ${quantity} reserved units because the inventory reservation balance is inconsistent.`);
      error.statusCode = 409;
      throw error;
    }
  }

  const releasedAt = new Date();
  let releasedTotal = 0;
  reservations.forEach((reservation) => {
    const quantity = reservationRemaining(reservation);
    releasedTotal += quantity;
    reservation.remainingQuantity = 0;
    reservation.releasedQuantity = (Number(reservation.releasedQuantity) || 0) + quantity;
    reservation.status = 'Released';
    reservation.releasedAt = releasedAt;
    reservation.releaseReason = String(reason || 'Delivery Note reservation released.');
    reservation.releasedBy = user?._id || null;
    reservation.releasedByName = user?.fullName || '';
  });
  return releasedTotal;
};

module.exports = {
  reservationRemaining,
  activeReservations,
  inventoryStatusStage,
  releaseOrderReservations,
  releaseDeliveryNoteReservations
};
