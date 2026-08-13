export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const todayString = () => new Date().toISOString().slice(0, 10);

export function configuredSlots(doctor, date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return [];
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parsed.getDay()];
  const schedule = JSON.parse(doctor.weeklySchedule || '[]');
  const config = schedule.find((item) => item.day?.toLowerCase() === dayName.toLowerCase());
  if (!config || !Number.isInteger(config.slotDurationInMinutes) || config.slotDurationInMinutes <= 0) return [];
  const slots = [];
  let current = new Date(`${date}T${config.startTime}:00`);
  const end = new Date(`${date}T${config.endTime}:00`);
  while (current < end) {
    slots.push(current.toTimeString().slice(0, 5));
    current = new Date(current.getTime() + config.slotDurationInMinutes * 60000);
  }
  return slots;
}
