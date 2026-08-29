import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Check, CheckCircle, ChevronLeft, ChevronRight, Clock, DollarSign, HelpCircle, MessageCircle, Search, Stethoscope, Trash2, UserPlus, Users } from 'lucide-react';
import { PatientProfileModal } from '../clinical/ClinicalModals';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import { getWhatsAppLink, SUDANESE_STATES } from './clinicData';
import { staffSocket as socket } from '../../services/staffSocket';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';
import { staffApiRequest as apiRequest } from '../../services/apiClient';
import { createLatestSearchScheduler, visiblePatientDirectory } from './debouncedSearch';
import './receptionDashboard.css';

export default function ReceptionDashboard({ lang, t }) {
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [activeTab, setActiveTab] = useState('register'); // 'register', 'patients', 'billing', 'reconcile'

  // Billing patient search states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Dedicated patient-directory search states
  const [patientDirectoryQuery, setPatientDirectoryQuery] = useState('');
  const [patientDirectoryResults, setPatientDirectoryResults] = useState([]);
  const [patientDirectorySearchResults, setPatientDirectorySearchResults] = useState([]);
  const [patientDirectoryLoading, setPatientDirectoryLoading] = useState(false);
  const [patientDirectorySearchLoading, setPatientDirectorySearchLoading] = useState(false);
  const [patientDirectoryError, setPatientDirectoryError] = useState('');
  const [patientDirectoryLoadError, setPatientDirectoryLoadError] = useState('');
  const [patientDirectoryLoaded, setPatientDirectoryLoaded] = useState(false);

  // Registration Form States
  const [fullNameAr, setFullNameAr] = useState('');
  const [fullNameEn, setFullNameEn] = useState('');
  const [gender, setGender] = useState('MALE');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [addressStateId, setAddressStateId] = useState('1');
  const [addressDetails, setAddressDetails] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');

  // Walk-in intake state
  const [walkInMode, setWalkInMode] = useState('EXISTING');
  const [walkInPatientQuery, setWalkInPatientQuery] = useState('');
  const [walkInPatientResults, setWalkInPatientResults] = useState([]);
  const [walkInPatient, setWalkInPatient] = useState(null);
  const [walkInDoctorId, setWalkInDoctorId] = useState('');
  const [walkInSlots, setWalkInSlots] = useState([]);
  const [walkInTime, setWalkInTime] = useState('');
  const [walkInSubmitting, setWalkInSubmitting] = useState(false);

  // Selected Patient for Billing
  const [billingPatient, setBillingPatient] = useState(null);
  const [insuranceCompanyId, setInsuranceCompanyId] = useState('');
  const [insuranceCompanies, setInsuranceCompanies] = useState([]);
  const [clinicalServices, setClinicalServices] = useState([]);
  const [addedServices, setAddedServices] = useState([]);

  // Payment Allocation
  const [paymentRows, setPaymentRows] = useState([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
  const [billingSubmitting, setBillingSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Shift cash ledger
  const [physicalCash, setPhysicalCash] = useState('');
  const [expectedCash, setExpectedCash] = useState('');
  const [reconcileResult, setReconcileResult] = useState(null);
  const [filterDate, setFilterDate] = useState(clinicDateString());
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);

  // Pending Approvals State
  const [pendingAppointments, setPendingAppointments] = useState([]);
  const [queueTab, setQueueTab] = useState('queue'); // 'queue' | 'pending'
  const [billingAppointment, setBillingAppointment] = useState(null);

  // Laboratory billing queue
  const [labBillingOrders, setLabBillingOrders] = useState([]);
  const [selectedLabBillingOrder, setSelectedLabBillingOrder] = useState(null);
  const [labBillingLoading, setLabBillingLoading] = useState(false);
  const billingSearchSchedulerRef = useRef(null);
  const directorySearchSchedulerRef = useRef(null);
  const walkInSearchSchedulerRef = useRef(null);
  const directoryLoadRequestRef = useRef(0);
  if (!billingSearchSchedulerRef.current) billingSearchSchedulerRef.current = createLatestSearchScheduler();
  if (!directorySearchSchedulerRef.current) directorySearchSchedulerRef.current = createLatestSearchScheduler();
  if (!walkInSearchSchedulerRef.current) walkInSearchSchedulerRef.current = createLatestSearchScheduler();

  const appointmentStatusLabels = {
    PENDING: {
      ar: 'قيد المراجعة',
      en: 'Pending'
    },
    SCHEDULED: {
      ar: 'مجدول',
      en: 'Scheduled'
    },
    CONFIRMED: {
      ar: 'مؤكد',
      en: 'Confirmed'
    },
    CHECKED_IN: {
      ar: 'بانتظار الطبيب',
      en: 'Waiting for Doctor'
    },
    IN_CONSULTATION: {
      ar: 'داخل العيادة',
      en: 'In Consultation'
    },
    WAITING_LAB: {
      ar: 'بانتظار المختبر',
      en: 'Waiting for Lab'
    },
    COMPLETED: {
      ar: 'مكتمل',
      en: 'Completed'
    },
    CANCELLED: {
      ar: 'ملغي',
      en: 'Cancelled'
    },
    NO_SHOW: {
      ar: 'لم يحضر',
      en: 'No Show'
    }
  };

  const getAppointmentStatusLabel = (status) => {
    const labels = appointmentStatusLabels[status];

    if (!labels) {
      return status?.replaceAll('_', ' ') || '-';
    }

    return lang === 'ar' ? labels.ar : labels.en;
  };

  const getPaymentMethodLabel = (method) => {
    const labels = {
      CASH: {
        ar: 'نقدًا',
        en: 'Cash'
      },
      CARD: {
        ar: 'بطاقة',
        en: 'Card'
      },
      BANKAK: {
        ar: 'بنكك',
        en: 'Bankak'
      },
      FAWRY: {
        ar: 'فوري',
        en: 'Fawry'
      }
    };

    const value = labels[method];

    return value
      ? (lang === 'ar' ? value.ar : value.en)
      : method;
  };

  const fetchPendingAppointments = () => {
    fetchWithAuth('/api/appointments/pending')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setPendingAppointments(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Pending fetch error:', err));
  };

  const refreshLabBillingQueue = async () => {
    setLabBillingLoading(true);

    try {
      const res = await fetchWithAuth('/api/billing/lab-orders/pending');
      const data = await res.json().catch(() => []);

      if (!res.ok) {
        console.error('Laboratory billing queue failed:', data);
        setLabBillingOrders([]);
        return;
      }

      const queue = Array.isArray(data) ? data : [];
      setLabBillingOrders(queue);

      setSelectedLabBillingOrder((current) => {
        if (!current) return null;

        const refreshed = queue.find((order) => order.id === current.id);

        if (!refreshed) return null;

        return refreshed;
      });
    } catch (err) {
      console.error('Laboratory billing queue error:', err);
      setLabBillingOrders([]);
    } finally {
      setLabBillingLoading(false);
    }
  };

  const handleSelectLabBillingOrder = (order) => {
    setErrorMsg('');
    setSuccessMsg('');

    setSelectedLabBillingOrder(order);
    setBillingPatient(order.patient);
    setBillingAppointment(null);
    setInsuranceCompanyId('');

    setAddedServices(
      order.items.filter((item) => item.labReviewStatus !== 'EXTERNAL').map((item) => ({
        id: item.id,
        labelAr:
          item.service?.labelAr ||
          item.customTestName ||
          'فحص مخصص',
        labelEn:
          item.service?.labelEn ||
          item.customTestName ||
          'Custom Test',
        baseFeeSdg: item.service?.baseFeeSdg == null ? null : Number(item.service.baseFeeSdg),
        qty: 1
      }))
    );

    const amount =
      order.pricingRequired || order.status === 'PAID'
        ? ''
        : Number(
            order.invoice?.remainingBalanceSdg ??
            order.estimatedTotalSdg ??
            0
          );

    setPaymentRows([
      {
        amountSdg: amount > 0 ? String(amount) : '',
        paymentMethod: 'CASH',
        transactionReference: ''
      }
    ]);
  };

  const handleApproveAppointment = async (appId) => {
    const confirmed = window.confirm(
      lang === 'ar'
        ? 'هل أنت متأكد أنك تريد تأكيد هذا الموعد؟'
        : 'Are you sure you want to confirm this appointment?'
    );

    if (!confirmed) return;

    try {
      const res = await fetchWithAuth(`/api/appointments/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم تأكيد الموعد بنجاح.' : 'Appointment confirmed successfully.');
        fetchPendingAppointments();
        refreshDoctorQueue();
        if (data.whatsAppLinkAr) {
          window.open(data.whatsAppLinkAr, '_blank');
        }
      } else {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر تأكيد الموعد.'
              : 'Failed to confirm the appointment.'
          )
        );
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        lang === 'ar'
          ? 'تعذر تأكيد الموعد. يرجى المحاولة مرة أخرى.'
          : 'Failed to confirm the appointment. Please try again.'
      );
    }
  };

  const handleCancelAppointment = async (appId) => {
    const confirmed = window.confirm(
      lang === 'ar'
        ? 'هل أنت متأكد أنك تريد إلغاء هذا الموعد؟'
        : 'Are you sure you want to cancel this appointment?'
    );

    if (!confirmed) return;

    try {
      const res = await fetchWithAuth(`/api/appointments/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم إلغاء الموعد.' : 'Appointment cancelled.');
        fetchPendingAppointments();
        refreshDoctorQueue();
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        lang === 'ar'
          ? 'تعذر إلغاء الموعد. يرجى المحاولة مرة أخرى.'
          : 'Failed to cancel the appointment. Please try again.'
      );
    }
  };

  // Fetch doctors & services on mount
  useEffect(() => {
    fetchPendingAppointments();
    refreshLabBillingQueue();

    apiRequest('/api/appointments/doctors')
      .then((data) => setDoctors(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setDoctors([]);
      });

    apiRequest('/api/billing/services')
      .then((data) => setClinicalServices(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setClinicalServices([]);
      });

    apiRequest('/api/billing/insurance-companies')
      .then((data) => setInsuranceCompanies(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setInsuranceCompanies([]);
      });
  }, []);

  // Fetch queue when doctor or date changes
  const refreshDoctorQueue = useCallback(() => {
    if (selectedDoctor) {
      fetchWithAuth(`/api/appointments/queue/${selectedDoctor.id}?date=${filterDate}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setAppointments(data);
          } else {
            setAppointments([]);
            console.error('Queue response is not an array:', data);
          }
        })
        .catch((err) => {
          console.error(err);
          setAppointments([]);
        });
    }
  }, [selectedDoctor, filterDate]);

  useEffect(() => {
    refreshDoctorQueue();
  }, [refreshDoctorQueue]);

  useEffect(() => {
    if (!selectedDoctor && doctors.length) {
      setSelectedDoctor(doctors.find((doctor) => doctor.status === 'ACTIVE') || doctors[0]);
    }
  }, [doctors, selectedDoctor]);

  useEffect(() => {
    const handleQueueUpdate = () => {
      refreshDoctorQueue();
      fetchPendingAppointments();
    };

    socket.on('queueUpdated', handleQueueUpdate);
    return () => {
      socket.off('queueUpdated', handleQueueUpdate);
    };
  }, [refreshDoctorQueue]);

  const handlePatientSearch = (val) => {
    setSearchQuery(val);
    const query = val.trim();

    if (query.length <= 2) {
      billingSearchSchedulerRef.current.cancel();
      setSearchResults([]);
      return;
    }

    setSearchResults([]);
    billingSearchSchedulerRef.current.schedule(
      async () => {
        const res = await fetchWithAuth(`/api/patients/search?q=${encodeURIComponent(query)}`);
        const data = await res.json().catch(() => []);
        return res.ok && Array.isArray(data) ? data : [];
      },
      {
        onSuccess: setSearchResults,
        onError: () => setSearchResults([])
      }
    );
  };


  const loadPatientDirectory = useCallback(async () => {
    const requestId = ++directoryLoadRequestRef.current;
    setPatientDirectoryLoading(true);
    setPatientDirectoryLoadError('');

    try {
      const res = await fetchWithAuth('/api/patients?limit=50');
      const data = await res.json().catch(() => []);

      if (!res.ok) {
        throw new Error(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر تحميل قائمة المرضى.'
              : 'Failed to load patient directory.'
          )
        );
      }

      if (requestId === directoryLoadRequestRef.current) {
        setPatientDirectoryResults(Array.isArray(data) ? data : []);
        setPatientDirectoryLoaded(true);
      }
    } catch (err) {
      if (requestId !== directoryLoadRequestRef.current) return;
      console.error('Patient directory load error:', err);

      setPatientDirectoryResults([]);
      setPatientDirectoryLoadError(
        err?.message ||
          (
            lang === 'ar'
              ? 'تعذر تحميل قائمة المرضى. حاول مرة أخرى.'
              : 'Unable to load patient directory. Please try again.'
          )
      );
    } finally {
      if (requestId === directoryLoadRequestRef.current) setPatientDirectoryLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    if (
      activeTab === 'patients' &&
      !patientDirectoryLoaded &&
      !patientDirectoryLoading
    ) {
      loadPatientDirectory();
    }
  }, [
    activeTab,
    patientDirectoryLoaded,
    patientDirectoryLoading,
    loadPatientDirectory
  ]);

  const handlePatientDirectorySearch = (val) => {
    setPatientDirectoryQuery(val);
    setPatientDirectoryError('');
    const query = val.trim();

    if (query.length <= 2) {
      directorySearchSchedulerRef.current.cancel();
      setPatientDirectorySearchResults([]);
      setPatientDirectorySearchLoading(false);
      return;
    }

    setPatientDirectorySearchResults([]);
    setPatientDirectorySearchLoading(true);
    directorySearchSchedulerRef.current.schedule(
      async () => {
        const res = await fetchWithAuth(`/api/patients/search?q=${encodeURIComponent(query)}`);
        const data = await res.json().catch(() => []);
        if (!res.ok) {
          throw new Error(apiErrorMessage(data, lang === 'ar' ? 'تعذر البحث عن المرضى.' : 'Failed to search patients.'));
        }
        return Array.isArray(data) ? data : [];
      },
      {
        onSuccess: setPatientDirectorySearchResults,
        onError: (err) => {
          console.error('Patient directory search error:', err);
          setPatientDirectorySearchResults([]);
          setPatientDirectoryError(err?.message || (lang === 'ar' ? 'تعذر البحث عن المرضى. حاول مرة أخرى.' : 'Unable to search patients. Please try again.'));
        },
        onSettled: () => setPatientDirectorySearchLoading(false)
      }
    );
  };

  const handleRegisterPatient = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetchWithAuth('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          fullNameAr,
          fullNameEn,
          gender,
          dateOfBirth: dob,
          nationalId: nationalId || undefined,
          phone,
          addressStateId: parseInt(addressStateId),
          addressDetails,
          emergencyContact: emergencyContact || 'Self'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم تسجيل المريض بنجاح.' : 'Patient registered successfully.');
        setBillingPatient(data);
        setActiveTab('billing'); // Redirect to billing tab
        // Clear fields
        setFullNameAr('');
        setFullNameEn('');
        setPhone('');
        setDob('');
        setNationalId('');
        setAddressDetails('');
        setEmergencyContact('');
      } else {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر تسجيل المريض.'
              : 'Patient registration failed.'
          )
        );
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        lang === 'ar'
          ? 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.'
          : 'Unable to connect to the server. Please try again.'
      );
    }
  };

  const searchWalkInPatients = (value) => {
    setWalkInPatientQuery(value);
    setWalkInPatient(null);
    const query = value.trim();
    if (query.length < 2) {
      walkInSearchSchedulerRef.current.cancel();
      setWalkInPatientResults([]);
      return;
    }
    setWalkInPatientResults([]);
    walkInSearchSchedulerRef.current.schedule(
      async () => {
        const res = await fetchWithAuth(`/api/patients/search?q=${encodeURIComponent(query)}`);
        const data = await res.json().catch(() => []);
        return res.ok && Array.isArray(data) ? data : [];
      },
      {
        onSuccess: setWalkInPatientResults,
        onError: () => setWalkInPatientResults([])
      }
    );
  };

  useEffect(() => () => {
    billingSearchSchedulerRef.current.cancel();
    directorySearchSchedulerRef.current.cancel();
    walkInSearchSchedulerRef.current.cancel();
    directoryLoadRequestRef.current += 1;
  }, []);

  const handleWalkInDoctorChange = async (doctorId) => {
    setWalkInDoctorId(doctorId);
    setWalkInTime('');
    if (!doctorId) {
      setWalkInSlots([]);
      return;
    }
    try {
      const res = await fetchWithAuth(`/api/appointments/slots?doctorId=${encodeURIComponent(doctorId)}&date=${clinicDateString()}`);
      const data = await res.json().catch(() => []);
      setWalkInSlots(res.ok && Array.isArray(data) ? data : []);
    } catch {
      setWalkInSlots([]);
    }
  };

  const handleWalkInSubmit = async (event) => {
    event.preventDefault();
    if (walkInSubmitting || !walkInDoctorId || !walkInTime || (walkInMode === 'EXISTING' && !walkInPatient)) return;
    setWalkInSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    const body = {
      mode: walkInMode,
      doctorId: walkInDoctorId,
      appointmentDate: clinicDateString(),
      appointmentTime: walkInTime
    };
    if (walkInMode === 'EXISTING') {
      body.patientId = walkInPatient.id;
    } else {
      body.patient = {
        fullNameAr,
        fullNameEn,
        gender,
        dateOfBirth: dob,
        nationalId: nationalId || undefined,
        phone,
        addressStateId: parseInt(addressStateId),
        addressDetails: addressDetails || undefined,
        emergencyContact: emergencyContact || 'Self'
      };
    }
    try {
      const res = await fetchWithAuth('/api/appointments/walk-in', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(apiErrorMessage(data, lang === 'ar' ? 'تعذر تسجيل المريض المباشر.' : 'Unable to register walk-in patient.'));
        return;
      }
      setSuccessMsg(lang === 'ar' ? 'تم تسجيل المريض وإدخاله في طابور الطبيب بنجاح.' : 'Patient checked in and sent to the doctor queue successfully.');
      const doctor = doctors.find((item) => item.id === walkInDoctorId);
      if (doctor) {
        setSelectedDoctor(doctor);
        const queueRes = await fetchWithAuth(`/api/appointments/queue/${doctor.id}?date=${clinicDateString()}`);
        const queueData = await queueRes.json().catch(() => []);
        if (queueRes.ok && Array.isArray(queueData)) setAppointments(queueData);
      }
      setWalkInPatient(null);
      setWalkInPatientQuery('');
      setWalkInPatientResults([]);
      setWalkInTime('');
      setWalkInSlots([]);
      if (walkInMode === 'NEW') {
        setFullNameAr(''); setFullNameEn(''); setPhone(''); setDob(''); setNationalId(''); setAddressDetails(''); setEmergencyContact('');
      }
    } catch {
      setErrorMsg(lang === 'ar' ? 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to reach the server. Check your connection and try again.');
    } finally {
      setWalkInSubmitting(false);
    }
  };

  const handleCheckIn = async (appointmentId) => {
    try {
      const res = await fetchWithAuth(`/api/appointments/${appointmentId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CHECKED_IN' })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setSuccessMsg(
          lang === 'ar'
            ? 'تم تسجيل وصول المريض. يجب إتمام رسوم الكشف قبل أن يصبح جاهزًا للطبيب.'
            : 'Patient checked in. The consultation fee must be paid before the patient is ready for the doctor.'
        );
        refreshDoctorQueue();
      } else {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر تسجيل وصول المريض.'
              : 'Failed to check in the patient.'
          )
        );
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        lang === 'ar'
          ? 'حدث خطأ أثناء تسجيل وصول المريض.'
          : 'An error occurred while checking in the patient.'
      );
    }
  };

  const handleQuickBill = (app) => {
    if (!app.patient || app.status !== 'CHECKED_IN') return;

    setSelectedLabBillingOrder(null);
    setBillingPatient(app.patient);
    setBillingAppointment(app);
    setActiveTab('billing');

    const consultService = clinicalServices.find(s =>
      s.labelEn.toLowerCase().includes('consult') ||
      s.labelAr.includes('كشف')
    );

    const docFee = app.doctor?.consultationFee ? parseFloat(app.doctor.consultationFee) : 0;

    if (consultService) {
      setAddedServices([{
        id: consultService.id,
        labelAr: `${consultService.labelAr} - د. ${lang === 'ar' ? app.doctor.fullNameAr : app.doctor.fullNameEn}`,
        labelEn: `${consultService.labelEn} - Dr. ${app.doctor.fullNameEn}`,
        baseFeeSdg: docFee,
        qty: 1
      }]);
    } else {
      setAddedServices([{
        id: 'temp-consult',
        labelAr: `معاينة - د. ${lang === 'ar' ? app.doctor.fullNameAr : app.doctor.fullNameEn}`,
        labelEn: `Consultation - Dr. ${app.doctor.fullNameEn}`,
        baseFeeSdg: docFee,
        qty: 1
      }]);
    }
    setPaymentRows([{ amountSdg: docFee.toString(), paymentMethod: 'CASH', transactionReference: '' }]);
  };

  // Add consultation/service to billing list
  const handleAddBillingService = (service) => {
    setAddedServices([...addedServices, { ...service, qty: 1 }]);
  };

  const handleRemoveBillingService = (index) => {
    setAddedServices(addedServices.filter((_, idx) => idx !== index));
  };

  const calculateInvoiceTotals = () => {
    const totalSdg = addedServices.reduce((sum, service) => {
      if (service.baseFeeSdg == null) return sum;
      const price = Number(service.baseFeeSdg);
      return Number.isFinite(price) ? sum + (price * service.qty) : sum;
    }, 0);
    // Fixed conversion rate of 1500 locked at checkout
    const totalUsd = totalSdg / 1500;
    return { totalSdg, totalUsd };
  };

  const handleCreateInvoice = async () => {
    if (billingSubmitting) return;

    setErrorMsg('');
    setSuccessMsg('');

    if (!billingPatient) {
      setErrorMsg(
        lang === 'ar'
          ? 'اختر المريض أولاً.'
          : 'Select a patient first.'
      );
      return;
    }

    const isLaboratoryBilling = Boolean(selectedLabBillingOrder);
    if (
      !isLaboratoryBilling &&
      addedServices.length === 0
    ) {
      setErrorMsg(
        lang === 'ar'
          ? 'أضف خدمة طبية واحدة على الأقل.'
          : 'Add at least one clinical service.'
      );
      return;
    }

    if (
      isLaboratoryBilling &&
      selectedLabBillingOrder.pricingRequired
    ) {
      setErrorMsg(
        lang === 'ar'
          ? 'يوجد فحص مختبري جديد يحتاج إلى مراجعة وتسعير من المختبر قبل إصدار الفاتورة.'
          : 'A laboratory test requires review and pricing before the invoice can be issued.'
      );
      return;
    }

    if (
      isLaboratoryBilling &&
      selectedLabBillingOrder.status === 'PAID'
    ) {
      setSuccessMsg(
        lang === 'ar'
          ? 'تم دفع هذه الفاتورة بالكامل والمريض جاهز للمختبر.'
          : 'This laboratory invoice is already fully paid and ready for the laboratory.'
      );
      return;
    }

    const validPayments = paymentRows
      .map((payment) => ({
        ...payment,
        amountSdg: Number(payment.amountSdg)
      }))
      .filter(
        (payment) =>
          Number.isFinite(payment.amountSdg) &&
          payment.amountSdg > 0
      );

    if (validPayments.length === 0) {
      setErrorMsg(
        lang === 'ar'
          ? 'أدخل مبلغ دفع صحيح.'
          : 'Enter a valid payment amount.'
      );
      return;
    }

    setBillingSubmitting(true);

    try {
      const invoiceType = isLaboratoryBilling
        ? 'LABORATORY'
        : billingAppointment
          ? 'CONSULTATION'
          : 'GENERAL';

      const invoicePayload = {
        patientId: billingPatient.id,
        appointmentId:
          !isLaboratoryBilling
            ? billingAppointment?.id || undefined
            : undefined,

        labOrderId:
          isLaboratoryBilling
            ? selectedLabBillingOrder.id
            : undefined,

        invoiceType,

        insuranceCompanyId:
          !isLaboratoryBilling
            ? insuranceCompanyId || undefined
            : undefined
      };

      if (invoiceType === 'GENERAL') {
        invoicePayload.items = addedServices.map((service) => ({
          serviceId: service.id,
          quantity: service.qty
        }));
      }

      const res = await fetchWithAuth('/api/billing/invoice', {
        method: 'POST',
        body: JSON.stringify(invoicePayload)
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر إنشاء الفاتورة.'
              : 'Failed to create the invoice.'
          )
        );
        return;
      }

      const paymentRes = await fetchWithAuth(
        `/api/billing/invoice/${data.invoice.id}/payments`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': crypto.randomUUID()
          },
          body: JSON.stringify({
            payments: validPayments.map((payment) => ({
              amountSdg: payment.amountSdg,
              paymentMethod: payment.paymentMethod,
              transactionReference:
                payment.transactionReference || undefined
            }))
          })
        }
      );

      const paymentData =
        await paymentRes.json().catch(() => ({}));

      if (!paymentRes.ok) {
        setErrorMsg(
          apiErrorMessage(
            paymentData,
            lang === 'ar'
              ? 'تعذر تسجيل الدفعة.'
              : 'Failed to record the payment.'
          )
        );
        return;
      }

      refreshDoctorQueue();
      await refreshLabBillingQueue();

      if (paymentData.paymentStatus === 'PAID') {
        if (isLaboratoryBilling) {
          setSuccessMsg(
            lang === 'ar'
              ? 'تم دفع رسوم المختبر بالكامل. الطلب الآن جاهز لجمع العينة.'
              : 'Laboratory invoice paid in full. The order is now ready for sample collection.'
          );

          setSelectedLabBillingOrder(null);
        } else {
          setSuccessMsg(
            lang === 'ar'
              ? 'تم دفع رسوم الكشف بالكامل. المريض الآن جاهز للطبيب.'
              : 'Consultation fee paid in full. The patient is now ready for the doctor.'
          );
        }

        setAddedServices([]);
        setBillingPatient(null);
        setBillingAppointment(null);

        setPaymentRows([
          {
            amountSdg: '',
            paymentMethod: 'CASH',
            transactionReference: ''
          }
        ]);
      } else {
        setSuccessMsg(
          lang === 'ar'
            ? `تم تسجيل دفعة جزئية. المتبقي ${paymentData.remainingBalanceSdg ?? 0} ج.س.`
            : `Partial payment recorded. Remaining balance: ${paymentData.remainingBalanceSdg ?? 0} SDG.`
        );

        setPaymentRows([
          {
            amountSdg: String(
              paymentData.remainingBalanceSdg ?? ''
            ),
            paymentMethod: 'CASH',
            transactionReference: ''
          }
        ]);
      }
    } catch (err) {
      console.error(err);

      setErrorMsg(
        lang === 'ar'
          ? 'حدث خطأ أثناء معالجة الفاتورة والدفع.'
          : 'An error occurred while processing billing and payment.'
      );
    } finally {
      setBillingSubmitting(false);
    }
  };

  const handleReconcileShift = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth('/api/billing/shift/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          expectedAmountSdg: parseFloat(expectedCash),
          actualAmountSdg: parseFloat(physicalCash),
          note: 'Daily receptionist shift reconciliation close'
        })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setReconcileResult(data);
        setSuccessMsg(
          lang === 'ar'
            ? 'تمت مطابقة الوردية بنجاح.'
            : 'Shift reconciliation completed successfully.'
        );
      } else {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر إتمام مطابقة الوردية.'
              : 'Failed to reconcile the shift.'
          )
        );
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        lang === 'ar'
          ? 'حدث خطأ أثناء مطابقة الوردية.'
          : 'An error occurred while reconciling the shift.'
      );
    }
  };

  const changeQueueDate = (days) => {
    const nextDate = new Date(`${filterDate}T12:00:00`);
    if (Number.isNaN(nextDate.getTime())) return;
    nextDate.setDate(nextDate.getDate() + days);
    setFilterDate(nextDate.toISOString().slice(0, 10));
  };

  const queueMetrics = [
    { key: 'doctors', icon: Stethoscope, value: doctors.filter((doctor) => doctor.status === 'ACTIVE').length, ar: 'الأطباء المناوبون', en: 'On-duty doctors' },
    { key: 'appointments', icon: CalendarDays, value: appointments.length, ar: 'مواعيد الطبيب', en: 'Doctor appointments' },
    { key: 'waiting', icon: Clock, value: appointments.filter((appointment) => appointment.status === 'CHECKED_IN').length, ar: 'بانتظار الطبيب', en: 'Waiting' },
    { key: 'pending', icon: AlertCircle, value: pendingAppointments.length, ar: 'بانتظار التأكيد', en: 'Pending approval' },
    { key: 'completed', icon: CheckCircle, value: appointments.filter((appointment) => appointment.status === 'COMPLETED').length, ar: 'مكتمل', en: 'Completed' }
  ];
  const patientDirectorySearchActive = patientDirectoryQuery.trim().length > 2;
  const visiblePatientDirectoryResults = visiblePatientDirectory(
    patientDirectoryQuery,
    patientDirectoryResults,
    patientDirectorySearchResults
  );
  const patientDirectoryBusy = patientDirectoryLoading || patientDirectorySearchLoading;
  const visiblePatientDirectoryError = patientDirectorySearchActive
    ? patientDirectoryError
    : patientDirectoryLoadError;

  return (
    <div className="dashboard-wrapper reception-dashboard" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="workspace-panel reception-workspace">
        <RoleHero role="reception" lang={lang} />

        <section className="reception-toolbar" aria-label={lang === 'ar' ? 'الوصول السريع للمرضى' : 'Quick patient access'}>
          <div className="reception-global-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={patientDirectoryQuery}
              onChange={(event) => handlePatientDirectorySearch(event.target.value)}
              placeholder={lang === 'ar' ? 'البحث عن مريض بالاسم / الهاتف / SHF-000001' : 'Search by patient name / phone / SHF-000001'}
              aria-label={lang === 'ar' ? 'البحث عن مريض' : 'Search patients'}
              dir="auto"
            />
            {patientDirectorySearchLoading && <span className="reception-search-loading" role="status">{lang === 'ar' ? 'جارٍ البحث…' : 'Searching…'}</span>}
            {patientDirectorySearchActive && patientDirectorySearchResults.length > 0 && (
              <div className="reception-search-results">
                {patientDirectorySearchResults.slice(0, 8).map((patient) => (
                  <button key={patient.id} type="button" onClick={() => { setViewingProfilePatientId(patient.id); handlePatientDirectorySearch(''); }}>
                    <span><strong>{lang === 'ar' ? patient.fullNameAr || patient.fullNameEn : patient.fullNameEn || patient.fullNameAr}</strong><small dir="ltr">{patient.fileNumber || '—'} · {patient.phone || '—'}</small></span>
                    <span>{lang === 'ar' ? 'فتح الملف' : 'Open file'}</span>
                  </button>
                ))}
              </div>
            )}
            {patientDirectorySearchActive && !patientDirectorySearchLoading && patientDirectorySearchResults.length === 0 && (
              <div className="reception-search-results reception-search-message" role={patientDirectoryError ? 'alert' : 'status'}>
                <span>{patientDirectoryError || (lang === 'ar' ? 'لم يتم العثور على مريض مطابق.' : 'No matching patient found.')}</span>
                {patientDirectoryError && <button type="button" onClick={() => handlePatientDirectorySearch(patientDirectoryQuery)}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>}
              </div>
            )}
          </div>
          <button type="button" className="reception-register-action" onClick={() => setActiveTab('register')}>
            <UserPlus size={18} aria-hidden="true" />
            {lang === 'ar' ? 'تسجيل مريض' : 'Register patient'}
          </button>
        </section>

        <section className="reception-doctors" aria-labelledby="reception-doctors-title">
          <header>
            <div><Stethoscope size={18} aria-hidden="true" /><h2 id="reception-doctors-title">{lang === 'ar' ? 'الأطباء المناوبون' : 'On-duty doctors'}</h2></div>
            <span>{lang === 'ar' ? `${doctors.length} أطباء` : `${doctors.length} doctors`}</span>
          </header>
          <div className="reception-doctor-strip">
            {doctors.map((doc) => (
              <button key={doc.id} type="button" className={`reception-doctor-card ${selectedDoctor?.id === doc.id ? 'selected' : ''}`} onClick={() => setSelectedDoctor(doc)} aria-pressed={selectedDoctor?.id === doc.id}>
                <span className="reception-doctor-avatar" aria-hidden="true">{(lang === 'ar' ? doc.fullNameAr : doc.fullNameEn)?.trim()?.charAt(0) || 'D'}</span>
                <span><strong>{lang === 'ar' ? doc.fullNameAr : doc.fullNameEn}</strong><small>{lang === 'ar' ? doc.specialtyAr : doc.specialtyEn}</small></span>
                {doc.status === 'ACTIVE' && <i role="status" aria-label={lang === 'ar' ? 'متاح' : 'Available'} />}
              </button>
            ))}
            {doctors.length === 0 && <p className="reception-strip-empty">{lang === 'ar' ? 'لا يوجد أطباء مناوبون حاليًا.' : 'No on-duty doctors are available.'}</p>}
          </div>
        </section>

        <section className="reception-metrics" aria-label={lang === 'ar' ? 'ملخص عمليات اليوم' : 'Today’s operations summary'}>
          {queueMetrics.map(({ key, icon: Icon, value, ar, en }) => <article key={key}><span><Icon size={17} aria-hidden="true" /></span><div><strong>{value}</strong><small>{lang === 'ar' ? ar : en}</small></div></article>)}
        </section>

        <div className="panel-grid reception-main-grid">
          {/* DAILY QUEUE MANAGER & PENDING APPROVALS */}
          <section className="panel-column reception-queue-panel" aria-labelledby="reception-queue-title">
            <header className="reception-queue-header">
              <div className="reception-section-heading">
                <div><CalendarDays size={18} aria-hidden="true" /><h2 id="reception-queue-title">{lang === 'ar' ? 'مواعيد اليوم' : 'Today’s appointments'}</h2></div>
                <span>{selectedDoctor ? (lang === 'ar' ? selectedDoctor.fullNameAr : selectedDoctor.fullNameEn) : (lang === 'ar' ? 'اختر طبيباً' : 'Select a doctor')}</span>
              </div>
              <div className="reception-queue-tools">
                <div className="reception-queue-tabs" role="tablist" aria-label={lang === 'ar' ? 'طريقة عرض المواعيد' : 'Appointment view'}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={queueTab === 'queue'}
                  className={queueTab === 'queue' ? 'active' : ''}
                  onClick={() => setQueueTab('queue')}
                >
                  <Clock size={14} />
                  {lang === 'ar' ? 'الطابور اليومي' : 'Today’s Queue'}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={queueTab === 'pending'}
                  className={queueTab === 'pending' ? 'active' : ''}
                  onClick={() => setQueueTab('pending')}
                >
                  <AlertCircle size={14} />
                  {lang === 'ar'
                    ? 'طلبات بانتظار التأكيد'
                    : 'Pending Appointment Requests'}
                  {pendingAppointments.length > 0 && (
                    <span className="reception-tab-count">
                      {pendingAppointments.length}
                    </span>
                  )}
                </button>
              </div>

              {queueTab === 'queue' && (
                <div className="reception-date-control">
                  <button type="button" onClick={() => changeQueueDate(-1)} aria-label={lang === 'ar' ? 'اليوم السابق' : 'Previous day'}><ChevronLeft size={17} /></button>
                  <button type="button" className="reception-today-button" onClick={() => setFilterDate(clinicDateString())}>{lang === 'ar' ? 'اليوم' : 'Today'}</button>
                  <input type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} aria-label={lang === 'ar' ? 'تاريخ الطابور' : 'Queue date'} />
                  <button type="button" onClick={() => changeQueueDate(1)} aria-label={lang === 'ar' ? 'اليوم التالي' : 'Next day'}><ChevronRight size={17} /></button>
                </div>
              )}
              </div>
            </header>

            {queueTab === 'pending' ? (
              pendingAppointments.length === 0 ? (
                <div className="reception-empty-state">
                  <CheckCircle size={36} color="var(--primary)" />
                  <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد طلبات مواعيد معلقة حالياً.' : 'No pending appointment requests.'}</p>
                </div>
              ) : (
                <div className="reception-request-list">{pendingAppointments.map((app) => (
                  <article
                    key={app.id}
                    className="reception-request-row"
                  >
                    <div className="reception-request-title">
                      <button type="button" className="reception-patient-link" onClick={() => setViewingProfilePatientId(app.patient.id)}>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</button>
                      <span className="badge badge-warning">
                        {getAppointmentStatusLabel('PENDING')}
                      </span>
                    </div>
                    <div className="reception-request-meta">
                      <span dir="ltr">{app.patient?.fileNumber || '—'} · {app.patient?.phone || '—'}</span>
                      <div><strong>{lang === 'ar' ? 'الطبيب:' : 'Doctor:'}</strong> {lang === 'ar' ? app.doctor?.fullNameAr : app.doctor?.fullNameEn}</div>
                      <div>
                        <strong>
                          {lang === 'ar' ? 'الموعد:' : 'Appointment:'}
                        </strong>{' '}
                        {app.appointmentDate}{' '}
                        {lang === 'ar' ? 'الساعة' : 'at'}{' '}
                        {app.appointmentTime}
                      </div>
                    </div>

                    <div className="reception-row-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
                        onClick={() => handleApproveAppointment(app.id)}
                      >
                        <Check size={12} />
                        {lang === 'ar' ? 'تأكيد الموعد' : 'Confirm Appointment'}
                      </button>

                      <a
                        href={getWhatsAppLink(
                          app.patient?.phone,
                          lang === 'ar'
                            ? `مرحباً ${app.patient?.fullNameAr}، يرجى تأكيد موعدك بمركز الشفاء الطبي مع ${app.doctor?.fullNameAr} بتاريخ ${app.appointmentDate} الساعة ${app.appointmentTime}.`
                            : `Hello ${app.patient?.fullNameEn}, please confirm your appointment at Al-Shifa Clinic with ${app.doctor?.fullNameEn} on ${app.appointmentDate} at ${app.appointmentTime}.`
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-whatsapp"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
                      >
                        <MessageCircle size={12} />
                        {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                      </a>

                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
                        onClick={() => handleCancelAppointment(app.id)}
                      >
                        {lang === 'ar' ? 'رفض الطلب' : 'Reject Request'}
                      </button>
                    </div>
                  </article>
                ))}</div>
              )
            ) : selectedDoctor ? (
              appointments.length === 0 ? (
                <div className="reception-empty-state">
                  <HelpCircle size={36} />
                  <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد مواعيد مسجلة لهذا الطبيب اليوم.' : 'No appointments scheduled for this doctor today.'}</p>
                </div>
              ) : (
                <div className="reception-queue-list">{appointments.map((app) => {
                  const isEmergency = app.emergencyOverride;
                  const statusStyles = (() => {
                    switch (app.status) {
                      case 'SCHEDULED':
                      case 'CONFIRMED':
                        return { '--queue-accent': '#9ca3af', background: 'rgba(156, 163, 175, 0.05)' };
                      case 'CHECKED_IN':
                        return { '--queue-accent': 'var(--warning)', background: 'rgba(245, 158, 11, 0.08)' };
                      case 'IN_CONSULTATION':
                        return { '--queue-accent': 'var(--primary)', background: 'rgba(20, 184, 166, 0.08)' };
                      case 'COMPLETED':
                        return { '--queue-accent': 'var(--success)', background: 'rgba(16, 185, 129, 0.08)' };
                      default:
                        return { '--queue-accent': 'var(--border-color)' };
                    }
                  })();

                  return (
                    <article
                      key={app.id}
                      className={`reception-queue-row ${isEmergency ? 'emergency-border' : ''}`}
                      style={statusStyles}
                    >
                      <div className="reception-queue-patient">
                        <button type="button" className="reception-patient-link" onClick={() => setViewingProfilePatientId(app.patient.id)}>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</button>
                        <small dir="ltr">{app.patient.fileNumber || '—'} · {app.patient.phone || '—'}</small>
                      </div>
                      <div className="reception-queue-doctor">
                        <small>{lang === 'ar' ? 'الطبيب' : 'Doctor'}</small>
                        <strong>{lang === 'ar' ? selectedDoctor.fullNameAr : selectedDoctor.fullNameEn}</strong>
                      </div>
                      <time className="reception-queue-time" dateTime={`${app.appointmentDate}T${app.appointmentTime}`} dir="ltr">{app.appointmentTime}</time>
                      <div className="reception-queue-status">
                        <span className={`badge ${app.status === 'COMPLETED' ? 'badge-success' :
                          app.status === 'IN_CONSULTATION' ? 'badge-primary' :
                            app.status === 'CHECKED_IN'
                              ? (app.consultationReady ? 'badge-success' : 'badge-warning')
                              : 'badge-secondary'
                          }`}>
                          {app.status === 'CHECKED_IN'
                            ? (
                              app.consultationReady
                                ? (lang === 'ar' ? 'جاهز للطبيب' : 'Ready for Doctor')
                                : (
                                  app.consultationPaymentStatus === 'PARTIALLY_PAID'
                                    ? (lang === 'ar' ? 'دفع جزئي' : 'Partially Paid')
                                    : (lang === 'ar' ? 'بانتظار الدفع' : 'Payment Pending')
                                )
                            )
                            : getAppointmentStatusLabel(app.status)}
                        </span>
                        {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ مستعجلة' : 'Emergency Priority'}</span>}
                      </div>

                      <div className="reception-row-actions">
                        {(app.status === 'SCHEDULED' || app.status === 'CONFIRMED') && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, minHeight: '32px' }}
                            onClick={() => handleCheckIn(app.id)}
                          >
                            {lang === 'ar' ? 'تسجيل وصول' : 'Check In'}
                          </button>
                        )}
                        {app.status === 'CHECKED_IN' && !app.consultationReady && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minHeight: '32px' }}
                            onClick={() => handleQuickBill(app)}
                          >
                            <DollarSign size={12} />
                            {app.consultationPaymentStatus === 'PARTIALLY_PAID'
                              ? (lang === 'ar' ? 'إكمال الدفع' : 'Continue Payment')
                              : (lang === 'ar' ? 'دفع رسوم الكشف' : 'Pay Consultation')}
                          </button>
                        )}
                        <a
                          href={getWhatsAppLink(
                            app.patient?.phone,
                            lang === 'ar'
                              ? `مركز الشفاء الطبي: تذكير بموعدك (${app.patient.fullNameAr}). الوقت: ${app.appointmentTime}.`
                              : `Al-Shifa Clinic: Reminder for your appointment (${app.patient.fullNameEn}) at ${app.appointmentTime}.`
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-whatsapp"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '32px' }}
                        >
                          <MessageCircle size={12} />
                        </a>
                      </div>
                    </article>
                  );
                })}</div>
              )
            ) : (
              <div className="reception-empty-state">
                <Users size={36} />
                <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'يرجى اختيار طبيب من القائمة لعرض طابور الانتظار.' : 'Please select a doctor from the list to view the live queue.'}</p>
              </div>
            )}
          </section>

          <aside className="panel-column reception-utility-panel" aria-labelledby="reception-utility-title">
            <div className="reception-utility-heading">
              <div>
                <span className="reception-eyebrow">{lang === 'ar' ? 'وصول سريع' : 'Quick access'}</span>
                <h2 id="reception-utility-title">{lang === 'ar' ? 'عمليات الاستقبال' : 'Reception operations'}</h2>
              </div>
            </div>
            <div className="tabs-header reception-utility-tabs" role="tablist" aria-label={lang === 'ar' ? 'عمليات الاستقبال' : 'Reception operations'}>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'register'}
                className={`tab-select-btn ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => setActiveTab('register')}
              >
                {lang === 'ar' ? 'تسجيل مريض' : 'Register Patient'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'walkin'}
                className={`tab-select-btn ${activeTab === 'walkin' ? 'active' : ''}`}
                onClick={() => setActiveTab('walkin')}
              >
                {lang === 'ar' ? 'إدخال مريض مباشر' : 'Walk-in Patient'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'patients'}
                className={`tab-select-btn ${activeTab === 'patients' ? 'active' : ''}`}
                onClick={() => setActiveTab('patients')}
              >
                {lang === 'ar' ? 'المرضى' : 'Patients'}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'billing'}
                className={`tab-select-btn ${activeTab === 'billing' ? 'active' : ''}`}
                onClick={() => setActiveTab('billing')}
              >
                {lang === 'ar' ? 'الفوترة والدفع' : 'Billing & Payment'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'reconcile'}
                className={`tab-select-btn ${activeTab === 'reconcile' ? 'active' : ''}`}
                onClick={() => setActiveTab('reconcile')}
              >
                {lang === 'ar' ? 'مطابقة الوردية' : 'Shift Reconciliation'}
              </button>
            </div>

            {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{errorMsg}</div>}
            {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem' }}>{successMsg}</div>}

            {/* TAB: REGISTER PATIENT */}
            {activeTab === 'register' && (
              <form onSubmit={handleRegisterPatient} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
                <div className="form-group">
                  <label className="form-label">{t('fullNameAr')} *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={fullNameAr}
                    onChange={(e) => setFullNameAr(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('fullNameEn')} *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={fullNameEn}
                    onChange={(e) => setFullNameEn(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('phone')} *</label>
                  <input
                    type="tel"
                    required
                    className="form-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'تاريخ الميلاد' : 'Date of Birth'} *</label>
                  <input
                    type="date"
                    required
                    className="form-input"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('gender')}</label>
                  <select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="MALE">{t('male')}</option>
                    <option value="FEMALE">{t('female')}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('addressState')}</label>
                  <select className="form-input" value={addressStateId} onChange={(e) => setAddressStateId(e.target.value)}>
                    {SUDANESE_STATES.map((st) => (
                      <option key={st.id} value={st.id}>
                        {lang === 'ar' ? st.labelAr : st.labelEn}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  {lang === 'ar' ? 'حفظ ملف المريض' : 'Save Patient Profile'}
                </button>
              </form>
            )}

            {/* TAB: WALK-IN INTAKE */}
            {activeTab === 'walkin' && (
              <form onSubmit={handleWalkInSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'نوع المريض' : 'Patient type'}</label>
                  <select className="form-input" value={walkInMode} onChange={(e) => { setWalkInMode(e.target.value); setWalkInPatient(null); }}>
                    <option value="EXISTING">{lang === 'ar' ? 'مريض مسجل مسبقًا' : 'Existing patient'}</option>
                    <option value="NEW">{lang === 'ar' ? 'مريض جديد' : 'New patient'}</option>
                  </select>
                </div>
                {walkInMode === 'EXISTING' ? (
                  <div className="form-group" style={{ position: 'relative' }}>
                    <label className="form-label">{lang === 'ar' ? 'ابحث عن المريض' : 'Search patient'} *</label>
                    <input className="form-input" value={walkInPatientQuery} onChange={(e) => searchWalkInPatients(e.target.value)} placeholder={lang === 'ar' ? 'الاسم أو الهاتف أو SHF-000001' : 'Name, phone or SHF-000001'} />
                    {walkInPatientResults.length > 0 && (
                      <div className="patient-search-dropdown">
                        {walkInPatientResults.map((item) => (
                          <button key={item.id} type="button" className="dropdown-item-patient" onClick={() => { setWalkInPatient(item); setWalkInPatientQuery(item.fullNameAr || item.fullNameEn || item.phone); setWalkInPatientResults([]); }}>
                            <strong>{lang === 'ar' ? item.fullNameAr : item.fullNameEn}</strong><small dir="ltr">{item.fileNumber || '—'} · {item.phone || '—'}</small>
                          </button>
                        ))}
                      </div>
                    )}
                    {walkInPatient && <div className="badge badge-success" style={{ marginTop: '0.35rem' }}>{lang === 'ar' ? 'تم اختيار المريض' : 'Patient selected'}</div>}
                  </div>
                ) : (
                  <>
                    <div className="form-group"><label className="form-label">{t('fullNameAr')} *</label><input required className="form-input" value={fullNameAr} onChange={(e) => setFullNameAr(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">{t('fullNameEn')} *</label><input required className="form-input" value={fullNameEn} onChange={(e) => setFullNameEn(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">{t('phone')} *</label><input required className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">{lang === 'ar' ? 'تاريخ الميلاد' : 'Date of Birth'} *</label><input required type="date" className="form-input" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">{t('gender')}</label><select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}><option value="MALE">{t('male')}</option><option value="FEMALE">{t('female')}</option></select></div>
                    <div className="form-group"><label className="form-label">{t('addressState')}</label><select className="form-input" value={addressStateId} onChange={(e) => setAddressStateId(e.target.value)}>{SUDANESE_STATES.map((st) => <option key={st.id} value={st.id}>{lang === 'ar' ? st.labelAr : st.labelEn}</option>)}</select></div>
                  </>
                )}
                <div className="form-group"><label className="form-label">{lang === 'ar' ? 'الطبيب' : 'Doctor'} *</label><select required className="form-input" value={walkInDoctorId} onChange={(e) => handleWalkInDoctorChange(e.target.value)}><option value="">{lang === 'ar' ? 'اختر الطبيب' : 'Select doctor'}</option>{doctors.filter((doctor) => doctor.status === 'ACTIVE').map((doctor) => <option key={doctor.id} value={doctor.id}>{lang === 'ar' ? doctor.fullNameAr : doctor.fullNameEn}</option>)}</select></div>
                <div className="form-group"><label className="form-label">{lang === 'ar' ? 'موعد اليوم' : "Today's slot"} *</label><select required className="form-input" value={walkInTime} onChange={(e) => setWalkInTime(e.target.value)} disabled={!walkInDoctorId}><option value="">{walkInSlots.length ? (lang === 'ar' ? 'اختر الوقت' : 'Select time') : (lang === 'ar' ? 'لا توجد أوقات متاحة' : 'No available slots')}</option>{walkInSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></div>
                <div className="badge badge-info">{lang === 'ar' ? 'سيتم تسجيل الحضور فورًا مع الالتزام ببوابة دفع الكشف.' : 'The patient will be checked in immediately; the consultation payment gate still applies.'}</div>
                <button type="submit" className="btn btn-primary" disabled={walkInSubmitting || !walkInDoctorId || !walkInTime || (walkInMode === 'EXISTING' && !walkInPatient)}>{walkInSubmitting ? (lang === 'ar' ? 'جارٍ التسجيل...' : 'Registering...') : (lang === 'ar' ? 'تسجيل الحضور وإرسال المريض للطبيب' : 'Check in and send to doctor')}</button>
              </form>
            )}

            {/* TAB: PATIENT DIRECTORY */}
            {activeTab === 'patients' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  overflowY: 'auto'
                }}
              >
                <div>
                  <h3 style={{ marginBottom: '0.35rem' }}>
                    {lang === 'ar' ? 'المرضى' : 'Patients'}
                  </h3>
                  <p
                    style={{
                      margin: 0,
                      color: 'var(--text-secondary)',
                      fontSize: '0.9rem'
                    }}
                  >
                    {lang === 'ar'
                      ? 'ابحث عن مريض مسجل ثم افتح ملفه لإدارة بياناته وربط حساب بوابة المريض.'
                      : 'Search for an existing patient and open their profile to manage their information and patient portal link.'}
                  </p>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap'
                  }}
                >
                  <small style={{ color: 'var(--text-secondary)' }}>
                    {lang === 'ar'
                      ? `المرضى الظاهرون: ${visiblePatientDirectoryResults.length}`
                      : `Visible patients: ${visiblePatientDirectoryResults.length}`}
                  </small>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={loadPatientDirectory}
                    disabled={patientDirectoryLoading}
                  >
                    {lang === 'ar'
                      ? 'تحديث القائمة'
                      : 'Refresh list'}
                  </button>
                </div>

                <div className="search-wrapper">
                  <Search className="search-icon-svg" size={16} />

                  <input
                    type="text"
                    className="search-input-field"
                    placeholder={
                      lang === 'ar'
                        ? 'ابحث بالاسم أو رقم الهاتف أو SHF-000001...'
                        : 'Search by patient name, phone or SHF-000001...'
                    }
                    value={patientDirectoryQuery}
                    dir="auto"
                    onChange={(e) =>
                      handlePatientDirectorySearch(e.target.value)
                    }
                  />
                </div>

                {patientDirectoryBusy && (
                  <div
                    className="glass-panel"
                    style={{
                      padding: '1rem',
                      textAlign: 'center',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    {lang === 'ar'
                      ? 'جارٍ البحث عن المرضى...'
                      : 'Searching patients...'}
                  </div>
                )}

                {visiblePatientDirectoryError && (
                  <div
                    className="badge badge-danger"
                    style={{
                      padding: '0.75rem',
                      whiteSpace: 'normal'
                    }}
                  >
                    {visiblePatientDirectoryError}
                  </div>
                )}

                {!patientDirectoryBusy &&
                  !visiblePatientDirectoryError &&
                  patientDirectoryLoaded &&
                  visiblePatientDirectoryResults.length === 0 && (
                    <div
                      className="glass-panel"
                      style={{
                        padding: '1rem',
                        textAlign: 'center',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      {lang === 'ar'
                        ? 'لم يتم العثور على مرضى مطابقين.'
                        : 'No matching patients found.'}
                    </div>
                  )}

                {visiblePatientDirectoryResults.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem'
                    }}
                  >
                    {visiblePatientDirectoryResults.map((patient) => (
                      <article
                        key={patient.id}
                        className="glass-panel"
                        style={{
                          padding: '0.9rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '1rem',
                          flexWrap: 'wrap'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.25rem'
                          }}
                        >
                          <strong>
                            {lang === 'ar'
                              ? patient.fullNameAr ||
                                patient.fullNameEn
                              : patient.fullNameEn ||
                                patient.fullNameAr}
                          </strong>

                          <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                            {lang === 'ar' ? 'رقم الملف: ' : 'File number: '}<bdi dir="ltr">{patient.fileNumber || '—'}</bdi>
                          </span>

                          {patient.phone && (
                            <span
                              style={{
                                fontSize: '0.85rem',
                                color: 'var(--text-secondary)'
                              }}
                            >
                              {patient.phone}
                            </span>
                          )}

                          {patient.dateOfBirth && (
                            <span
                              style={{
                                fontSize: '0.8rem',
                                color: 'var(--text-secondary)'
                              }}
                            >
                              {lang === 'ar'
                                ? `تاريخ الميلاد: ${patient.dateOfBirth}`
                                : `Date of birth: ${patient.dateOfBirth}`}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            setViewingProfilePatientId(patient.id)
                          }
                        >
                          {lang === 'ar'
                            ? 'فتح ملف المريض'
                            : 'Open Patient Profile'}
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: BILLING & CHECKOUT */}
            {activeTab === 'billing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                {/* Laboratory Billing Queue */}
                <section
                  className="glass-panel"
                  style={{
                    padding: '1rem',
                    marginBottom: '0.75rem'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      marginBottom: '0.75rem'
                    }}
                  >
                    <div>
                      <strong>
                        {lang === 'ar'
                          ? 'فواتير المختبر'
                          : 'Laboratory Bills'}
                      </strong>

                      <div
                        style={{
                          fontSize: '0.78rem',
                          color: 'var(--text-secondary)',
                          marginTop: '0.2rem'
                        }}
                      >
                        {lang === 'ar'
                          ? 'طلبات الفحوصات الصادرة من الطبيب'
                          : 'Diagnostic orders submitted by doctors'}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.75rem'
                      }}
                      onClick={refreshLabBillingQueue}
                      disabled={labBillingLoading}
                    >
                      {labBillingLoading
                        ? (lang === 'ar'
                            ? 'جاري التحديث...'
                            : 'Refreshing...')
                        : (lang === 'ar'
                            ? 'تحديث'
                            : 'Refresh')}
                    </button>
                  </div>

                  {labBillingOrders.length === 0 ? (
                    <div
                      style={{
                        padding: '1rem',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem'
                      }}
                    >
                      {lang === 'ar'
                        ? 'لا توجد طلبات مختبر تحتاج متابعة مالية حالياً.'
                        : 'No laboratory orders currently require billing follow-up.'}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}
                    >
                      {labBillingOrders.map((order) => {
                        const remaining =
                          order.invoice?.remainingBalanceSdg ??
                          order.estimatedTotalSdg ??
                          0;

                        const paid = order.status === 'PAID';

                        return (
                          <button
                            key={order.id}
                            type="button"
                            className={`queue-card-item glass-panel ${
                              selectedLabBillingOrder?.id === order.id
                                ? 'selected'
                                : ''
                            }`}
                            style={{
                              width: '100%',
                              textAlign: 'start',
                              cursor: 'pointer'
                            }}
                            onClick={() =>
                              handleSelectLabBillingOrder(order)
                            }
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '0.75rem',
                                flexWrap: 'wrap'
                              }}
                            >
                              <strong>
                                {lang === 'ar'
                                  ? order.patient.fullNameAr
                                  : order.patient.fullNameEn}
                              </strong>

                              <span
                                className={`badge ${
                                  paid
                                    ? 'badge-success'
                                    : 'badge-warning'
                                }`}
                              >
                                {order.pricingRequired
                                  ? (lang === 'ar'
                                      ? 'بانتظار مراجعة المختبر'
                                      : 'Lab Review Pending')
                                  : paid
                                    ? (lang === 'ar'
                                        ? 'مدفوع'
                                        : 'Paid')
                                    : order.billingStatus ===
                                        'PARTIALLY_PAID'
                                      ? (lang === 'ar'
                                          ? 'مدفوع جزئياً'
                                          : 'Partially Paid')
                                      : (lang === 'ar'
                                          ? 'بانتظار الدفع'
                                          : 'Waiting for Payment')}
                              </span>
                            </div>

                            <div
                              style={{
                                fontSize: '0.8rem',
                                color: 'var(--text-secondary)',
                                marginTop: '0.35rem'
                              }}
                            >
                              {order.items
                                .map((item) =>
                                  lang === 'ar'
                                    ? item.service?.labelAr ||
                                      `${item.customTestName}${item.labReviewStatus === 'EXTERNAL' ? ' — خارجي' : ''}`
                                    : item.service?.labelEn ||
                                      `${item.customTestName}${item.labReviewStatus === 'EXTERNAL' ? ' — External' : ''}`
                                )
                                .filter(Boolean)
                                .join(' • ')}
                            </div>

                            {!order.pricingRequired && (
                              <div
                                style={{
                                  marginTop: '0.35rem',
                                  fontWeight: '600'
                                }}
                              >
                                {paid
                                  ? (lang === 'ar'
                                      ? 'جاهز للمختبر'
                                      : 'Ready for Laboratory')
                                  : `${lang === 'ar'
                                      ? 'المتبقي'
                                      : 'Remaining'}: ${Number(
                                      remaining
                                    ).toLocaleString(
                                      lang === 'ar'
                                        ? 'ar'
                                        : 'en'
                                    )} ${
                                      lang === 'ar'
                                        ? 'ج.س'
                                        : 'SDG'
                                    }`}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Search Patient */}
                <div className="search-wrapper">
                  <Search className="search-icon-svg" size={16} />
                  <input
                    type="text"
                    placeholder={
                      lang === 'ar'
                        ? 'ابحث عن مريض بالاسم أو الهاتف أو SHF-000001...'
                        : 'Search patient by name, phone or SHF-000001...'
                    }
                    className="search-input-field"
                    value={searchQuery}
                    onChange={(e) => handlePatientSearch(e.target.value)}
                  />
                  {searchResults.length > 0 && (
                    <ul className="dropdown-results">
                      {searchResults.map((p) => (
                        <li
                          key={p.id}
                          className="dropdown-item-patient"
                          onClick={() => {
                            setSelectedLabBillingOrder(null);
                            setBillingAppointment(null);
                            setAddedServices([]);
                            setBillingPatient(p);
                            setSearchResults([]);
                            setSearchQuery('');
                          }}
                        >
                          <strong>{lang === 'ar' ? p.fullNameAr : p.fullNameEn}</strong>
                          <span dir="ltr" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{p.fileNumber || '—'} · {p.phone || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {billingPatient && (
                  <div className="glass-panel" style={{ padding: '0.75rem', fontSize: '0.9rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                        flexWrap: 'wrap'
                      }}
                    >
                      <div>
                        <strong>{lang === 'ar' ? 'المريض المختار:' : 'Selected Patient:'}</strong>{' '}
                        {lang === 'ar' ? billingPatient.fullNameAr : billingPatient.fullNameEn}
                        <div dir="ltr" style={{ marginTop: '0.2rem', color: 'var(--primary)', fontWeight: 700 }}>{billingPatient.fileNumber || '—'}</div>
                      </div>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setViewingProfilePatientId(billingPatient.id)}
                      >
                        {lang === 'ar' ? 'فتح ملف المريض' : 'Open Patient Profile'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Services Catalog */}
                <div>
                  <label className="form-label">{lang === 'ar' ? 'اختر الخدمة الطبية' : 'Select Clinical Service'}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {clinicalServices.map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleAddBillingService(svc)}
                        disabled={Boolean(selectedLabBillingOrder)}
                      >
                        {lang === 'ar' ? svc.labelAr : svc.labelEn}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Added services list */}
                {addedServices.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                    <strong>{lang === 'ar' ? 'الخدمات المضافة للفاتورة:' : 'Services Added to Invoice:'}</strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                      {addedServices.map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                          <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>{item.baseFeeSdg == null
                              ? (lang === 'ar' ? 'السعر غير محدد' : 'Pricing required')
                              : `${Number(item.baseFeeSdg).toLocaleString(lang === 'ar' ? 'ar' : 'en')} ${lang === 'ar' ? 'ج.س' : 'SDG'}`}</span>
                            <button
                              type="button"
                              style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                              onClick={() => handleRemoveBillingService(idx)}
                              disabled={Boolean(selectedLabBillingOrder)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Copay selector */}
                    <div className="form-group" style={{ marginTop: '1rem' }}>
                      <label className="form-label">{lang === 'ar' ? 'الضمان الصحي' : 'Health Insurance'}</label>
                      <select
                        className="form-input"
                        value={insuranceCompanyId}
                        onChange={(e) => setInsuranceCompanyId(e.target.value)}
                        disabled={Boolean(selectedLabBillingOrder)}
                      >
                        <option value="">
                          {lang === 'ar'
                            ? 'دفع مباشر بدون تأمين'
                            : 'Self-Pay / No Insurance'}
                        </option>
                        {insuranceCompanies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {lang === 'ar' ? c.labelAr : c.labelEn}{' '}
                            (
                            {lang === 'ar'
                              ? `مساهمة المريض ${parseFloat(c.copayPercentage)}%`
                              : `${parseFloat(c.copayPercentage)}% Copay`}
                            )
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Totals */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 'bold' }}>
                      <span>{t('invoiceTotal')}:</span>
                      <span style={{ color: 'var(--primary)' }}>
                        {calculateInvoiceTotals().totalSdg.toLocaleString(
                          lang === 'ar' ? 'ar' : 'en'
                        )}{' '}
                        {lang === 'ar' ? 'ج.س' : 'SDG'}
                      </span>
                    </div>

                    {/* Split Payments row configuration for receptionist-authorized invoice types */}
                    <div style={{ marginTop: '1rem' }}>
                      <label className="form-label">{lang === 'ar' ? 'توزيع الدفعات' : 'Payment Allocation'}</label>
                      {paymentRows.map((row, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.25rem' }}>
                          <input
                            type="number"
                            placeholder={
      lang === 'ar'
        ? 'المبلغ بالجنيه'
        : 'Amount (SDG)'
    }
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={row.amountSdg}
                            onChange={(e) => {
                              const updated = [...paymentRows];
                              updated[idx].amountSdg = e.target.value;
                              setPaymentRows(updated);
                            }}
                          />
                          <select
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={row.paymentMethod}
                            onChange={(e) => {
                              const updated = [...paymentRows];
                              updated[idx].paymentMethod = e.target.value;
                              setPaymentRows(updated);
                            }}
                          >
                            <option value="CASH">
                              {getPaymentMethodLabel('CASH')}
                            </option>
                            <option value="CARD">
                              {getPaymentMethodLabel('CARD')}
                            </option>
                            <option value="BANKAK">
                              {getPaymentMethodLabel('BANKAK')}
                            </option>
                            <option value="FAWRY">
                              {getPaymentMethodLabel('FAWRY')}
                            </option>
                          </select>
                          <input
                            type="text"
                            placeholder={
      lang === 'ar'
        ? 'رقم المرجع'
        : 'Reference ID'
    }
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={row.transactionReference}
                            onChange={(e) => {
                              const updated = [...paymentRows];
                              updated[idx].transactionReference = e.target.value;
                              setPaymentRows(updated);
                            }}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px', fontSize: '0.75rem', marginTop: '0.5rem', width: '100%' }}
                        onClick={() => setPaymentRows([...paymentRows, { amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }])}
                      >
                        {lang === 'ar' ? '+ إضافة دفعة أخرى' : '+ Add Another Payment'}
                      </button>
                    </div>

                    <button
                      className="btn btn-primary"
                      style={{
                        width: '100%',
                        marginTop: '1.5rem'
                      }}
                      onClick={handleCreateInvoice}
                      disabled={
                        billingSubmitting ||
                        selectedLabBillingOrder?.status === 'PAID' ||
                        selectedLabBillingOrder?.pricingRequired
                      }
                    >
                      {billingSubmitting
                        ? (lang === 'ar'
                            ? 'جاري معالجة الفاتورة...'
                            : 'Processing invoice...')
                        : selectedLabBillingOrder
                          ? selectedLabBillingOrder.status === 'PAID'
                            ? (lang === 'ar'
                                ? 'مدفوع — جاهز للمختبر'
                                : 'Paid — Ready for Laboratory')
                            : selectedLabBillingOrder.billingStatus === 'PARTIALLY_PAID'
                              ? (lang === 'ar'
                                  ? 'إكمال دفع المختبر'
                                  : 'Continue Laboratory Payment')
                              : (lang === 'ar'
                                  ? 'دفع رسوم المختبر'
                                  : 'Pay Laboratory')
                          : (lang === 'ar'
                              ? 'إصدار الفاتورة وتأكيد الدفع'
                              : 'Issue Invoice & Confirm Payment')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB: SHIFT RECONCILE */}
            {activeTab === 'reconcile' && (
              <form onSubmit={handleReconcileShift} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'المبلغ المتوقع بالصندوق (SDG)' : 'Expected Cash in Register (SDG)'}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    className="form-input"
                    placeholder={lang === 'ar' ? 'أدخل المبلغ المتوقع' : 'Enter expected cash amount'}
                    value={expectedCash}
                    onChange={(e) => setExpectedCash(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'المبلغ الفعلي بالصندوق (SDG)' : 'Actual Cash in Register (SDG)'}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    className="form-input"
                    placeholder="Enter cash amount"
                    value={physicalCash}
                    onChange={(e) => setPhysicalCash(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  {t('reconcile')}
                </button>

                {reconcileResult && (
                  <div className="glass-panel" style={{ padding: '1rem', marginTop: '1rem', textAlign: 'center' }}>
                    <h4>{lang === 'ar'
                      ? 'نتيجة مطابقة الوردية'
                      : 'Shift Reconciliation Result'}</h4>
                    <h3 style={{ color: reconcileResult.discrepancy === 0 ? 'var(--primary)' : 'var(--danger)', marginTop: '0.5rem' }}>
                      {reconcileResult.discrepancy === 0
                        ? (lang === 'ar'
                            ? 'الوردية متطابقة تمامًا — لا يوجد فرق'
                            : 'Shift balanced — no discrepancy')
                        : (lang === 'ar'
                            ? `فرق الصندوق: ${reconcileResult.discrepancy.toLocaleString('ar')} ج.س`
                            : `Cash discrepancy: ${reconcileResult.discrepancy.toLocaleString('en')} SDG`)}
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                      {lang === 'ar'
                        ? (reconcileResult.discrepancy === 0
                            ? 'تمت مطابقة المبلغ المتوقع مع المبلغ الفعلي.'
                            : 'يوجد فرق بين المبلغ المتوقع والمبلغ الفعلي. يرجى مراجعته.')
                        : reconcileResult.message}
                    </p>
                  </div>
                )}
              </form>
            )}
          </aside>
        </div>
      </div>
      {viewingProfilePatientId && (
        <PatientProfileModal
          patientId={viewingProfilePatientId}
          onClose={() => setViewingProfilePatientId(null)}
          lang={lang}
        />
      )}
    </div>
  );
}

/* ==========================================
   3. DOCTOR DASHBOARD & CLINICAL EMR WORKSPACE
   ========================================== */
