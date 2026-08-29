import { useCallback, useEffect, useState, useRef } from 'react';
import { Activity, CalendarDays, CheckCircle2, Clock3, FlaskConical, Lock, MessageCircle, Printer, RefreshCw, Search, Sliders, Stethoscope, User, Users } from 'lucide-react';
import { PatientProfileModal, PostVisitSummaryModal } from '../clinical/ClinicalModals';
import { getWhatsAppLink } from '../reception/clinicData';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import { staffSocket as socket } from '../../services/staffSocket';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';
import { staffApiRequest as apiRequest } from '../../services/apiClient';
import MedicineCombobox from './MedicineCombobox';
import { doctorPrescriptionItem, duplicatePrescriptionItem } from '../../utils/doctorPrescription';
import './doctorDashboard.css';

export default function DoctorDashboard({ user, lang, t }) {
  const [queue, setQueue] = useState([]);
  const [filterDate, setFilterDate] = useState(clinicDateString());
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [selectedAppointmentStatus, setSelectedAppointmentStatus] = useState('');

  // EMR Details
  const [historyData, setHistoryData] = useState([]);
  const [activeSummaryId, setActiveSummaryId] = useState(null);
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);

  // Lab-return / consultation finalization
  const [isFinalizingVisit, setIsFinalizingVisit] = useState(false);
  const isReadOnlyVisit = selectedAppointmentStatus === 'COMPLETED';
  const [currentRecordId, setCurrentRecordId] = useState(null);
  const [currentLabResults, setCurrentLabResults] = useState([]);
  const [historicalPrescriptions, setHistoricalPrescriptions] = useState([]);
  const [historicalLabOrders, setHistoricalLabOrders] = useState([]);

  // Consult records entry
  const [symptoms, setSymptoms] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatment, setTreatment] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [vitals, setVitals] = useState({ blood_pressure: '120/80', heart_rate: '75', temperature: '37.0', weight: '70' });

  // Prescription builder
  const [drugs, setDrugs] = useState([]);
  const [selectedDrug, setSelectedDrug] = useState('');
  const [customDrugName, setCustomDrugName] = useState('');
  const [dosage, setDosage] = useState('');
  const [duration, setDuration] = useState('');
  const [quantity, setQuantity] = useState('');
  const [instrAr, setInstrAr] = useState('');
  const [instrEn, setInstrEn] = useState('');
  const [prescribedItems, setPrescribedItems] = useState([]);
  const [medicineMode, setMedicineMode] = useState('official');
  const [editingPrescriptionIndex, setEditingPrescriptionIndex] = useState(-1);
  const [prescriptionMessage, setPrescriptionMessage] = useState('');

  // Lab services selectors
  const [clinicalServices, setClinicalServices] = useState([]);
  const [orderedTests, setOrderedTests] = useState([]);
  const [customTestName, setCustomTestName] = useState('');
  const [customTests, setCustomTests] = useState([]);
  const [labServiceSearch, setLabServiceSearch] = useState('');
  const [showCustomTestInput, setShowCustomTestInput] = useState(false);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Prevent duplicate consultation/finalize submissions.
  // The ref blocks even two clicks fired before React can re-render.
  const consultationSaveLock = useRef(false);
  const [isSavingConsultation, setIsSavingConsultation] = useState(false);

  // Diagnosis, Dosage and Vitals presets
  const commonDiagnoses = [
    { labelAr: "ضغط الدم", labelEn: "Hypertension (I10)", val: "Essential Hypertension (I10)" },
    { labelAr: "السكري", labelEn: "Type 2 Diabetes (E11)", val: "Type 2 Diabetes Mellitus (E11)" },
    { labelAr: "التهاب اللوزتين", labelEn: "Tonsillitis (J03)", val: "Acute Tonsillitis (J03)" },
    { labelAr: "النزلة المعوية", labelEn: "Gastroenteritis (A09)", val: "Gastroenteritis (A09)" },
    { labelAr: "الربو الشعبى", labelEn: "Asthma (J45)", val: "Bronchial Asthma (J45)" }
  ];

  const quickDosagePresets = ["1x3 daily", "1x2 daily", "1 daily", "500mg 1x3"];
  const quickDurationPresets = [
    { value: '3 Days', ar: '3 أيام', en: '3 Days' },
    { value: '5 Days', ar: '5 أيام', en: '5 Days' },
    { value: '7 Days', ar: '7 أيام', en: '7 Days' },
    { value: '10 Days', ar: '10 أيام', en: '10 Days' }
  ];

  const appointmentStatusLabels = {
    SCHEDULED: { ar: 'مجدول', en: 'Scheduled' },
    CONFIRMED: { ar: 'مؤكد', en: 'Confirmed' },
    CHECKED_IN: { ar: 'تم تسجيل الوصول', en: 'Checked In' },
    IN_CONSULTATION: { ar: 'قيد الكشف', en: 'In Consultation' },
    WAITING_LAB: { ar: 'بانتظار المختبر', en: 'Waiting for Lab' },
    COMPLETED: { ar: 'مكتمل', en: 'Completed' },
    CANCELLED: { ar: 'ملغي', en: 'Cancelled' },
    NO_SHOW: { ar: 'لم يحضر', en: 'No Show' }
  };

  const getAppointmentStatusLabel = (status) => {
    const labels = appointmentStatusLabels[status];

    if (!labels) {
      return status?.replaceAll('_', ' ') || '-';
    }

    return lang === 'ar' ? labels.ar : labels.en;
  };

  const getGenderLabel = (gender) => {
    const genderLabels = {
      MALE: { ar: 'ذكر', en: 'Male' },
      FEMALE: { ar: 'أنثى', en: 'Female' },
      OTHER: { ar: 'آخر', en: 'Other' }
    };

    const labels = genderLabels[gender];

    if (!labels) return gender || '-';

    return lang === 'ar' ? labels.ar : labels.en;
  };

  const handlePopulateNormalVitals = () => {
    setVitals({ blood_pressure: '120/80', heart_rate: '72', temperature: '36.8', weight: '70' });
  };

  const changeFilterDate = (offset) => {
    const nextDate = new Date(`${filterDate}T12:00:00`);
    nextDate.setDate(nextDate.getDate() + offset);
    setFilterDate(nextDate.toISOString().slice(0, 10));
  };

  const getPatientAge = (dateOfBirth) => {
    if (!dateOfBirth) return null;
    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const beforeBirthday = today.getMonth() < birthDate.getMonth()
      || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate());
    if (beforeBirthday) age -= 1;
    return age >= 0 ? age : null;
  };

  const fetchDoctorQueue = useCallback(() => {
    if (user.doctorId) {
      fetchWithAuth(`/api/appointments/queue/${user.doctorId}?date=${filterDate}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setQueue(data);
          } else {
            setQueue([]);
            console.error('Queue response is not an array:', data);
          }
        })
        .catch((err) => {
          console.error(err);
          setQueue([]);
        });
    }
  }, [user.doctorId, filterDate]);

  // Fetch queue on filterDate change
  useEffect(() => {
    fetchDoctorQueue();
  }, [fetchDoctorQueue]);

  useEffect(() => {
    const handleQueueUpdate = (data) => {
      if (!data || !data.doctorId || data.doctorId === user.doctorId || data.targetDoctorId === user.doctorId) {
        fetchDoctorQueue();
      }
    };

    socket.on('queueUpdated', handleQueueUpdate);
    return () => {
      socket.off('queueUpdated', handleQueueUpdate);
    };
  }, [fetchDoctorQueue, user.doctorId]);

  // Fetch lists on load
  useEffect(() => {
    fetchWithAuth('/api/records/drugs')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setDrugs(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setDrugs([]);
      });

    apiRequest('/api/billing/services')
      .then((data) => setClinicalServices(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setClinicalServices([]);
      });
  }, []);

  const fetchPatientHistory = (patientId) => {
    fetchWithAuth(`/api/patients/${patientId}/history`)
      .then((res) => res.ok ? res.json() : {})
      .then((data) => {
        setHistoryData(data.history || []);
      })
      .catch((err) => {
        console.error(err);
        setHistoryData([]);
      });
  };

  const handlePatientSelect = async (appt) => {
    setErrorMsg('');
    setSuccessMsg('');

    if (appt.status === 'CONFIRMED' || appt.status === 'SCHEDULED') {
      setErrorMsg(
        lang === 'ar'
          ? 'يجب على الاستقبال تسجيل وصول المريض أولاً قبل بدء الكشف.'
          : 'Reception must check in the patient before the consultation can start.'
      );
      return;
    }

    if (appt.status === 'CHECKED_IN' && !appt.consultationReady) {
      setErrorMsg(
        lang === 'ar'
          ? 'هذا المريض بانتظار إتمام رسوم الكشف في الاستقبال.'
          : 'This patient is waiting for the consultation fee to be completed at reception.'
      );
      return;
    }

    // The doctor must not reopen a patient while the laboratory is still working.
    if (appt.status === 'WAITING_LAB') {
      setErrorMsg(
        lang === 'ar'
          ? 'هذا المريض بانتظار نتائج المختبر. سيتم إعادته للطبيب تلقائيًا بعد اكتمال النتائج.'
          : 'This patient is waiting for laboratory results. The visit will return automatically when the results are complete.'
      );
      return;
    }

    try {
      // A checked-in patient is starting consultation for the first time.
      if (appt.status === 'CHECKED_IN') {
        const statusRes = await fetchWithAuth(`/api/appointments/${appt.id}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'IN_CONSULTATION' })
        });

        const statusData = await statusRes.json().catch(() => ({}));

        if (!statusRes.ok) {
          const message =
            typeof statusData.error === 'object'
              ? statusData.error.message
              : statusData.error;

          setErrorMsg(
            message ||
              (lang === 'ar'
                ? 'تعذر بدء الكشف الطبي لهذا الموعد.'
                : 'Unable to start consultation for this appointment.')
          );
          return;
        }
      }

      // If the appointment is already IN_CONSULTATION, check whether a
      // MedicalRecord already exists. If it does, this is normally a
      // patient returning after laboratory results.
      let existingSummary = null;

      if ((appt.status === 'IN_CONSULTATION' || appt.status === 'COMPLETED') && (appt.medicalRecordId || appt.status === 'COMPLETED')) {
        const summaryRes = await fetchWithAuth(`/api/records/${appt.id}/summary`);

        if (summaryRes.ok) {
          existingSummary = await summaryRes.json();
        } else if (summaryRes.status !== 404) {
          const summaryError = await summaryRes.json().catch(() => ({}));

          throw new Error(
            typeof summaryError.error === 'object'
              ? summaryError.error.message
              : summaryError.error || 'Failed to load consultation.'
          );
        }
      }

      setSelectedPatient(appt.patient);
      setSelectedAppointmentId(appt.id);
      setSelectedAppointmentStatus(appt.status);
      fetchPatientHistory(appt.patient.id);

      if (existingSummary) {
        setIsFinalizingVisit(appt.status !== 'COMPLETED');
        setCurrentRecordId(existingSummary.id);
        setCurrentLabResults(existingSummary.labOrders || []);
        setHistoricalPrescriptions(existingSummary.prescriptions || []);
        setHistoricalLabOrders(existingSummary.labOrders || []);

        setSymptoms(existingSummary.symptoms || '');
        setDiagnosis(existingSummary.diagnosis || '');
        setTreatment(existingSummary.treatment || '');
        setClinicalNotes(existingSummary.clinicalNotes || '');

        if (existingSummary.vitals) {
          setVitals({
            blood_pressure: existingSummary.vitals.blood_pressure || '',
            heart_rate: existingSummary.vitals.heart_rate || '',
            temperature: existingSummary.vitals.temperature || '',
            weight: existingSummary.vitals.weight || ''
          });
        }

        // Do not copy old prescriptions into the new prescription builder.
        // The doctor may add only additional/final medicines here.
        setPrescribedItems([]);
        setOrderedTests([]);

        setSuccessMsg(
          lang === 'ar'
            ? 'نتائج المختبر جاهزة. راجع النتائج ثم أكمل التشخيص والعلاج.'
            : 'Laboratory results are ready. Review them and finalize the diagnosis and treatment.'
        );
      } else {
        setIsFinalizingVisit(false);
        setCurrentRecordId(null);
        setCurrentLabResults([]);
        setHistoricalPrescriptions([]);
        setHistoricalLabOrders([]);
      }

      fetchDoctorQueue();
    } catch (err) {
      console.error(err);

      setErrorMsg(
        err.message ||
          (lang === 'ar'
            ? 'حدث خطأ أثناء فتح الكشف الطبي.'
            : 'An error occurred while opening the consultation.')
      );
    }
  };



  const handleAddDrugToRx = () => {
    const parsedQuantity = Number(quantity);
    const customName = customDrugName.trim();

    if (
      (!selectedDrug && !customName) ||
      (selectedDrug && customName) ||
      !dosage ||
      !duration ||
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity <= 0
    ) {
      setPrescriptionMessage(lang === 'ar' ? 'اختر دواءً وأكمل الجرعة والمدة والكمية.' : 'Choose a medicine and complete dosage, duration, and quantity.');
      return;
    }

    const drugObj = selectedDrug ? drugs.find((drug) => drug.id === selectedDrug) : null;
    if (selectedDrug && !drugObj) return;
    const candidate = doctorPrescriptionItem(drugObj, { customDrugName: customName, dosage, duration, instructionsAr: instrAr, instructionsEn: instrEn, quantity: parsedQuantity });
    if (duplicatePrescriptionItem(prescribedItems, candidate, editingPrescriptionIndex)) {
      setPrescriptionMessage(lang === 'ar' ? 'هذا الدواء موجود بالفعل في الوصفة. عدّل الإدخال الحالي بدلاً من إضافته مرة أخرى.' : 'This medicine is already in the prescription. Edit the existing entry instead of adding it again.');
      return;
    }
    setPrescribedItems((current) => editingPrescriptionIndex >= 0 ? current.map((item, index) => index === editingPrescriptionIndex ? candidate : item) : [...current, candidate]);

    setSelectedDrug('');
    setCustomDrugName('');
    setDosage('');
    setDuration('');
    setQuantity('');
    setInstrAr('');
    setInstrEn('');
    setEditingPrescriptionIndex(-1);
    setPrescriptionMessage('');
  };

  const handleEditPrescriptionItem = (item, index) => {
    setMedicineMode(item.drugId ? 'official' : 'custom');
    setSelectedDrug(item.drugId || ''); setCustomDrugName(item.customDrugName || '');
    setDosage(item.dosage); setDuration(item.duration); setQuantity(String(item.qtyPrescribed));
    setInstrAr(item.instructionsAr || ''); setInstrEn(item.instructionsEn || '');
    setEditingPrescriptionIndex(index); setPrescriptionMessage('');
  };

  const handleRemovePrescriptionItem = (index) => {
    setPrescribedItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (editingPrescriptionIndex === index) { setEditingPrescriptionIndex(-1); setSelectedDrug(''); setCustomDrugName(''); }
    else if (editingPrescriptionIndex > index) setEditingPrescriptionIndex((current) => current - 1);
  };

  const handleToggleTest = (serviceId) => {
    if (orderedTests.includes(serviceId)) {
      setOrderedTests(orderedTests.filter((id) => id !== serviceId));
    } else {
      setOrderedTests([...orderedTests, serviceId]);
    }
  };

  const handleAddCustomTest = () => {
    const normalized = customTestName.trim();

    if (!normalized) return;

    const alreadyExists = customTests.some(
      (item) => item.toLowerCase() === normalized.toLowerCase()
    );

    if (!alreadyExists) {
      setCustomTests([...customTests, normalized]);
    }

    setCustomTestName('');
  };

  const handleRemoveCustomTest = (testName) => {
    setCustomTests(customTests.filter((item) => item !== testName));
  };

  const handleSaveConsultation = async () => {
    if (isReadOnlyVisit) {
      setErrorMsg(lang === 'ar' ? 'هذه الزيارة مكتملة ولا يمكن تعديلها.' : 'This visit is completed and cannot be edited.');
      return;
    }
    if (consultationSaveLock.current) {
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');

    const isFinalize = isFinalizingVisit && currentRecordId;
    const hasLabOrders =
      orderedTests.length > 0 ||
      customTests.length > 0;

    if (!isFinalize && !hasLabOrders && !diagnosis.trim()) {
      setErrorMsg(t('requiredField'));
      return;
    }

    if (isFinalize && !diagnosis.trim()) {
      setErrorMsg(t('requiredField'));
      return;
    }

    consultationSaveLock.current = true;
    setIsSavingConsultation(true);

    try {

      const url = isFinalize
        ? `/api/records/${currentRecordId}/finalize`
        : '/api/records';

      const body = isFinalize
        ? {
            diagnosis,
            treatment,
            clinicalNotes,
            vitalSigns: vitals,
            prescribedDrugs: prescribedItems
          }
        : {
            patientId: selectedPatient.id,
            appointmentId: selectedAppointmentId,
            symptoms,
            diagnosis,
            treatment,
            clinicalNotes,
            vitalSigns: vitals,
            prescribedDrugs: prescribedItems,
            orderedServices: orderedTests,
            customTests
          };

      const res = await fetchWithAuth(url, {
        method: isFinalize ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر حفظ الكشف الطبي.'
              : 'Failed to save the medical record.'
          )
        );
        return;
      }

      const sentToLab =
        !isFinalize &&
        Boolean(data.data?.labOrder);

      if (isFinalize) {
        setSuccessMsg(
          lang === 'ar'
            ? 'تمت مراجعة النتائج وإنهاء الزيارة بنجاح.'
            : 'Laboratory results reviewed and visit finalized successfully.'
        );
      } else if (sentToLab) {
        setSuccessMsg(
          lang === 'ar'
            ? 'تم حفظ الكشف وإرسال طلب الفحوصات. المريض الآن بانتظار المختبر.'
            : 'Consultation saved and laboratory tests ordered. The patient is now waiting for the laboratory.'
        );
      } else {
        setSuccessMsg(
          lang === 'ar'
            ? 'تم إنهاء الزيارة وحفظ الملف الطبي للمريض بنجاح.'
            : 'Consultation completed successfully.'
        );
      }

      const recId =
        data.recordId ||
        data.record?.id ||
        data.data?.record?.id ||
        currentRecordId ||
        selectedAppointmentId;

      // Only show the final/post-visit summary after a truly completed visit.
      if (!sentToLab) {
        setActiveSummaryId(recId);
      }

      setSelectedPatient(null);
      setSelectedAppointmentId('');
      setSelectedAppointmentStatus('');
      setSymptoms('');
      setDiagnosis('');
      setTreatment('');
      setClinicalNotes('');
      setPrescribedItems([]);
      setOrderedTests([]);
      setCustomTests([]);
      setCustomTestName('');
      setSelectedDrug('');
      setCustomDrugName('');
      setDosage('');
      setDuration('');
      setQuantity('');
      setInstrAr('');
      setInstrEn('');

      setIsFinalizingVisit(false);
      setCurrentRecordId(null);
      setCurrentLabResults([]);
      setHistoricalPrescriptions([]);
      setHistoricalLabOrders([]);

      fetchDoctorQueue();
    } catch (err) {
      console.error(err);

      setErrorMsg(
        lang === 'ar'
          ? 'فشل حفظ الكشف الطبي.'
          : 'EMR saving failed.'
      );
    } finally {
      consultationSaveLock.current = false;
      setIsSavingConsultation(false);
    }
  };

  const dailyMetrics = [
    { key: 'waiting', icon: Users, value: queue.filter((item) => item.status === 'CHECKED_IN' && item.consultationReady).length, ar: 'المرضى المنتظرون', en: 'Waiting patients' },
    { key: 'consulting', icon: Stethoscope, value: queue.filter((item) => item.status === 'IN_CONSULTATION').length, ar: 'قيد الكشف', en: 'In consultation' },
    { key: 'completed', icon: CheckCircle2, value: queue.filter((item) => item.status === 'COMPLETED').length, ar: 'مكتمل اليوم', en: 'Completed today' },
    { key: 'laboratory', icon: FlaskConical, value: queue.filter((item) => item.status === 'WAITING_LAB').length, ar: 'بانتظار المختبر', en: 'Waiting for lab' },
    { key: 'total', icon: CalendarDays, value: queue.length, ar: 'إجمالي مواعيد اليوم', en: "Today's appointments" }
  ];
  const selectedAppointment = queue.find((item) => item.id === selectedAppointmentId);
  const selectedPatientAge = getPatientAge(selectedPatient?.dateOfBirth);

  return (
    <div className="dashboard-wrapper doctor-dashboard" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="workspace-panel doctor-dashboard__workspace">
        <RoleHero role="doctor" lang={lang}/>
        <section className="doctor-daily-summary" aria-labelledby="doctor-daily-summary-title">
          <div className="doctor-section-heading">
            <div>
              <span>{lang === 'ar' ? 'نظرة سريرية سريعة' : 'Clinical snapshot'}</span>
              <h2 id="doctor-daily-summary-title">{lang === 'ar' ? 'ملخص اليوم' : "Today's summary"}</h2>
            </div>
            <time dateTime={filterDate} dir="ltr">{new Date(`${filterDate}T12:00:00`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { weekday: 'long', day: 'numeric', month: 'long' })}</time>
          </div>
          <div className="doctor-metrics-grid">
            {dailyMetrics.map((metric) => {
              const MetricIcon = metric.icon;
              return <article className={`doctor-metric doctor-metric--${metric.key}`} key={metric.key}>
                <span className="doctor-metric__icon"><MetricIcon size={18} aria-hidden="true" /></span>
                <div><strong>{metric.value}</strong><span>{lang === 'ar' ? metric.ar : metric.en}</span></div>
              </article>;
            })}
          </div>
        </section>

        <div className="doctor-operational-grid">
          {/* COLUMN 1: LIVE QUEUE & PATIENT INFO */}
          <aside className="doctor-queue-panel" aria-labelledby="doctor-queue-title">
            <div className="doctor-queue-header">
              <div className="doctor-queue-title-row">
                <span className="panel-title" id="doctor-queue-title">
                  <Activity size={18} />
                  {lang === 'ar' ? 'طابور الطبيب' : 'Doctor Queue'}
                </span>
                <span className="doctor-queue-count">{queue.length}</span>
              </div>
              <div className="doctor-date-controls">
                <button type="button" onClick={() => changeFilterDate(-1)} aria-label={lang === 'ar' ? 'اليوم السابق' : 'Previous day'}>‹</button>
                <button type="button" className="doctor-date-today" onClick={() => setFilterDate(clinicDateString())}>{lang === 'ar' ? 'اليوم' : 'Today'}</button>
                <button type="button" onClick={() => changeFilterDate(1)} aria-label={lang === 'ar' ? 'اليوم التالي' : 'Next day'}>›</button>
                <button type="button" onClick={fetchDoctorQueue} aria-label={lang === 'ar' ? 'تحديث الطابور' : 'Refresh queue'}><RefreshCw size={15} /></button>
              </div>
              <label className="doctor-date-picker">
                <CalendarDays size={15} aria-hidden="true" />
                <span className="sr-only">{lang === 'ar' ? 'تاريخ الطابور' : 'Queue date'}</span>
                <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
              </label>
            </div>

            <div className="doctor-queue-list">
            {queue.length === 0 && <div className="doctor-queue-empty" role="status">
              <Stethoscope size={30} aria-hidden="true" />
              <strong>{lang === 'ar' ? 'لا يوجد مرضى في طابورك لهذا اليوم.' : 'There are no patients in your queue for this day.'}</strong>
              <span>{lang === 'ar' ? 'يمكنك اختيار تاريخ آخر من الأعلى.' : 'You can choose another date above.'}</span>
            </div>}
            {queue.map((appt) => {
              const isEmergency = appt.emergencyOverride;
              return (
                <button
                  type="button"
                  key={appt.id}
                  className={`doctor-queue-card ${isEmergency ? 'emergency-border' : ''} ${selectedAppointmentId === appt.id ? 'selected' : ''}`}
                  onClick={() => handlePatientSelect(appt)}
                  aria-pressed={selectedAppointmentId === appt.id}
                >
                  <span className="doctor-queue-card__top">
                    <strong>{(lang === 'ar' ? appt.patient.fullNameAr : appt.patient.fullNameEn) || appt.patient.fullNameAr || appt.patient.fullNameEn}</strong>
                    <span
                      className={
                        appt.status === 'WAITING_LAB' ||
                        (appt.status === 'CHECKED_IN' && !appt.consultationReady)
                          ? 'badge badge-warning'
                          : 'badge badge-success'
                      }
                    >
                      {appt.status === 'CHECKED_IN'
                        ? (
                          appt.consultationReady
                            ? (lang === 'ar' ? 'جاهز للكشف' : 'Ready')
                            : (lang === 'ar' ? 'بانتظار الدفع' : 'Payment Pending')
                        )
                      : getAppointmentStatusLabel(appt.status)}
                    </span>
                  </span>
                  <span className="doctor-queue-card__identity">
                    <bdi dir="ltr">{appt.patient.fileNumber || '—'}</bdi>
                    {appt.patient.phone && <bdi dir="ltr">{appt.patient.phone}</bdi>}
                  </span>
                  <span className="doctor-queue-card__meta">
                    <span><Clock3 size={14} aria-hidden="true" /><bdi dir="ltr">{appt.appointmentTime || '—'}</bdi></span>
                    {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ' : 'Emergency'}</span>}
                  </span>
                </button>
              );
            })}
            </div>
          </aside>

          {/* COLUMN 2: CLINICAL WORKSPACE */}
          <main className="doctor-clinical-workspace" aria-label={lang === 'ar' ? 'مساحة الكشف الطبي' : 'Clinical workspace'}>
            {errorMsg && (
              <div
                className="badge badge-danger"
                role="alert"
                style={{
                  padding: '0.75rem',
                  width: '100%',
                  marginBottom: '1rem'
                }}
              >
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div
                className="badge badge-success"
                style={{
                  padding: '0.75rem',
                  width: '100%',
                  marginBottom: '1rem'
                }}
              >
                {successMsg}
              </div>
            )}

            {selectedPatient ? (
              <div className="doctor-selected-workspace">
                <header className="doctor-patient-context">
                  <span className="doctor-patient-avatar" aria-hidden="true"><User size={22} /></span>
                  <div className="doctor-patient-context__identity">
                    <span>{lang === 'ar' ? 'المريض الحالي' : 'Current patient'}</span>
                    <h2>{(lang === 'ar' ? selectedPatient.fullNameAr : selectedPatient.fullNameEn) || selectedPatient.fullNameAr || selectedPatient.fullNameEn}</h2>
                    <div>
                      <bdi className="doctor-mrn" dir="ltr">{selectedPatient.fileNumber || '—'}</bdi>
                      <span>{selectedPatientAge === null ? '—' : (lang === 'ar' ? `${selectedPatientAge} سنة` : `${selectedPatientAge} years`)}</span>
                      <span>{getGenderLabel(selectedPatient.gender)}</span>
                    </div>
                  </div>
                  <div className="doctor-patient-context__visit">
                    <span><Clock3 size={14} aria-hidden="true" />{lang === 'ar' ? 'موعد' : 'Appointment'} <bdi dir="ltr">{selectedAppointment?.appointmentTime || '—'}</bdi></span>
                    <span className="badge badge-info">{getAppointmentStatusLabel(selectedAppointmentStatus)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary doctor-open-patient-file"
                    onClick={() => setViewingProfilePatientId(selectedPatient.id)}
                  >
                    <User size={14} />
                    {lang === 'ar' ? 'فتح ملف المريض' : 'Open Patient File'}
                  </button>
                </header>

                {isReadOnlyVisit && (
                  <div className="badge badge-info" role="status" style={{ width: '100%', marginBottom: '1rem', padding: '0.75rem' }}>
                    {lang === 'ar' ? 'زيارة مكتملة — للعرض فقط' : 'Completed visit — read only'}
                  </div>
                )}

                {isReadOnlyVisit && (historicalPrescriptions.length > 0 || historicalLabOrders.length > 0) && (
                  <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
                    <h4 style={{ marginTop: 0 }}>{lang === 'ar' ? 'ملخص الوصفة والفحوصات' : 'Prescription and laboratory summary'}</h4>
                    {historicalPrescriptions.length > 0 && <div>
                      <strong>{lang === 'ar' ? 'الوصفة الطبية' : 'Prescription'}</strong>
                      {historicalPrescriptions.map((item, index) => (
                        <div key={item.id || index} style={{ marginTop: '0.35rem' }}>
                          {lang === 'ar' ? item.drugNameAr : item.drugNameEn}
                          {' — '}{item.dosage} · {item.duration} · {lang === 'ar' ? `الكمية ${item.qtyPrescribed}` : `Qty ${item.qtyPrescribed}`}
                        </div>
                      ))}
                    </div>}
                    {historicalLabOrders.length > 0 && <div style={{ marginTop: '0.75rem' }}>
                      <strong>{lang === 'ar' ? 'الفحوصات المخبرية' : 'Laboratory tests'}</strong>
                      {historicalLabOrders.map((item, index) => (
                        <div key={item.id || index} style={{ marginTop: '0.35rem' }}>
                          {lang === 'ar' ? item.serviceNameAr : item.serviceNameEn}
                          {item.resultValue ? ` — ${item.resultValue}` : ''}
                        </div>
                      ))}
                    </div>}
                  </div>
                )}

                <fieldset disabled={isReadOnlyVisit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="doctor-consultation-layout">
                  {/* Left Column: Full Patient History at a glance */}
                  <section className="doctor-clinical-section doctor-history-panel" aria-labelledby="doctor-history-title">
                    <h3 className="doctor-clinical-section__title" id="doctor-history-title">
                      <Activity size={18} color="var(--primary)" />
                      {lang === 'ar' ? 'سجل الزيارات السابقة' : 'Patient EMR History'}
                    </h3>
                    <div className="emr-timeline">
                      {historyData.length === 0 ? (
                        <p style={{ opacity: 0.6 }}>{lang === 'ar' ? 'لا يوجد زيارات سابقة مسجلة.' : 'No historical visits logged.'}</p>
                      ) : (
                        historyData.map((rec) => (
                          <div key={rec.id} className="timeline-card glass-panel" style={{ marginBottom: '1rem', padding: '0.75rem', borderLeft: '3px solid var(--primary)', position: 'relative' }}>
                            {rec.isLocked && (
                              <div className="lock-container-block" style={{ position: 'absolute', right: '10px', top: '10px', display: 'flex', gap: '4px', alignItems: 'center', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px' }}>
                                <Lock size={12} color="var(--danger)" />
                                <span style={{ fontSize: '0.65rem', color: 'var(--danger)' }}>{t('breakTheGlass')}</span>
                              </div>
                            )}
                            <div className={`timeline-details ${rec.isLocked ? 'locked-overlay' : ''}`} style={{ fontSize: '0.8rem' }}>
                              <div className="timeline-header" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                <span>
      {new Date(rec.visitDate).toLocaleDateString(
        lang === 'ar' ? 'ar' : 'en'
      )}
    </span>
                                <span style={{ color: 'var(--primary)' }}>
                                  {lang === 'ar' ? rec.doctorNameAr : rec.doctorNameEn}
                                </span>
                              </div>
                              <div className="timeline-vitals" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', opacity: 0.8 }}>
                                <span>
                                  {lang === 'ar' ? 'الضغط:' : 'BP:'} {rec.vitalSigns?.blood_pressure || '-'}
                                </span>
                                <span>
                                  {lang === 'ar' ? 'النبض:' : 'HR:'} {rec.vitalSigns?.heart_rate || '-'}{' '}
                                  {lang === 'ar' ? 'نبضة/دقيقة' : 'bpm'}
                                </span>
                                <span>
                                  {lang === 'ar' ? 'الحرارة:' : 'Temp:'} {rec.vitalSigns?.temperature || '-'} °C
                                </span>
                              </div>
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>{t('symptoms')}:</strong> {rec.symptoms}
                              </div>
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>{t('diagnosis')}:</strong> {rec.diagnosis}
                              </div>
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>{t('treatment')}:</strong> {rec.treatment}
                              </div>
                              {!rec.isLocked && (
                                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    onClick={() => {
                                      const targetId = rec.id || rec.recordId || rec.appointmentId;
                                      setActiveSummaryId(targetId);
                                    }}
                                  >
                                    <Printer size={12} />
                                    {lang === 'ar' ? 'ملخص الزيارة والطباعة' : 'Visit Summary / Print'}
                                  </button>

                                  {selectedPatient?.phone && (
                                    <a
                                      href={getWhatsAppLink(
                                        selectedPatient.phone,
                                        lang === 'ar'
                                          ? `مركز الشفاء الطبي - ملخص الزيارة:\nالتشخيص: ${rec.diagnosis}\nالعلاج: ${rec.treatment}`
                                          : `Al-Shifa Clinic - Visit Summary:\nDiagnosis: ${rec.diagnosis}\nTreatment: ${rec.treatment}`
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-whatsapp"
                                      style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                    >
                                      <MessageCircle size={12} />
                                      {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Right Column: Active Consultation & Prescription Builder */}
                  <div className="doctor-consultation-form">
                    {/* Completed laboratory results returned to the doctor */}
                    {isFinalizingVisit && (
                      <div
                        className="glass-panel"
                        style={{
                          padding: '1rem',
                          border: '1px solid var(--success)'
                        }}
                      >
                        <h4 style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                          {lang === 'ar'
                            ? 'نتائج المختبر - جاهزة للمراجعة'
                            : 'Laboratory Results - Ready for Review'}
                        </h4>

                        {currentLabResults.length === 0 ? (
                          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                            {lang === 'ar'
                              ? 'لا توجد نتائج مختبر مسجلة.'
                              : 'No laboratory results were found.'}
                          </p>
                        ) : (
                          <div style={{ display: 'grid', gap: '0.5rem' }}>
                            {currentLabResults.map((result, index) => (
                              <div
                                key={`${result.serviceNameEn}-${index}`}
                                style={{
                                  padding: '0.65rem',
                                  borderRadius: '8px',
                                  background: 'rgba(255,255,255,0.04)',
                                  borderLeft: result.isOutOfRange
                                    ? '3px solid var(--danger)'
                                    : '3px solid var(--success)'
                                }}
                              >
                                <div style={{ fontWeight: 'bold' }}>
                                  {lang === 'ar'
                                    ? result.serviceNameAr
                                    : result.serviceNameEn}
                                </div>

                                <div style={{ marginTop: '0.25rem' }}>
                                  {lang === 'ar' ? 'النتيجة:' : 'Result:'}{' '}
                                  <strong>{result.resultValue || 'N/A'}</strong>
                                </div>

                                {result.isOutOfRange && (
                                  <span
                                    className="badge badge-danger"
                                    style={{ marginTop: '0.35rem' }}
                                  >
                                    {lang === 'ar'
                                      ? 'خارج النطاق الطبيعي'
                                      : 'Out of Range'}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <p
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 0,
                            marginTop: '0.75rem'
                          }}
                        >
                          {lang === 'ar'
                            ? 'راجع النتائج ثم حدّث التشخيص والعلاج والوصفة قبل إنهاء الزيارة.'
                            : 'Review the results, then update the diagnosis, treatment and prescription before finalizing the visit.'}
                        </p>
                      </div>
                    )}

                    {/* Vitals Section */}
                    <section className="doctor-clinical-section doctor-vitals-section" aria-labelledby="doctor-vitals-title">
                      <div className="doctor-clinical-section__heading">
                        <h3 id="doctor-vitals-title">{lang === 'ar' ? 'العلامات الحيوية الحالية' : 'Current Vitals'}</h3>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                          onClick={handlePopulateNormalVitals}
                        >
                          {lang === 'ar' ? 'علامات حيوية طبيعية' : 'Normal Vitals Preset'}
                        </button>
                      </div>
                      <div className="doctor-vitals-grid">
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-bp">
  {lang === 'ar' ? 'ضغط الدم' : 'Blood Pressure'}
</label>
                          <input
                            id="doctor-vital-bp"
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.blood_pressure}
                            onChange={(e) => setVitals({ ...vitals, blood_pressure: e.target.value })}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-heart-rate">
  {lang === 'ar' ? 'معدل النبض (نبضة/دقيقة)' : 'Heart Rate (bpm)'}
</label>
                          <input
                            id="doctor-vital-heart-rate"
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.heart_rate}
                            onChange={(e) => setVitals({ ...vitals, heart_rate: e.target.value })}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-temperature">
  {lang === 'ar' ? 'درجة الحرارة (°م)' : 'Temperature (°C)'}
</label>
                          <input
                            id="doctor-vital-temperature"
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.temperature}
                            onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-weight">
  {lang === 'ar' ? 'الوزن (كجم)' : 'Weight (kg)'}
</label>
                          <input
                            id="doctor-vital-weight"
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.weight}
                            onChange={(e) => setVitals({ ...vitals, weight: e.target.value })}
                          />
                        </div>
                      </div>
                    </section>

                    {/* Symptoms & Diagnosis */}
                    <section className="doctor-clinical-section doctor-assessment-section" aria-labelledby="doctor-assessment-title">
                      <h3 className="doctor-clinical-section__title" id="doctor-assessment-title">{lang === 'ar' ? 'التقييم السريري وخطة العلاج' : 'Clinical assessment and treatment plan'}</h3>
                      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="form-label" htmlFor="doctor-symptoms">{t('symptoms')}</label>
                        <textarea
                          id="doctor-symptoms"
                          rows={2}
                          className="form-input"
                          value={symptoms}
                          onChange={(e) => setSymptoms(e.target.value)}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <label className="form-label" htmlFor="doctor-diagnosis" style={{ margin: 0 }}>{t('diagnosis')} *</label>
                          <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{lang === 'ar' ? 'نماذج تشخيص سريعة:' : 'Quick Diagnoses:'}</span>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.5rem' }}>
                          {commonDiagnoses.map((cd) => (
                            <button
                              key={cd.val}
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '0.7rem', textTransform: 'none', background: 'rgba(255,255,255,0.05)' }}
                              onClick={() => setDiagnosis(cd.val)}
                            >
                              {lang === 'ar' ? cd.labelAr : cd.labelEn}
                            </button>
                          ))}
                        </div>

                        <input
                          id="doctor-diagnosis"
                          type="text"
                          placeholder={
  lang === 'ar'
    ? 'رمز ICD-11 أو وصف التشخيص'
    : 'ICD-11 code or diagnosis description'
}
                          className="form-input"
                          required
                          value={diagnosis}
                          onChange={(e) => setDiagnosis(e.target.value)}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" htmlFor="doctor-treatment">{t('treatment')}</label>
                        <textarea
                          id="doctor-treatment"
                          rows={2}
                          className="form-input"
                          value={treatment}
                          onChange={(e) => setTreatment(e.target.value)}
                        />
                      </div>
                      <div className="form-group doctor-clinical-notes">
                        <label className="form-label" htmlFor="doctor-clinical-notes">{lang === 'ar' ? 'الملاحظات السريرية' : 'Clinical notes'}</label>
                        <textarea id="doctor-clinical-notes" rows={3} className="form-input" value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} />
                      </div>
                    </section>

                    {/* Prescription Builder */}
                    <section className="doctor-clinical-section doctor-prescription-section" aria-labelledby="doctor-prescription-title">
                      <h3 className="doctor-clinical-section__title" id="doctor-prescription-title">
                        <Sliders size={16} color="var(--primary)" />
                        {lang === 'ar' ? 'الوصفة الطبية السريعة' : 'Rapid Prescription Builder'}
                      </h3>
                      <div className="doctor-medicine-mode" role="group" aria-label={lang === 'ar' ? 'نوع الدواء' : 'Medicine type'}>
                        <button type="button" className={medicineMode === 'official' ? 'is-selected' : ''} aria-pressed={medicineMode === 'official'} onClick={() => { setMedicineMode('official'); setCustomDrugName(''); }}>{lang === 'ar' ? 'دواء من القائمة الرسمية' : 'Official formulary medicine'}</button>
                        <button type="button" className={medicineMode === 'custom' ? 'is-selected' : ''} aria-pressed={medicineMode === 'custom'} onClick={() => { setMedicineMode('custom'); setSelectedDrug(''); }}>{lang === 'ar' ? 'دواء غير موجود / كتابة يدوية' : 'Medicine not found / custom'}</button>
                      </div>
                      {medicineMode === 'official' ? <MedicineCombobox medicines={drugs} selectedId={selectedDrug} lang={lang} onSelect={(id) => { setSelectedDrug(id); setCustomDrugName(''); setPrescriptionMessage(''); }} /> : <div className="form-group doctor-custom-medicine"><label className="form-label" htmlFor="doctor-custom-medicine">{lang === 'ar' ? 'اسم الدواء المكتوب يدويًا' : 'Custom medicine name'}</label><input id="doctor-custom-medicine" type="text" className="form-input" dir={lang === 'ar' ? 'rtl' : 'ltr'} value={customDrugName} onChange={(event) => { setCustomDrugName(event.target.value); setSelectedDrug(''); setPrescriptionMessage(''); }} /><small>{lang === 'ar' ? 'سيُرسل هذا الدواء إلى الصيدلي للمراجعة ولن يتحول تلقائيًا إلى دواء رسمي.' : 'This medicine will require pharmacist review and will not become a formulary entry automatically.'}</small></div>}
                      <div className="doctor-prescription-fields">
                        <div className="form-group"><label className="form-label" htmlFor="doctor-rx-dosage">{lang === 'ar' ? 'الجرعة والتكرار' : 'Dosage and frequency'}</label><input id="doctor-rx-dosage" type="text" className="form-input" dir="ltr" value={dosage} onChange={(event) => setDosage(event.target.value)} /><div className="doctor-rx-helpers">{quickDosagePresets.map((preset) => <button key={preset} type="button" onClick={() => setDosage(preset)}>{preset}</button>)}</div></div>
                        <div className="form-group"><label className="form-label" htmlFor="doctor-rx-duration">{lang === 'ar' ? 'مدة العلاج' : 'Duration'}</label><input id="doctor-rx-duration" type="text" className="form-input" value={duration} onChange={(event) => setDuration(event.target.value)} /><div className="doctor-rx-helpers">{quickDurationPresets.map((preset) => <button key={preset.value} type="button" onClick={() => setDuration(preset.value)}>{lang === 'ar' ? preset.ar : preset.en}</button>)}</div></div>
                        <div className="form-group"><label className="form-label" htmlFor="doctor-rx-quantity">{lang === 'ar' ? 'الكمية الموصوفة' : 'Prescribed quantity'}</label><input id="doctor-rx-quantity" type="number" min="1" step="1" className="form-input" dir="ltr" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
                        <div className="form-group"><label className="form-label" htmlFor="doctor-rx-instructions-ar">تعليمات الدواء بالعربية</label><input id="doctor-rx-instructions-ar" type="text" className="form-input" dir="rtl" value={instrAr} onChange={(event) => setInstrAr(event.target.value)} /></div>
                        <div className="form-group"><label className="form-label" htmlFor="doctor-rx-instructions-en">Medication instructions in English</label><input id="doctor-rx-instructions-en" type="text" className="form-input" dir="ltr" value={instrEn} onChange={(event) => setInstrEn(event.target.value)} /></div>
                      </div>
                      {prescriptionMessage && <div className="doctor-prescription-message" role="alert">{prescriptionMessage}</div>}
                      <button type="button" className="btn btn-secondary doctor-add-prescription" onClick={handleAddDrugToRx}>{editingPrescriptionIndex >= 0 ? (lang === 'ar' ? 'حفظ تعديل الدواء' : 'Save medicine changes') : t('prescribe')}</button>
                      {prescribedItems.length > 0 && <div className="doctor-prescribed-list" aria-label={lang === 'ar' ? 'الأدوية المختارة' : 'Selected medicines'}>{prescribedItems.map((item, index) => { const displayDrug = item.drugId ? drugs.find((drug) => drug.id === item.drugId) : null; return <article className="doctor-prescribed-card" key={item.drugId || `custom-${item.customDrugName}-${index}`}>
                        <div className="doctor-prescribed-card__header"><div><strong>{lang === 'ar' ? item.nameAr : item.nameEn}</strong>{item.drugId ? <small>{[displayDrug?.brandName, displayDrug?.genericName, displayDrug?.strength, displayDrug?.dosageForm].filter(Boolean).join(' · ')}</small> : <span className="badge badge-warning">{lang === 'ar' ? 'دواء مكتوب يدويًا — يحتاج مراجعة الصيدلي' : 'Custom medicine — pharmacist review required'}</span>}</div><span className="badge badge-info">{lang === 'ar' ? `الكمية ${item.qtyPrescribed}` : `Qty ${item.qtyPrescribed}`}</span></div>
                        <dl><div><dt>{lang === 'ar' ? 'الجرعة' : 'Dosage'}</dt><dd>{item.dosage}</dd></div><div><dt>{lang === 'ar' ? 'المدة' : 'Duration'}</dt><dd>{item.duration}</dd></div>{(item.instructionsAr || item.instructionsEn) && <div><dt>{lang === 'ar' ? 'التعليمات' : 'Instructions'}</dt><dd>{lang === 'ar' ? item.instructionsAr || item.instructionsEn : item.instructionsEn || item.instructionsAr}</dd></div>}</dl>
                        <div className="doctor-prescribed-actions"><button type="button" className="btn" onClick={() => handleEditPrescriptionItem(item, index)}>{lang === 'ar' ? 'تعديل' : 'Edit'}</button><button type="button" className="btn btn-danger" onClick={() => handleRemovePrescriptionItem(index)}>{lang === 'ar' ? 'إزالة' : 'Remove'}</button></div>
                      </article>; })}</div>}
                    </section>

                    {/* Laboratory / radiology orders */}
                    <section className="doctor-lab-order-card" aria-labelledby="doctor-lab-order-title">
                      <div className="doctor-lab-order-header">
                        <div>
                          <h4 id="doctor-lab-order-title"><FlaskConical size={17} aria-hidden="true" />{lang === 'ar' ? 'طلب الفحوصات' : 'Order investigations'}</h4>
                          <p>{lang === 'ar' ? 'اختر الفحوصات المطلوبة للمريض من القائمة المعتمدة.' : 'Select the required tests from the approved catalogue.'}</p>
                        </div>
                        <span className="doctor-lab-selected-count" aria-live="polite">
                          {lang === 'ar' ? `تم اختيار ${orderedTests.length} فحوصات` : `${orderedTests.length} test${orderedTests.length === 1 ? '' : 's'} selected`}
                        </span>
                      </div>

                      {clinicalServices.filter((serviceItem) => serviceItem.category === 'LABORATORY' || serviceItem.category === 'RADIOLOGY').length > 4 && (
                        <label className="doctor-lab-search">
                          <Search size={16} aria-hidden="true" />
                          <span className="sr-only">{lang === 'ar' ? 'البحث في الفحوصات' : 'Search tests'}</span>
                          <input type="search" value={labServiceSearch} onChange={(event) => setLabServiceSearch(event.target.value)} placeholder={lang === 'ar' ? 'ابحث عن فحص...' : 'Search tests...'} />
                        </label>
                      )}

                      {['LABORATORY', 'RADIOLOGY'].map((category) => {
                        const normalizedSearch = labServiceSearch.trim().toLocaleLowerCase();
                        const services = clinicalServices.filter((serviceItem) => {
                          if (serviceItem.category !== category) return false;
                          if (!normalizedSearch) return true;
                          return [serviceItem.labelAr, serviceItem.labelEn].filter(Boolean).some((label) => label.toLocaleLowerCase().includes(normalizedSearch));
                        });
                        if (services.length === 0) return null;
                        return <div className="doctor-lab-subsection" key={category}>
                          <h5>{category === 'LABORATORY' ? (lang === 'ar' ? 'الفحوصات المخبرية' : 'Laboratory tests') : (lang === 'ar' ? 'الأشعة' : 'Radiology')}</h5>
                          <div className="doctor-lab-service-grid">
                            {services.map((svc) => <label className={`doctor-lab-service-option ${orderedTests.includes(svc.id) ? 'is-selected' : ''}`} key={svc.id}>
                              <input type="checkbox" checked={orderedTests.includes(svc.id)} onChange={() => handleToggleTest(svc.id)} />
                              <span className="doctor-lab-service-copy"><strong>{lang === 'ar' ? svc.labelAr : svc.labelEn}</strong>{lang === 'ar' && svc.labelEn && <small>{svc.labelEn}</small>}{lang !== 'ar' && svc.labelAr && <small>{svc.labelAr}</small>}</span>
                              <span className="doctor-lab-checkmark" aria-hidden="true">{orderedTests.includes(svc.id) ? '✓' : ''}</span>
                            </label>)}
                          </div>
                        </div>;
                      })}

                      {!isFinalizingVisit && <div className="doctor-custom-test-area">
                        <button type="button" className="doctor-custom-test-toggle" onClick={() => setShowCustomTestInput((visible) => !visible)} aria-expanded={showCustomTestInput}>
                          + {lang === 'ar' ? 'إضافة فحص غير موجود في القائمة' : 'Add a test not in the catalogue'}
                        </button>
                        {showCustomTestInput && <div className="doctor-custom-test-form">
                          <input type="text" value={customTestName} onChange={(event) => setCustomTestName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleAddCustomTest(); } }} placeholder={lang === 'ar' ? 'مثال: CRP أو Thyroid Function Test' : 'Example: CRP or Thyroid Function Test'} aria-label={lang === 'ar' ? 'اسم الفحص المخصص' : 'Custom test name'} />
                          <button type="button" className="btn btn-secondary" onClick={handleAddCustomTest}>{lang === 'ar' ? 'إضافة الفحص' : 'Add Test'}</button>
                        </div>}
                        {customTests.length > 0 && <div className="doctor-custom-test-list">{customTests.map((testName) => <div className="doctor-custom-test-chip" key={testName}><span>{testName}</span><button type="button" onClick={() => handleRemoveCustomTest(testName)} aria-label={lang === 'ar' ? `حذف ${testName}` : `Remove ${testName}`}>×</button></div>)}</div>}
                      </div>}
                    </section>

                    <div className="doctor-consultation-actions">
                    <div><strong>{lang === 'ar' ? 'إجراء الكشف' : 'Consultation action'}</strong><span>{lang === 'ar' ? 'راجع البيانات السريرية قبل تنفيذ الإجراء النهائي.' : 'Review the clinical information before the final action.'}</span></div>
                    <button type="button" className="btn btn-primary" onClick={handleSaveConsultation} disabled={isSavingConsultation || isReadOnlyVisit}>
                      {isFinalizingVisit
                        ? (lang === 'ar'
                            ? 'مراجعة النتائج وإنهاء الزيارة'
                            : 'Review Results & Complete Visit')
                        : (orderedTests.length > 0 || customTests.length > 0)
                          ? (lang === 'ar'
                              ? 'إرسال للمختبر وانتظار النتائج'
                              : 'Send to Lab & Await Results')
                          : (lang === 'ar'
                              ? 'إنهاء الزيارة'
                              : 'Complete Visit')}
                    </button></div>
                  </div>
                </div>
                </fieldset>
              </div>
            ) : (
              <section className="doctor-workspace-empty" aria-labelledby="doctor-workspace-empty-title">
                <span className="doctor-workspace-empty__icon"><Stethoscope size={34} aria-hidden="true" /></span>
                <h2 id="doctor-workspace-empty-title">{lang === 'ar' ? 'اختر مريضاً من طابور الطبيب لبدء الكشف الطبي.' : 'Select a patient from the doctor queue to start the consultation.'}</h2>
                <p>{lang === 'ar' ? 'ستظهر بيانات المريض وسجل الزيارات وأدوات التوثيق السريري هنا.' : 'Patient details, visit history, and clinical documentation tools will appear here.'}</p>
                <ol className="doctor-workflow-steps">
                  {[lang === 'ar' ? 'اختيار المريض' : 'Select patient', lang === 'ar' ? 'مراجعة ملف المريض' : 'Review patient file', lang === 'ar' ? 'تسجيل العلامات والأعراض' : 'Record vitals and symptoms', lang === 'ar' ? 'التشخيص وخطة العلاج' : 'Diagnose and plan treatment', lang === 'ar' ? 'الوصفة والفحوصات' : 'Prescription and investigations', lang === 'ar' ? 'إكمال الكشف' : 'Complete consultation'].map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
                </ol>
              </section>
            )}
          </main>
        </div>
      </div>

      {viewingProfilePatientId && (
        <PatientProfileModal
          patientId={viewingProfilePatientId}
          onClose={() => setViewingProfilePatientId(null)}
          lang={lang}
          onSelectSummary={(recId) => setActiveSummaryId(recId)}
        />
      )}
      {activeSummaryId && <PostVisitSummaryModal summaryId={activeSummaryId} onClose={() => setActiveSummaryId(null)} lang={lang} />}
    </div>
  );
}

/* ==========================================
   4. PHARMACIST DASHBOARD
   ========================================== */
