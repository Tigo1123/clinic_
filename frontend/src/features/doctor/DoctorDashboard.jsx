import { useCallback, useEffect, useState } from 'react';
import { Activity, Lock, MessageCircle, Printer, Sliders, Stethoscope, User } from 'lucide-react';
import { PatientProfileModal, PostVisitSummaryModal } from '../clinical/ClinicalModals';
import { getWhatsAppLink } from '../reception/clinicData';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import { staffSocket as socket } from '../../services/staffSocket';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';
import { apiRequest } from '../../services/apiClient';

export default function DoctorDashboard({ user, lang, t }) {
  const [queue, setQueue] = useState([]);
  const [filterDate, setFilterDate] = useState(clinicDateString());
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');

  // EMR Details
  const [historyData, setHistoryData] = useState([]);
  const [activeSummaryId, setActiveSummaryId] = useState(null);
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);

  // Lab-return / consultation finalization
  const [isFinalizingVisit, setIsFinalizingVisit] = useState(false);
  const [currentRecordId, setCurrentRecordId] = useState(null);
  const [currentLabResults, setCurrentLabResults] = useState([]);

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

  // Lab services selectors
  const [clinicalServices, setClinicalServices] = useState([]);
  const [orderedTests, setOrderedTests] = useState([]);
  const [customTestName, setCustomTestName] = useState('');
  const [customTests, setCustomTests] = useState([]);

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

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

      if (appt.status === 'IN_CONSULTATION') {
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
      fetchPatientHistory(appt.patient.id);

      if (existingSummary) {
        setIsFinalizingVisit(true);
        setCurrentRecordId(existingSummary.id);
        setCurrentLabResults(existingSummary.labOrders || []);

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
      return;
    }

    if (selectedDrug) {
      const drugObj = drugs.find((d) => d.id === selectedDrug);
      if (!drugObj) return;

      setPrescribedItems([
        ...prescribedItems,
        {
          drugId: selectedDrug,
          nameAr: drugObj.labelAr,
          nameEn: drugObj.labelEn,
          dosage,
          duration,
          instructionsAr: instrAr,
          instructionsEn: instrEn,
          qtyPrescribed: parsedQuantity
        }
      ]);
    } else {
      setPrescribedItems([
        ...prescribedItems,
        {
          customDrugName: customName,
          nameAr: customName,
          nameEn: customName,
          dosage,
          duration,
          instructionsAr: instrAr,
          instructionsEn: instrEn,
          qtyPrescribed: parsedQuantity
        }
      ]);
    }

    setSelectedDrug('');
    setCustomDrugName('');
    setDosage('');
    setDuration('');
    setQuantity('');
    setInstrAr('');
    setInstrEn('');
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

      fetchDoctorQueue();
    } catch (err) {
      console.error(err);

      setErrorMsg(
        lang === 'ar'
          ? 'فشل حفظ الكشف الطبي.'
          : 'EMR saving failed.'
      );
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
                        appt.status === 'WAITING_LAB'
                          ? 'badge badge-warning'
                          : 'badge badge-success'
                      }
                    >
                      {getAppointmentStatusLabel(appt.status)}
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

                {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem', width: '100%', marginBottom: '1rem' }}>{errorMsg}</div>}
                {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem', width: '100%', marginBottom: '1rem' }}>{successMsg}</div>}

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
                      <div style={{ marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                          {lang === 'ar' ? 'نماذج أدوية سريعة:' : 'Quick Medications:'}
                        </span>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.25rem',
                            marginTop: '0.35rem'
                          }}
                        >
                          {drugs.slice(0, 10).map((drug) => (
                            <button
                              key={drug.id}
                              type="button"
                              className="btn btn-secondary"
                              style={{
                                padding: '3px 8px',
                                fontSize: '0.7rem',
                                textTransform: 'none',
                                background:
                                  selectedDrug === drug.id
                                    ? 'rgba(0,120,255,0.15)'
                                    : 'rgba(255,255,255,0.05)'
                              }}
                              onClick={() => {
                                setSelectedDrug(drug.id);
                                setCustomDrugName('');
                              }}
                            >
                              {lang === 'ar' ? drug.labelAr : drug.labelEn}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '0.5rem' }}>
                        <div>
                          <select
                            className="form-input"
                            value={selectedDrug}
                            disabled={Boolean(customDrugName.trim())}
                            onChange={(e) => {
                              setSelectedDrug(e.target.value);
                              if (e.target.value) setCustomDrugName('');
                            }}
                          >
                            <option value="">
                              {lang === 'ar' ? 'اختر الدواء...' : 'Medication...'}
                            </option>

                            {drugs.map((d) => (
                              <option key={d.id} value={d.id}>
                                {lang === 'ar' ? d.labelAr : d.labelEn}
                              </option>
                            ))}
                          </select>

                          <div
                            style={{
                              textAlign: 'center',
                              fontSize: '0.7rem',
                              opacity: 0.7,
                              margin: '5px 0'
                            }}
                          >
                            {lang === 'ar' ? 'أو' : 'OR'}
                          </div>

                          <input
                            type="text"
                            className="form-input"
                            disabled={Boolean(selectedDrug)}
                            placeholder={
                              lang === 'ar'
                                ? 'اكتب اسم الدواء يدويًا'
                                : 'Type medication name manually'
                            }
                            value={customDrugName}
                            onChange={(e) => {
                              setCustomDrugName(e.target.value);
                              if (e.target.value) setSelectedDrug('');
                            }}
                          />

                          <div
                            style={{
                              fontSize: '0.68rem',
                              opacity: 0.7,
                              marginTop: '5px'
                            }}
                          >
                            {lang === 'ar'
                              ? 'استخدم اختيار الدواء أو الكتابة اليدوية، وليس الاثنين معًا.'
                              : 'Use either the medication list or manual entry, not both.'}
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            placeholder={
  lang === 'ar'
    ? 'الجرعة، مثال: 500mg'
    : 'Dosage, e.g. 500mg'
}
                            className="form-input"
                            value={dosage}
                            onChange={(e) => setDosage(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: '2px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {quickDosagePresets.map(p => (
                              <button
                                key={p}
                                type="button"
                                style={{ padding: '2px 4px', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                onClick={() => setDosage(p)}
                              >
                                {lang === 'ar' ? preset.ar : preset.en}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            placeholder={
  lang === 'ar'
    ? 'مدة العلاج، مثال: 5 أيام'
    : 'Duration, e.g. 5 days'
}
                            className="form-input"
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: '2px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {quickDurationPresets.map((preset) => (
                              <button
                                key={preset.value}
                                type="button"
                                style={{ padding: '2px 4px', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                onClick={() => setDuration(preset.value)}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          placeholder={lang === 'ar' ? 'الكمية' : 'Quantity'}
                          aria-label={lang === 'ar' ? 'الكمية الموصوفة' : 'Prescribed quantity'}
                          className="form-input"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder={
  lang === 'ar'
    ? 'تعليمات الدواء بالعربية'
    : 'Medication instructions in Arabic'
}
                          className="form-input"
                          value={instrAr}
                          onChange={(e) => setInstrAr(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder={
  lang === 'ar'
    ? 'تعليمات الدواء بالإنجليزية'
    : 'Medication instructions in English'
}
                          className="form-input"
                          value={instrEn}
                          onChange={(e) => setInstrEn(e.target.value)}
                        />
                      </div>
                      <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: '0.5rem', padding: '6px' }} onClick={handleAddDrugToRx}>
                        {t('prescribe')}
                      </button>

                      {/* Prescribed Items Table */}
                      {prescribedItems.length > 0 && (
                        <table className="staff-table" style={{ fontSize: '0.75rem', marginTop: '0.75rem' }}>
                          <thead>
                            <tr>
                              <th>{lang === 'ar' ? 'الدواء' : 'Medication'}</th>
                              <th>{lang === 'ar' ? 'الجرعة' : 'Dosage'}</th>
                              <th>{lang === 'ar' ? 'المدة' : 'Duration'}</th>
                              <th>{lang === 'ar' ? 'الكمية' : 'Quantity'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {prescribedItems.map((item, idx) => (
                              <tr key={idx}>
                                <td>{lang === 'ar' ? item.nameAr : item.nameEn}</td>
                                <td>{item.dosage}</td>
                                <td>{item.duration}</td>
                                <td>{item.qtyPrescribed}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
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
