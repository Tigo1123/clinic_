import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle, Clock, DollarSign, HelpCircle, MessageCircle, Printer, Search, Trash2, Users } from 'lucide-react';
import { PatientProfileModal, PostVisitSummaryModal } from '../clinical/ClinicalModals';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import { getWhatsAppLink, SUDANESE_STATES } from './clinicData';
import { staffSocket as socket } from '../../services/staffSocket';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';
import { apiRequest } from '../../services/apiClient';

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
  const [patientDirectoryLoading, setPatientDirectoryLoading] = useState(false);
  const [patientDirectoryError, setPatientDirectoryError] = useState('');
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
  const [activeSummaryId, setActiveSummaryId] = useState(null);
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);

  // Pending Approvals State
  const [pendingAppointments, setPendingAppointments] = useState([]);
  const [queueTab, setQueueTab] = useState('queue'); // 'queue' | 'pending'

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
    const handleQueueUpdate = () => {
      refreshDoctorQueue();
      fetchPendingAppointments();
    };

    socket.on('queueUpdated', handleQueueUpdate);
    return () => {
      socket.off('queueUpdated', handleQueueUpdate);
    };
  }, [refreshDoctorQueue]);

  const handlePatientSearch = async (val) => {
    setSearchQuery(val);
    if (val.length > 2) {
      const res = await fetchWithAuth(`/api/patients/search?q=${encodeURIComponent(val)}`);
      const data = await res.json();
      setSearchResults(data);
    } else {
      setSearchResults([]);
    }
  };


  const loadPatientDirectory = useCallback(async () => {
    setPatientDirectoryLoading(true);
    setPatientDirectoryError('');

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

      setPatientDirectoryResults(
        Array.isArray(data) ? data : []
      );

      setPatientDirectoryLoaded(true);
    } catch (err) {
      console.error('Patient directory load error:', err);

      setPatientDirectoryResults([]);
      setPatientDirectoryError(
        err?.message ||
          (
            lang === 'ar'
              ? 'تعذر تحميل قائمة المرضى. حاول مرة أخرى.'
              : 'Unable to load patient directory. Please try again.'
          )
      );
    } finally {
      setPatientDirectoryLoading(false);
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

  const handlePatientDirectorySearch = async (val) => {
    setPatientDirectoryQuery(val);
    setPatientDirectoryError('');

    if (val.trim().length <= 2) {
      if (patientDirectoryLoaded) {
        await loadPatientDirectory();
      } else {
        setPatientDirectoryResults([]);
      }

      setPatientDirectoryLoading(false);
      return;
    }

    setPatientDirectoryLoading(true);

    try {
      const res = await fetchWithAuth(
        `/api/patients/search?q=${encodeURIComponent(val.trim())}`
      );

      const data = await res.json().catch(() => []);

      if (!res.ok) {
        throw new Error(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر البحث عن المرضى.'
              : 'Failed to search patients.'
          )
        );
      }

      setPatientDirectoryResults(
        Array.isArray(data) ? data : []
      );
    } catch (err) {
      console.error('Patient directory search error:', err);

      setPatientDirectoryResults([]);
      setPatientDirectoryError(
        err?.message ||
          (
            lang === 'ar'
              ? 'تعذر البحث عن المرضى. حاول مرة أخرى.'
              : 'Unable to search patients. Please try again.'
          )
      );
    } finally {
      setPatientDirectoryLoading(false);
    }
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
            ? 'تم تسجيل وصول المريض وإضافته إلى طابور الطبيب.'
            : 'Patient checked in and added to the doctor queue.'
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
    if (!app.patient) return;
    setBillingPatient(app.patient);
    setActiveTab('billing');

    const consultService = clinicalServices.find(s =>
      s.labelEn.toLowerCase().includes('consult') ||
      s.labelAr.includes('كشف')
    );

    const docFee = app.doctor?.consultationFee ? parseFloat(app.doctor.consultationFee) : 5000;

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
    const totalSdg = addedServices.reduce((sum, s) => sum + parseFloat(s.baseFeeSdg) * s.qty, 0);
    // Fixed conversion rate of 1500 locked at checkout
    const totalUsd = totalSdg / 1500;
    return { totalSdg, totalUsd };
  };

  const handleCreateInvoice = async () => {
    if (billingSubmitting) return;
    setErrorMsg('');
    setSuccessMsg('');
    if (addedServices.length === 0 || !billingPatient) {
      setErrorMsg(
        lang === 'ar'
          ? 'اختر المريض وأضف خدمة طبية واحدة على الأقل.'
          : 'Select a patient and add at least one clinical service.'
      );
      return;
    }

    setBillingSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/billing/invoice', {
        method: 'POST',
        body: JSON.stringify({
          patientId: billingPatient.id,
          insuranceCompanyId: insuranceCompanyId || undefined,
          items: addedServices.map((s) => ({
            descriptionAr: s.labelAr,
            descriptionEn: s.labelEn,
            qty: s.qty,
            unitPriceSdg: parseFloat(s.baseFeeSdg)
          }))
        })
      });
      const data = await res.json();
      if (res.ok) {
        // Record split payments
        const paymentRes = await fetchWithAuth(`/api/billing/invoice/${data.invoice.id}/payments`, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            payments: paymentRows.map((p) => ({
              amountSdg: parseFloat(p.amountSdg),
              paymentMethod: p.paymentMethod,
              transactionReference: p.transactionReference || undefined
            }))
          })
        });

        if (paymentRes.ok) {
          setSuccessMsg(lang === 'ar' ? 'تم إصدار الفاتورة وإتمام الدفع بنجاح.' : 'Invoice issued and paid successfully.');
          setAddedServices([]);
          setBillingPatient(null);
          setPaymentRows([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
        } else {
          const payError = await paymentRes.json();
          setErrorMsg(
            typeof payError.error === 'object'
              ? payError.error.message
              : payError.error ||
                (lang === 'ar'
                  ? 'تعذر تسجيل الدفعات على الفاتورة.'
                  : 'Failed to apply payments to the invoice.')
          );
        }
      } else {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر إنشاء الفاتورة.'
              : 'Failed to create the invoice.'
          )
        );
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

  return (
    <div className="dashboard-wrapper">
      {/* 3 COLUMN GRID WORKSPACE */}
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <RoleHero role="reception" lang={lang}/>
        <div className="panel-grid">
          {/* COLUMN 1: DOCTORS ROSTER */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <Users size={18} />
                {lang === 'ar' ? 'الأطباء المناوبين' : 'On-Duty Doctors'}
              </span>
            </div>
            {doctors.map((doc) => (
              <div
                key={doc.id}
                className={`queue-card-item glass-panel ${selectedDoctor?.id === doc.id ? 'selected' : ''}`}
                onClick={() => setSelectedDoctor(doc)}
              >
                <h4>{lang === 'ar' ? doc.fullNameAr : doc.fullNameEn}</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {lang === 'ar' ? doc.specialtyAr : doc.specialtyEn}
                </p>
              </div>
            ))}
          </div>

          {/* COLUMN 2: DAILY QUEUE MANAGER & PENDING APPROVALS */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header" style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={`btn ${queueTab === 'queue' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem', minHeight: '36px' }}
                  onClick={() => setQueueTab('queue')}
                >
                  <Clock size={14} />
                  {lang === 'ar' ? 'الطابور اليومي' : 'Today’s Queue'}
                </button>
                <button
                  type="button"
                  className={`btn ${queueTab === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem', minHeight: '36px', position: 'relative' }}
                  onClick={() => setQueueTab('pending')}
                >
                  <AlertCircle size={14} />
                  {lang === 'ar'
                    ? 'طلبات بانتظار التأكيد'
                    : 'Pending Appointment Requests'}
                  {pendingAppointments.length > 0 && (
                    <span className="badge badge-danger" style={{ marginLeft: '4px', fontSize: '0.7rem', padding: '1px 5px' }}>
                      {pendingAppointments.length}
                    </span>
                  )}
                </button>
              </div>

              {queueTab === 'queue' && (
                <input
                  type="date"
                  className="form-input"
                  style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                />
              )}
            </div>

            {queueTab === 'pending' ? (
              pendingAppointments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  <CheckCircle size={36} color="var(--primary)" />
                  <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد طلبات مواعيد معلقة حالياً.' : 'No pending appointment requests.'}</p>
                </div>
              ) : (
                pendingAppointments.map((app) => (
                  <div
                    key={app.id}
                    className="queue-card-item glass-panel"
                    style={{ borderLeft: '4px solid var(--warning)', padding: '0.75rem', marginBottom: '0.75rem' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</strong>
                      <span className="badge badge-warning">
                        {getAppointmentStatusLabel('PENDING')}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                      <div><strong>{lang === 'ar' ? 'الطبيب:' : 'Doctor:'}</strong> {lang === 'ar' ? app.doctor?.fullNameAr : app.doctor?.fullNameEn}</div>
                      <div>
                        <strong>
                          {lang === 'ar' ? 'الموعد:' : 'Appointment:'}
                        </strong>{' '}
                        {app.appointmentDate}{' '}
                        {lang === 'ar' ? 'الساعة' : 'at'}{' '}
                        {app.appointmentTime}
                      </div>
                      <div><strong>{lang === 'ar' ? 'الهاتف:' : 'Phone:'}</strong> {app.patient?.phone}</div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
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
                  </div>
                ))
              )
            ) : selectedDoctor ? (
              appointments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  <HelpCircle size={36} />
                  <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد مواعيد مسجلة لهذا الطبيب اليوم.' : 'No appointments scheduled for this doctor today.'}</p>
                </div>
              ) : (
                appointments.map((app) => {
                  const isEmergency = app.emergencyOverride;
                  const statusStyles = (() => {
                    switch (app.status) {
                      case 'SCHEDULED':
                      case 'CONFIRMED':
                        return { borderLeft: '4px solid #9ca3af', background: 'rgba(156, 163, 175, 0.05)' };
                      case 'CHECKED_IN':
                        return { borderLeft: '4px solid var(--warning)', background: 'rgba(245, 158, 11, 0.08)' };
                      case 'IN_CONSULTATION':
                        return { borderLeft: '4px solid var(--primary)', background: 'rgba(20, 184, 166, 0.08)' };
                      case 'COMPLETED':
                        return { borderLeft: '4px solid var(--success)', background: 'rgba(16, 185, 129, 0.08)' };
                      default:
                        return { borderLeft: '4px solid var(--border-color)' };
                    }
                  })();

                  return (
                    <div
                      key={app.id}
                      className={`queue-card-item glass-panel ${isEmergency ? 'emergency-border' : ''}`}
                      style={{ ...statusStyles, padding: '0.75rem', marginBottom: '0.5rem' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</strong>
                        <span className={`badge ${app.status === 'COMPLETED' ? 'badge-success' :
                          app.status === 'IN_CONSULTATION' ? 'badge-primary' :
                            app.status === 'CHECKED_IN' ? 'badge-warning' : 'badge-secondary'
                          }`}>
                          {getAppointmentStatusLabel(app.status)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <span>{app.appointmentTime}</span>
                        {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ مستعجلة' : 'Emergency Priority'}</span>}
                      </div>

                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                        {(app.status === 'SCHEDULED' || app.status === 'CONFIRMED') && (
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, minHeight: '32px' }}
                            onClick={() => handleCheckIn(app.id)}
                          >
                            {lang === 'ar' ? 'تسجيل وصول' : 'Check In'}
                          </button>
                        )}
                        <button
                          className="btn btn-secondary"
                          style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minHeight: '32px' }}
                          onClick={() => handleQuickBill(app)}
                        >
                          <DollarSign size={12} />
                          {lang === 'ar' ? 'فتح الفاتورة' : 'Open Billing'}
                        </button>
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
                        {app.status === 'COMPLETED' && (
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minHeight: '32px' }}
                            onClick={() => setActiveSummaryId(app.id)}
                          >
                            <Printer size={12} />
                            {lang === 'ar' ? 'ملخص' : 'Summary'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <Users size={36} />
                <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'يرجى اختيار طبيب من القائمة لعرض طابور الانتظار.' : 'Please select a doctor from the list to view the live queue.'}</p>
              </div>
            )}
          </div>

          {/* COLUMN 3: BILLING & REGISTRATION */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="tabs-header">
              <button
                className={`tab-select-btn ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => setActiveTab('register')}
              >
                {lang === 'ar' ? 'تسجيل مريض' : 'Register Patient'}
              </button>
              <button
                className={`tab-select-btn ${activeTab === 'patients' ? 'active' : ''}`}
                onClick={() => setActiveTab('patients')}
              >
                {lang === 'ar' ? 'المرضى' : 'Patients'}
              </button>

              <button
                className={`tab-select-btn ${activeTab === 'billing' ? 'active' : ''}`}
                onClick={() => setActiveTab('billing')}
              >
                {lang === 'ar' ? 'الفوترة والدفع' : 'Billing & Payment'}
              </button>
              <button
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
                      ? `المرضى الظاهرون: ${patientDirectoryResults.length}`
                      : `Visible patients: ${patientDirectoryResults.length}`}
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
                        ? 'ابحث بالاسم أو رقم الهاتف...'
                        : 'Search by patient name or phone...'
                    }
                    value={patientDirectoryQuery}
                    onChange={(e) =>
                      handlePatientDirectorySearch(e.target.value)
                    }
                  />
                </div>

                {patientDirectoryLoading && (
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

                {patientDirectoryError && (
                  <div
                    className="badge badge-danger"
                    style={{
                      padding: '0.75rem',
                      whiteSpace: 'normal'
                    }}
                  >
                    {patientDirectoryError}
                  </div>
                )}

                {!patientDirectoryLoading &&
                  !patientDirectoryError &&
                  patientDirectoryLoaded &&
                  patientDirectoryResults.length === 0 && (
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

                {patientDirectoryResults.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem'
                    }}
                  >
                    {patientDirectoryResults.map((patient) => (
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
                {/* Search Patient */}
                <div className="search-wrapper">
                  <Search className="search-icon-svg" size={16} />
                  <input
                    type="text"
                    placeholder={
                      lang === 'ar'
                        ? 'ابحث عن مريض بالاسم أو رقم الهاتف...'
                        : 'Search patient by name or phone...'
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
                            setBillingPatient(p);
                            setSearchResults([]);
                            setSearchQuery('');
                          }}
                        >
                          <strong>{lang === 'ar' ? p.fullNameAr : p.fullNameEn}</strong>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{p.phone}</span>
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
                            <span>{parseFloat(item.baseFeeSdg).toLocaleString(
                              lang === 'ar' ? 'ar' : 'en'
                            )}{' '}
                            {lang === 'ar' ? 'ج.س' : 'SDG'}</span>
                            <button
                              type="button"
                              style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                              onClick={() => handleRemoveBillingService(idx)}
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

                    {/* Split Payments row configuration */}
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

                    <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleCreateInvoice} disabled={billingSubmitting}>
                      {billingSubmitting
                        ? (lang === 'ar'
                            ? 'جاري معالجة الفاتورة...'
                            : 'Processing invoice...')
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
   3. DOCTOR DASHBOARD & CLINICAL EMR WORKSPACE
   ========================================== */
