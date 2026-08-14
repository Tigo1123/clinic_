import { useCallback, useEffect, useState } from 'react';
import { Activity, Lock, MessageCircle, Printer, Shield, Sliders, Stethoscope, User } from 'lucide-react';
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

  // Consult records entry
  const [symptoms, setSymptoms] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatment, setTreatment] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [vitals, setVitals] = useState({ blood_pressure: '120/80', heart_rate: '75', temperature: '37.0', weight: '70' });

  // Prescription builder
  const [drugs, setDrugs] = useState([]);
  const [selectedDrug, setSelectedDrug] = useState('');
  const [dosage, setDosage] = useState('');
  const [duration, setDuration] = useState('');
  const [quantity, setQuantity] = useState('');
  const [instrAr, setInstrAr] = useState('');
  const [instrEn, setInstrEn] = useState('');
  const [prescribedItems, setPrescribedItems] = useState([]);

  // Lab services selectors
  const [clinicalServices, setClinicalServices] = useState([]);
  const [orderedTests, setOrderedTests] = useState([]);

  // Break-the-Glass States
  const [showBypassModal, setShowBypassModal] = useState(false);
  const [bypassJustification, setBypassJustification] = useState('');
  const [bypassError, setBypassError] = useState('');

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
  const quickDurationPresets = ["3 Days", "5 Days", "7 Days", "10 Days"];

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
      console.log('[Socket.io] Queue update received in Doctor:', data);
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

  const handlePatientSelect = (appt) => {
    setSelectedPatient(appt.patient);
    setSelectedAppointmentId(appt.id);
    fetchPatientHistory(appt.patient.id);
    // Auto status change to IN_CONSULTATION
    fetchWithAuth(`/api/appointments/${appt.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'IN_CONSULTATION' })
    }).then(() => fetchDoctorQueue());
  };

  const handleBreakTheGlass = async () => {
    setBypassError('');
    if (bypassJustification.length < 20) {
      setBypassError(lang === 'ar' ? 'الرجاء توفير شرح طارئ كافٍ (20 حرفاً على الأقل)' : 'Please provide sufficient justification (minimum 20 characters)');
      return;
    }

    try {
      const res = await fetchWithAuth('/api/records/bypass', {
        method: 'POST',
        body: JSON.stringify({
          patientId: selectedPatient.id,
          justification: bypassJustification
        })
      });
      if (res.ok) {
        setShowBypassModal(false);
        setBypassJustification('');
        fetchPatientHistory(selectedPatient.id);
      } else {
        const errData = await res.json();
        setBypassError(errData.error || 'Bypass failed.');
      }
    } catch (err) {
      console.error(err);
      setBypassError('Bypass request failed.');
    }
  };

  const handleAddDrugToRx = () => {
    const parsedQuantity = Number(quantity);
    if (!selectedDrug || !dosage || !duration || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0) return;
    const drugObj = drugs.find((d) => d.id === selectedDrug);
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
    setSelectedDrug('');
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

  const handleSaveConsultation = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!diagnosis) {
      setErrorMsg(t('requiredField'));
      return;
    }

    try {
      const res = await fetchWithAuth('/api/records', {
        method: 'POST',
        body: JSON.stringify({
          patientId: selectedPatient.id,
          appointmentId: selectedAppointmentId,
          symptoms,
          diagnosis,
          treatment,
          clinicalNotes,
          vitalSigns: vitals,
          prescribedDrugs: prescribedItems,
          orderedServices: orderedTests
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم إنهاء الزيارة وحفظ الملف الطبي للمريض بنجاح.' : 'EMR Consultation saved successfully.');
        const recId = data.recordId || data.record?.id || data.data?.record?.id || data.data?.id || selectedAppointmentId;
        setActiveSummaryId(recId);
        setSelectedPatient(null);
        setSymptoms('');
        setDiagnosis('');
        setTreatment('');
        setClinicalNotes('');
        setPrescribedItems([]);
        setOrderedTests([]);
        fetchDoctorQueue();
      } else {
        setErrorMsg(apiErrorMessage(data, 'Failed to save EMR.'));
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('EMR saving failed.');
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
                    <span className="badge badge-success">{appt.status}</span>
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

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button className="btn btn-danger" style={{ width: '100%', fontSize: '0.8rem' }} onClick={() => setShowBypassModal(true)}>
                    <Shield size={14} />
                    {t('breakTheGlass')}
                  </button>
                </div>
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
                      {lang === 'ar' ? 'الجنس:' : 'Gender:'} {selectedPatient.gender} | {lang === 'ar' ? 'تاريخ الميلاد:' : 'DOB:'} {selectedPatient.dateOfBirth}
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
                                <span>{new Date(rec.visitDate).toLocaleDateString()}</span>
                                <span style={{ color: 'var(--primary)' }}>
                                  {lang === 'ar' ? rec.doctorNameAr : rec.doctorNameEn}
                                </span>
                              </div>
                              <div className="timeline-vitals" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', opacity: 0.8 }}>
                                <span>BP: {rec.vitalSigns?.blood_pressure}</span>
                                <span>HR: {rec.vitalSigns?.heart_rate} bpm</span>
                                <span>Temp: {rec.vitalSigns?.temperature} °C</span>
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
                                      console.log('[DoctorDashboard] Opening Visit Summary for rec:', targetId, rec);
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
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>BP</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.blood_pressure}
                            onChange={(e) => setVitals({ ...vitals, blood_pressure: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>HR (bpm)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.heart_rate}
                            onChange={(e) => setVitals({ ...vitals, heart_rate: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Temp (°C)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.temperature}
                            onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Wt (kg)</label>
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
                          placeholder="ICD-11 Code / Diagnosis description"
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
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '0.5rem' }}>
                        <select className="form-input" value={selectedDrug} onChange={(e) => setSelectedDrug(e.target.value)}>
                          <option value="">{lang === 'ar' ? 'اختر الدواء...' : 'Medication...'}</option>
                          {drugs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {lang === 'ar' ? d.labelAr : d.labelEn}
                            </option>
                          ))}
                        </select>

                        <div>
                          <input
                            type="text"
                            placeholder="Dosage (500mg)"
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
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            placeholder="Duration (5 Days)"
                            className="form-input"
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: '2px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {quickDurationPresets.map(p => (
                              <button
                                key={p}
                                type="button"
                                style={{ padding: '2px 4px', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                onClick={() => setDuration(p)}
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
                          placeholder="Instructions (Arabic)"
                          className="form-input"
                          value={instrAr}
                          onChange={(e) => setInstrAr(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Instructions (English)"
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
                              <th>Drug</th>
                              <th>Dosage</th>
                              <th>Duration</th>
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
                    </div>

                    <button type="button" className="btn btn-primary" style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 'bold' }} onClick={handleSaveConsultation}>
                      {lang === 'ar' ? 'حفظ الكشف الطبي وإغلاق الجلسة' : 'Save Consultation & Lock File'}
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

      {/* Break-the-Glass warning Modal */}
      {showBypassModal && (
        <div className="modal-overlay">
          <div className="modal-content-panel glass-panel" style={{ maxWidth: '450px' }}>
            <h3 style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Shield size={24} />
              {lang === 'ar' ? 'تحذير كسر حماية الخصوصية' : 'Bypass Privacy Alert'}
            </h3>
            {bypassError && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{bypassError}</div>}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {lang === 'ar'
                ? 'تحذير: أنت على وشك تجاوز خصوصية المريض والولوج إلى السجل الكامل. سيتم تسجيل هذا الإجراء وإبلاغ الإدارة فوراً.'
                : 'Warning: You are about to bypass patient privacy. This action will be logged and reported to the Administrator.'}
            </p>
            <div className="form-group">
              <label className="form-label">{lang === 'ar' ? 'مبرر الحالة الطارئة (20 حرفاً كحد أدنى)' : 'Emergency Justification (Min 20 chars)'}</label>
              <textarea
                rows={3}
                required
                className="form-input"
                value={bypassJustification}
                onChange={(e) => setBypassJustification(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowBypassModal(false)}>
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="btn btn-danger" onClick={handleBreakTheGlass}>
                {lang === 'ar' ? 'تأكيد الباي-باس' : 'Confirm Bypass'}
              </button>
            </div>
          </div>
        </div>
      )}
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
