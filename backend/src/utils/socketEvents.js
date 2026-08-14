const STAFF_QUEUE_ROLES = ['ADMIN', 'RECEPTIONIST'];

export function emitQueueUpdate(io, payload, doctorIds = []) {
  if (!io) return;

  let target = io;
  for (const role of STAFF_QUEUE_ROLES) target = target.to(`role_${role}`);
  for (const doctorId of new Set(doctorIds.filter(Boolean))) target = target.to(`doctor_${doctorId}`);
  target.emit('queueUpdated', payload);
}
