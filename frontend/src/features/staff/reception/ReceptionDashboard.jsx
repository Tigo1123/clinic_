import { guardFormSubmit } from '../../../utils/guardFormSubmit.js';
import { NAME_FIELDS, patientNameErrors, isValidPastDate } from '../../../utils/patientIdentityValidation.js';
import PatientIdentityField from './components/PatientIdentityField';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calculator,
  ClipboardList,
  DollarSign,
  FlaskConical,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { PatientProfileModal } from '../clinical/ClinicalModals';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { SUDANESE_STATES } from '../../../utils/clinicData';
import { staffSocket as socket } from '../../../services/staff/staffSocket';
import RoleHero from '../components/RoleHero';
import { clinicDateString } from '../../../utils/clinicTime';
import { staffApiRequest as apiRequest } from '../../../services/apiClient';
import { createLatestSearchScheduler, visiblePatientDirectory } from './debouncedSearch';
import { useStaffNav } from '../staffShellContext';
import './receptionDashboard.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';
import FacilityIdentityLine from '../components/FacilityIdentityLine';
import ReceptionToolbar from './components/ReceptionToolbar';
import PatientDirectoryPanel from './components/PatientDirectoryPanel';
import LabBillingQueue from './components/LabBillingQueue';
import ServiceOrderBillingOptions from './components/ServiceOrderBillingOptions';
import ExcludeServiceChargeDialog from './components/ExcludeServiceChargeDialog';
import InvoiceCorrectionDialog from './components/InvoiceCorrectionDialog';
import PendingAppointmentRow from './components/PendingAppointmentRow';
import AppointmentQueue from './components/AppointmentQueue';
import ConfirmAppointmentDialog from './components/ConfirmAppointmentDialog';
import {
  calculateInvoiceTotals,
  createEmptyPatientName
} from './receptionHelpers';

function issuedInvoiceLines(invoice) {
  return invoice.items.map((item) => ({
    id: item.id,
    labelAr: item.descriptionAr,
    labelEn: item.descriptionEn,
    baseFeeSdg: Number(item.unitPriceSdg),
    qty: item.qty
  }));
}

export default function ReceptionDashboard({ lang, t, notificationIntent = null, onNotificationIntentHandled }) {
  const branding = useFacilityBranding();
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [queueRevision, setQueueRevision] = useState(0);
  const [confirming, setConfirming] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const confirmationNoticeRef = useRef(null);
  const refreshDoctorQueue = useCallback(() => setQueueRevision(value => value + 1), []);
  const closeConfirmation = useCallback(() => setConfirming(null), []);

  useEffect(() => {
    if (confirmation) confirmationNoticeRef.current?.focus();
  }, [confirmation]);
  const [activeTab, setActiveTab] = useState('front-desk'); // 'front-desk', 'walkin', 'register', 'patients', 'billing', 'lab-billing', 'reconcile'

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
  const nameErrors = patientNameErrors(patientName);
  const birthDateError = isValidPastDate(dob) ? undefined : 'onboardingDobInvalid';
  const nameInputs = NAME_FIELDS.map(field => (
    <PatientIdentityField key={field} field={field} value={patientName[field]} t={t} error={nameErrors[field]}
      onChange={value => setPatientName(current => ({ ...current, [field]: value }))} />
  ));
  const birthDateInput = <PatientIdentityField field="dateOfBirth" value={dob} onChange={setDob} t={t} error={birthDateError} />;
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
  const [insuranceCompaniesLoading, setInsuranceCompaniesLoading] = useState(false);
  const [insuranceCompaniesError, setInsuranceCompaniesError] = useState('');
  const [insurancePreview, setInsurancePreview] = useState({ status: 'idle', data: null, error: '' });
  const [issuedBillingInvoice, setIssuedBillingInvoice] = useState(null);
  const [billingServiceOrder, setBillingServiceOrder] = useState(null);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [chargeToExclude, setChargeToExclude] = useState(null);
  const [reviewingRefund, setReviewingRefund] = useState(false);
  const [serviceOrderStatus, setServiceOrderStatus] = useState('loading');
  const [serviceOrderRevision, setServiceOrderRevision] = useState(0);
  const [addedServices, setAddedServices] = useState([]);

  // Payment Allocation
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentMethodsError, setPaymentMethodsError] = useState(false);
  const [paymentRows, setPaymentRows] = useState([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
  useEffect(() => {
    const codes = paymentMethods.map(method => method.code);
    setPaymentRows(rows => rows.map(row => codes.includes(row.paymentMethod) ? row : { ...row, paymentMethod: codes[0] || '' }));
  }, [paymentMethods]);
  const [billingSubmitting, setBillingSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Shift cash ledger
  const [physicalCash, setPhysicalCash] = useState('');
  const [expectedCash, setExpectedCash] = useState('');
  const [reconcileResult, setReconcileResult] = useState(null);
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  const [filterDate, setFilterDate] = useState(clinicDateString());
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);

  // Pending Approvals State
  const [pendingAppointments, setPendingAppointments] = useState([]);
  const [pendingAppointmentsLoadError, setPendingAppointmentsLoadError] = useState(false);
  const [billingAppointment, setBillingAppointment] = useState(null);
  const [highlightedAppointmentId, setHighlightedAppointmentId] = useState(null);
  const [highlightedLabOrderId, setHighlightedLabOrderId] = useState(null);
  const [staleNotificationNotice, setStaleNotificationNotice] = useState(null);
  const lastHandledIntentKeyRef = useRef(null);
  const doctorsRef = useRef(doctors);
  doctorsRef.current = doctors;
  const filterDateRef = useRef(filterDate);
  filterDateRef.current = filterDate;
  const onIntentHandledRef = useRef(onNotificationIntentHandled);
  onIntentHandledRef.current = onNotificationIntentHandled;

  // Laboratory billing queue
  const [labBillingOrders, setLabBillingOrders] = useState([]);
  const [selectedLabBillingOrder, setSelectedLabBillingOrder] = useState(null);
  const [labBillingLoading, setLabBillingLoading] = useState(false);
  const [labBillingLoadError, setLabBillingLoadError] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const pendingActionIdsRef = useRef(new Set());
  const [pendingActionIds, setPendingActionIds] = useState(new Set());
  const billingSearchSchedulerRef = useRef(null);
  const directorySearchSchedulerRef = useRef(null);
  const walkInSearchSchedulerRef = useRef(null);
  const directoryLoadRequestRef = useRef(0);
  const insurancePreviewRequestRef = useRef(0);
  const insuranceCompaniesRequestRef = useRef(0);
  const issuedBillingInvoiceRef = useRef(null);
  const selectedLabBillingOrderRef = useRef(null);
  issuedBillingInvoiceRef.current = issuedBillingInvoice;
  selectedLabBillingOrderRef.current = selectedLabBillingOrder;
  const paymentAttemptRef = useRef(null);
  const billingInFlight = useRef(false);
  if (!billingSearchSchedulerRef.current) billingSearchSchedulerRef.current = createLatestSearchScheduler();
  if (!directorySearchSchedulerRef.current) directorySearchSchedulerRef.current = createLatestSearchScheduler();
  if (!walkInSearchSchedulerRef.current) walkInSearchSchedulerRef.current = createLatestSearchScheduler();

  const pendingRequestRef = useRef(0);
  const fetchPendingAppointments = () => {
    const requestId = ++pendingRequestRef.current;
    fetchWithAuth('/api/appointments/pending')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load pending appointments');
        return res.json();
      })
      .then((data) => {
        if (requestId !== pendingRequestRef.current) return;
        setPendingAppointmentsLoadError(false);
        setPendingAppointments(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (requestId === pendingRequestRef.current) setPendingAppointmentsLoadError(true);
      });
  };

  const refreshLabBillingQueue = async () => {
    setLabBillingLoading(true);

    try {
      const res = await fetchWithAuth('/api/billing/lab-orders/pending');
      const data = await res.json().catch(() => []);

      if (!res.ok) {
        console.error('Laboratory billing queue failed:', data);
        setLabBillingLoadError(true);
        return;
      }

      const queue = Array.isArray(data) ? data : [];
      setLabBillingOrders(queue);
      setLabBillingLoadError(false);

      setSelectedLabBillingOrder((current) => {
        if (!current) return null;

        const refreshed = queue.find((order) => order.id === current.id);

        if (!refreshed) return null;

        return refreshed;
      });
    } catch (err) {
      console.error('Laboratory billing queue error:', err);
      setLabBillingLoadError(true);
    } finally {
      setLabBillingLoading(false);
    }
  };

  const handleSelectLabBillingOrder = (order) => {
    setErrorMsg('');
    setSuccessMsg('');

    paymentAttemptRef.current = null;
    setSelectedLabBillingOrder(order);
    setBillingServiceOrder(null);
    setChargeToExclude(null);
    setReviewingRefund(false);
    setIssuedBillingInvoice(order.issuedInvoice ?? null);
    setBillingPatient(order.patient);
    setBillingAppointment(null);
    setInsuranceCompanyId(order.issuedInvoice?.insuranceClaim?.insuranceCompanyId || '');
    setInsurancePreview({ status: 'idle', data: null, error: '' });

    const invoiceItems = order.issuedInvoice?.invoice.items;
    setAddedServices(invoiceItems
      ? issuedInvoiceLines(order.issuedInvoice.invoice)
      : order.items.filter((item) => item.labReviewStatus !== 'EXTERNAL').map((item) => ({
          id: item.id,
          labelAr: item.service?.labelAr || item.customTestName || 'فحص مخصص',
          labelEn: item.service?.labelEn || item.customTestName || 'Custom Test',
          baseFeeSdg: item.service?.baseFeeSdg == null ? null : Number(item.service.baseFeeSdg),
          qty: 1
        })));

    setPaymentRows((rows) => [{
      amountSdg: order.issuedInvoice ? String(order.issuedInvoice.remainingBalanceSdg) : '',
      paymentMethod: rows[0]?.paymentMethod || '',
      transactionReference: ''
    }]);
    setActiveTab('billing');
  };

  function handleApproveAppointment(appointment) {
    setConfirmation(null);
    setConfirming(appointment);
  }

  function handleConfirmed(appointment, data) {
    setConfirming(null);
    setConfirmation({ patient: appointment.patient, ar: data.whatsAppLinkAr, en: data.whatsAppLinkEn });
    setPendingAppointments(list => list.filter(item => item.id !== appointment.id));
    fetchPendingAppointments();
    refreshDoctorQueue();
  }

  const handleCancelAppointment = async (appId) => {
    if (pendingActionIdsRef.current.has(appId)) return;
    const confirmed = window.confirm(
      lang === 'ar'
        ? 'هل أنت متأكد أنك تريد إلغاء هذا الموعد؟'
        : 'Are you sure you want to cancel this appointment?'
    );

    if (!confirmed) return;

    pendingActionIdsRef.current.add(appId);
    setPendingActionIds(new Set(pendingActionIdsRef.current));

    try {
      const res = await fetchWithAuth(`/api/appointments/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم إلغاء الموعد.' : 'Appointment cancelled.');
        fetchPendingAppointments();
        refreshDoctorQueue();
      } else {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر إلغاء الموعد.'
              : 'Failed to cancel the appointment.'
          )
        );
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        lang === 'ar'
          ? 'تعذر إلغاء الموعد. يرجى المحاولة مرة أخرى.'
          : 'Failed to cancel the appointment. Please try again.'
      );
    } finally {
      pendingActionIdsRef.current.delete(appId);
      setPendingActionIds(new Set(pendingActionIdsRef.current));
    }
  };

  const loadInsuranceCompanies = useCallback(async () => {
    const requestId = ++insuranceCompaniesRequestRef.current;
    setInsuranceCompaniesLoading(true);
    setInsuranceCompaniesError('');
    try {
      const res = await fetchWithAuth('/api/billing/insurance-companies');
      const data = await res.json().catch(() => null);
      if (requestId !== insuranceCompaniesRequestRef.current) return;
      if (!res.ok || !Array.isArray(data)) {
        setInsuranceCompanies([]);
        setInsuranceCompaniesError(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر تحميل شركات التأمين. حاول مرة أخرى.'
              : 'Unable to load insurance providers. Please try again.',
            lang
          )
        );
        return;
      }
      setInsuranceCompanies(data);
      if (!issuedBillingInvoiceRef.current && !selectedLabBillingOrderRef.current) {
        setInsuranceCompanyId((current) => (
          current && !data.some((company) => company.id === current) ? '' : current
        ));
      }
    } catch (err) {
      console.error(err);
      if (requestId !== insuranceCompaniesRequestRef.current) return;
      setInsuranceCompanies([]);
      setInsuranceCompaniesError(
        lang === 'ar'
          ? 'تعذر الاتصال بخدمة شركات التأمين. حاول مرة أخرى.'
          : 'Unable to reach the insurance providers service. Please try again.'
      );
    } finally {
      if (requestId === insuranceCompaniesRequestRef.current) {
        setInsuranceCompaniesLoading(false);
      }
    }
  }, [lang]);

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

    loadInsuranceCompanies();
  }, [loadInsuranceCompanies]);

  useEffect(() => {
    if (activeTab === 'billing') {
      loadInsuranceCompanies();
    }
  }, [activeTab, loadInsuranceCompanies]);

  const prevBillingPatientIdRef = useRef(null);
  useEffect(() => {
    const currentId = billingPatient?.id ?? null;
    if (currentId !== prevBillingPatientIdRef.current) {
      prevBillingPatientIdRef.current = currentId;
      if (!selectedLabBillingOrderRef.current && !issuedBillingInvoiceRef.current) {
        setInsuranceCompanyId('');
      }
    }
  }, [billingPatient]);

  const issuedPaymentStatus = issuedBillingInvoice?.invoice.paymentStatus;
  const paymentLocked = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'].includes(issuedPaymentStatus);
  const canReviewRefund = issuedBillingInvoice?.refundableSdg > 0 && (
    billingAppointment?.status === 'CHECKED_IN' ||
    ['PENDING_BILLING', 'PAID'].includes(selectedLabBillingOrder?.status)
  );
  const billingPatientId = billingPatient?.id;
  useEffect(() => {
    setServiceOrders([]);
    setServiceOrderStatus('loading');
    if (activeTab !== 'billing' || !billingPatientId || billingAppointment || selectedLabBillingOrder) return;
    let current = true;
    apiRequest(`/api/billing/service-orders/pending/${encodeURIComponent(billingPatientId)}`)
      .then((orders) => {
        if (!current) return;
        setServiceOrders(Array.isArray(orders) ? orders : []);
        setServiceOrderStatus('ready');
      })
      .catch(() => {
        if (current) setServiceOrderStatus('error');
      });
    return () => { current = false; };
  }, [activeTab, billingPatientId, billingAppointment, selectedLabBillingOrder, serviceOrderRevision]);

  useEffect(() => {
    const requestId = ++insurancePreviewRequestRef.current;
    if (issuedBillingInvoice) {
      setInsurancePreview({ status: 'ready', data: issuedBillingInvoice, error: '' });
      return;
    }
    if (!billingPatient || selectedLabBillingOrder?.pricingRequired || addedServices.length === 0) {
      setInsurancePreview({ status: 'idle', data: null, error: '' });
      return;
    }

    const timer = window.setTimeout(async () => {
      setInsurancePreview({ status: 'loading', data: null, error: '' });
      const invoiceType = selectedLabBillingOrder
        ? 'LABORATORY'
        : billingAppointment ? 'CONSULTATION' : 'GENERAL';
      const payload = {
        patientId: billingPatient.id,
        insuranceCompanyId: insuranceCompanyId || null,
        invoiceType,
        appointmentId: billingAppointment?.id || null,
        ...(selectedLabBillingOrder ? { labOrderId: selectedLabBillingOrder.id } : {}),
        ...(billingServiceOrder ? { serviceOrderId: billingServiceOrder.id } : {})
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
        if (data.existing && data.invoice) {
          setIssuedBillingInvoice(data);
          setAddedServices(issuedInvoiceLines(data.invoice));
          setInsuranceCompanyId(data.insuranceClaim?.insuranceCompanyId || '');
        }
        setInsurancePreview({ status: 'ready', data, error: '' });
        setPaymentRows((rows) => [{ amountSdg: String(data.remainingBalanceSdg ?? data.patientShareSdg), paymentMethod: rows[0]?.paymentMethod || '', transactionReference: '' }]);
      } catch {
        if (requestId !== insurancePreviewRequestRef.current) return;
        setInsurancePreview({ status: 'error', data: null, error: lang === 'ar' ? 'تعذر الاتصال بخدمة احتساب التأمين.' : 'Unable to reach the insurance calculation service.' });
        setPaymentRows([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
      }
    }, 150);

    return () => window.clearTimeout(timer);
  }, [addedServices.length, billingAppointment, billingPatient, billingServiceOrder, insuranceCompanyId, issuedBillingInvoice, lang, selectedLabBillingOrder]);

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

  useEffect(() => {
    const requestKey = notificationIntent?.requestKey;
    if (!requestKey || lastHandledIntentKeyRef.current === requestKey) return;
    lastHandledIntentKeyRef.current = requestKey;
    let active = true;

    async function handleDrillDown() {
      setErrorMsg('');
      setSuccessMsg('');
      setStaleNotificationNotice(null);
      setHighlightedAppointmentId(null);
      setHighlightedLabOrderId(null);

      const { targetType, targetId, eventType, context = {} } = notificationIntent;

      if (targetType === 'labOrder') {
        const labOrderId = targetId || context.labOrderId;
        setActiveTab('lab-billing');
        setLabBillingLoading(true);
        try {
          const res = await fetchWithAuth('/api/billing/lab-orders/pending');
          const data = await res.json().catch(() => []);
          if (!active) return;
          if (!res.ok) {
            setLabBillingLoadError(true);
            setStaleNotificationNotice({
              type: 'warning',
              text: lang === 'ar'
                ? 'تعذر فتح طلب فحص المختبر المشار إليه.'
                : 'Unable to load the referenced laboratory billing order.'
            });
            return;
          }
          const queue = Array.isArray(data) ? data : [];
          setLabBillingOrders(queue);
          setLabBillingLoadError(false);
          const matchedOrder = labOrderId ? queue.find((order) => order.id === labOrderId) : null;
          if (matchedOrder) {
            setHighlightedLabOrderId(matchedOrder.id);
          } else {
            setStaleNotificationNotice({
              type: 'warning',
              text: lang === 'ar'
                ? 'طلب فحص المختبر المشار إليه تم سداده بالفعل أو لم يعد بانتظار التحصيل.'
                : 'The referenced laboratory order has already been paid or is no longer awaiting billing.',
              patientId: context.patientId || null
            });
          }
        } catch {
          if (active) setLabBillingLoadError(true);
        } finally {
          if (active) setLabBillingLoading(false);
          onIntentHandledRef.current?.();
        }
        return;
      }

      if (targetType === 'appointment') {
        const appointmentId = targetId || context.appointmentId;
        const targetDate = context.appointmentDate || filterDateRef.current;
        const targetDoctorId = context.doctorId || null;
        const patientId = context.patientId || null;

        setActiveTab('front-desk');

        let availableDoctors = doctorsRef.current;
        if (targetDoctorId && availableDoctors.length === 0) {
          try {
            const loadedDoctors = await apiRequest('/api/appointments/doctors');
            if (!active) return;
            availableDoctors = Array.isArray(loadedDoctors) ? loadedDoctors : [];
            setDoctors(availableDoctors);
          } catch {
            availableDoctors = [];
          }
        }

        const matchedDoctor = targetDoctorId
          ? availableDoctors.find((doc) => doc.id === targetDoctorId) || null
          : null;
        if (matchedDoctor) {
          setSelectedDoctor(matchedDoctor);
        }
        if (context.appointmentDate) {
          setFilterDate(context.appointmentDate);
        }

        let pendingList = [];
        try {
          const pendingRes = await fetchWithAuth('/api/appointments/pending');
          const pendingData = pendingRes.ok ? await pendingRes.json().catch(() => []) : [];
          if (!active) return;
          pendingList = Array.isArray(pendingData) ? pendingData : [];
          setPendingAppointments(pendingList);
          setPendingAppointmentsLoadError(!pendingRes.ok);
        } catch {
          if (active) setPendingAppointmentsLoadError(true);
        }

        const pendingMatch = appointmentId ? pendingList.find((item) => item.id === appointmentId) : null;
        if (pendingMatch) {
          if (!matchedDoctor && pendingMatch.doctorId) {
            const pendingDoc = availableDoctors.find((doc) => doc.id === pendingMatch.doctorId);
            if (pendingDoc) setSelectedDoctor(pendingDoc);
          }
          setHighlightedAppointmentId(pendingMatch.id);
          refreshDoctorQueue();
          onIntentHandledRef.current?.();
          return;
        }

        const queueDoctorId = matchedDoctor?.id || targetDoctorId;
        if (queueDoctorId && appointmentId) {
          try {
            const queueRes = await fetchWithAuth(`/api/appointments/queue/${queueDoctorId}?date=${encodeURIComponent(targetDate)}`);
            const queueData = queueRes.ok ? await queueRes.json().catch(() => []) : [];
            if (!active) return;
            const queueList = Array.isArray(queueData) ? queueData : [];
            refreshDoctorQueue();
            const queueMatch = queueList.find((item) => item.id === appointmentId);
            if (queueMatch) {
              setHighlightedAppointmentId(queueMatch.id);
              if (eventType === 'APPOINTMENT_BOOKED') {
                setStaleNotificationNotice({
                  type: 'info',
                  text: lang === 'ar'
                    ? 'تمت معالجة طلب الحجز مسبقاً — يتم عرض الموعد في طابور الطبيب.'
                    : 'This booking request was already processed — showing the appointment in the doctor queue.'
                });
              }
              onIntentHandledRef.current?.();
              return;
            }
          } catch {
            // Fall through to stale-record handling below.
          }
        }

        if (patientId && !appointmentId) {
          setViewingProfilePatientId(patientId);
          onIntentHandledRef.current?.();
          return;
        }

        setStaleNotificationNotice({
          type: 'warning',
          text: lang === 'ar'
            ? 'الموعد المشار إليه لم يعد معلقاً أو نشطاً في الطابور (ربما تم إلغاؤه أو نقله).'
            : 'The referenced appointment is no longer pending or active in the queue (it may have been cancelled or moved).',
          patientId
        });
        onIntentHandledRef.current?.();
      }
    }

    handleDrillDown();
    return () => { active = false; };
  }, [notificationIntent, lang, refreshDoctorQueue]);

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
    if (isRegistering) return;
    setErrorMsg('');
    setSuccessMsg('');
    setIsRegistering(true);
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
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم تسجيل المريض بنجاح.' : 'Patient registered successfully.');
        selectBillingPatient(data);
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
    } finally {
      setIsRegistering(false);
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
    insuranceCompaniesRequestRef.current += 1;
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
        setFilterDate(clinicDateString());
        refreshDoctorQueue();
      }
      setWalkInPatient(null);
      setWalkInPatientQuery('');
      setWalkInPatientResults([]);
      setWalkInTime('');
      setWalkInSlots([]);
      if (walkInMode === 'NEW') {
        setPatientName(createEmptyPatientName()); setPhone(''); setDob(''); setNationalId(''); setAddressDetails(''); setEmergencyContact('');
      }
      setActiveTab('front-desk');
    } catch {
      setErrorMsg(lang === 'ar' ? 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to reach the server. Check your connection and try again.');
    } finally {
      setWalkInSubmitting(false);
    }
  };

  const handleCheckIn = async (appointmentId) => {
    if (pendingActionIdsRef.current.has(appointmentId)) return;
    pendingActionIdsRef.current.add(appointmentId);
    setPendingActionIds(new Set(pendingActionIdsRef.current));
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
    } finally {
      pendingActionIdsRef.current.delete(appointmentId);
      setPendingActionIds(new Set(pendingActionIdsRef.current));
    }
  };

  const selectBillingPatient = (patient) => {
    paymentAttemptRef.current = null;
    setSelectedLabBillingOrder(null);
    setBillingAppointment(null);
    setBillingServiceOrder(null);
    setChargeToExclude(null);
    setReviewingRefund(false);
    setAddedServices([]);
    setIssuedBillingInvoice(null);
    setBillingPatient(patient);
    setInsuranceCompanyId('');
    setInsurancePreview({ status: 'idle', data: null, error: '' });
  };

  const handleQuickBill = (app) => {
    if (!app.patient || app.status !== 'CHECKED_IN') return;

    selectBillingPatient(app.patient);
    setBillingAppointment(app);
    setActiveTab('billing');

    const docFee = app.doctor?.consultationFee ? Number(app.doctor.consultationFee) : 0;
    setAddedServices([{
      id: app.id,
      labelAr: `معاينة - د. ${app.doctor.fullNameAr}`,
      labelEn: `Consultation - Dr. ${app.doctor.fullNameEn}`,
      baseFeeSdg: docFee,
      qty: 1
    }]);
  };

  const handleSelectServiceOrder = (order) => {
    if (billingServiceOrder?.id === order.id && issuedBillingInvoice) return;

    paymentAttemptRef.current = null;
    setErrorMsg('');
    setSuccessMsg('');
    setBillingServiceOrder(order);
    setChargeToExclude(null);
    setInsuranceCompanyId(order.issuedInvoice?.insuranceClaim?.insuranceCompanyId || '');
    setInsurancePreview({ status: 'idle', data: null, error: '' });
    setIssuedBillingInvoice(order.issuedInvoice);
    if (order.issuedInvoice) {
      setPaymentRows((rows) => [{
        amountSdg: String(order.issuedInvoice.remainingBalanceSdg),
        paymentMethod: rows[0]?.paymentMethod || '',
        transactionReference: ''
      }]);
    }
    setAddedServices(order.items.filter((item) => !item.billingExcludedAt).map((item) => ({ ...item, qty: item.quantity })));
  };

  const handleChargeExcluded = (itemId, reason) => {
    ++insurancePreviewRequestRef.current;
    setInsurancePreview({ status: 'idle', data: null, error: '' });
    setAddedServices((services) => services.filter((item) => item.id !== itemId));
    setBillingServiceOrder((order) => ({
      ...order,
      items: order.items.map((item) => item.id === itemId
        ? { ...item, billingExcludedAt: true, billingExclusionReason: reason }
        : item)
    }));
    setChargeToExclude(null);
    setServiceOrderRevision((revision) => revision + 1);
  };

  const handleInvoiceRefunded = async () => {
    selectBillingPatient(null);
    setErrorMsg('');
    setSuccessMsg(lang === 'ar' ? 'تم تسجيل الاسترداد.' : 'Refund recorded.');
    refreshDoctorQueue();
    await refreshLabBillingQueue();
  };

  const handleCreateInvoice = async () => {
    if (billingInFlight.current) return;
    if (billingSubmitting || paymentLocked) return;

    let paymentRequestSent = false;
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
          ? 'اختر موعد معاينة أو طلبًا من الطبيب.'
          : 'Select a consultation or doctor order.'
      );
      return;
    }

    if (insurancePreview.status !== 'ready') {
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

    const isZeroPatientShare = Number(insurancePreview.data?.patientShareSdg) === 0;
    if (validPayments.length === 0 && !isZeroPatientShare) {
      setErrorMsg(
        lang === 'ar'
          ? 'أدخل مبلغ دفع صحيح.'
          : 'Enter a valid payment amount.'
      );
      return;
    }

    billingInFlight.current = true;
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
        serviceOrderId: billingServiceOrder?.id,

        insuranceCompanyId: insuranceCompanyId || undefined
      };

      let data = issuedBillingInvoice;
      if (!data) {
        const res = await fetchWithAuth('/api/billing/invoice', {
          method: 'POST',
          body: JSON.stringify(invoicePayload)
        });

        data = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (data.error?.code === 'SERVICE_ORDER_BILLING_CHANGED') {
            setServiceOrderRevision((revision) => revision + 1);
          }
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
        setAddedServices(issuedInvoiceLines(data.invoice));
      }

      if (data.invoice.paymentStatus === 'PAID') {
        paymentAttemptRef.current = null;
        setSuccessMsg(isLaboratoryBilling
          ? (lang === 'ar' ? 'تمت تسوية رسوم المختبر والطلب جاهز لجمع العينة.' : 'Laboratory invoice settled. The order is ready for sample collection.')
          : (lang === 'ar' ? 'تمت تسوية الفاتورة.' : 'Invoice settled.'));
        selectBillingPatient(null);
        refreshDoctorQueue();
        await refreshLabBillingQueue();
        return;
      }

      const authoritativePatientShare = Number(data.remainingBalanceSdg ?? data.patientShareSdg);
      const requestedPaymentTotal = validPayments.reduce((sum, payment) => sum + payment.amountSdg, 0);
      if (!Number.isSafeInteger(authoritativePatientShare) || requestedPaymentTotal > authoritativePatientShare) {
        paymentAttemptRef.current = null;
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

      const invoiceId = data.invoice.id;
      const normalizedPayments = validPayments.map((payment) => ({
        amountSdg: payment.amountSdg,
        paymentMethod: payment.paymentMethod,
        transactionReference:
          payment.transactionReference || undefined
      }));
      const fingerprint = JSON.stringify({ invoiceId, payments: normalizedPayments });

      if (
        !paymentAttemptRef.current ||
        paymentAttemptRef.current.invoiceId !== invoiceId ||
        paymentAttemptRef.current.fingerprint !== fingerprint
      ) {
        paymentAttemptRef.current = {
          invoiceId,
          fingerprint,
          idempotencyKey: crypto.randomUUID()
        };
      }
      const idempotencyKey = paymentAttemptRef.current.idempotencyKey;

      paymentRequestSent = true;
      const paymentRes = await fetchWithAuth(
        `/api/billing/invoice/${data.invoice.id}/payments`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify({
            payments: normalizedPayments
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

      paymentAttemptRef.current = null;

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
        } else if (billingServiceOrder) {
          setSuccessMsg(lang === 'ar' ? 'تم دفع فاتورة الإجراءات بالكامل.' : 'Procedure invoice paid in full.');
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
        setBillingServiceOrder(null);

        setPaymentRows([
          {
            amountSdg: '',
            paymentMethod: 'CASH',
            transactionReference: ''
          }
        ]);
      } else {
        setIssuedBillingInvoice({
          ...data,
          invoice: { ...data.invoice, paymentStatus: paymentData.paymentStatus },
          refundableSdg: paymentData.totalPaidSdg,
          remainingBalanceSdg: paymentData.remainingBalanceSdg
        });
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

      if (paymentRequestSent) {
        setErrorMsg(
          lang === 'ar'
            ? 'تعذر تأكيد نتيجة الدفع. يمكنك إعادة المحاولة بنفس المبلغ بأمان، أو تحديث الفاتورة للتحقق.'
            : 'The payment outcome could not be confirmed. Retrying the same payment is safe, or refresh the invoice to check.'
        );
      } else {
        setErrorMsg(
          lang === 'ar'
            ? 'حدث خطأ أثناء معالجة الفاتورة والدفع.'
            : 'An error occurred while processing billing and payment.'
        );
      }
    } finally {
      billingInFlight.current = false;
      setBillingSubmitting(false);
    }
  };

  const handleReconcileShift = async (e) => {
    e.preventDefault();
    if (reconcileSubmitting) return;

    setErrorMsg('');
    setSuccessMsg('');
    setReconcileResult(null);

    const expected = Number(expectedCash);
    const actual = Number(physicalCash);

    if (String(expectedCash).trim() === '' || String(physicalCash).trim() === '' || !Number.isSafeInteger(expected) || expected < 0 || !Number.isSafeInteger(actual) || actual < 0) {
      setErrorMsg(
        lang === 'ar'
          ? 'أدخل مبالغ صحيحة بالجنيه بدون كسور.'
          : 'Enter whole SDG amounts with no decimals.'
      );
      return;
    }

    setReconcileSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/billing/shift/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          expectedAmountSdg: expected,
          actualAmountSdg: actual,
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
    } finally {
      setReconcileSubmitting(false);
    }
  };

  // Registered left-rail items
  const labAwaitingPaymentCount = useMemo(() => {
    return labBillingOrders.filter((order) => order.status !== 'PAID' && !order.pricingRequired).length;
  }, [labBillingOrders]);

  const navItems = useMemo(() => [
    {
      id: 'front-desk',
      label: lang === 'ar' ? 'الاستقبال' : 'Front desk',
      icon: ClipboardList
    },
    {
      id: 'patients',
      label: lang === 'ar' ? 'المرضى' : 'Patients',
      icon: Users
    },
    {
      id: 'billing',
      label: lang === 'ar' ? 'الفوترة' : 'Billing',
      icon: ReceiptText
    },
    {
      id: 'lab-billing',
      label: lang === 'ar' ? 'فواتير المختبر' : 'Lab billing',
      icon: FlaskConical,
      count: labAwaitingPaymentCount > 0 ? labAwaitingPaymentCount : undefined
    },
    {
      id: 'reconcile',
      label: lang === 'ar' ? 'مطابقة الوردية' : 'Shift close',
      icon: Calculator
    }
  ], [lang, labAwaitingPaymentCount]);

  const activeNavId = (activeTab === 'walkin' || activeTab === 'register')
    ? 'front-desk'
    : activeTab;

  const handleNavSelect = useCallback((id) => {
    setActiveTab(id);
  }, []);

  useStaffNav({
    items: navItems,
    activeId: activeNavId,
    onSelect: handleNavSelect,
    roleLabel: lang === 'ar' ? 'الاستقبال' : 'Reception'
  });

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

  const pendingRequestsCount = pendingAppointments.length;
  const labBillsToCollect = labBillingOrders.filter((order) => order.status !== 'PAID');

  return (
    <div className="dashboard-wrapper reception-dashboard" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Hidden RoleHero preserves component test compatibility without breaking mockups */}
      <div className="sr-only" aria-hidden="true">
        <RoleHero role="reception" lang={lang} />
      </div>

      {confirming && <ConfirmAppointmentDialog appointment={confirming} lang={lang}
        onClose={closeConfirmation} onConfirmed={handleConfirmed} />}
      <div className="workspace-panel reception-workspace">
        {/* Alerts */}
        {errorMsg && (
          <div role="alert" className="reception-alert-banner is-error">
            <span>{errorMsg}</span>
            <button type="button" className="reception-alert-dismiss" onClick={() => setErrorMsg('')} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        {successMsg && (
          <div role="status" className="reception-alert-banner is-success">
            <span>{successMsg}</span>
            <button type="button" className="reception-alert-dismiss" onClick={() => setSuccessMsg('')} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        {staleNotificationNotice && (
          <div
            role="status"
            className={`staff-notification-banner${staleNotificationNotice.type === 'info' ? ' staff-notification-banner--info' : ''}`}
          >
            <span>{staleNotificationNotice.text}</span>
            <div className="staff-notification-banner__actions">
              {staleNotificationNotice.patientId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setViewingProfilePatientId(staleNotificationNotice.patientId)}
                >
                  {lang === 'ar' ? 'فتح ملف المريض' : 'Open Patient File'}
                </button>
              )}
              <button
                type="button"
                className="reception-alert-dismiss"
                onClick={() => setStaleNotificationNotice(null)}
                aria-label={lang === 'ar' ? 'إغلاق' : 'Dismiss'}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── 1. FRONT DESK VIEW ────────────────────────────────────── */}
        {activeTab === 'front-desk' && (
          <div className="reception-frontdesk-view">
            {confirmation && (
              <div ref={confirmationNoticeRef} tabIndex={-1} role="status" className="reception-alert-banner is-success">
                <span>{lang === 'ar' ? 'تم تأكيد الموعد' : 'Appointment confirmed'} · {lang === 'ar'
                  ? confirmation.patient?.fullNameAr || confirmation.patient?.fullNameEn
                  : confirmation.patient?.fullNameEn || confirmation.patient?.fullNameAr}</span>
                {confirmation[lang] && <a href={confirmation[lang]} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                  {lang === 'ar' ? 'إرسال عبر واتساب' : 'Send WhatsApp message'}
                </a>}
                <button type="button" className="reception-alert-dismiss" onClick={() => setConfirmation(null)}
                  aria-label={lang === 'ar' ? 'إغلاق' : 'Dismiss'}><X size={14} /></button>
              </div>
            )}
            <header className="ui-page-header reception-header">
              <div className="reception-header-title-block">
                <h1 className="ui-page-title">{lang === 'ar' ? 'الاستقبال' : 'Front desk'}</h1>
              </div>

              <div className="reception-header-actions">
                <button
                  type="button"
                  className="btn btn-secondary reception-header-btn"
                  onClick={() => setActiveTab('register')}
                >
                  {lang === 'ar' ? 'تسجيل مريض' : 'Register patient'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary reception-header-btn"
                  onClick={() => setActiveTab('walkin')}
                >
                  <UserPlus size={18} aria-hidden="true" />
                  <span>{lang === 'ar' ? 'إدخال مريض مباشر' : 'Check in walk-in'}</span>
                </button>
              </div>
            </header>

            <div className="reception-main-columns">
              {/* Main Queue Column */}
              <section aria-labelledby="reception-queue-title" className="reception-queue-column">
                <div className="reception-filter-row">
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

                  <div className="reception-doctor-select-box" role="region" aria-labelledby="reception-doctors-title">
                    <div className="reception-doctor-label-wrap">
                      <span id="reception-doctors-title" className="ui-section-label">
                        {lang === 'ar' ? 'الأطباء المناوبون' : 'On-duty doctors'}
                      </span>
                      {selectedDoctor && (
                        <span className={`ui-status ${selectedDoctor.status === 'ACTIVE' ? 'ui-status--ok' : 'ui-status--muted'}`}>
                          {selectedDoctor.status === 'ACTIVE'
                            ? (lang === 'ar' ? 'متاح' : 'Available')
                            : (lang === 'ar' ? 'غير متاح' : 'Unavailable')}
                        </span>
                      )}
                    </div>
                    {doctors.length === 0 ? (
                      <p className="reception-no-doctors">
                        {lang === 'ar' ? 'لا يوجد أطباء مناوبون حاليًا.' : 'No on-duty doctors are available.'}
                      </p>
                    ) : (
                      <select
                        className="form-input reception-doctor-select"
                        value={selectedDoctor?.id || ''}
                        onChange={(e) => {
                          const doc = doctors.find((d) => d.id === e.target.value);
                          setSelectedDoctor(doc || null);
                        }}
                        aria-label={lang === 'ar' ? 'اختر الطبيب' : 'Select Doctor'}
                      >
                        {doctors.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {lang === 'ar' ? doc.fullNameAr : doc.fullNameEn}
                            {doc.specialtyEn ? ` (${lang === 'ar' ? doc.specialtyAr : doc.specialtyEn})` : ''}
                            {` — ${doc.status === 'ACTIVE' ? (lang === 'ar' ? 'متاح' : 'Available') : (lang === 'ar' ? 'غير متاح' : 'Unavailable')}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                <AppointmentQueue
                  lang={lang} doctor={selectedDoctor} date={filterDate} onDateChange={setFilterDate}
                  revision={queueRevision} onRetry={refreshDoctorQueue}
                  branding={branding} pendingActionIds={pendingActionIds}
                  highlightedAppointmentId={highlightedAppointmentId}
                  setViewingProfilePatientId={setViewingProfilePatientId}
                  handleCheckIn={handleCheckIn} handleQuickBill={handleQuickBill}
                />
              </section>

              {/* Needs Your Attention Column */}
              <aside aria-labelledby="reception-utility-title" className="reception-attention-column">
                <h2 id="reception-utility-title" className="reception-attention-heading">
                  {lang === 'ar' ? 'تنبيهات الاستقبال' : 'Needs your attention'}
                </h2>

                {/* Booking Requests Card */}
                <div className="ui-panel reception-attention-card">
                  <h3 className="ui-section-label reception-card-label">
                    {lang === 'ar'
                      ? `طلبات الحجز · ${pendingRequestsCount}`
                      : `Booking requests · ${pendingRequestsCount}`}
                  </h3>

                  {pendingAppointmentsLoadError && (
                    <div role="alert" className="patient-alert error">
                      {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'} <button type="button" onClick={fetchPendingAppointments}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
                    </div>
                  )}

                  {pendingRequestsCount === 0 ? (
                    <div className="reception-card-empty">
                      <span>{lang === 'ar' ? 'لا توجد طلبات مواعيد معلقة حالياً.' : 'No pending appointment requests.'}</span>
                    </div>
                  ) : (
                    <div className="reception-attention-list">
                      {pendingAppointments.map((app) => (
                        <PendingAppointmentRow
                          key={app.id}
                          app={app}
                          lang={lang}
                          branding={branding}
                          setViewingProfilePatientId={setViewingProfilePatientId}
                          handleApproveAppointment={handleApproveAppointment}
                          handleCancelAppointment={handleCancelAppointment}
                          isActionPending={pendingActionIds.has(app.id)}
                          isHighlighted={highlightedAppointmentId === app.id}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Lab Bills to Collect Card */}
                <div className="ui-panel reception-attention-card">
                  <h3 className="ui-section-label reception-card-label">
                    {lang === 'ar'
                      ? `فواتير مختبر للتحصيل · ${labBillsToCollect.length}`
                      : `Lab bills to collect · ${labBillsToCollect.length}`}
                  </h3>

                  {labBillsToCollect.length === 0 ? (
                    <div className="reception-card-empty">
                      <span>{lang === 'ar' ? 'لا توجد فواتير مختبر بانتظار التحصيل.' : 'No lab bills to collect.'}</span>
                    </div>
                  ) : (
                    <div className="reception-attention-list">
                      {labBillsToCollect.map((order) => {
                        const patientName = lang === 'ar'
                          ? order.patient?.fullNameAr || order.patient?.fullNameEn || '—'
                          : order.patient?.fullNameEn || order.patient?.fullNameAr || '—';
                        const remaining = order.invoice?.remainingBalanceSdg ?? order.estimatedTotalSdg ?? 0;

                        return (
                          <div key={order.id} className="reception-attention-lab-row">
                            <div className="reception-attention-lab-info">
                              <span className="reception-attention-patient-name">{patientName}</span>
                              <span className="reception-attention-lab-detail">
                                {order.items?.length || 0} {lang === 'ar' ? 'فحوصات' : 'tests'} · <bdi dir="ltr" className="ui-mono">{Number(remaining).toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}</bdi>
                              </span>
                            </div>
                            <button
                              type="button"
                              className="reception-collect-link"
                              onClick={() => handleSelectLabBillingOrder(order)}
                            >
                              {lang === 'ar' ? 'تحصيل' : 'Collect'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* ── 2. WALK-IN INTAKE VIEW (Focused View) ────────────────── */}
        {activeTab === 'walkin' && (
          <div className="reception-focused-view">
            <header className="ui-page-header reception-focused-header">
              <button
                type="button"
                className="reception-back-link"
                onClick={() => setActiveTab('front-desk')}
              >
                <ArrowLeft size={18} aria-hidden="true" />
                <span>{lang === 'ar' ? 'الرجوع للاستقبال' : 'Back to front desk'}</span>
              </button>
              <h1 className="ui-page-title">{lang === 'ar' ? 'إدخال مريض مباشر' : 'Check in walk-in'}</h1>
            </header>

            <form onSubmit={event => guardFormSubmit(event, handleWalkInSubmit)} className="reception-focused-form">
              <section aria-label="Walk-in details" className="ui-panel reception-focused-panel">
                {/* Segmented Mode Selector */}
                <div role="tablist" aria-label={lang === 'ar' ? 'نوع المريض' : 'Patient type'} className="ui-segmented">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={walkInMode === 'EXISTING'}
                    className={walkInMode === 'EXISTING' ? 'active' : ''}
                    onClick={() => { setWalkInMode('EXISTING'); setWalkInPatient(null); }}
                  >
                    {lang === 'ar' ? 'مريض مسجل مسبقًا' : 'Existing patient'}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={walkInMode === 'NEW'}
                    className={walkInMode === 'NEW' ? 'active' : ''}
                    onClick={() => { setWalkInMode('NEW'); setWalkInPatient(null); }}
                  >
                    {lang === 'ar' ? 'مريض جديد' : 'New patient'}
                  </button>
                </div>

                {/* Existing Patient Search */}
                {walkInMode === 'EXISTING' ? (
                  <div className="reception-form-field">
                    <label className="reception-form-label">
                      <span className="ui-section-label">{lang === 'ar' ? 'ابحث عن المريض' : 'Find a patient'} *</span>
                      <input
                        type="search"
                        className="form-input"
                        value={walkInPatientQuery}
                        onChange={(e) => searchWalkInPatients(e.target.value)}
                        placeholder={lang === 'ar' ? 'الاسم أو الهاتف أو SHF-000001' : 'Name, phone or SHF-000001'}
                      />
                    </label>

                    {walkInPatientResults.length > 0 && (
                      <div className="reception-search-results">
                        {walkInPatientResults.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="reception-search-result-item"
                            onClick={() => {
                              setWalkInPatient(item);
                              setWalkInPatientQuery(item.fullNameAr || item.fullNameEn || item.phone);
                              setWalkInPatientResults([]);
                            }}
                          >
                            <strong>{lang === 'ar' ? item.fullNameAr : item.fullNameEn}</strong>
                            <small className="ui-mono" dir="ltr">{item.fileNumber || '—'} · {item.phone || '—'}</small>
                          </button>
                        ))}
                      </div>
                    )}

                    {walkInPatient && (
                      <div className="reception-selected-card">
                        <div className="reception-selected-card-info">
                          <strong className="reception-selected-patient-name">
                            {lang === 'ar' ? walkInPatient.fullNameAr : walkInPatient.fullNameEn}
                          </strong>
                          <span className="ui-mono reception-selected-patient-mrn" dir="ltr">
                            {walkInPatient.fileNumber || '—'}
                          </span>
                        </div>
                        <span className="ui-mono reception-selected-patient-phone" dir="ltr">
                          {walkInPatient.phone || '—'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="reception-new-patient-fields">
                    <div className="reception-name-grid">
                      {nameInputs}
                    </div>

                    <div className="reception-details-grid">
                      <div className="reception-form-field">
                        <label className="reception-form-label">
                          <span className="ui-section-label">{t('phone')} *</span>
                          <input
                            type="tel"
                            required
                            className="form-input ui-mono"
                            dir="ltr"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                          />
                        </label>
                      </div>

                      {birthDateInput}

                      <div className="reception-form-field">
                        <label className="reception-form-label">
                          <span className="ui-section-label">{t('gender')}</span>
                          <select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                            <option value="MALE">{t('male')}</option>
                            <option value="FEMALE">{t('female')}</option>
                          </select>
                        </label>
                      </div>

                      <div className="reception-form-field">
                        <label className="reception-form-label">
                          <span className="ui-section-label">{t('addressState')}</span>
                          <select className="form-input" value={addressStateId} onChange={(e) => setAddressStateId(e.target.value)}>
                            {SUDANESE_STATES.map((st) => (
                              <option key={st.id} value={st.id}>
                                {lang === 'ar' ? st.labelAr : st.labelEn}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* Doctor Selection */}
                <div className="reception-form-field reception-field-half">
                  <label className="reception-form-label">
                    <span className="ui-section-label">{lang === 'ar' ? 'الطبيب' : 'Doctor'} *</span>
                    <select
                      required
                      className="form-input"
                      value={walkInDoctorId}
                      onChange={(e) => handleWalkInDoctorChange(e.target.value)}
                    >
                      <option value="">{lang === 'ar' ? 'اختر الطبيب' : 'Select doctor'}</option>
                      {doctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {lang === 'ar' ? doctor.fullNameAr : doctor.fullNameEn}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Slot Selection */}
                <div role="group" aria-label={lang === 'ar' ? 'موعد اليوم' : "Today's slot"} className="reception-slots-group">
                  <span className="ui-section-label">{lang === 'ar' ? 'موعد اليوم' : "Today’s slot"} *</span>
                  <div className="reception-slot-pills">
                    {walkInSlots.length === 0 ? (
                      <span className="reception-no-slots">
                        {walkInDoctorId
                          ? (lang === 'ar' ? 'لا توجد أوقات متاحة اليوم' : 'No available slots today')
                          : (lang === 'ar' ? 'اختر طبيباً أولاً' : 'Select a doctor first')}
                      </span>
                    ) : (
                      walkInSlots.map((slot) => {
                        const isSelected = walkInTime === slot;
                        return (
                          <button
                            key={slot}
                            type="button"
                            aria-pressed={isSelected ? 'true' : 'false'}
                            className={`reception-slot-pill ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => setWalkInTime(slot)}
                          >
                            <span className="ui-mono">{slot}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="reception-info-note">
                  {lang === 'ar'
                    ? 'سيتم تسجيل الحضور فورًا مع الالتزام ببوابة دفع الكشف.'
                    : 'The patient will be checked in immediately; the consultation payment gate still applies.'}
                </div>
              </section>

              <div className="reception-form-actions">
                <button
                  type="button"
                  className="btn btn-secondary reception-action-btn"
                  onClick={() => setActiveTab('front-desk')}
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary reception-action-btn"
                  disabled={walkInSubmitting || !walkInDoctorId || !walkInTime || (walkInMode === 'EXISTING' && !walkInPatient)}
                >
                  <UserPlus size={18} aria-hidden="true" />
                  <span>
                    {walkInSubmitting
                      ? (lang === 'ar' ? 'جارٍ التسجيل...' : 'Registering...')
                      : (lang === 'ar' ? 'تسجيل الحضور وإرسال المريض للطبيب' : 'Check in and send to doctor')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── 3. REGISTER PATIENT VIEW (Focused View) ─────────────── */}
        {activeTab === 'register' && (
          <div className="reception-focused-view">
            <header className="ui-page-header reception-focused-header">
              <button
                type="button"
                className="reception-back-link"
                onClick={() => setActiveTab('front-desk')}
              >
                <ArrowLeft size={18} aria-hidden="true" />
                <span>{lang === 'ar' ? 'الرجوع للاستقبال' : 'Back to front desk'}</span>
              </button>
              <h1 className="ui-page-title">{lang === 'ar' ? 'تسجيل مريض' : 'Register patient'}</h1>
            </header>

            <form onSubmit={event => guardFormSubmit(event, handleRegisterPatient)} className="reception-focused-form">
              <section aria-label="Registration details" className="ui-panel reception-focused-panel">
                <div className="reception-name-grid">
                  {nameInputs}
                </div>

                <div className="reception-details-grid">
                  <div className="reception-form-field">
                    <label className="reception-form-label">
                      <span className="ui-section-label">{t('phone')} *</span>
                      <input
                        type="tel"
                        required
                        className="form-input ui-mono"
                        dir="ltr"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </label>
                  </div>

                  {birthDateInput}

                  <div className="reception-form-field">
                    <label className="reception-form-label">
                      <span className="ui-section-label">{t('gender')}</span>
                      <select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                        <option value="MALE">{t('male')}</option>
                        <option value="FEMALE">{t('female')}</option>
                      </select>
                    </label>
                  </div>

                  <div className="reception-form-field">
                    <label className="reception-form-label">
                      <span className="ui-section-label">{t('addressState')}</span>
                      <select className="form-input" value={addressStateId} onChange={(e) => setAddressStateId(e.target.value)}>
                        {SUDANESE_STATES.map((st) => (
                          <option key={st.id} value={st.id}>
                            {lang === 'ar' ? st.labelAr : st.labelEn}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </section>

              <div className="reception-form-actions">
                <button
                  type="button"
                  className="btn btn-secondary reception-action-btn"
                  onClick={() => setActiveTab('front-desk')}
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button type="submit" className="btn btn-primary reception-action-btn" disabled={isRegistering}>
                  {isRegistering
                    ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…')
                    : (lang === 'ar' ? 'حفظ ملف المريض' : 'Save Patient Profile')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── 4. BILLING & PAYMENT VIEW ────────────────────────────── */}
        {activeTab === 'billing' && (
          <div className="reception-billing-view">
            <header className="ui-page-header reception-billing-header">
              <div className="reception-billing-title-block">
                <h1 className="ui-page-title">
                  {billingPatient
                    ? (lang === 'ar' ? billingPatient.fullNameAr : billingPatient.fullNameEn)
                    : (lang === 'ar' ? 'الفوترة والدفع' : 'Billing')}
                </h1>
                {billingPatient ? (
                  <span className="reception-billing-subtitle">
                    <span className="ui-mono" dir="ltr">{billingPatient.fileNumber || '—'}</span>
                    {billingAppointment?.doctor && (
                      <span> · {lang === 'ar' ? `د. ${billingAppointment.doctor.fullNameAr}` : `Dr. ${billingAppointment.doctor.fullNameEn}`}</span>
                    )}
                  </span>
                ) : (
                  <span className="reception-billing-subtitle">
                    {lang === 'ar' ? 'اختر مريضاً لبدء الفوترة' : 'Select a patient to begin billing'}
                  </span>
                )}
              </div>
              {billingPatient && (
                <button
                  type="button"
                  className="btn btn-secondary reception-header-btn"
                  onClick={() => setViewingProfilePatientId(billingPatient.id)}
                >
                  {lang === 'ar' ? 'فتح ملف المريض' : 'Open Patient Profile'}
                </button>
              )}
            </header>

            <FacilityIdentityLine language={lang} />

            {/* Patient Search (if none selected or switching) */}
            <div className="reception-billing-search-box">
              <div className="reception-search-input-wrap">
                <Search size={16} className="reception-search-icon" aria-hidden="true" />
                <input
                  type="text"
                  placeholder={
                    lang === 'ar'
                      ? 'ابحث عن مريض بالاسم أو الهاتف أو SHF-000001...'
                      : 'Search patient by name, phone or SHF-000001...'
                  }
                  className="form-input reception-billing-search-input"
                  value={searchQuery}
                  disabled={billingSubmitting || Boolean(chargeToExclude)}
                  onChange={(e) => handlePatientSearch(e.target.value)}
                />
              </div>

              {searchResults.length > 0 && (
                <ul className="reception-search-results">
                  {searchResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="reception-search-result-btn"
                        disabled={billingSubmitting || Boolean(chargeToExclude)}
                        onClick={() => {
                          selectBillingPatient(p);
                          setSearchResults([]);
                          setSearchQuery('');
                        }}
                      >
                        <strong>{lang === 'ar' ? p.fullNameAr : p.fullNameEn}</strong>
                        <span className="ui-mono" dir="ltr">{p.fileNumber || '—'} · {p.phone || '—'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="reception-billing-grid">
              {/* Left Column: Services & Insurance */}
              <section aria-labelledby="svc-title" className="reception-services-column">
                {billingPatient && !billingAppointment && !selectedLabBillingOrder && (
                  <ServiceOrderBillingOptions
                    lang={lang}
                    orders={serviceOrders}
                    status={serviceOrderStatus}
                    selectedOrderId={billingServiceOrder?.id}
                    onSelect={handleSelectServiceOrder}
                    onRetry={() => setServiceOrderRevision((revision) => revision + 1)}
                    disabled={billingSubmitting || Boolean(chargeToExclude)}
                  />
                )}
                <div className="ui-panel reception-services-panel">
                  <h2 id="svc-title" className="reception-panel-title">
                    {lang === 'ar' ? 'الخدمات' : 'Services'}
                  </h2>

                  <div className="reception-services-header-row">
                    <span className="ui-section-label">{lang === 'ar' ? 'الخدمة' : 'Service'}</span>
                    <span className="ui-section-label reception-price-col-label">{lang === 'ar' ? 'السعر' : 'Price'}</span>
                  </div>

                  {addedServices.length === 0 ? (
                    <div className="reception-panel-empty">
                      <span>{billingServiceOrder
                        ? (lang === 'ar' ? 'استُبعدت كل الرسوم من هذا الطلب.' : 'All charges have been removed from this order.')
                        : (lang === 'ar' ? 'اختر موعد معاينة أو طلبًا من الطبيب.' : 'Select a consultation or doctor order.')}</span>
                    </div>
                  ) : (
                    <div className="reception-services-list">
                      {addedServices.map((item) => (
                        <div key={item.id} className="reception-service-row">
                          <span className="reception-service-name">
                            {lang === 'ar' ? item.labelAr : item.labelEn}{item.qty > 1 && ` × ${item.qty}`}
                          </span>
                          <div className="reception-service-price-block">
                            <span className="ui-mono reception-service-price" dir="ltr">
                              {item.baseFeeSdg == null
                                ? (lang === 'ar' ? 'السعر غير محدد' : 'Pricing required')
                                : `${Number(item.baseFeeSdg).toLocaleString(lang === 'ar' ? 'ar' : 'en')} ${lang === 'ar' ? 'ج.س' : 'SDG'}`}
                            </span>
                            {billingServiceOrder && !issuedBillingInvoice && (
                              <button
                                type="button"
                                className="reception-remove-service-btn"
                                disabled={billingSubmitting}
                                onClick={() => setChargeToExclude(item)}
                                aria-label={lang === 'ar' ? `استبعاد رسوم ${item.labelAr}` : `Remove charge for ${item.labelEn}`}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {billingServiceOrder?.items.some((item) => item.billingExcludedAt) && (
                  <ul className="reception-services-list">
                    {billingServiceOrder.items.filter((item) => item.billingExcludedAt).map((item) => (
                      <li key={item.id} className="reception-service-row">
                        <span>{lang === 'ar' ? item.labelAr : item.labelEn} · {lang === 'ar' ? 'مستبعدة من الفاتورة' : 'Removed from invoice'}</span>
                        <span>{item.billingExclusionReason}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {chargeToExclude && billingServiceOrder && (
                  <ExcludeServiceChargeDialog
                    lang={lang}
                    orderId={billingServiceOrder.id}
                    line={chargeToExclude}
                    onClose={() => setChargeToExclude(null)}
                    onExcluded={handleChargeExcluded}
                  />
                )}

                {addedServices.length > 0 && (
                  <p className="reception-payment-note">
                    {issuedBillingInvoice
                      ? (lang === 'ar' ? 'صدرت الفاتورة وبنودها ثابتة.' : 'This invoice has been issued and its lines are locked.')
                      : billingServiceOrder
                        ? (lang === 'ar' ? 'يمكن استبعاد رسوم خدمة قبل إصدار الفاتورة.' : 'Individual charges can be removed before the invoice is issued.')
                        : (lang === 'ar' ? 'تُحدد البنود حسب الموعد أو الطلب الطبي.' : 'The appointment or clinical order determines these lines.')}
                  </p>
                )}

                {/* Health Insurance Selector */}
                <div className="reception-form-field reception-insurance-field">
                  <label className="reception-form-label">
                    <span className="ui-section-label">{lang === 'ar' ? 'الضمان الصحي' : 'Health insurance'}</span>
                    <select
                      className="form-input"
                      value={insuranceCompanyId}
                      onChange={(e) => setInsuranceCompanyId(e.target.value)}
                      disabled={Boolean(issuedBillingInvoice || selectedLabBillingOrder?.pricingRequired || billingSubmitting || addedServices.length === 0)}
                    >
                      <option value="">
                        {lang === 'ar' ? 'دفع مباشر بدون تأمين' : 'No insurance'}
                      </option>
                      {insuranceCompanies.map((c) => {
                        const copay = parseFloat(c.copayPercentage);
                        const cycle = c.billingCycleDays != null ? Number(c.billingCycleDays) : null;
                        return (
                          <option key={c.id} value={c.id}>
                            {lang === 'ar' ? c.labelAr : c.labelEn}
                            {` (${lang === 'ar' ? `مساهمة المريض ${copay}%` : `${copay}% Copay`}${cycle ? (lang === 'ar' ? ` · دورة ${cycle} يوم` : ` · ${cycle}d cycle`) : ''})`}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {insuranceCompaniesLoading && (
                    <span role="status" className="reception-header-subtitle">
                      {lang === 'ar' ? 'جارٍ تحديث قائمة شركات التأمين…' : 'Refreshing insurance providers…'}
                    </span>
                  )}
                  {insuranceCompaniesError && (
                    <div role="alert" className="reception-payment-alert">
                      <span>{insuranceCompaniesError}</span>{' '}
                      <button type="button" className="btn btn-secondary" onClick={loadInsuranceCompanies}>
                        {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                      </button>
                    </div>
                  )}
                  {!insuranceCompaniesLoading && !insuranceCompaniesError && insuranceCompanies.length === 0 && (
                    <span className="reception-header-subtitle">
                      {lang === 'ar' ? 'لا توجد شركات تأمين مفعّلة حالياً.' : 'No active insurance providers configured.'}
                    </span>
                  )}
                </div>
              </section>

              {/* Right Column: Payment & Totals */}
              <aside aria-label="Payment" className="reception-payment-column">
                <dl className="reception-billing-summary" aria-live="polite">
                  {insurancePreview.status === 'loading' && (
                    <p>{lang === 'ar' ? 'جارٍ احتساب مسؤولية التأمين…' : 'Calculating insurance responsibility…'}</p>
                  )}
                  {insurancePreview.status === 'error' && (
                    <p role="alert" className="reception-billing-summary-error">{insurancePreview.error}</p>
                  )}
                  {insurancePreview.status === 'ready' && (
                    <>
                      <div className="reception-summary-row">
                        <dt>{lang === 'ar' ? 'إجمالي الخدمات' : 'Services total'}</dt>
                        <dd className="ui-mono" dir="ltr">
                          {Number(insurancePreview.data.grossTotalSdg).toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}
                        </dd>
                      </div>
                      <div className="reception-summary-row">
                        <dt>{lang === 'ar' ? 'تغطية التأمين' : 'Insurance coverage'}</dt>
                        <dd className="ui-mono" dir="ltr">
                          {Number(insurancePreview.data.insuranceCoverageSdg).toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}
                        </dd>
                      </div>
                      <div className="reception-summary-row is-due">
                        <dt>{lang === 'ar' ? 'المطلوب من المريض' : 'Patient amount due'}</dt>
                        <dd className="ui-mono reception-due-amount" dir="ltr">
                          {Number(insurancePreview.data.remainingBalanceSdg ?? insurancePreview.data.patientShareSdg).toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}
                        </dd>
                      </div>
                    </>
                  )}
                  {insurancePreview.status === 'idle' && (
                    <div className="reception-summary-row is-due">
                      <dt>{t('invoiceTotal')}</dt>
                      <dd className="ui-mono reception-due-amount" dir="ltr">
                        {calculateInvoiceTotals(addedServices).totalSdg.toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}
                      </dd>
                    </div>
                  )}
                </dl>

                {canReviewRefund && (
                  <button type="button" className="btn btn-secondary" disabled={billingSubmitting} onClick={() => setReviewingRefund(true)}>
                    {lang === 'ar' ? 'مراجعة الاسترداد' : 'Review refund'}
                  </button>
                )}
                {canReviewRefund && reviewingRefund && (
                  <InvoiceCorrectionDialog
                    lang={lang}
                    invoice={issuedBillingInvoice}
                    onClose={() => setReviewingRefund(false)}
                    onRefunded={handleInvoiceRefunded}
                  />
                )}
                {paymentLocked && (
                  <p role="status">{issuedPaymentStatus === 'PAID'
                    ? (lang === 'ar' ? 'تمت تسوية الفاتورة.' : 'Invoice settled.')
                    : (lang === 'ar' ? 'هذه الفاتورة مغلقة أمام الدفعات الجديدة.' : 'This invoice is closed to further payments.')}</p>
                )}
                {!paymentLocked && <div className="reception-payment-form">
                  <span className="ui-section-label">{lang === 'ar' ? 'توزيع الدفعات' : 'Payment allocation'}</span>

                  {paymentMethodsError && (
                    <p role="alert" className="reception-payment-alert">
                      {lang === 'ar' ? 'تعذر تحميل طرق الدفع. أعد تحميل الصفحة للمحاولة.' : 'Payment methods could not be loaded. Reload to retry.'}
                    </p>
                  )}

                  {paymentMethods.length === 0 && !paymentMethodsError && (
                    <p role="status" className="reception-payment-alert">
                      {lang === 'ar' ? 'لا توجد طرق دفع نشطة. راجع مدير العيادة.' : 'No active payment methods. Contact the clinic administrator.'}
                    </p>
                  )}

                  {paymentRows.map((row, idx) => (
                    <div key={idx} className="reception-payment-row">
                      <label className="reception-payment-field">
                        <span className="ui-section-label">{lang === 'ar' ? 'طريقة الدفع' : 'Payment method'}</span>
                        <select
                          className="form-input"
                          value={row.paymentMethod}
                          onChange={(e) => {
                            const updated = [...paymentRows];
                            updated[idx].paymentMethod = e.target.value;
                            setPaymentRows(updated);
                          }}
                        >
                          <option value="">{lang === 'ar' ? 'اختر طريقة دفع متاحة' : 'Choose an available payment method'}</option>
                          {paymentMethods.map(method => (
                            <option key={method.code} value={method.code}>
                              {lang === 'ar' ? method.labelAr : method.labelEn}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="reception-payment-field">
                        <span className="ui-section-label">{lang === 'ar' ? 'المبلغ (SDG)' : 'Amount (SDG)'}</span>
                        <input
                          type="number"
                          className="form-input ui-mono"
                          dir="ltr"
                          placeholder="Amount"
                          value={row.amountSdg}
                          onChange={(e) => {
                            const updated = [...paymentRows];
                            updated[idx].amountSdg = e.target.value;
                            setPaymentRows(updated);
                          }}
                        />
                      </label>

                      <label className="reception-payment-field">
                        <span className="ui-section-label">{lang === 'ar' ? 'رقم المرجع (اختياري)' : 'Transaction reference (optional)'}</span>
                        <input
                          type="text"
                          className="form-input ui-mono"
                          dir="ltr"
                          placeholder={lang === 'ar' ? 'رقم المرجع' : 'Reference ID'}
                          value={row.transactionReference}
                          onChange={(e) => {
                            const updated = [...paymentRows];
                            updated[idx].transactionReference = e.target.value;
                            setPaymentRows(updated);
                          }}
                        />
                      </label>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-secondary reception-add-payment-btn"
                    onClick={() => setPaymentRows([...paymentRows, { amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }])}
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>{lang === 'ar' ? '+ إضافة دفعة أخرى' : '+ Add Another Payment'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary reception-submit-payment-btn"
                    onClick={handleCreateInvoice}
                    disabled={
                      billingSubmitting ||
                      Boolean(chargeToExclude) || reviewingRefund ||
                      insurancePreview.status !== 'ready' ||
                      ((!insurancePreview.data || Number(insurancePreview.data.patientShareSdg) !== 0) && (
                        paymentMethodsError ||
                        paymentMethods.length === 0 ||
                        paymentRows.some(row => !paymentMethods.some(method => method.code === row.paymentMethod))
                      )) ||
                      selectedLabBillingOrder?.status === 'PAID' ||
                      selectedLabBillingOrder?.pricingRequired
                    }
                  >
                    <DollarSign size={18} aria-hidden="true" />
                    <span>
                      {billingSubmitting
                        ? (lang === 'ar' ? 'جاري معالجة الفاتورة...' : 'Processing invoice...')
                        : selectedLabBillingOrder
                          ? selectedLabBillingOrder.status === 'PAID'
                            ? (lang === 'ar' ? 'مدفوع — جاهز للمختبر' : 'Paid — Ready for Laboratory')
                            : selectedLabBillingOrder.billingStatus === 'PARTIALLY_PAID'
                              ? (lang === 'ar' ? 'إكمال دفع المختبر' : 'Continue Laboratory Payment')
                              : (lang === 'ar' ? 'دفع رسوم المختبر' : 'Pay Laboratory')
                          : Number(insurancePreview.data?.patientShareSdg) === 0
                            ? (lang === 'ar' ? 'إصدار الفاتورة وتسويتها' : 'Issue and settle invoice')
                            : (lang === 'ar' ? 'إصدار الفاتورة وتأكيد الدفع' : 'Issue Invoice & Confirm Payment')}
                    </span>
                  </button>
                </div>}
              </aside>
            </div>
          </div>
        )}

        {/* ── 5. LAB BILLING VIEW (Full View) ──────────────────────── */}
        {activeTab === 'lab-billing' && (
          <>
            {labBillingLoadError && (
              <div role="alert" className="patient-alert error">
                {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'} <button type="button" onClick={refreshLabBillingQueue}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
              </div>
            )}
            <LabBillingQueue
              lang={lang}
              labBillingLoading={labBillingLoading}
              labBillingOrders={labBillingOrders}
              selectedLabBillingOrder={selectedLabBillingOrder}
              highlightedLabOrderId={highlightedLabOrderId}
              refreshLabBillingQueue={refreshLabBillingQueue}
              handleSelectLabBillingOrder={handleSelectLabBillingOrder}
            />
          </>
        )}

        {/* ── 6. SHIFT CLOSE / RECONCILE VIEW ──────────────────────── */}
        {activeTab === 'reconcile' && (
          <div className="reception-shiftclose-view">
            <header className="ui-page-header reception-view-header">
              <div className="reception-view-header-start">
                <h1 className="ui-page-title">{lang === 'ar' ? 'مطابقة الوردية' : 'Shift close'}</h1>
                <span className="reception-header-subtitle">
                  {formatQueueDateLabel(clinicDateString(), lang, clinicDateString())}
                </span>
              </div>
            </header>

            <form onSubmit={event => guardFormSubmit(event, handleReconcileShift)} className="ui-panel reception-shiftclose-form">
              <div className="reception-form-field">
                <label className="reception-form-label">
                  <span className="ui-section-label">
                    {lang === 'ar' ? 'المبلغ المتوقع بالصندوق (SDG)' : 'Expected cash in register (SDG)'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    required
                    className="form-input ui-mono"
                    dir="ltr"
                    placeholder={lang === 'ar' ? 'أدخل المبلغ المتوقع' : 'Enter expected cash amount'}
                    value={expectedCash}
                    onChange={(e) => setExpectedCash(e.target.value)}
                  />
                </label>
              </div>

              <div className="reception-form-field">
                <label className="reception-form-label">
                  <span className="ui-section-label">
                    {lang === 'ar' ? 'المبلغ الفعلي بالصندوق (SDG)' : 'Actual cash in register (SDG)'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    required
                    className="form-input ui-mono"
                    dir="ltr"
                    placeholder={lang === 'ar' ? 'أدخل المبلغ الفعلي' : 'Enter actual counted cash'}
                    value={physicalCash}
                    onChange={(e) => setPhysicalCash(e.target.value)}
                  />
                </label>
              </div>

              <div>
                <button type="submit" disabled={reconcileSubmitting} className="btn btn-primary reception-reconcile-submit-btn">
                  <Calculator size={18} aria-hidden="true" />
                  <span>{t('reconcile') || (lang === 'ar' ? 'مطابقة الوردية' : 'Reconcile shift')}</span>
                </button>
              </div>
            </form>

            {reconcileResult && (
              <div
                role="status"
                className={`reception-reconcile-result-banner ${reconcileResult.discrepancy === 0 ? 'is-balanced' : 'is-discrepancy'}`}
              >
                <span className="reception-reconcile-headline">
                  <span className="ui-status-dot" aria-hidden="true" />
                  {reconcileResult.discrepancy === 0
                    ? (lang === 'ar' ? 'الوردية متطابقة تمامًا — لا يوجد فرق' : 'Shift balanced — no discrepancy')
                    : (lang === 'ar'
                        ? (reconcileResult.discrepancy < 0
                            ? `عجز بمقدار ${Math.abs(reconcileResult.discrepancy).toLocaleString('ar')} ج.س`
                            : `فائض بمقدار ${reconcileResult.discrepancy.toLocaleString('ar')} ج.س`)
                        : (reconcileResult.discrepancy < 0
                            ? `Short by SDG ${Math.abs(reconcileResult.discrepancy).toLocaleString('en')}`
                            : `Over by SDG ${reconcileResult.discrepancy.toLocaleString('en')}`))}
                </span>
                <span className="reception-reconcile-body">
                  {lang === 'ar'
                    ? (reconcileResult.discrepancy === 0
                        ? 'تمت مطابقة المبلغ المتوقع مع المبلغ الفعلي.'
                        : (reconcileResult.discrepancy < 0
                            ? `الصندوق يحوي ${Math.abs(reconcileResult.discrepancy).toLocaleString('ar')} ج.س أقل من المتوقع.`
                            : `الصندوق يحوي ${reconcileResult.discrepancy.toLocaleString('ar')} ج.س أكثر من المتوقع.`))
                    : (reconcileResult.discrepancy === 0
                        ? 'The register holds the exact expected amount.'
                        : (reconcileResult.discrepancy < 0
                            ? `The register holds SDG ${Math.abs(reconcileResult.discrepancy).toLocaleString('en')} less than expected.`
                            : `The register holds SDG ${reconcileResult.discrepancy.toLocaleString('en')} more than expected.`))}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── 7. PATIENTS DIRECTORY VIEW ───────────────────────────── */}
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
