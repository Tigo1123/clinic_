import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { validatePeriods } from '../src/services/doctorSchedulingAdmin.js';
import { generateScheduleSlots } from '../src/utils/scheduling.js';
import { clinicAppointmentToInstant, getClinicDateString } from '../src/utils/clinicTime.js';
const period = (startTime, endTime, slotDurationMinutes = 30) => ({ dayOfWeek: 'MONDAY', startTime, endTime, slotDurationMinutes });
for (const [start,end,count] of [['09:00','17:00',16],['08:00','14:00',12],['14:00','20:00',12]]) {
 test(`${start} to ${end} validates and generates same-day slots`, () => {
  const p=period(start,end); assert.doesNotThrow(()=>validatePeriods([p]));
  const slots=generateScheduleSlots([p],'2190-01-04');
  assert.equal(slots.length,count);assert.equal(slots[0],start);assert.ok(slots.every(time=>time>=start&&time<end));assert.equal(new Set(slots).size,slots.length);
 });
}
test('specific validation codes distinguish equal, overnight, invalid time and duration',()=>{
 for(const [p,code] of [[period('09:00','09:00'),'SCHEDULE_TIME_ORDER'],[period('17:00','09:00'),'SCHEDULE_OVERNIGHT_UNSUPPORTED'],[period('22:00','08:00'),'SCHEDULE_OVERNIGHT_UNSUPPORTED'],[period('09:00','10:00',61),'SCHEDULE_INVALID_DURATION'],[period('09:00 AM','05:00 PM'),'SCHEDULE_INVALID_TIME'],[period('24:00','23:00'),'SCHEDULE_INVALID_TIME']]) {
  assert.throws(()=>validatePeriods([p]),error=>error.code===code&&error.status===422);
  assert.throws(()=>validatePeriods([p],true),error=>error.code===code);
 }
 assert.throws(()=>validatePeriods([{...period('22:00','08:00'),active:false}]),error=>error.code==='SCHEDULE_OVERNIGHT_UNSUPPORTED');
});
test('overnight periods never generate misleading slots on either date',()=>{
 for(const date of ['2190-01-04','2190-01-05']) assert.deepEqual(generateScheduleSlots([period('22:00','08:00')],date),[]);
});
test('clinic midnight and UTC date rollover retain wall-clock slot keys and breaks',()=>{
 const date='2190-01-04';
 const p={...period('00:00','02:00'),breaks:[{startTime:'00:30',endTime:'01:00'}]};
 assert.deepEqual(generateScheduleSlots([p],date),['00:00','01:00','01:30']);
 const instant=clinicAppointmentToInstant(date,'00:00');
 assert.equal(getClinicDateString(instant),date);
 assert.equal(DateTime.fromJSDate(instant).setZone('Africa/Khartoum').toFormat('HH:mm'),'00:00');
 assert.equal(instant.toISOString().slice(0,10),'2190-01-03');
});
