import type { Metadata } from 'next';
export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Privacy | Nazir' };
export default function Page() {
  return <main>
    <h1>Privacy</h1>
    <section lang="en"><h2>Privacy</h2>
      <p>Nazir uses fictional services and synthetic data only and never connects to a real government system. Do not enter real personal data.</p>
      <p>From Google we store your name, email, picture and Google account id. We store sign in session records that expire after 30 days.</p>
      <p>We store the workspaces, roles, test runs, conversations, findings and audit events you create.</p>
      <p>Free third party AI providers may process synthetic test conversations under their own terms and privacy policies.</p>
      <p>Hosting is on Vercel and the database is on Neon.</p>
      <p>For deletion or questions, email <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>Last updated 19 October 2026.</p>
    </section>
    <section lang="ar" dir="rtl"><h2>الخصوصية</h2>
      <p>يستخدم ناظر خدمات خيالية وبيانات مصطنعة فقط ولا يتصل بأي نظام حكومي حقيقي. لا تدخل بيانات شخصية حقيقية.</p>
      <p>نحفظ من Google اسمك وبريدك الإلكتروني وصورتك ومعرف حسابك لدى Google. ونحفظ سجلات جلسات تسجيل الدخول التي تنتهي بعد 30 يوما.</p>
      <p>نحفظ مساحات العمل والأدوار وعمليات الاختبار والمحادثات والنتائج وأحداث التدقيق التي تنشئها.</p>
      <p>قد يعالج مزودو الذكاء الاصطناعي المجانيون من جهات خارجية محادثات الاختبار المصطنعة وفقا لشروطهم وسياسات الخصوصية لديهم.</p>
      <p>تستضاف الخدمة على Vercel وقاعدة البيانات على Neon.</p>
      <p>لطلب الحذف أو الاستفسار، راسل <a href="mailto:shanifadhil022@gmail.com">shanifadhil022@gmail.com</a>.</p>
      <p>آخر تحديث 19 أكتوبر 2026.</p>
    </section>
  </main>;
}
