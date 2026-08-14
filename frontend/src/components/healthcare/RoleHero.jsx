import { Activity, ClipboardList, Microscope, PackageCheck, Stethoscope, UserRoundCheck } from 'lucide-react';
import HealthcareIllustration from './HealthcareIllustration';

const icons={reception:UserRoundCheck,doctor:Stethoscope,laboratory:Microscope,pharmacy:PackageCheck,admin:Activity};
const copy={
  reception:{en:['Reception Workspace','Coordinate appointments, patient check-in, queue flow, and billing.'],ar:['مساحة عمل الاستقبال','تنسيق المواعيد وتسجيل وصول المرضى والطابور والفوترة.']},
  doctor:{en:['Clinical Workspace','Review today’s patients and document care in one focused workspace.'],ar:['مساحة العمل السريرية','راجع مرضى اليوم ووثّق الرعاية في مساحة عمل مركزة.']},
  laboratory:{en:['Laboratory Workspace','Process diagnostic orders and record each result independently.'],ar:['مساحة عمل المختبر','معالجة طلبات التشخيص وتسجيل كل نتيجة بشكل مستقل.']},
  pharmacy:{en:['Pharmacy Workspace','Review prescriptions, FEFO batches, and safe dispensing.'],ar:['مساحة عمل الصيدلية','مراجعة الوصفات ودفعات الصرف حسب الأسبق انتهاءً.']},
  admin:{en:['Healthcare Operations','Manage clinic access, real activity, analytics, and audit controls.'],ar:['عمليات الرعاية الصحية','إدارة الوصول ونشاط العيادة والتحليلات وسجلات التدقيق.']}
};
export default function RoleHero({role,lang='en'}){const Icon=icons[role]||ClipboardList;const [title,description]=copy[role]?.[lang]||copy[role]?.en||[];return <section className="role-hero"><div><span className="role-hero__eyebrow"><Icon size={16}/>{title}</span><h2>{title}</h2><p>{description}</p></div><HealthcareIllustration variant={role}/></section>}
