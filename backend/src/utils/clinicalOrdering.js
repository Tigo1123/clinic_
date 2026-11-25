import { ApiError } from './apiError.js';

/**
 * Shared Phase 3 domain rules for doctor clinical ordering and reception billing.
 * Used identically by Express routes and NestJS services to keep parity exact.
 */

export const BILLABLE_NON_LAB_CATEGORIES = Object.freeze([
  'CLINICAL_PROCEDURE',
  'RADIOLOGY'
]);

export const MAX_SERVICE_ORDER_ITEMS = 50;
export const MAX_SERVICE_ORDER_QUANTITY = 20;

export function createDomainError(status, code, message) {
  return new ApiError(status, code, message);
}

/**
 * Rejects free-text laboratory orders on new clinical submissions while
 * preserving existing custom test rows for historical read and lab review flows.
 */
export function assertNoNewCustomTests(customTests) {
  if (Array.isArray(customTests) && customTests.length > 0) {
    throw createDomainError(
      422,
      'CUSTOM_LAB_TESTS_NOT_ALLOWED',
      'New laboratory orders must use the clinic service catalogue.'
    );
  }
}

/**
 * Aggregates duplicate service IDs in a doctor's non-lab service order submission
 * so each ClinicalService appears at most once per ServiceOrder with summed quantity.
 */
export function normalizeDoctorServiceOrders(serviceOrders = []) {
  if (!Array.isArray(serviceOrders) || serviceOrders.length === 0) {
    return [];
  }
  const byServiceId = new Map();
  for (const entry of serviceOrders) {
    const quantity = entry.quantity == null ? 1 : Number(entry.quantity);
    const current = byServiceId.get(entry.serviceId) || 0;
    const nextQty = current + quantity;
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || nextQty > MAX_SERVICE_ORDER_QUANTITY) {
      throw createDomainError(
        422,
        'SERVICE_ORDER_QUANTITY_INVALID',
        `Service order quantity must be between 1 and ${MAX_SERVICE_ORDER_QUANTITY}.`
      );
    }
    byServiceId.set(entry.serviceId, nextQty);
  }
  return Array.from(byServiceId.entries()).map(([serviceId, quantity]) => ({
    serviceId,
    quantity
  }));
}

/**
 * Checks whether the caller is allowed to execute an ad-hoc GENERAL billing
 * action vs a doctor-ordered ServiceOrder, CONSULTATION, or LABORATORY action.
 * Admin paths remain preserved.
 */
export function assertBillingServiceSelectionAllowed(role, { invoiceType, serviceOrderId, items }) {
  if (serviceOrderId != null) {
    if (typeof serviceOrderId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(serviceOrderId)) {
      throw createDomainError(422, 'SERVICE_ORDER_ID_INVALID', 'Provide a valid clinical service order ID.');
    }
    if (invoiceType !== 'GENERAL' || (items != null && (!Array.isArray(items) || items.length > 0))) {
      throw createDomainError(422, 'SERVICE_ORDER_INVOICE_FIELDS_INVALID', 'Billing a clinical service order uses its ordered items.');
    }
  }
  if (role === 'RECEPTIONIST' && invoiceType === 'GENERAL' && !serviceOrderId) {
    throw createDomainError(
      403,
      'RECEPTION_SERVICE_SELECTION_FORBIDDEN',
      'Receptionists can bill a consultation, laboratory order or doctor-ordered clinical service.'
    );
  }
}
