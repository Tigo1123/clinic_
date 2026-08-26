import { useCallback, useEffect, useState, useRef } from 'react';
import { Activity, Lock, MessageCircle, Printer, Sliders, Stethoscope, User } from 'lucide-react';
import { PatientProfileModal, PostVisitSummaryModal } from '../clinical/ClinicalModals';
import { getWhatsAppLink } from '../reception/clinicData';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import { staffSocket as socket } from '../../services/staffSocket';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';
import { staffApiRequest as apiRequest } from '../../services/apiClient';
import MedicineCombobox from './MedicineCombobox';
import { doctorPrescriptionItem, duplicatePrescriptionItem } from '../../utils/doctorPrescription';

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

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <RoleHero role="doctor" lang={lang}/>
        <div className="panel-grid-2">
          {/* COLUMN 1: LIVE QUEUE & PATIENT INFO */}
          <div className="panel-column glass-panel" style={{ padding: '1.25rem' }}>
            <div className="panel-header" style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="panel-title">
                  <Activity size={18} />
                  {lang === 'ar' ? 'طابور الطبيب' : 'Doctor Patient Waitlist'}
                </span>
              </div>
              <input
                type="date"
                className="form-input"
                style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>

            {queue.map((appt) => {
              const isEmergency = appt.emergencyOverride;
              return (
                <div
                  key={appt.id}
                  className={`queue-card-item glass-panel ${isEmergency ? 'emergency-border' : ''} ${selectedAppointmentId === appt.id ? 'selected' : ''}`}
                  onClick={() => handlePatientSelect(appt)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{lang === 'ar' ? appt.patient.fullNameAr : appt.patient.fullNameEn}</strong>
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
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{appt.appointmentTime}</span>
                    {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ' : 'Emergency'}</span>}
                  </div>
                </div>
              );
            })}

            {selectedPatient && (
              <div className="glass-panel" style={{ padding: '1rem', marginTop: '1.5rem', fontSize: '0.85rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>{lang === 'ar' ? 'ملف المريض الحالي' : 'Patient Summary'}</h4>
                <p>
                  <strong>{lang === 'ar' ? 'الاسم:' : 'Name:'}</strong>{' '}
                  {lang === 'ar' ? selectedPatient.fullNameAr : selectedPatient.fullNameEn}
                </p>
                <p><strong>{lang === 'ar' ? 'تاريخ الميلاد:' : 'DOB:'}</strong> {selectedPatient.dateOfBirth}</p>
                <p><strong>{lang === 'ar' ? 'الهاتف:' : 'Phone:'}</strong> {selectedPatient.phone}</p>

              </div>
            )}
          </div>

          {/* COLUMN 2: CLINICAL WORKSPACE */}
          <div className="panel-column glass-panel" style={{ padding: '1.25rem' }}>
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
              <div>
                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ color: 'var(--primary)', margin: 0 }}>
                      {lang === 'ar' ? 'ملف الكشف الطبي الموحد:' : 'Unified Clinical Workspace:'}{' '}
                      {lang === 'ar' ? selectedPatient.fullNameAr : selectedPatient.fullNameEn}
                    </h3>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {lang === 'ar' ? 'الجنس:' : 'Gender:'} {getGenderLabel(selectedPatient.gender)} | {lang === 'ar' ? 'تاريخ الميلاد:' : 'DOB:'} {selectedPatient.dateOfBirth}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => setViewingProfilePatientId(selectedPatient.id)}
                  >
                    <User size={14} />
                    {lang === 'ar' ? 'عرض الملف الشامل' : 'View Full Profile'}
                  </button>
                </div>

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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem', alignItems: 'start' }}>
                  {/* Left Column: Full Patient History at a glance */}
                  <div className="glass-panel" style={{ padding: '1rem', maxHeight: '70vh', overflowY: 'auto' }}>
                    <h4 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Activity size={18} color="var(--primary)" />
                      {lang === 'ar' ? 'سجل الزيارات السابقة' : 'Patient EMR History'}
                    </h4>
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
                  </div>

                  {/* Right Column: Active Consultation & Prescription Builder */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0 }}>{lang === 'ar' ? 'العلامات الحيوية الحالية' : 'Current Vitals'}</h4>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                          onClick={handlePopulateNormalVitals}
                        >
                          {lang === 'ar' ? 'علامات حيوية طبيعية' : 'Normal Vitals Preset'}
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>
  {lang === 'ar' ? 'ضغط الدم' : 'Blood Pressure'}
</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.blood_pressure}
                            onChange={(e) => setVitals({ ...vitals, blood_pressure: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>
  {lang === 'ar' ? 'معدل النبض (نبضة/دقيقة)' : 'Heart Rate (bpm)'}
</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.heart_rate}
                            onChange={(e) => setVitals({ ...vitals, heart_rate: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>
  {lang === 'ar' ? 'درجة الحرارة (°م)' : 'Temperature (°C)'}
</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.temperature}
                            onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>
  {lang === 'ar' ? 'الوزن (كجم)' : 'Weight (kg)'}
</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.weight}
                            onChange={(e) => setVitals({ ...vitals, weight: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Symptoms & Diagnosis */}
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="form-label">{t('symptoms')}</label>
                        <textarea
                          rows={2}
                          className="form-input"
                          value={symptoms}
                          onChange={(e) => setSymptoms(e.target.value)}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <label className="form-label" style={{ margin: 0 }}>{t('diagnosis')} *</label>
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
                        <label className="form-label">{t('treatment')}</label>
                        <textarea
                          rows={2}
                          className="form-input"
                          value={treatment}
                          onChange={(e) => setTreatment(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Prescription Builder */}
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <h4 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Sliders size={16} color="var(--primary)" />
                        {lang === 'ar' ? 'الوصفة الطبية السريعة' : 'Rapid Prescription Builder'}
                      </h4>
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
                    </div>

                    {/* Labs orders */}
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <h4 style={{ marginBottom: '0.5rem' }}>{lang === 'ar' ? 'طلب فحوصات مخبرية / أشعة' : 'Order Diagnostic Tests'}</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {clinicalServices
                          .filter((s) => s.category === 'LABORATORY' || s.category === 'RADIOLOGY')
                          .map((svc) => (
                            <label
                              key={svc.id}
                              className="glass-panel"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer', padding: '4px 8px', margin: 0, background: orderedTests.includes(svc.id) ? 'rgba(20, 184, 166, 0.15)' : 'rgba(255,255,255,0.03)' }}
                            >
                              <input
                                type="checkbox"
                                checked={orderedTests.includes(svc.id)}
                                onChange={() => handleToggleTest(svc.id)}
                              />
                              <span>{lang === 'ar' ? svc.labelAr : svc.labelEn}</span>
                            </label>
                          ))}

                      </div>

                      {!isFinalizingVisit && (
                        <div style={{ marginTop: '0.9rem' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.45rem' }}>
                            {lang === 'ar' ? 'إضافة فحص غير موجود في القائمة' : 'Add a test not in the catalogue'}
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              gap: '0.5rem',
                              flexWrap: 'wrap'
                            }}
                          >
                            <input
                              type="text"
                              value={customTestName}
                              onChange={(event) => setCustomTestName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  handleAddCustomTest();
                                }
                              }}
                              placeholder={
                                lang === 'ar'
                                  ? 'مثال: CRP أو Thyroid Function Test'
                                  : 'Example: CRP or Thyroid Function Test'
                              }
                              style={{
                                flex: '1 1 260px',
                                minWidth: 0
                              }}
                            />

                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleAddCustomTest}
                            >
                              {lang === 'ar' ? 'إضافة الفحص' : 'Add Test'}
                            </button>
                          </div>

                          {customTests.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.5rem',
                                marginTop: '0.65rem'
                              }}
                            >
                              {customTests.map((testName) => (
                                <div
                                  key={testName}
                                  className="glass-panel"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.45rem',
                                    padding: '5px 8px',
                                    margin: 0,
                                    fontSize: '0.8rem'
                                  }}
                                >
                                  <span>{testName}</span>

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveCustomTest(testName)}
                                    aria-label={
                                      lang === 'ar'
                                        ? `حذف ${testName}`
                                        : `Remove ${testName}`
                                    }
                                    style={{
                                      border: 0,
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      fontWeight: 700,
                                      color: 'var(--danger)'
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 'bold' }}
                      onClick={handleSaveConsultation}
                      disabled={isSavingConsultation || isReadOnlyVisit}
                    >
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
                    </button>
                  </div>
                </div>
                </fieldset>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar' ? 'يرجى اختيار مريض من الطابور لبدء الكشف الطبي.' : 'Please select a patient from the queue to start the consultation.'}</p>
              </div>
            )}
          </div>
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
