# مراجعة صيانة نظام شفاء — نوفمبر 2026

## النطاق والمصدر
هذه الوثيقة تحدد خط الأساس لدفعة الصيانة الأولى؛ لا تعني اعتماد النظام للاستخدام السريري.
مرجع التعديلات: `feat/next-improvements`، وهو متقدم على `main` بمقدار 68 commit وقت الفحص.
لم تُمس قاعدة البيانات أو أسرار البيئة أو الملفات الطبية، ولم يتم النشر إلى Render.

## الوضع المنشور المرصود (10 نوفمبر 2026)
- `clinic-production-api`: خدمة Docker على Render، النشر التلقائي متوقف، وآخر نشر ناجح مرصود يعود إلى أغسطس 2026.
- `clinic-production-web`: Static Site من فرع `redesign`، النشر التلقائي متوقف، والنسخة المنشورة أقدم من الفرع الرئيسي.
- `clinic-staging-api`: Docker API من `feat/next-improvements`، آخر نشر ناجح مرصود 7 نوفمبر 2026.
- `clinic-staging-web`: Static Site من `feat/next-improvements`، آخر نشر ناجح مرصود 1 نوفمبر 2026.
- بيانات نشر الواجهة والخادم ليست متزامنة بالضرورة: لا تفترض تكافؤ schema وUI بدون فحص.

## مشكلة مراقبة الجلسات
تكررت رسالة `socket.revocation_listener_unhealthy` مع `terminating connection due to administrator command` في سجلات Staging يومي 7 و10 نوفمبر.
هذا يدل على قطع اتصال PostgreSQL الخاص بإشعارات إلغاء الجلسات، لكنه لا يثبت الجهة التي قطعته.
**لا تعطل الخدمة أو تقلل حماية المصادقة لإخفاء الخطأ**.
الخطوة التالية: فحص دورة حياة الاتصال المباشر (غير pooled)، إعادة الاتصال، صحة مسار /api/health/ready، وأحداث إيقاف قاعدة البيانات وسجلات Render بالتوقيت ذاته.

## إصلاحات دفعة 1
1. استعمال `VITE_API_BASE_URL` في تحميل إعدادات العيادة، مع سقف زمني 5 ثوانٍ لعدم تجميد بدء React.
2. نقل سكربت ضبط السمة من HTML الداخلي إلى `public/theme-init.js` ليتوافق مع CSP الموجودة، ويحافظ على التهيئة قبل تحميل React.
3. استخراج `useApi` و`usePagedList` من ملف صفحات المرضى إلى `hooks/usePatientRequests.js` دون تعديل واجهة الاستدعاء.
4. إضافة اختبارات صغيرة لتأكيد السلوك، وتفعيل اختبارات CI لهذا الفرع عبر `maintenance/**`.

## مسائل مفتوحة قبل أي اعتماد للإنتاج
- مطابقة `VITE_API_BASE_URL` و`VITE_STAFF_API_URL` و`VITE_STAFF_SOCKET_URL` المنشورة مع الخدمة المقصودة؛ قيم Vite تُدمج وقت البناء.
- مراجعة أصول CORS وTLS و`TRUST_PROXY_HOPS` والأسرار دون عرض قيم الأسرار في سجلات أو مراجعات.
- التأكد من ثبات تخزين المرفقات: ملفات Render المحلية قد تُفقد بعد إعادة النشر دون persistent storage.
- توحيد استراتيجية الفروع والترويج من staging إلى production بشكل صريح بعد اختبار وتوثيق ترحيل قاعدة البيانات.
- تقسيم صفحات المرضى والمصادقة الطويلة إلى ملفات صفحات ومكونات أصغر تدريجياً، مع اختبارات مطابقة قبل وبعد كل خطوة.
- فحص أداء الحزم الكبيرة وتحميل الصفحات البطيئة، ثم إعادة تقييم Security Headers وXSS والاعتماديات.
- لا تستخدم بيانات مرضى حقيقية في الاختبارات الآلية، ولا تنفذ migrate reset أو db push أو seeding على الإنتاج.

## خطوات التحقق
- افتح PR إلى `feat/next-improvements`.
- تحقق من GitHub Actions: Backend tests + Frontend tests/lint/build + Docker builds.
- اختبر يدوياً على Staging: صفحة البداية، التحويل بين العربية والإنجليزية، تسجيل الدخول، المواعيد، الإشعارات، تحميل الملفات.
- لا تدمج إلى `main` أو تنشر إلى Render حتى تنتهي اختبارات Staging وسلامة البيانات.

## مراجع الكود
- `frontend/src/main.jsx`
- `frontend/src/utils/clinicTime.js`
- `frontend/index.html`
- `frontend/nginx.conf`
- `frontend/src/features/patient-dashboard/PatientPages.jsx`
- `backend/src/services/socketRevocation.js`
- `backend/src/config.js`
- `DEPLOYMENT.md`
