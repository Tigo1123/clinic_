import { useTranslation } from 'react-i18next';
import { Collection } from './shared.jsx';

export function Prescriptions(){
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  return (
    <Collection
      path="/api/patient/prescriptions"
      titleKey="prescriptions"
      render={item=>(
        <>
          <h2>{new Date(item.prescriptionDate).toLocaleDateString(i18n.language)}</h2>
          {item.medicines.map(m=>(
            <p key={m.id}>
              {lang === 'ar'
                ? m.medicine?.labelAr || m.medicine?.labelEn || m.customDrugName
                : m.medicine?.labelEn || m.medicine?.labelAr || m.customDrugName
              }
              {' — '}
              {m.dosage}, {m.duration}
            </p>
          ))}
        </>
      )}
    />
  );
}
