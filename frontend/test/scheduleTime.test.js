import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScheduleTime, schedulePeriodError, scheduleTimeMessage, formatScheduleTime } from '../src/features/admin/scheduleTime.js';
const period = (startTime, endTime, slotDurationMinutes = 30) => ({ startTime, endTime, slotDurationMinutes });
for (const [start, end] of [['09:00 AM', '05:00 PM'], ['08:00 AM','02:00 PM'], ['02:00 PM','08:00 PM']]) {
 test(`${start} to ${end} is valid`, () => assert.equal(schedulePeriodError(period(start,end)),null));
}
test('equal, reversed and overnight periods are explicitly rejected', () => {
 assert.equal(schedulePeriodError(period('09:00','09:00')), 'SCHEDULE_TIME_ORDER');
 for(const [start,end] of [['05:00 PM','09:00 AM'],['10:00 PM','08:00 AM']]) assert.equal(schedulePeriodError(period(start,end)), 'SCHEDULE_OVERNIGHT_UNSUPPORTED');
});
test('slot duration must fit and use positive whole minutes', () => {
 for(const duration of [61,0,-1,1.5,NaN]) assert.equal(schedulePeriodError(period('09:00','10:00',duration)), 'SCHEDULE_INVALID_DURATION');
 assert.equal(schedulePeriodError(period('09:00','10:00',60)),null);
});
test('AM/PM, noon, midnight, Arabic digits and native whole-minute seconds normalize without dates', () => {
 for(const [value,expected] of [[' 09:00 am ','09:00'],['05:00 PM','17:00'],['12:00 AM','00:00'],['12:00 PM','12:00'],['١٠:٠٠ م','22:00'],['٠٨:٠٠ ص','08:00'],['17:00','17:00'],['09:00:00','09:00'],['۰۹:۳۰','09:30']]) assert.equal(normalizeScheduleTime(value),expected);
 for(const value of ['',null,'24:00','00:00 PM','13:00 AM','09:00:01','09:60','tomorrow']) assert.equal(normalizeScheduleTime(value),null);
 assert.equal(schedulePeriodError(period('','17:00')), 'SCHEDULE_INVALID_TIME');
 assert.equal(formatScheduleTime('17:00','en'),'05:00 PM');
 assert.equal(formatScheduleTime('00:00','ar'),'12:00 ص');
});
test('Arabic and English explanations cover each error and translations can override fallbacks', () => {
 assert.equal(scheduleTimeMessage('SCHEDULE_TIME_ORDER','ar'),'يجب أن يكون وقت النهاية بعد وقت البداية في نفس اليوم.');
 assert.match(scheduleTimeMessage('SCHEDULE_OVERNIGHT_UNSUPPORTED','ar'),/بعد منتصف الليل غير مدعومة حالياً/);
 assert.match(scheduleTimeMessage('SCHEDULE_TIME_ORDER','en'),/same calendar day/);
 assert.match(scheduleTimeMessage('SCHEDULE_OVERNIGHT_UNSUPPORTED','en'),/Overnight schedules are not supported/);
 assert.equal(scheduleTimeMessage('SCHEDULE_INVALID_DURATION','ar',key=>key),'يجب أن تكون مدة الموعد عدداً صحيحاً من الدقائق، دقيقة واحدة على الأقل، وألا تتجاوز مدة فترة العمل.');
 assert.equal(scheduleTimeMessage('SCHEDULE_INVALID_TIME','en',()=> 'Translated'), 'Translated');
});
test('breaks stay inside the same day and may not overlap',()=> {
 const p=period('09:00','17:00');
 assert.equal(schedulePeriodError({...p,breaks:[{startTime:'12:00',endTime:'13:00'}]}),null);
 for(const br of [{startTime:'08:00',endTime:'10:00'},{startTime:'16:00',endTime:'10:00'}]) assert.equal(schedulePeriodError({...p,breaks:[br]}),'SCHEDULE_BREAK_OUTSIDE_PERIOD');
 assert.equal(schedulePeriodError({...p,breaks:[{startTime:'12:00',endTime:'13:00'},{startTime:'12:30',endTime:'14:00'}]}),'SCHEDULE_BREAK_OVERLAP');
});

test('registered Arabic and English translations match the validation messages',async()=>{
 const {default:i18n}=await import('../src/i18n.js');
 const {scheduleTimeMessages}=await import('../src/features/admin/scheduleTime.js');
 for(const lang of ['ar','en']) for(const [code,[key,message]] of Object.entries(scheduleTimeMessages[lang])) {
  assert.equal(i18n.getFixedT(lang)(key),message);
  assert.equal(scheduleTimeMessage(code,lang,i18n.getFixedT(lang)),message);
 }
});
