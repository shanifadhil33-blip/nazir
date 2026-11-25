import type { Metadata } from 'next';
export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Terms | Nazir' };
export default function Page() {
  return <main className="nz-legal">
    <h1>Terms</h1>
    <section lang="en"><h2>Terms</h2>
      <p>Nazir is a prototype for testing AI agents. The demo uses a fictional service and made up data. Your own account can connect an agent you control or have written permission to test.</p>
      <p>Results apply only within the tested scope and are not a certificate. Review the evidence before using a result.</p>
      <p>Use a separate test environment with made up people and records. Safety checks may ask the agent to read or change records. Configure SDK dry runs for tools that change data. Do not connect real customer records or assume that every action will be blocked.</p>
      <p>Review suggested changes and apply them to your own agent yourself. Nazir does not deploy changes to your agent. Do not enter real personal data, attack the service or interfere with its operation.</p>
      <p>For questions, email <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>Last updated 25 November 2026.</p>
    </section>
    <section lang="ar" dir="rtl"><h2>الشروط</h2>
      <p>ناظر نموذج أولي لاختبار وكلاء الذكاء الاصطناعي. يستخدم المثال التجريبي خدمة خيالية وبيانات مصطنعة. يمكنك في حسابك الخاص ربط وكيل تتحكم به أو لديك إذن مكتوب باختباره.</p>
      <p>تنطبق النتائج على النطاق الذي اختبر فقط وليست شهادة. راجع الأدلة قبل استخدام أي نتيجة.</p>
      <p>استخدم بيئة اختبار منفصلة بأشخاص وسجلات خيالية. قد تطلب فحوص الأمان من الوكيل قراءة سجلات أو تغييرها. أعد المحاكاة في SDK للأدوات التي تغير البيانات. لا تربط سجلات متعاملين حقيقية ولا تفترض أن كل إجراء سيمنع.</p>
      <p>راجع التغييرات المقترحة ونفذها في وكيلك بنفسك. لا ينشر ناظر تغييرات إلى وكيلك. لا تدخل بيانات شخصية حقيقية ولا تهاجم الخدمة أو تعطل عملها.</p>
      <p>للاستفسار، راسل <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>آخر تحديث 25 نوفمبر 2026.</p>
    </section>
  </main>;
}
