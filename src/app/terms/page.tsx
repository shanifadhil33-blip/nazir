import type { Metadata } from 'next';
export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Terms | Nazir' };
export default function Page() {
  return <main className="nz-legal">
    <h1>Terms</h1>
    <section lang="en"><h2>Terms</h2>
      <p>Nazir is a prototype for demonstration using fictional services and synthetic data only. There is no live government connection.</p>
      <p>Results apply only within the tested scope and are not a certificate. Review the evidence before using a result.</p>
      <p>Do not enter real personal data. Do not attack the service or interfere with its operation.</p>
      <p>For questions, email <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>Last updated 19 October 2026.</p>
    </section>
    <section lang="ar" dir="rtl"><h2>الشروط</h2>
      <p>ناظر نموذج أولي للعرض يستخدم خدمات خيالية وبيانات مصطنعة فقط. لا يوجد اتصال مباشر بنظام حكومي.</p>
      <p>تنطبق النتائج على النطاق الذي اختبر فقط وليست شهادة. راجع الأدلة قبل استخدام أي نتيجة.</p>
      <p>لا تدخل بيانات شخصية حقيقية. لا تهاجم الخدمة ولا تعطل عملها.</p>
      <p>للاستفسار، راسل <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>آخر تحديث 19 أكتوبر 2026.</p>
    </section>
  </main>;
}
