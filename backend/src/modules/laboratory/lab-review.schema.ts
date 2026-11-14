import { z } from 'zod';

export const LAB_REVIEW_DECISIONS = ['LINK_EXISTING', 'CREATE_SERVICE', 'EXTERNAL'] as const;
export type LabReviewDecision = (typeof LAB_REVIEW_DECISIONS)[number];

export const isLabReviewDecision = (value: string): value is LabReviewDecision =>
  (LAB_REVIEW_DECISIONS as readonly string[]).includes(value);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Same coercions as the Express route (src/routes/records.js). */
function normalizeLabReviewBody(raw: unknown) {
  const body = isPlainObject(raw) ? raw : {};
  return {
    decision: typeof body.decision === 'string' ? body.decision.trim().toUpperCase() : '',
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    serviceId: typeof body.serviceId === 'string' ? body.serviceId.trim() : '',
    service: isPlainObject(body.service) ? body.service : {},
  };
}

/**
 * POST /api/records/lab-order-items/:id/review body.
 *
 * This schema only normalizes and never rejects: the Express route
 * (src/routes/records.js) answers bad input with domain-specific codes
 * (LAB_REVIEW_DECISION_INVALID, LAB_SERVICE_ID_REQUIRED,
 * LAB_SERVICE_LABELS_REQUIRED, LAB_PRICE_ADMIN_REQUIRED) that the frontend
 * relies on, so those checks stay in LaboratoryService rather than becoming a
 * generic VALIDATION_ERROR.
 */
export const labReviewSchema = z.preprocess(
  normalizeLabReviewBody,
  z.object({
    decision: z.string(),
    note: z.string().nullable(),
    serviceId: z.string(),
    // Loose record: LaboratoryService checks labelEn/labelAr and rejects
    // client-supplied baseFeeSdg/baseFeeUsd keys with LAB_PRICE_ADMIN_REQUIRED.
    service: z.record(z.string(), z.unknown()),
  }),
);

export type LabReviewInput = z.output<typeof labReviewSchema>;
