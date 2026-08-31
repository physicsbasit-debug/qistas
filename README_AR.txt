Qistas v1.3.7 — حد صفّين دراسيين لكل معلم

طريقة التطبيق:
1) ضع INSTALL_QISTAS_V1_3_7.mjs في جذر مستودع qistas.
2) شغّل:
   node INSTALL_QISTAS_V1_3_7.mjs
3) إذا ظهرت PASS، احذف ملف المثبت ثم ارفع/commit الملفات التي عدّلها.

المثبت لا يترك المشروع مكسورًا:
- يفحص مواضع التعديل قبل التطبيق.
- يشغّل node --check.
- يشغّل اختبار الميزة.
- يشغّل npm test كاملًا.
- يشغّل npm run build.
- إذا فشل أي فحص، يعيد الملفات الأصلية تلقائيًا.

الملفات الناتجة/المعدلة:
- src/domain/gradeLimit.js
- src/engine/distribution.js
- src/app.js
- tests/grade-limit.test.js
- package.json
- RELEASE_NOTES_v1.3.7.md

القاعدة:
الحد الأقصى للمعلم = صفّان دراسيان مختلفان، مهما كان عدد الشعب داخل الصف.
