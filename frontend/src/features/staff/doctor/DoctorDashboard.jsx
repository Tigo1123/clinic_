import { useCallback, useEffect, useState, useRef } from 'react';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FlaskConical, Lock, MessageCircle, Printer, RefreshCw, Search, Sliders, Stethoscope, User, Users, X } from 'lucide-react';
import { PatientProfileModal, PostVisitSummaryModal } from '../clinical/ClinicalModals';
import { getWhatsAppLink } from '../../../utils/clinicData';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { staffSocket as socket } from '../../../services/staff/staffSocket';
import RoleHero from '../components/RoleHero';
import { clinicDateString } from '../../../utils/clinicTime';
import { staffApiRequest as apiRequest } from '../../../services/apiClient';
import MedicineCombobox from './MedicineCombobox';
import { doctorPrescriptionItem, duplicatePrescriptionItem, validateDoctorPrescriptionEntry } from './doctorPrescription';
import './doctorDashboard.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';
import FacilityIdentityLine from '../components/FacilityIdentityLine';
import { useStaffNav } from '../staffShellContext';

const DEFAULT_VITALS = { blood_pressure: '120/80', heart_rate: '75', temperature: '37.0', weight: '70' };

export default function DoctorDashboard({ user, lang, t }) {
  const branding = useFacilityBranding();
  const [queue, setQueue] = useState([]);
  const [queueLoadError, setQueueLoadError] = useState(false);
  const [filterDate, setFilterDate] = useState(clinicDateString());
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [selectedAppointmentStatus, setSelectedAppointmentStatus] = useState('');

  // EMR Details & Previous Visits
  const [historyData, setHistoryData] = useState([]);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [activeSummaryId, setActiveSummaryId] = useState(null);
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);
  const summaryReturnFocusRef = useRef(null);

  // Stepper state (1: Vitals & symptoms, 2: Diagnosis & plan, 3: Prescription, 4: Lab tests, 5: Review & complete)
  const [consultationStep, setConsultationStep] = useState(1);

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
  const [vitals, setVitals] = useState(DEFAULT_VITALS);

  // Prescription builder
  const [drugs, setDrugs] = useState([]);
  const [catalogLoadError, setCatalogLoadError] = useState(false);
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
  const [prescriptionInvalidField, setPrescriptionInvalidField] = useState('');
  const [consultationInvalidField, setConsultationInvalidField] = useState('');

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
  const consultationSaveLock = useRef(false);
  const patientSelectionRequestRef = useRef(0);
  const [isSavingConsultation, setIsSavingConsultation] = useState(false);

  // Stepper definition
  const consultationSteps = [
    { id: 1, ar: 'العلامات والأعراض', en: 'Vitals and symptoms' },
    { id: 2, ar: 'التشخيص والخطة', en: 'Diagnosis and plan' },
    { id: 3, ar: 'الوصفة الطبية', en: 'Prescription' },
    { id: 4, ar: 'الفحوصات المخبرية', en: 'Lab tests' },
    { id: 5, ar: 'المراجعة والإنهاء', en: 'Review and complete' }
  ];

  // Register rail navigation with StaffShell
  useStaffNav({
    items: [
      {
        id: 'today',
        label: lang === 'ar' ? 'اليوم' : 'Today',
        icon: CalendarDays,
        count: queue.length
      }
    ],
    activeId: 'today',
    onSelect: (id) => {
      if (id === 'today') {
        setFilterDate(clinicDateString());
      }
    },
    roleLabel: lang === 'ar' ? 'طبيب' : 'Doctor'
  });

  // Diagnosis, Dosage and Duration presets
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
    if (!labels) return status?.replaceAll('_', ' ') || '-';
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
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load doctor queue');
          return res.json();
        })
        .then((data) => {
          if (Array.isArray(data)) {
            setQueueLoadError(false);
            setQueue(data);
          } else {
            throw new Error('Queue response is not an array');
          }
        })
        .catch(() => {
          setQueueLoadError(true);
        });
    }
  }, [user.doctorId, filterDate]);

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

  const loadCatalogs = useCallback(async () => {
    let hasError = false;
    try {
      const res = await fetchWithAuth('/api/records/drugs');
      if (res.ok) {
        const data = await res.json();
        setDrugs(Array.isArray(data) ? data : []);
      } else {
        hasError = true;
      }
    } catch (err) {
      console.error(err);
      hasError = true;
    }

    try {
      const data = await apiRequest('/api/billing/services');
      setClinicalServices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      hasError = true;
    }

    setCatalogLoadError(hasError);
  }, []);

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs]);

  const fetchPatientHistory = (patientId, selectionRequestId = patientSelectionRequestRef.current) => {
    if (!patientId) return;
    fetchWithAuth(`/api/patients/${patientId}/history`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('History load failed');
        }
        return res.json();
      })
      .then((data) => {
        if (patientSelectionRequestRef.current === selectionRequestId) {
          setHistoryLoadError(false);
          setHistoryData(data.history || []);
        }
      })
      .catch((err) => {
        if (patientSelectionRequestRef.current === selectionRequestId) {
          console.error(err);
          setHistoryLoadError(true);
        }
      });
  };

  const handlePatientSelect = async (appt) => {
    const selectionRequestId = ++patientSelectionRequestRef.current;
    setErrorMsg('');
    setSuccessMsg('');
    setHistoryLoadError(false);

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

    if (appt.status === 'WAITING_LAB') {
      setErrorMsg(
        lang === 'ar'
          ? 'هذا المريض بانتظار نتائج المختبر. سيتم إعادته للطبيب تلقائيًا بعد اكتمال النتائج.'
          : 'This patient is waiting for laboratory results. The visit will return automatically when the results are complete.'
      );
      return;
    }

    try {
      let existingSummary = null;

      if (appt.medicalRecordId || appt.status === 'COMPLETED') {
        const summaryRes = await fetchWithAuth(`/api/records/${appt.id}/summary`);
        if (patientSelectionRequestRef.current !== selectionRequestId) return;

        if (summaryRes.ok) {
          existingSummary = await summaryRes.json();
          if (patientSelectionRequestRef.current !== selectionRequestId) return;
        } else if (summaryRes.status === 404) {
          throw new Error(lang === 'ar'
            ? 'تعذر تحميل السجل الطبي الحالي. لم يتم فتح الزيارة للتعديل.'
            : 'The existing clinical record could not be loaded. This visit was not opened for editing.');
        } else if (summaryRes.status !== 404) {
          const summaryError = await summaryRes.json().catch(() => ({}));
          if (patientSelectionRequestRef.current !== selectionRequestId) return;
          const apiError = typeof summaryError.error === 'object' ? summaryError.error : null;
          const error = new Error(apiErrorMessage(summaryError, lang === 'ar' ? 'تعذر تحميل الكشف الطبي.' : 'Failed to load consultation.'));
          error.code = apiError?.code;
          throw error;
        }
      }

      if (appt.status === 'CHECKED_IN') {
        const statusRes = await fetchWithAuth(`/api/appointments/${appt.id}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'IN_CONSULTATION' })
        });
        if (patientSelectionRequestRef.current !== selectionRequestId) return;

        const statusData = await statusRes.json().catch(() => ({}));
        if (patientSelectionRequestRef.current !== selectionRequestId) return;

        if (!statusRes.ok) {
          setErrorMsg(
            apiErrorMessage(
              statusData,
              lang === 'ar'
                ? 'تعذر بدء الكشف الطبي لهذا الموعد.'
                : 'Unable to start consultation for this appointment.'
            )
          );
          return;
        }
      }

      setSelectedPatient(appt.patient);
      setSelectedAppointmentId(appt.id);
      setSelectedAppointmentStatus(appt.status === 'CHECKED_IN' ? 'IN_CONSULTATION' : appt.status);
      setConsultationStep(1);
      fetchPatientHistory(appt.patient.id, selectionRequestId);

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
        } else {
          setVitals(DEFAULT_VITALS);
        }

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
        setSymptoms('');
        setDiagnosis('');
        setTreatment('');
        setClinicalNotes('');
        setVitals(DEFAULT_VITALS);
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
      }

      fetchDoctorQueue();
    } catch (err) {
      if (patientSelectionRequestRef.current !== selectionRequestId) return;
      console.error(err);

      setErrorMsg(err.code === 'CLINICAL_DATA_UNREADABLE'
        ? (lang === 'ar'
          ? 'المعلومات السريرية لهذه الزيارة غير متاحة. لم يتم فتح الزيارة للتعديل.'
          : 'Clinical information for this visit is unavailable. The visit was not opened for editing.')
        : (err.message || (lang === 'ar'
          ? 'حدث خطأ أثناء فتح الكشف الطبي.'
          : 'An error occurred while opening the consultation.')));
    }
  };

  const focusClinicalField = (fieldId) => {
    requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
  };

  const handleAddDrugToRx = (event) => {
    event?.preventDefault();
    const parsedQuantity = Number(quantity);
    const customName = customDrugName.trim();

    const invalidField = validateDoctorPrescriptionEntry({ selectedDrug, customDrugName: customName, dosage, duration, quantity });
    if (invalidField) {
      const validation = {
        medicine: { id: medicineMode === 'custom' ? 'doctor-custom-medicine' : 'doctor-medicine-search', ar: 'يرجى اختيار الدواء أو إدخال اسم الدواء المكتوب يدويًا.', en: 'Please select a medicine or enter the custom medicine name.' },
        dosage: { id: 'doctor-rx-dosage', ar: 'يرجى إدخال الجرعة والتكرار.', en: 'Please enter the dosage and frequency.' },
        duration: { id: 'doctor-rx-duration', ar: 'يرجى تحديد مدة العلاج.', en: 'Please specify the treatment duration.' },
        quantity: { id: 'doctor-rx-quantity', ar: 'يرجى تحديد كمية صحيحة أكبر من صفر.', en: 'Please enter a valid quantity greater than zero.' }
      }[invalidField];
      setConsultationStep(3);
      setPrescriptionInvalidField(invalidField);
      setPrescriptionMessage(lang === 'ar' ? validation.ar : validation.en);
      focusClinicalField(validation.id);
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
    setPrescriptionInvalidField('');
    setPrescriptionMessage('');
  };

  const handleEditPrescriptionItem = (item, index) => {
    setMedicineMode(item.drugId ? 'official' : 'custom');
    setSelectedDrug(item.drugId || '');
    setCustomDrugName(item.customDrugName || '');
    setDosage(item.dosage);
    setDuration(item.duration);
    setQuantity(String(item.qtyPrescribed));
    setInstrAr(item.instructionsAr || '');
    setInstrEn(item.instructionsEn || '');
    setEditingPrescriptionIndex(index);
    setPrescriptionMessage('');
    setConsultationStep(3);
    focusClinicalField('doctor-rx-dosage');
  };

  const handleRemovePrescriptionItem = (index) => {
    setPrescribedItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (editingPrescriptionIndex === index) {
      setEditingPrescriptionIndex(-1);
      setSelectedDrug('');
      setCustomDrugName('');
    } else if (editingPrescriptionIndex > index) {
      setEditingPrescriptionIndex((current) => current - 1);
    }
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

  const handleSaveConsultation = async (event) => {
    event?.preventDefault();
    if (isReadOnlyVisit) {
      setErrorMsg(lang === 'ar' ? 'هذه الزيارة مكتملة ولا يمكن تعديلها.' : 'This visit is completed and cannot be edited.');
      return;
    }
    if (consultationSaveLock.current) {
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');
    setConsultationInvalidField('');

    const isFinalize = isFinalizingVisit && currentRecordId;
    const hasLabOrders =
      orderedTests.length > 0 ||
      customTests.length > 0;

    if (!isFinalize && !hasLabOrders && !diagnosis.trim()) {
      setConsultationInvalidField('diagnosis');
      setErrorMsg(lang === 'ar' ? 'يرجى إدخال التشخيص قبل إنهاء الزيارة.' : 'Please enter the diagnosis before completing the visit.');
      setConsultationStep(2);
      focusClinicalField('doctor-diagnosis');
      return;
    }

    if (isFinalize && !diagnosis.trim()) {
      setConsultationInvalidField('diagnosis');
      setErrorMsg(lang === 'ar' ? 'يرجى إدخال التشخيص قبل إنهاء الزيارة.' : 'Please enter the diagnosis before completing the visit.');
      setConsultationStep(2);
      focusClinicalField('doctor-diagnosis');
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
      setConsultationStep(1);

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

        {/* ── Daily Summary Strip (One-line ledger strip) ── */}
        <section className="doctor-daily-summary" aria-labelledby="doctor-daily-summary-title">
          <div className="doctor-section-heading sr-only">
            <div>
              <span>{lang === 'ar' ? 'نظرة سريرية سريعة' : 'Clinical snapshot'}</span>
              <h2 id="doctor-daily-summary-title">{lang === 'ar' ? 'ملخص اليوم' : "Today's summary"}</h2>
            </div>
            <time dateTime={filterDate} dir="ltr">{new Date(`${filterDate}T12:00:00`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { weekday: 'long', day: 'numeric', month: 'long' })}</time>
          </div>
          <div className="doctor-daily-summary__strip">
            <div className="doctor-daily-summary__meta">
              <span className="ui-section-label">{lang === 'ar' ? 'ملخص اليوم' : "Today's summary"}</span>
              <time dateTime={filterDate} className="ui-mono doctor-daily-summary__time" dir="ltr">
                {new Date(`${filterDate}T12:00:00`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { weekday: 'short', day: 'numeric', month: 'short' })}
              </time>
            </div>
            <div className="doctor-metrics-grid">
              {dailyMetrics.map((metric) => {
                const MetricIcon = metric.icon;
                return (
                  <article className={`doctor-metric doctor-metric--${metric.key}`} key={metric.key}>
                    <span className="doctor-metric__icon" aria-hidden="true"><MetricIcon size={15} /></span>
                    <div className="doctor-metric__body">
                      <strong className="ui-mono">{metric.value}</strong>
                      <span>{lang === 'ar' ? metric.ar : metric.en}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Main Operational Grid (Queue + Workspace) ── */}
        <div className="doctor-operational-grid">
          {/* COLUMN 1: NARROW QUEUE */}
          <aside className="doctor-queue-panel" aria-labelledby="doctor-queue-title">
            <div className="doctor-queue-header">
              <div className="doctor-queue-title-row">
                <span className="panel-title" id="doctor-queue-title">
                  {lang === 'ar' ? 'طابور الطبيب' : 'My queue'}
                </span>
                <span className="doctor-queue-count">{queue.length}</span>
              </div>
              <div className="doctor-queue-controls">
                <div className="doctor-date-controls">
                  <button type="button" onClick={() => changeFilterDate(-1)} aria-label={lang === 'ar' ? 'اليوم السابق' : 'Previous day'}><ChevronLeft size={14} /></button>
                  <button type="button" className="doctor-date-today" onClick={() => setFilterDate(clinicDateString())}>{lang === 'ar' ? 'اليوم' : 'Today'}</button>
                  <button type="button" onClick={() => changeFilterDate(1)} aria-label={lang === 'ar' ? 'اليوم التالي' : 'Next day'}><ChevronRight size={14} /></button>
                  <button type="button" onClick={fetchDoctorQueue} aria-label={lang === 'ar' ? 'تحديث الطابور' : 'Refresh queue'}><RefreshCw size={13} /></button>
                </div>
                <label className="doctor-date-picker">
                  <CalendarDays size={13} aria-hidden="true" />
                  <span className="sr-only">{lang === 'ar' ? 'تاريخ الطابور' : 'Queue date'}</span>
                  <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
                </label>
              </div>
            </div>

            <div className="doctor-queue-list">
              {queueLoadError && (
                <div role="alert" className="patient-alert error">
                  {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'} <button type="button" onClick={fetchDoctorQueue}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
                </div>
              )}
              {queue.length === 0 && (
                <div className="doctor-queue-empty" role="status">
                  <Stethoscope size={28} aria-hidden="true" />
                  <strong>{lang === 'ar' ? 'لا يوجد مرضى في طابورك لهذا اليوم.' : 'There are no patients in your queue for this day.'}</strong>
                  <span>{lang === 'ar' ? 'يمكنك اختيار تاريخ آخر من الأعلى.' : 'You can choose another date above.'}</span>
                </div>
              )}
              {queue.map((appt) => {
                const isEmergency = appt.emergencyOverride;
                const queueStatusClass = appt.status === 'CHECKED_IN'
                  ? (appt.consultationReady ? 'waiting' : 'payment-pending')
                  : ({ IN_CONSULTATION: 'in-consultation', COMPLETED: 'completed', WAITING_LAB: 'lab-pending', CANCELLED: 'cancelled', NO_SHOW: 'no-show', SCHEDULED: 'scheduled', CONFIRMED: 'confirmed' }[appt.status] || 'scheduled');
                return (
                  <button
                    type="button"
                    key={appt.id}
                    className={`doctor-queue-card ${isEmergency ? 'emergency-border' : ''} ${selectedAppointmentId === appt.id ? 'selected' : ''}`}
                    onClick={() => handlePatientSelect(appt)}
                    aria-pressed={selectedAppointmentId === appt.id}
                  >
                    <span className="doctor-queue-time ui-mono">
                      <bdi dir="ltr">{appt.appointmentTime || '—'}</bdi>
                    </span>
                    <span className="doctor-queue-body">
                      <strong className="doctor-queue-name">{(lang === 'ar' ? appt.patient.fullNameAr : appt.patient.fullNameEn) || appt.patient.fullNameAr || appt.patient.fullNameEn}</strong>
                      <span className={`badge doctor-status doctor-status--${queueStatusClass}`}>
                        {appt.status === 'CHECKED_IN'
                          ? (
                            appt.consultationReady
                              ? (lang === 'ar' ? 'بانتظار الكشف' : 'Waiting')
                              : (lang === 'ar' ? 'بانتظار الدفع' : 'Payment Pending')
                          )
                          : getAppointmentStatusLabel(appt.status)}
                      </span>
                    </span>
                    {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ' : 'Emergency'}</span>}
                    <bdi className="doctor-mrn sr-only" dir="ltr">{appt.patient.fileNumber || '—'}</bdi>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* COLUMN 2: CLINICAL WORKSPACE */}
          <main className="doctor-clinical-workspace" aria-label={lang === 'ar' ? 'مساحة الكشف الطبي' : 'Clinical workspace'}>
            {errorMsg && (
              <div
                className="badge badge-danger doctor-alert-banner"
                role="alert"
              >
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div
                className="badge badge-success doctor-alert-banner"
              >
                {successMsg}
              </div>
            )}

            {selectedPatient ? (
              <div className="doctor-selected-workspace">
                {/* ── Patient Context Header ── */}
                <header className="doctor-patient-context">
                  <div className="doctor-patient-context__identity">
                    <span className="ui-section-label">{lang === 'ar' ? 'المريض الحالي' : 'Current patient'}</span>
                    <h2 id="doc-patient-title">{(lang === 'ar' ? selectedPatient.fullNameAr : selectedPatient.fullNameEn) || selectedPatient.fullNameAr || selectedPatient.fullNameEn}</h2>
                    <div className="doctor-patient-context__meta">
                      <span>{getGenderLabel(selectedPatient.gender)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedPatientAge === null ? '—' : (lang === 'ar' ? `${selectedPatientAge} سنة` : `${selectedPatientAge} years`)}</span>
                      <span aria-hidden="true">·</span>
                      <bdi className="doctor-mrn" dir="ltr">{selectedPatient.fileNumber || '—'}</bdi>
                      <span aria-hidden="true">·</span>
                      <span>{lang === 'ar' ? 'موعد' : 'Appointment'} <bdi className="ui-mono" dir="ltr">{selectedAppointment?.appointmentTime || '—'}</bdi></span>
                      <span className="badge badge-info">{getAppointmentStatusLabel(selectedAppointmentStatus)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary doctor-open-patient-file"
                    onClick={() => setViewingProfilePatientId(selectedPatient.id)}
                  >
                    <User size={15} aria-hidden="true" />
                    {lang === 'ar' ? 'فتح ملف المريض' : 'Open Patient File'}
                  </button>
                </header>

                {/* ── One-line Vitals Strip once recorded ── */}
                {(vitals.blood_pressure || vitals.heart_rate || vitals.temperature || vitals.weight || symptoms) && (
                  <div className="doctor-vitals-strip">
                    <div className="doctor-vital-cell">
                      <span className="doctor-vital-label">{lang === 'ar' ? 'ضغط الدم' : 'Blood pressure'}</span>
                      <span className="doctor-vital-value ui-mono">{vitals.blood_pressure || '—'}</span>
                    </div>
                    <div className="doctor-vital-cell">
                      <span className="doctor-vital-label">{lang === 'ar' ? 'معدل النبض' : 'Heart rate'}</span>
                      <span className="doctor-vital-value ui-mono">{vitals.heart_rate ? `${vitals.heart_rate} bpm` : '—'}</span>
                    </div>
                    <div className="doctor-vital-cell">
                      <span className="doctor-vital-label">{lang === 'ar' ? 'درجة الحرارة' : 'Temperature'}</span>
                      <span className="doctor-vital-value ui-mono">{vitals.temperature ? `${vitals.temperature} °C` : '—'}</span>
                    </div>
                    <div className="doctor-vital-cell">
                      <span className="doctor-vital-label">{lang === 'ar' ? 'الوزن' : 'Weight'}</span>
                      <span className="doctor-vital-value ui-mono">{vitals.weight ? `${vitals.weight} kg` : '—'}</span>
                    </div>
                    {symptoms && (
                      <div className="doctor-vital-symptoms">
                        <span className="doctor-vital-label">{lang === 'ar' ? 'الأعراض:' : 'Symptoms:'}</span>
                        <span className="doctor-vital-symptoms__text">{symptoms}</span>
                      </div>
                    )}
                  </div>
                )}

                {isReadOnlyVisit && (
                  <div className="badge badge-info doctor-readonly-badge" role="status">
                    {lang === 'ar' ? 'زيارة مكتملة — للعرض فقط' : 'Completed visit — read only'}
                  </div>
                )}

                {isReadOnlyVisit && (historicalPrescriptions.length > 0 || historicalLabOrders.length > 0) && (
                  <div className="ui-panel doctor-historical-summary">
                    <h4 className="doctor-historical-summary__title">{lang === 'ar' ? 'ملخص الوصفة والفحوصات' : 'Prescription and laboratory summary'}</h4>
                    {historicalPrescriptions.length > 0 && (
                      <div>
                        <strong>{lang === 'ar' ? 'الوصفة الطبية' : 'Prescription'}</strong>
                        {historicalPrescriptions.map((item, index) => (
                          <div key={item.id || index} className="doctor-historical-summary__item">
                            {lang === 'ar' ? item.drugNameAr : item.drugNameEn}
                            {' — '}{item.dosage} · {item.duration} · {lang === 'ar' ? `الكمية ${item.qtyPrescribed}` : `Qty ${item.qtyPrescribed}`}
                          </div>
                        ))}
                      </div>
                    )}
                    {historicalLabOrders.length > 0 && (
                      <div className="doctor-historical-summary__group">
                        <strong>{lang === 'ar' ? 'الفحوصات المخبرية' : 'Laboratory tests'}</strong>
                        {historicalLabOrders.map((item, index) => (
                          <div key={item.id || index} className="doctor-historical-summary__item">
                            {lang === 'ar' ? item.serviceNameAr : item.serviceNameEn}
                            {item.resultValue ? ` — ${item.resultValue}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Collapsible Patient EMR History ── */}
                <section className="doctor-clinical-section doctor-history-panel" aria-labelledby="doctor-history-title">
                  <button
                    type="button"
                    className="doctor-history-toggle"
                    onClick={() => setIsHistoryExpanded((open) => !open)}
                    aria-expanded={isHistoryExpanded}
                  >
                    <span className="doctor-history-toggle__title" id="doctor-history-title">
                      <Activity size={16} aria-hidden="true" />
                      {lang === 'ar' ? 'سجل الزيارات السابقة' : 'Patient EMR History'}
                      <span className="ui-mono doctor-history-badge">({historyData.length})</span>
                    </span>
                    {isHistoryExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                  </button>
                  {isHistoryExpanded && (
                    <div className="emr-timeline">
                      {historyLoadError && (
                        <div role="alert" className="patient-alert error">
                          {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'}{' '}
                          <button type="button" onClick={() => fetchPatientHistory(selectedPatient?.id, patientSelectionRequestRef.current)}>
                            {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                          </button>
                        </div>
                      )}
                      {historyData.length === 0 ? (
                        <p className="doctor-history-empty">{lang === 'ar' ? 'لا يوجد زيارات سابقة مسجلة.' : 'No historical visits logged.'}</p>
                      ) : (
                        historyData.map((rec) => (
                          <div key={rec.id} className="timeline-card ui-panel doctor-timeline-card">
                            {rec.isLocked && (
                              <div className="lock-container-block">
                                <Lock size={12} color="var(--danger)" />
                                <span className="lock-label">{t('breakTheGlass')}</span>
                              </div>
                            )}
                            <div className={`timeline-details ${rec.isLocked ? 'locked-overlay' : ''}`}>
                              <div className="timeline-header">
                                <span>{new Date(rec.visitDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}</span>
                                <span className="timeline-doctor">{lang === 'ar' ? rec.doctorNameAr : rec.doctorNameEn}</span>
                              </div>
                              <div className="timeline-vitals">
                                <span>{lang === 'ar' ? 'الضغط:' : 'BP:'} {rec.vitalSigns?.blood_pressure || '-'}</span>
                                <span>{lang === 'ar' ? 'النبض:' : 'HR:'} {rec.vitalSigns?.heart_rate || '-'} {lang === 'ar' ? 'نبضة/دقيقة' : 'bpm'}</span>
                                <span>{lang === 'ar' ? 'الحرارة:' : 'Temp:'} {rec.vitalSigns?.temperature || '-'} °C</span>
                              </div>
                              <div className="timeline-row">
                                <strong>{t('symptoms')}:</strong> {rec.symptoms}
                              </div>
                              <div className="timeline-row">
                                <strong>{t('diagnosis')}:</strong> {rec.diagnosis}
                              </div>
                              <div className="timeline-row">
                                <strong>{t('treatment')}:</strong> {rec.treatment}
                              </div>
                              {!rec.isLocked && (
                                <div className="timeline-actions">
                                  <button
                                    type="button"
                                    className="btn btn-secondary timeline-summary-btn"
                                    onClick={(event) => {
                                      const targetId = rec.id || rec.recordId || rec.appointmentId;
                                      summaryReturnFocusRef.current = event.currentTarget;
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
                                          ? `${branding.displayNameAr} - ملخص الزيارة:\nالتشخيص: ${rec.diagnosis}\nالعلاج: ${rec.treatment}`
                                          : `${branding.displayNameEn} - Visit Summary:\nDiagnosis: ${rec.diagnosis}\nTreatment: ${rec.treatment}`
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-whatsapp timeline-whatsapp-btn"
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
                  )}
                </section>

                {/* ── Consultation Workflow (5 Steps Stepper) ── */}
                <fieldset className="doctor-consultation-form" disabled={isReadOnlyVisit}>
                  {!isReadOnlyVisit && (
                    <ol aria-label={lang === 'ar' ? 'خطوات الكشف الطبي' : 'Consultation steps'} className="doctor-consultation-stepper">
                      {consultationSteps.map((step) => {
                        const isCurrent = consultationStep === step.id;
                        const isPast = consultationStep > step.id;
                        return (
                          <li key={step.id} className={`doctor-stepper-item ${isCurrent ? 'is-active' : ''} ${isPast ? 'is-past' : ''}`}>
                            <button
                              type="button"
                              className="doctor-stepper-btn"
                              onClick={() => setConsultationStep(step.id)}
                              aria-current={isCurrent ? 'step' : undefined}
                            >
                              <span className="doctor-stepper-bar" aria-hidden="true" />
                              <span className="doctor-stepper-label">
                                <span className="ui-mono">{step.id}</span> · {lang === 'ar' ? step.ar : step.en}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {/* STEP 1: Vitals and symptoms */}
                  <div className={`doctor-step-pane ${!isReadOnlyVisit && consultationStep !== 1 ? 'is-hidden' : ''}`}>
                    <section className="doctor-clinical-section doctor-vitals-section" aria-labelledby="doctor-vitals-title">
                      <div className="doctor-clinical-section__heading">
                        <h3 id="doctor-vitals-title">{lang === 'ar' ? 'العلامات الحيوية والأعراض' : 'Vitals and symptoms'}</h3>
                        <button
                          type="button"
                          className="btn btn-secondary doctor-vitals-preset-btn"
                          onClick={handlePopulateNormalVitals}
                        >
                          {lang === 'ar' ? 'علامات حيوية طبيعية' : 'Normal Vitals Preset'}
                        </button>
                      </div>
                      <div className="doctor-vitals-grid">
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-bp">{lang === 'ar' ? 'ضغط الدم' : 'Blood Pressure'}</label>
                          <input id="doctor-vital-bp" type="text" className="form-input" value={vitals.blood_pressure} onChange={(e) => setVitals({ ...vitals, blood_pressure: e.target.value })} />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-heart-rate">{lang === 'ar' ? 'معدل النبض (نبضة/دقيقة)' : 'Heart Rate (bpm)'}</label>
                          <input id="doctor-vital-heart-rate" type="text" className="form-input" value={vitals.heart_rate} onChange={(e) => setVitals({ ...vitals, heart_rate: e.target.value })} />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-temperature">{lang === 'ar' ? 'درجة الحرارة (°م)' : 'Temperature (°C)'}</label>
                          <input id="doctor-vital-temperature" type="text" className="form-input" value={vitals.temperature} onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })} />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-vital-weight">{lang === 'ar' ? 'الوزن (كجم)' : 'Weight (kg)'}</label>
                          <input id="doctor-vital-weight" type="text" className="form-input" value={vitals.weight} onChange={(e) => setVitals({ ...vitals, weight: e.target.value })} />
                        </div>
                      </div>
                      <div className="form-group doctor-form-group--mt">
                        <label className="form-label" htmlFor="doctor-symptoms">{t('symptoms')}</label>
                        <textarea id="doctor-symptoms" rows={3} className="form-input" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder={lang === 'ar' ? 'الأعراض والشكوى الرئيسية للمريض…' : 'Patient symptoms and chief complaint…'} />
                      </div>
                    </section>
                  </div>

                  {/* STEP 2: Diagnosis and plan */}
                  <div className={`doctor-step-pane ${!isReadOnlyVisit && consultationStep !== 2 ? 'is-hidden' : ''}`}>
                    <section className="doctor-clinical-section doctor-assessment-section" aria-labelledby="doctor-assessment-title">
                      <h3 className="doctor-clinical-section__title" id="doctor-assessment-title">{lang === 'ar' ? 'التقييم السريري وخطة العلاج' : 'Clinical assessment and treatment plan'}</h3>
                      <div className="form-group doctor-form-group--mb">
                        <div className="doctor-field-header">
                          <label className="form-label doctor-field-label--nomargin" htmlFor="doctor-diagnosis">{t('diagnosis')} *</label>
                          <span className="doctor-quick-diagnoses-title">{lang === 'ar' ? 'نماذج تشخيص سريعة:' : 'Quick Diagnoses:'}</span>
                        </div>
                        <div className="doctor-quick-diagnoses-list">
                          {commonDiagnoses.map((cd) => (
                            <button
                              key={cd.val}
                              type="button"
                              className="btn btn-secondary doctor-quick-diagnosis-btn"
                              onClick={() => { setDiagnosis(cd.val); setConsultationInvalidField(''); }}
                            >
                              {lang === 'ar' ? cd.labelAr : cd.labelEn}
                            </button>
                          ))}
                        </div>
                        <input
                          id="doctor-diagnosis"
                          type="text"
                          placeholder={lang === 'ar' ? 'رمز ICD-11 أو وصف التشخيص' : 'ICD-11 code or diagnosis description'}
                          className="form-input"
                          required
                          aria-invalid={consultationInvalidField === 'diagnosis'}
                          aria-describedby={consultationInvalidField === 'diagnosis' ? 'doctor-diagnosis-error' : undefined}
                          value={diagnosis}
                          onChange={(e) => { setDiagnosis(e.target.value); setConsultationInvalidField(''); }}
                        />
                        {consultationInvalidField === 'diagnosis' && (
                          <small id="doctor-diagnosis-error" className="doctor-field-error">
                            {lang === 'ar' ? 'يرجى إدخال التشخيص قبل إنهاء الزيارة.' : 'Please enter the diagnosis before completing the visit.'}
                          </small>
                        )}
                      </div>
                      <div className="form-group doctor-form-group--mb">
                        <label className="form-label" htmlFor="doctor-treatment">{t('treatment')}</label>
                        <textarea id="doctor-treatment" rows={3} className="form-input" value={treatment} onChange={(e) => setTreatment(e.target.value)} placeholder={lang === 'ar' ? 'الخطة العلاجية والتعليمات الطبية…' : 'Treatment plan and clinical instructions…'} />
                      </div>
                      <div className="form-group doctor-clinical-notes">
                        <label className="form-label" htmlFor="doctor-clinical-notes">{lang === 'ar' ? 'الملاحظات السريرية' : 'Clinical notes'}</label>
                        <textarea id="doctor-clinical-notes" rows={3} className="form-input" value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} placeholder={lang === 'ar' ? 'ملاحظات سريرية خاصة بالطبيب…' : 'Physician clinical notes…'} />
                      </div>
                    </section>
                  </div>

                  {/* STEP 3: Prescription */}
                  <div className={`doctor-step-pane ${!isReadOnlyVisit && consultationStep !== 3 ? 'is-hidden' : ''}`}>
                    <section className="doctor-clinical-section doctor-prescription-section" aria-labelledby="doctor-prescription-title">
                      {catalogLoadError && (
                        <div role="alert" className="patient-alert error">
                          {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'}{' '}
                          <button type="button" onClick={loadCatalogs}>
                            {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                          </button>
                        </div>
                      )}
                      <FacilityIdentityLine language={lang} />
                      <div className="doctor-prescription-heading">
                        <h3 className="doctor-clinical-section__title" id="doctor-prescription-title">
                          <Sliders size={16} aria-hidden="true" />
                          {lang === 'ar' ? 'الوصفة الطبية' : 'Prescription'}
                        </h3>
                        <button
                          type="button"
                          className="doctor-mode-toggle-link"
                          onClick={() => {
                            setMedicineMode(medicineMode === 'official' ? 'custom' : 'official');
                            setSelectedDrug('');
                            setCustomDrugName('');
                            setPrescriptionInvalidField('');
                            setPrescriptionMessage('');
                          }}
                        >
                          {medicineMode === 'official'
                            ? (lang === 'ar' ? 'دواء غير موجود في القائمة الرسمية؟' : 'Medicine not in the formulary?')
                            : (lang === 'ar' ? 'اختيار من القائمة الرسمية' : 'Choose from official formulary')}
                        </button>
                      </div>

                      <div className="doctor-medicine-mode sr-only" role="group" aria-label={lang === 'ar' ? 'نوع الدواء' : 'Medicine type'}>
                        <button type="button" className={medicineMode === 'official' ? 'is-selected' : ''} aria-pressed={medicineMode === 'official'} onClick={() => { setMedicineMode('official'); setCustomDrugName(''); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }}>{lang === 'ar' ? 'دواء من القائمة الرسمية' : 'Official formulary medicine'}</button>
                        <button type="button" className={medicineMode === 'custom' ? 'is-selected' : ''} aria-pressed={medicineMode === 'custom'} onClick={() => { setMedicineMode('custom'); setSelectedDrug(''); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }}>{lang === 'ar' ? 'دواء غير موجود / كتابة يدوية' : 'Medicine not found / custom'}</button>
                      </div>

                      {medicineMode === 'official' ? (
                        <MedicineCombobox medicines={drugs} selectedId={selectedDrug} lang={lang} invalid={prescriptionInvalidField === 'medicine'} onSelect={(id) => { setSelectedDrug(id); setCustomDrugName(''); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }} />
                      ) : (
                        <div className="form-group doctor-custom-medicine">
                          <label className="form-label" htmlFor="doctor-custom-medicine">{lang === 'ar' ? 'اسم الدواء المكتوب يدويًا' : 'Custom medicine name'}</label>
                          <input id="doctor-custom-medicine" type="text" className="form-input" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-invalid={prescriptionInvalidField === 'medicine'} value={customDrugName} onChange={(event) => { setCustomDrugName(event.target.value); setSelectedDrug(''); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }} />
                          <small className="doctor-custom-medicine-notice">{lang === 'ar' ? 'سيُرسل هذا الدواء إلى الصيدلي للمراجعة ولن يتحول تلقائيًا إلى دواء رسمي.' : 'This medicine will require pharmacist review and will not become a formulary entry automatically.'}</small>
                        </div>
                      )}

                      <div className="doctor-prescription-fields">
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-rx-dosage">{lang === 'ar' ? 'الجرعة والتكرار' : 'Dosage and frequency'}</label>
                          <input id="doctor-rx-dosage" type="text" className="form-input" dir="ltr" placeholder={lang === 'ar' ? 'مثال: قرص 3 مرات يوميًا' : 'e.g. 1 tablet, 3 times a day'} aria-invalid={prescriptionInvalidField === 'dosage'} value={dosage} onChange={(event) => { setDosage(event.target.value); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }} />
                          <div className="doctor-rx-helpers">{quickDosagePresets.map((preset) => <button key={preset} type="button" onClick={() => { setDosage(preset); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }}>{preset}</button>)}</div>
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-rx-duration">{lang === 'ar' ? 'مدة العلاج' : 'Duration'}</label>
                          <input id="doctor-rx-duration" type="text" className="form-input" placeholder={lang === 'ar' ? 'مثال: 5 أيام' : 'e.g. 5 days'} aria-invalid={prescriptionInvalidField === 'duration'} value={duration} onChange={(event) => { setDuration(event.target.value); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }} />
                          <div className="doctor-rx-helpers">{quickDurationPresets.map((preset) => <button key={preset.value} type="button" onClick={() => { setDuration(preset.value); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }}>{lang === 'ar' ? preset.ar : preset.en}</button>)}</div>
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-rx-quantity">{lang === 'ar' ? 'الكمية الموصوفة' : 'Prescribed quantity'}</label>
                          <input id="doctor-rx-quantity" type="number" min="1" step="1" className="form-input" dir="ltr" placeholder={lang === 'ar' ? 'مثال: 15' : 'e.g. 15'} aria-invalid={prescriptionInvalidField === 'quantity'} value={quantity} onChange={(event) => { setQuantity(event.target.value); setPrescriptionInvalidField(''); setPrescriptionMessage(''); }} />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-rx-instructions-ar">تعليمات الدواء بالعربية</label>
                          <input id="doctor-rx-instructions-ar" type="text" className="form-input" dir="rtl" value={instrAr} onChange={(event) => setInstrAr(event.target.value)} />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="doctor-rx-instructions-en">Medication instructions in English</label>
                          <input id="doctor-rx-instructions-en" type="text" className="form-input" dir="ltr" value={instrEn} onChange={(event) => setInstrEn(event.target.value)} />
                        </div>
                      </div>

                      {prescriptionMessage && <div className="doctor-prescription-message" role="alert">{prescriptionMessage}</div>}

                      <div className="doctor-prescription-add-wrap">
                        <button type="button" className="btn btn-secondary doctor-add-prescription" onClick={handleAddDrugToRx}>
                          {editingPrescriptionIndex >= 0 ? (lang === 'ar' ? 'حفظ تعديل الدواء' : 'Save medicine changes') : t('prescribe')}
                        </button>
                      </div>

                      {prescribedItems.length > 0 && (
                        <div className="doctor-prescribed-list" aria-label={lang === 'ar' ? 'الأدوية المختارة' : 'Selected medicines'}>
                          <h4 className="ui-section-label doctor-prescribed-list__title">
                            {lang === 'ar' ? `المضافة · ${prescribedItems.length}` : `Added · ${prescribedItems.length}`}
                          </h4>
                          {prescribedItems.map((item, index) => {
                            const displayDrug = item.drugId ? drugs.find((drug) => drug.id === item.drugId) : null;
                            return (
                              <article className="doctor-prescribed-card" key={item.drugId || `custom-${item.customDrugName}-${index}`}>
                                <div className="doctor-prescribed-card__header">
                                  <div>
                                    <strong>{lang === 'ar' ? item.nameAr : item.nameEn}</strong>
                                    {item.drugId ? (
                                      <small>{[displayDrug?.brandName, displayDrug?.genericName, displayDrug?.strength, displayDrug?.dosageForm].filter(Boolean).join(' · ')}</small>
                                    ) : (
                                      <span className="badge badge-warning">{lang === 'ar' ? 'دواء مكتوب يدويًا — يحتاج مراجعة الصيدلي' : 'Custom medicine — pharmacist review required'}</span>
                                    )}
                                  </div>
                                  <span className="badge badge-info">{lang === 'ar' ? `الكمية ${item.qtyPrescribed}` : `Qty ${item.qtyPrescribed}`}</span>
                                </div>
                                <dl>
                                  <div><dt>{lang === 'ar' ? 'الجرعة' : 'Dosage'}</dt><dd>{item.dosage}</dd></div>
                                  <div><dt>{lang === 'ar' ? 'المدة' : 'Duration'}</dt><dd>{item.duration}</dd></div>
                                  {(item.instructionsAr || item.instructionsEn) && <div><dt>{lang === 'ar' ? 'التعليمات' : 'Instructions'}</dt><dd>{lang === 'ar' ? item.instructionsAr || item.instructionsEn : item.instructionsEn || item.instructionsAr}</dd></div>}
                                </dl>
                                <div className="doctor-prescribed-actions">
                                  <button type="button" className="btn btn-secondary" onClick={() => handleEditPrescriptionItem(item, index)}>{lang === 'ar' ? 'تعديل' : 'Edit'}</button>
                                  <button type="button" className="btn btn-danger" onClick={() => handleRemovePrescriptionItem(index)}>{lang === 'ar' ? 'إزالة' : 'Remove'}</button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* STEP 4: Lab tests */}
                  <div className={`doctor-step-pane ${!isReadOnlyVisit && consultationStep !== 4 ? 'is-hidden' : ''}`}>
                    <section className="doctor-lab-order-card" aria-labelledby="doctor-lab-order-title">
                      {catalogLoadError && (
                        <div role="alert" className="patient-alert error">
                          {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'}{' '}
                          <button type="button" onClick={loadCatalogs}>
                            {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                          </button>
                        </div>
                      )}
                      <div className="doctor-lab-order-header">
                        <div>
                          <h4 id="doctor-lab-order-title"><FlaskConical size={17} aria-hidden="true" />{lang === 'ar' ? 'طلب الفحوصات' : 'Order investigations'}</h4>
                          <p className="doctor-lab-order-desc">{lang === 'ar' ? 'اختر الفحوصات المطلوبة للمريض من القائمة المعتمدة.' : 'Select the required tests from the approved catalogue.'}</p>
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
                        return (
                          <div className="doctor-lab-subsection" key={category}>
                            <h5>{category === 'LABORATORY' ? (lang === 'ar' ? 'الفحوصات المخبرية' : 'Laboratory tests') : (lang === 'ar' ? 'الأشعة' : 'Radiology')}</h5>
                            <div className="doctor-lab-service-grid">
                              {services.map((svc) => (
                                <label className={`doctor-lab-service-option ${orderedTests.includes(svc.id) ? 'is-selected' : ''}`} key={svc.id}>
                                  <input type="checkbox" checked={orderedTests.includes(svc.id)} onChange={() => handleToggleTest(svc.id)} />
                                  <span className="doctor-lab-service-copy">
                                    <strong>{lang === 'ar' ? svc.labelAr : svc.labelEn}</strong>
                                    {lang === 'ar' && svc.labelEn && <small>{svc.labelEn}</small>}
                                    {lang !== 'ar' && svc.labelAr && <small>{svc.labelAr}</small>}
                                  </span>
                                  <span className="doctor-lab-checkmark" aria-hidden="true">{orderedTests.includes(svc.id) ? <Check size={14} /> : null}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}

                      {!isFinalizingVisit && (
                        <div className="doctor-custom-test-area">
                          <button type="button" className="doctor-custom-test-toggle" onClick={() => setShowCustomTestInput((visible) => !visible)} aria-expanded={showCustomTestInput}>
                            + {lang === 'ar' ? 'إضافة فحص غير موجود في القائمة' : 'Add a test not in the catalogue'}
                          </button>
                          {showCustomTestInput && (
                            <div className="doctor-custom-test-form">
                              <input type="text" value={customTestName} onChange={(event) => setCustomTestName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleAddCustomTest(); } }} placeholder={lang === 'ar' ? 'مثال: CRP أو Thyroid Function Test' : 'Example: CRP or Thyroid Function Test'} aria-label={lang === 'ar' ? 'اسم الفحص المخصص' : 'Custom test name'} />
                              <button type="button" className="btn btn-secondary" onClick={handleAddCustomTest}>{lang === 'ar' ? 'إضافة الفحص' : 'Add Test'}</button>
                            </div>
                          )}
                          {customTests.length > 0 && (
                            <div className="doctor-custom-test-list">
                              {customTests.map((testName) => (
                                <div className="doctor-custom-test-chip" key={testName}>
                                  <span>{testName}</span>
                                  <button type="button" onClick={() => handleRemoveCustomTest(testName)} aria-label={lang === 'ar' ? `حذف ${testName}` : `Remove ${testName}`}><X size={14} /></button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* STEP 5: Review and complete */}
                  <div className={`doctor-step-pane ${!isReadOnlyVisit && consultationStep !== 5 ? 'is-hidden' : ''}`}>
                    <section className="doctor-clinical-section doctor-review-section" aria-labelledby="doctor-review-title">
                      <h3 className="doctor-clinical-section__title" id="doctor-review-title">
                        <CheckCircle2 size={16} aria-hidden="true" />
                        {lang === 'ar' ? 'المراجعة وإكمال الكشف' : 'Review and Complete Consultation'}
                      </h3>

                      {isFinalizingVisit && (
                        <div className="doctor-review-lab-results">
                          <h4 className="doctor-review-lab-results__title">
                            {lang === 'ar' ? 'نتائج المختبر - جاهزة للمراجعة' : 'Laboratory Results - Ready for Review'}
                          </h4>
                          {currentLabResults.length === 0 ? (
                            <p className="doctor-review-lab-results__empty">
                              {lang === 'ar' ? 'لا توجد نتائج مختبر مسجلة.' : 'No laboratory results were found.'}
                            </p>
                          ) : (
                            <div className="doctor-review-lab-results__grid">
                              {currentLabResults.map((result, index) => (
                                <div key={`${result.serviceNameEn}-${index}`} className={`doctor-lab-result-item ${result.isOutOfRange ? 'is-out-of-range' : 'is-normal'}`}>
                                  <strong>{lang === 'ar' ? result.serviceNameAr : result.serviceNameEn}</strong>
                                  <div className="doctor-lab-result-value">{lang === 'ar' ? 'النتيجة:' : 'Result:'} <strong>{result.resultValue || 'N/A'}</strong></div>
                                  {result.isOutOfRange && <span className="ui-status ui-status--danger">{lang === 'ar' ? 'خارج النطاق الطبيعي' : 'Out of Range'}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          <p className="doctor-review-lab-results__note">
                            {lang === 'ar' ? 'راجع النتائج ثم حدّث التشخيص والعلاج والوصفة قبل إنهاء الزيارة.' : 'Review the results, then update the diagnosis, treatment and prescription before finalizing the visit.'}
                          </p>
                        </div>
                      )}

                      <div className="doctor-review-grid">
                        <div className="doctor-review-card">
                          <div className="doctor-review-card__header">
                            <span className="ui-section-label">{lang === 'ar' ? 'العلامات والأعراض' : 'Vitals & Symptoms'}</span>
                            <button type="button" className="doctor-review-card__edit" onClick={() => setConsultationStep(1)}>{lang === 'ar' ? 'تعديل' : 'Edit'}</button>
                          </div>
                          <div className="doctor-review-card__content">
                            <div>{lang === 'ar' ? 'الضغط:' : 'BP:'} <span className="ui-mono">{vitals.blood_pressure || '—'}</span> · {lang === 'ar' ? 'النبض:' : 'HR:'} <span className="ui-mono">{vitals.heart_rate || '—'}</span> · {lang === 'ar' ? 'الحرارة:' : 'Temp:'} <span className="ui-mono">{vitals.temperature || '—'}</span></div>
                            {symptoms && <div><strong>{lang === 'ar' ? 'الأعراض:' : 'Symptoms:'}</strong> {symptoms}</div>}
                          </div>
                        </div>

                        <div className="doctor-review-card">
                          <div className="doctor-review-card__header">
                            <span className="ui-section-label">{lang === 'ar' ? 'التشخيص والخطة' : 'Diagnosis & Plan'}</span>
                            <button type="button" className="doctor-review-card__edit" onClick={() => setConsultationStep(2)}>{lang === 'ar' ? 'تعديل' : 'Edit'}</button>
                          </div>
                          <div className="doctor-review-card__content">
                            <div><strong>{lang === 'ar' ? 'التشخيص:' : 'Diagnosis:'}</strong> {diagnosis || <span className="doctor-review-missing">{lang === 'ar' ? 'لم يتم إدخال التشخيص' : 'Not entered'}</span>}</div>
                            {treatment && <div><strong>{lang === 'ar' ? 'العلاج:' : 'Treatment:'}</strong> {treatment}</div>}
                          </div>
                        </div>

                        <div className="doctor-review-card">
                          <div className="doctor-review-card__header">
                            <span className="ui-section-label">{lang === 'ar' ? 'الأدوية الموصوفة' : 'Prescriptions'}</span>
                            <button type="button" className="doctor-review-card__edit" onClick={() => setConsultationStep(3)}>{lang === 'ar' ? 'تعديل' : 'Edit'}</button>
                          </div>
                          <div className="doctor-review-card__content">
                            {prescribedItems.length === 0 ? (
                              <span className="doctor-review-empty">{lang === 'ar' ? 'لا توجد أدوية موصوفة' : 'No medicines prescribed'}</span>
                            ) : (
                              <ul className="doctor-review-list">
                                {prescribedItems.map((item, idx) => (
                                  <li key={idx}><strong>{lang === 'ar' ? item.nameAr : item.nameEn}</strong> — {item.dosage} ({item.duration})</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>

                        <div className="doctor-review-card">
                          <div className="doctor-review-card__header">
                            <span className="ui-section-label">{lang === 'ar' ? 'الفحوصات المطلوبة' : 'Investigations'}</span>
                            <button type="button" className="doctor-review-card__edit" onClick={() => setConsultationStep(4)}>{lang === 'ar' ? 'تعديل' : 'Edit'}</button>
                          </div>
                          <div className="doctor-review-card__content">
                            {(orderedTests.length === 0 && customTests.length === 0) ? (
                              <span className="doctor-review-empty">{lang === 'ar' ? 'لا توجد فحوصات مطلوبة' : 'No tests ordered'}</span>
                            ) : (
                              <div>
                                {orderedTests.length > 0 && <span>{lang === 'ar' ? `${orderedTests.length} فحوصات مختارة` : `${orderedTests.length} tests selected`}</span>}
                                {customTests.length > 0 && <div>{customTests.join(', ')}</div>}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="doctor-consultation-action-info">
                        <strong>{lang === 'ar' ? 'إجراء الكشف' : 'Consultation action'}</strong>
                        <span>{lang === 'ar' ? 'راجع البيانات السريرية قبل تنفيذ الإجراء النهائي.' : 'Review the clinical information before the final action.'}</span>
                      </div>
                    </section>
                  </div>

                  {/* ── Stepper Footer Controls (Back / Continue) ── */}
                  {!isReadOnlyVisit && (
                    <div className="doctor-stepper-footer">
                      {consultationStep > 1 ? (
                        <button
                          type="button"
                          className="btn btn-secondary doctor-stepper-back"
                          onClick={() => setConsultationStep((s) => s - 1)}
                        >
                          <ArrowLeft size={16} aria-hidden="true" />
                          {lang === 'ar'
                            ? `العودة إلى ${consultationSteps[consultationStep - 2]?.ar}`
                            : `Back to ${consultationSteps[consultationStep - 2]?.en}`}
                        </button>
                      ) : <div />}

                      <div className="doctor-stepper-footer__actions">
                        {consultationStep < 5 && (
                          <button
                            type="button"
                            className="btn btn-primary doctor-stepper-continue"
                            onClick={() => setConsultationStep((s) => s + 1)}
                          >
                            {lang === 'ar'
                              ? `المتابعة إلى ${consultationSteps[consultationStep]?.ar}`
                              : `Continue to ${consultationSteps[consultationStep]?.en}`}
                            <ArrowRight size={16} aria-hidden="true" />
                          </button>
                        )}

                        <button
                          type="button"
                          className={`btn btn-primary doctor-stepper-complete-btn ${consultationStep === 5 ? 'is-visible' : ''}`}
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
                  )}
                </fieldset>
              </div>
            ) : (
              /* ── Workspace Empty State ── */
              <section className="doctor-workspace-empty" aria-labelledby="doctor-workspace-empty-title">
                <span className="doctor-workspace-empty__icon"><Stethoscope size={30} aria-hidden="true" /></span>
                <h2 id="doctor-workspace-empty-title">{lang === 'ar' ? 'اختر مريضاً من طابور الطبيب لبدء الكشف الطبي.' : 'Select a patient from the doctor queue to start the consultation.'}</h2>
                <p>{lang === 'ar' ? 'ستظهر بيانات المريض وسجل الزيارات وأدوات التوثيق السريري هنا.' : 'Patient details, visit history, and clinical documentation tools will appear here.'}</p>
                <ol className="doctor-workflow-steps">
                  {[lang === 'ar' ? 'اختيار المريض' : 'Select patient', lang === 'ar' ? 'مراجعة ملف المريض' : 'Review patient file', lang === 'ar' ? 'تسجيل العلامات والأعراض' : 'Record vitals and symptoms', lang === 'ar' ? 'التشخيص وخطة العلاج' : 'Diagnose and plan treatment', lang === 'ar' ? 'الوصفة والفحوصات' : 'Prescription and investigations', lang === 'ar' ? 'إكمال الكشف' : 'Complete consultation'].map((step, index) => (
                    <li key={step} className={index === 0 ? 'is-active' : undefined} aria-current={index === 0 ? 'step' : undefined}>
                      <span>{index + 1}</span>{step}
                    </li>
                  ))}
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
          nestedModalOpen={Boolean(activeSummaryId)}
          onSelectSummary={(recId, trigger) => {
            summaryReturnFocusRef.current = trigger;
            setActiveSummaryId(recId);
          }}
        />
      )}
      {activeSummaryId && <PostVisitSummaryModal summaryId={activeSummaryId} onClose={() => setActiveSummaryId(null)} lang={lang} modalLayer={viewingProfilePatientId ? 'nested' : 'base'} returnFocusTo={summaryReturnFocusRef.current} />}
    </div>
  );
}
