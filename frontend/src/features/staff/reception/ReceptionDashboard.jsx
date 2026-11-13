import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle, ChevronLeft, ChevronRight, Clock, HelpCircle, Search, Stethoscope, Trash2, Users } from 'lucide-react';
import { PatientProfileModal } from '../clinical/ClinicalModals';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { SUDANESE_STATES } from '../../../utils/clinicData';
import { staffSocket as socket } from '../../../services/staff/staffSocket';
import RoleHero from '../components/RoleHero';
import { clinicDateString } from '../../../utils/clinicTime';
import { staffApiRequest as apiRequest } from '../../../services/apiClient';
import { createLatestSearchScheduler, visiblePatientDirectory } from './debouncedSearch';
import './receptionDashboard.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';
import FacilityIdentityLine from '../components/FacilityIdentityLine';
import ReceptionToolbar from './components/ReceptionToolbar';
import PatientDirectoryPanel from './components/PatientDirectoryPanel';
import LabBillingQueue from './components/LabBillingQueue';
import PendingAppointmentRow from './components/PendingAppointmentRow';
import QueueAppointmentRow from './components/QueueAppointmentRow';
import { calculateInvoiceTotals, createEmptyPatientName, PATIENT_NAME_FIELDS, shiftQueueDate } from './receptionHelpers';

export default function ReceptionDashboard({ lang, t }) {
  const branding = useFacilityBranding();
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
  const [patientName, setPatientName] = useState(createEmptyPatientName());
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
  const [insurancePreview, setInsurancePreview] = useState({ status: 'idle', data: null, error: '' });
  const [issuedBillingInvoice, setIssuedBillingInvoice] = useState(null);
  const [clinicalServices, setClinicalServices] = useState([]);
  const [addedServices, setAddedServices] = useState([]);

  // Payment Allocation
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentMethodsError, setPaymentMethodsError] = useState(false);
  const [paymentRows, setPaymentRows] = useState([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
  useEffect(() => { const codes = paymentMethods.map(method => method.code); setPaymentRows(rows => rows.map(row => codes.includes(row.paymentMethod) ? row : { ...row, paymentMethod: codes[0] || '' })); }, [paymentMethods]);
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
  const insurancePreviewRequestRef = useRef(0);
  if (!billingSearchSchedulerRef.current) billingSearchSchedulerRef.current = createLatestSearchScheduler();
  if (!directorySearchSchedulerRef.current) directorySearchSchedulerRef.current = createLatestSearchScheduler();
  if (!walkInSearchSchedulerRef.current) walkInSearchSchedulerRef.current = createLatestSearchScheduler();

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
    setIssuedBillingInvoice(null);
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
          window.open(data.whatsAppLinkAr, '_blank', 'noopener,noreferrer');
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

    apiRequest('/api/billing/payment-methods').then(data => { setPaymentMethods(Array.isArray(data) ? data : []); setPaymentMethodsError(false); }).catch(() => { setPaymentMethods([]); setPaymentMethodsError(true); });

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

  useEffect(() => {
    const requestId = ++insurancePreviewRequestRef.current;
    if (issuedBillingInvoice) {
      setInsurancePreview({ status: 'ready', data: issuedBillingInvoice, error: '' });
      return;
    }
    if (!billingPatient || selectedLabBillingOrder || addedServices.length === 0) {
      setInsurancePreview({ status: 'idle', data: null, error: '' });
      return;
    }

    const timer = window.setTimeout(async () => {
      setInsurancePreview({ status: 'loading', data: null, error: '' });
      const invoiceType = billingAppointment ? 'CONSULTATION' : 'GENERAL';
      const payload = {
        patientId: billingPatient.id,
        insuranceCompanyId: insuranceCompanyId || null,
        invoiceType,
        appointmentId: billingAppointment?.id || null,
        ...(invoiceType === 'GENERAL' ? {
          items: addedServices.map((service) => ({ serviceId: service.id, quantity: service.qty }))
        } : {})
      };
      try {
        const response = await fetchWithAuth('/api/billing/insurance-preview', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (requestId !== insurancePreviewRequestRef.current) return;
        if (!response.ok) {
          setInsurancePreview({
            status: 'error',
            data: null,
            error: apiErrorMessage(data, lang === 'ar' ? 'تعذر احتساب مسؤولية التأمين.' : 'Unable to calculate insurance responsibility.')
          });
          setPaymentRows([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
          return;
        }
        setInsurancePreview({ status: 'ready', data, error: '' });
        setPaymentRows([{ amountSdg: String(data.patientShareSdg), paymentMethod: 'CASH', transactionReference: '' }]);
      } catch {
        if (requestId !== insurancePreviewRequestRef.current) return;
        setInsurancePreview({ status: 'error', data: null, error: lang === 'ar' ? 'تعذر الاتصال بخدمة احتساب التأمين.' : 'Unable to reach the insurance calculation service.' });
        setPaymentRows([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
      }
    }, 150);

    return () => window.clearTimeout(timer);
  }, [addedServices, billingAppointment, billingPatient, insuranceCompanyId, issuedBillingInvoice, lang, selectedLabBillingOrder]);

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
      setSelectedDoctor(doctors[0]);
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
          ...patientName,
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
        setPatientName(createEmptyPatientName());
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
        ...patientName,
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
        setPatientName(createEmptyPatientName()); setPhone(''); setDob(''); setNationalId(''); setAddressDetails(''); setEmergencyContact('');
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
    setIssuedBillingInvoice(null);
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

    if (!isLaboratoryBilling && insurancePreview.status !== 'ready') {
      setErrorMsg(
        insurancePreview.error || (lang === 'ar'
          ? 'انتظر اكتمال احتساب الفاتورة والتأمين قبل الإصدار.'
          : 'Wait for invoice and insurance calculation before issuing the invoice.')
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

      let data = issuedBillingInvoice;
      if (!data) {
        const res = await fetchWithAuth('/api/billing/invoice', {
          method: 'POST',
          body: JSON.stringify(invoicePayload)
        });

        data = await res.json().catch(() => ({}));

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
        setIssuedBillingInvoice(data);
      }

      const authoritativePatientShare = Number(data.patientShareSdg);
      const requestedPaymentTotal = validPayments.reduce((sum, payment) => sum + payment.amountSdg, 0);
      if (!Number.isSafeInteger(authoritativePatientShare) || requestedPaymentTotal > authoritativePatientShare) {
        setPaymentRows([{ amountSdg: Number.isSafeInteger(authoritativePatientShare) ? String(authoritativePatientShare) : '', paymentMethod: 'CASH', transactionReference: '' }]);
        setInsurancePreview({
          status: Number.isSafeInteger(authoritativePatientShare) ? 'ready' : 'error',
          data: Number.isSafeInteger(authoritativePatientShare) ? {
            grossTotalSdg: Number(data.grossTotalSdg),
            insuranceCoverageSdg: Number(data.insuranceCoverageSdg),
            patientShareSdg: authoritativePatientShare,
            copayPercentage: data.copayPercentage
          } : null,
          error: Number.isSafeInteger(authoritativePatientShare) ? '' : (lang === 'ar' ? 'تعذر التحقق من مسؤولية المريض.' : 'Unable to verify patient responsibility.')
        });
        setErrorMsg(lang === 'ar'
          ? 'تغير المبلغ المعتمد على الخادم. راجع مسؤولية المريض قبل تسجيل الدفع.'
          : 'The server-authoritative amount changed. Review the patient responsibility before recording payment.');
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
        setIssuedBillingInvoice(null);
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
        setIssuedBillingInvoice(data);
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
    const nextDate = shiftQueueDate(filterDate, days);
    if (nextDate) setFilterDate(nextDate);
  };

  const queueMetrics = [
    { key: 'doctors', icon: Stethoscope, value: doctors.length, ar: 'الأطباء المناوبون', en: 'On-duty doctors' },
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

        <ReceptionToolbar
          lang={lang}
          patientDirectoryQuery={patientDirectoryQuery}
          patientDirectorySearchActive={patientDirectorySearchActive}
          patientDirectorySearchLoading={patientDirectorySearchLoading}
          patientDirectorySearchResults={patientDirectorySearchResults}
          patientDirectoryError={patientDirectoryError}
          handlePatientDirectorySearch={handlePatientDirectorySearch}
          setViewingProfilePatientId={setViewingProfilePatientId}
          setActiveTab={setActiveTab}
        />

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
                  <PendingAppointmentRow
                    key={app.id}
                    app={app}
                    lang={lang}
                    branding={branding}
                    setViewingProfilePatientId={setViewingProfilePatientId}
                    handleApproveAppointment={handleApproveAppointment}
                    handleCancelAppointment={handleCancelAppointment}
                  />
                ))}</div>
              )
            ) : selectedDoctor ? (
              appointments.length === 0 ? (
                <div className="reception-empty-state">
                  <HelpCircle size={36} />
                  <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد مواعيد مسجلة لهذا الطبيب اليوم.' : 'No appointments scheduled for this doctor today.'}</p>
                </div>
              ) : (
                <div className="reception-queue-list">{appointments.map((app) => (
                  <QueueAppointmentRow
                    key={app.id}
                    app={app}
                    lang={lang}
                    branding={branding}
                    selectedDoctor={selectedDoctor}
                    setViewingProfilePatientId={setViewingProfilePatientId}
                    handleCheckIn={handleCheckIn}
                    handleQuickBill={handleQuickBill}
                  />
                ))}</div>
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
                  {PATIENT_NAME_FIELDS.map((field) => <div className="form-group" key={field}><label className="form-label">{t(field)} *</label><input type="text" required className="form-input" value={patientName[field]} onChange={(e) => setPatientName((current) => ({ ...current, [field]: e.target.value }))} /></div>)}
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
                    {PATIENT_NAME_FIELDS.map((field) => <div className="form-group" key={field}><label className="form-label">{t(field)} *</label><input required className="form-input" value={patientName[field]} onChange={(e) => setPatientName((current) => ({ ...current, [field]: e.target.value }))} /></div>)}
                    <div className="form-group"><label className="form-label">{t('phone')} *</label><input required className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">{lang === 'ar' ? 'تاريخ الميلاد' : 'Date of Birth'} *</label><input required type="date" className="form-input" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">{t('gender')}</label><select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}><option value="MALE">{t('male')}</option><option value="FEMALE">{t('female')}</option></select></div>
                    <div className="form-group"><label className="form-label">{t('addressState')}</label><select className="form-input" value={addressStateId} onChange={(e) => setAddressStateId(e.target.value)}>{SUDANESE_STATES.map((st) => <option key={st.id} value={st.id}>{lang === 'ar' ? st.labelAr : st.labelEn}</option>)}</select></div>
                  </>
                )}
                <div className="form-group"><label className="form-label">{lang === 'ar' ? 'الطبيب' : 'Doctor'} *</label><select required className="form-input" value={walkInDoctorId} onChange={(e) => handleWalkInDoctorChange(e.target.value)}><option value="">{lang === 'ar' ? 'اختر الطبيب' : 'Select doctor'}</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{lang === 'ar' ? doctor.fullNameAr : doctor.fullNameEn}</option>)}</select></div>
                <div className="form-group"><label className="form-label">{lang === 'ar' ? 'موعد اليوم' : "Today's slot"} *</label><select required className="form-input" value={walkInTime} onChange={(e) => setWalkInTime(e.target.value)} disabled={!walkInDoctorId}><option value="">{walkInSlots.length ? (lang === 'ar' ? 'اختر الوقت' : 'Select time') : (lang === 'ar' ? 'لا توجد أوقات متاحة' : 'No available slots')}</option>{walkInSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></div>
                <div className="badge badge-info">{lang === 'ar' ? 'سيتم تسجيل الحضور فورًا مع الالتزام ببوابة دفع الكشف.' : 'The patient will be checked in immediately; the consultation payment gate still applies.'}</div>
                <button type="submit" className="btn btn-primary" disabled={walkInSubmitting || !walkInDoctorId || !walkInTime || (walkInMode === 'EXISTING' && !walkInPatient)}>{walkInSubmitting ? (lang === 'ar' ? 'جارٍ التسجيل...' : 'Registering...') : (lang === 'ar' ? 'تسجيل الحضور وإرسال المريض للطبيب' : 'Check in and send to doctor')}</button>
              </form>
            )}

            {/* TAB: PATIENT DIRECTORY */}
            {activeTab === 'patients' && (
              <PatientDirectoryPanel
                lang={lang}
                patientDirectoryQuery={patientDirectoryQuery}
                patientDirectoryLoading={patientDirectoryLoading}
                patientDirectoryLoaded={patientDirectoryLoaded}
                patientDirectoryBusy={patientDirectoryBusy}
                visiblePatientDirectoryResults={visiblePatientDirectoryResults}
                visiblePatientDirectoryError={visiblePatientDirectoryError}
                handlePatientDirectorySearch={handlePatientDirectorySearch}
                loadPatientDirectory={loadPatientDirectory}
                setViewingProfilePatientId={setViewingProfilePatientId}
              />
            )}

            {/* TAB: BILLING & CHECKOUT */}
            {activeTab === 'billing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                <FacilityIdentityLine language={lang} />
                {/* Laboratory Billing Queue */}
                <LabBillingQueue
                  lang={lang}
                  labBillingLoading={labBillingLoading}
                  labBillingOrders={labBillingOrders}
                  selectedLabBillingOrder={selectedLabBillingOrder}
                  refreshLabBillingQueue={refreshLabBillingQueue}
                  handleSelectLabBillingOrder={handleSelectLabBillingOrder}
                />

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
                            setIssuedBillingInvoice(null);
                            setBillingPatient(p);
                            setInsuranceCompanyId('');
                            setInsurancePreview({ status: 'idle', data: null, error: '' });
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
                        disabled={Boolean(selectedLabBillingOrder || issuedBillingInvoice)}
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
                              disabled={Boolean(selectedLabBillingOrder || issuedBillingInvoice)}
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
                        disabled={Boolean(selectedLabBillingOrder || issuedBillingInvoice)}
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

                    {/* Server-authoritative insurance preview */}
                    <div className="reception-billing-summary" aria-live="polite">
                      {insurancePreview.status === 'loading' && <p>{lang === 'ar' ? 'جارٍ احتساب مسؤولية التأمين…' : 'Calculating insurance responsibility…'}</p>}
                      {insurancePreview.status === 'error' && <p role="alert" className="reception-billing-summary-error">{insurancePreview.error}</p>}
                      {insurancePreview.status === 'ready' && [
                        [lang === 'ar' ? 'إجمالي الخدمات' : 'Services total', insurancePreview.data.grossTotalSdg],
                        [lang === 'ar' ? 'تغطية التأمين' : 'Insurance coverage', insurancePreview.data.insuranceCoverageSdg],
                        [lang === 'ar' ? 'مساهمة المريض' : 'Patient contribution', insurancePreview.data.patientShareSdg],
                        [lang === 'ar' ? 'المطلوب من المريض' : 'Patient amount due', insurancePreview.data.patientShareSdg]
                      ].map(([label, amount], index) => (
                        <div key={label} className={index === 3 ? 'is-due' : ''}>
                          <span>{label}</span>
                          <strong>{Number(amount).toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}</strong>
                        </div>
                      ))}
                      {insurancePreview.status === 'idle' && <div className="is-due"><span>{t('invoiceTotal')}</span><strong>{calculateInvoiceTotals(addedServices).totalSdg.toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}</strong></div>}
                    </div>

                    {paymentMethodsError && <p role="alert">{lang === 'ar' ? 'تعذر تحميل طرق الدفع. أعد تحميل الصفحة للمحاولة.' : 'Payment methods could not be loaded. Reload to retry.'}</p>}
                    {paymentMethods.length === 0 && !paymentMethodsError && <p role="status">{lang === 'ar' ? 'لا توجد طرق دفع نشطة. راجع مدير العيادة.' : 'No active payment methods. Contact the clinic administrator.'}</p>}
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
                            <option value="">{lang === 'ar' ? 'اختر طريقة دفع متاحة' : 'Choose an available payment method'}</option>
                            {paymentMethods.map(method => <option key={method.code} value={method.code}>{lang === 'ar' ? method.labelAr : method.labelEn}</option>)}
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
                        (!selectedLabBillingOrder && insurancePreview.status !== 'ready') || paymentMethodsError || paymentMethods.length === 0 || paymentRows.some(row => !paymentMethods.some(method => method.code === row.paymentMethod)) ||
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
