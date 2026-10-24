import { z } from 'zod';
import prisma from '../db.js';
import { ApiError } from '../utils/apiError.js';
import { REFERENCE_BOOTSTRAP_STATES } from './referenceBootstrap.js';

const stateIds = REFERENCE_BOOTSTRAP_STATES.map(state => state.id);
export const registrationAddressStateSchema = z.union([
  z.number().int().min(1).max(18),
  z.string().regex(/^(?:[1-9]|1[0-8])$/).transform(Number)
]);
export async function registrationAddressStates(client = prisma) {
  const states = await client.state.findMany({ where: { id: { in: stateIds } }, select: { id: true, labelAr: true, labelEn: true }, orderBy: { id: 'asc' } });
  return { states, complete: states.length === stateIds.length, expectedCount: stateIds.length };
}

// Both registration flows and finalization resolve only canonical numeric IDs.
// Labels are display data; phone-country selection is independent of residence.
export async function resolveAddressStateId(tx, value) {
  const id = value ?? Number(process.env.DEFAULT_STATE_ID || 1);
  if (!Number.isInteger(id) || !stateIds.includes(id)) throw new ApiError(422, 'ADDRESS_STATE_INVALID', 'Choose a valid Sudanese state ID.', [{ field: 'addressStateId' }]);
  const state = await tx.state.findUnique({ where: { id }, select: { id: true } });
  if (!state) throw new ApiError(422, 'ADDRESS_STATE_NOT_FOUND', 'The selected state is missing from the clinic address reference data.', [{ field: 'addressStateId', id }]);
  // Keep a concurrent reference-data deletion from turning a validated selection
  // into a raw foreign-key failure during Patient creation in this transaction.
  const rows = await tx.$queryRaw`SELECT "id" FROM "State" WHERE "id" = ${id} FOR KEY SHARE`;
  if (!rows.length) throw new ApiError(422, 'ADDRESS_SELECTION_STALE', 'Address data changed. Select your state again.', [{ field: 'addressStateId' }]);
  return state.id;
}
