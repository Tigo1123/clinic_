import { useState } from 'react';
import SpecialtyDeleteButton from './SpecialtyDeleteButton.js';

export default function SpecialtyRow({ specialty, lang, onSave, isAdmin, request, onDeleted, onFeedback }) {
  const [draft, setDraft] = useState(specialty);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>
        <input
          className="form-input ui-mono"
          value={draft.code}
          onChange={(event) => setDraft({ ...draft, code: event.target.value })}
        />
      </td>
      <td>
        <input
          className="form-input"
          value={draft.nameAr}
          onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })}
        />
      </td>
      <td>
        <input
          className="form-input"
          value={draft.nameEn}
          onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })}
        />
      </td>
      <td>
        <select
          className="form-input"
          value={String(draft.active)}
          onChange={(event) => setDraft({ ...draft, active: event.target.value === 'true' })}
        >
          <option value="true">{lang === 'ar' ? 'نشط' : 'Active'}</option>
          <option value="false">{lang === 'ar' ? 'غير نشط' : 'Inactive'}</option>
        </select>
      </td>
      <td>
        <div className="specialty-row-actions">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={handleSave}>
            {saving ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (lang === 'ar' ? 'حفظ' : 'Save')}
          </button>
          {isAdmin && <SpecialtyDeleteButton specialty={specialty} lang={lang} request={request} onDeleted={onDeleted} onFeedback={onFeedback}/>}
        </div>
      </td>
    </tr>
  );
}
