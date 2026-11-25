import type { Metadata } from 'next';
import Link from 'next/link';
export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Privacy | Nazir' };
export default function Page() {
  return <main className="nz-legal" lang="en" dir="ltr">
    <nav aria-label="Nazir"><Link href="/?lang=en" lang="en">Home</Link><Link href="/?lang=ar" lang="ar" dir="rtl">الرئيسية</Link></nav>
    <h1>Privacy</h1>
    <section lang="en"><h2>Privacy</h2>
      <p>The Nazir demo uses a fictional service and made up records. In your own account, you can connect an agent you control or have permission to test. Use a test environment and do not enter real personal data.</p>
      <p>From Google we store your name, email, picture and Google account id. We store sign in session records that expire after 30 days.</p>
      <p>We store your workspace, agent connection details, test runs, questions, replies, findings, fixes and activity. With the SDK, we also store reported tools, agent inventory and test evidence. Test people settings store the staging login details you provide. Connection secrets and test login values are stored encrypted.</p>
      <p>SDK evidence is filtered to remove secret fields and mask recognized personal values. This does not guarantee that every sensitive value in a reply is removed. Use made up people and records.</p>
      <p>Third party AI providers may process test conversations and evidence to assess answers, under their own terms and privacy policies. Your connected agent may also use its own external services.</p>
      <p>Hosting is on Vercel and the database is on Neon.</p>
      <p>For deletion or questions, email <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>Last updated 25 November 2026.</p>
    </section>
    <section lang="ar" dir="rtl"><h2>الخصوصية</h2>
      <p>يستخدم المثال التجريبي في ناظر خدمة خيالية وسجلات مصطنعة. في حسابك الخاص، يمكنك ربط وكيل تتحكم به أو لديك إذن باختباره. استخدم بيئة اختبار ولا تدخل بيانات شخصية حقيقية.</p>
      <p>نحفظ من Google اسمك وبريدك الإلكتروني وصورتك ومعرف حسابك لدى Google. ونحفظ سجلات جلسات تسجيل الدخول التي تنتهي بعد 30 يوما.</p>
      <p>نحفظ مساحة عملك وبيانات اتصال وكيلك وعمليات الاختبار والأسئلة والردود والنتائج والإصلاحات والنشاط. عند استخدام SDK، نحفظ أيضا الأدوات المبلغ عنها وجرد الوكيل وأدلة الاختبار. تحفظ إعدادات أشخاص الاختبار بيانات الدخول التجريبية التي تقدمها. تحفظ أسرار الاتصال وقيم الدخول التجريبية مشفرة.</p>
      <p>تصفى أدلة SDK لحذف الحقول السرية وإخفاء القيم الشخصية التي يمكن التعرف عليها. لا يضمن ذلك إزالة كل قيمة حساسة من الردود. استخدم أشخاصا وسجلات خيالية.</p>
      <p>قد يعالج مزودو ذكاء اصطناعي خارجيون محادثات الاختبار والأدلة لتقييم الإجابات وفقا لشروطهم وسياسات الخصوصية لديهم. وقد يستخدم وكيلك المتصل خدمات خارجية خاصة به أيضا.</p>
      <p>تستضاف الخدمة على Vercel وقاعدة البيانات على Neon.</p>
      <p>لطلب الحذف أو الاستفسار، راسل <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>آخر تحديث 25 نوفمبر 2026.</p>
    </section>
  </main>;
}
