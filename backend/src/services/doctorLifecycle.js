// Every lifecycle writer locks account before profile. Booking writers hold the
// profile lock and recheck eligibility before committing a new reservation.
export async function lockDoctorLifecycle(tx, doctorId) {
  const identity = await tx.doctor.findUnique({ where: { id: doctorId }, select: { userId: true } });
  if (!identity) return null;
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${identity.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Doctor" WHERE "id" = ${doctorId} FOR UPDATE`;
  return identity;
}

export async function synchronizeDoctorAccount(tx, userId, status) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (user && user.status !== status) {
    await tx.user.update({ where: { id: userId }, data: { status, authVersion: { increment: 1 } } });
  }
}
