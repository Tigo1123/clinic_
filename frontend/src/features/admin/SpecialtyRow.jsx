import { useState } from 'react';
import SpecialtyDeleteButton from './SpecialtyDeleteButton.js';

export default function SpecialtyRow({ specialty, lang, onSave, isAdmin, request, onDeleted, onFeedback }) {
  const [draft, setDraft] = useState(specialty);
  return <tr><td><input className="form-input" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })}/></td><td><input className="form-input" value={draft.nameAr} onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })}/></td><td><input className="form-input" value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })}/></td><td><select className="form-input" value={String(draft.active)} onChange={(event) => setDraft({ ...draft, active: event.target.value === 'true' })}><option value="true">{lang === 'ar' ? 'نشط' : 'Active'}</option><option value="false">{lang === 'ar' ? 'غير نشط' : 'Inactive'}</option></select></td><td><div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}><button type="button" className="btn btn-primary" onClick={() => onSave(draft)}>{lang === 'ar' ? 'حفظ' : 'Save'}</button>{isAdmin && <SpecialtyDeleteButton specialty={specialty} lang={lang} request={request} onDeleted={onDeleted} onFeedback={onFeedback}/>}</div></td></tr>;
}
