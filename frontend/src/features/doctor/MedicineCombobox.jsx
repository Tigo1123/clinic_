import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchDoctorMedicines } from '../../utils/doctorPrescription';

export default function MedicineCombobox({ medicines, selectedId, onSelect, lang, invalid = false }) {
  const selected = medicines.find((medicine) => medicine.id === selectedId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const results = useMemo(() => searchDoctorMedicines(medicines, query).slice(0, 30), [medicines, query]);

  useEffect(() => {
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const choose = (medicine) => {
    onSelect(medicine.id);
    setQuery(lang === 'ar' ? medicine.labelAr : medicine.labelEn);
    setOpen(false);
  };
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === 'Enter' && open && results[activeIndex]) { event.preventDefault(); choose(results[activeIndex]); }
    if (event.key === 'Escape') setOpen(false);
  };

  return <div className="doctor-medicine-combobox" ref={rootRef}>
    <label className="form-label" htmlFor="doctor-medicine-search">{lang === 'ar' ? 'دواء من القائمة الرسمية' : 'Official formulary medicine'}</label>
    <div className="doctor-medicine-search"><Search size={17} aria-hidden="true" /><input id="doctor-medicine-search" className="form-input" role="combobox" aria-expanded={open} aria-controls="doctor-medicine-results" aria-autocomplete="list" aria-invalid={invalid} aria-activedescendant={open && results[activeIndex] ? `doctor-medicine-${results[activeIndex].id}` : undefined} autoComplete="off" value={open ? query : selected ? (lang === 'ar' ? selected.labelAr : selected.labelEn) : query} placeholder={lang === 'ar' ? 'ابحث بالاسم التجاري أو العلمي…' : 'Search by brand or generic name…'} onFocus={() => { setOpen(true); setQuery(selected ? (lang === 'ar' ? selected.labelAr : selected.labelEn) : ''); setActiveIndex(0); }} onChange={(event) => { setQuery(event.target.value); onSelect(''); setOpen(true); setActiveIndex(0); }} onKeyDown={onKeyDown} /></div>
    {open && <div id="doctor-medicine-results" className="doctor-medicine-results" role="listbox">
      {results.length === 0 ? <p>{lang === 'ar' ? 'لا توجد أدوية مطابقة في القائمة الرسمية.' : 'No matching official medicines.'}</p> : results.map((medicine, index) => <button id={`doctor-medicine-${medicine.id}`} key={medicine.id} type="button" role="option" aria-selected={medicine.id === selectedId} className={`doctor-medicine-option${index === activeIndex ? ' is-active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(medicine)}>
        <strong>{medicine.brandName || (lang === 'ar' ? medicine.labelAr : medicine.labelEn)}</strong><span>{lang === 'ar' ? medicine.labelAr : medicine.labelEn}</span><small>{[medicine.genericName, medicine.strength, medicine.dosageForm].filter(Boolean).join(' · ')}</small>
      </button>)}
    </div>}
  </div>;
}
