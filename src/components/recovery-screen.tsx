'use client';

import { useEffect } from 'react';

const copy = {
  en: { error: 'Something went wrong', missing: 'Page not found', errorNote: 'Please try again. Your saved checks are still there.', missingNote: 'This page could not be found.', retry: 'Try again', home: 'Back to home' },
  ar: { error: 'حدث خطأ', missing: 'الصفحة غير موجودة', errorNote: 'حاول مجددا. فحوصاتك المحفوظة ما زالت موجودة.', missingNote: 'تعذر العثور على هذه الصفحة.', retry: 'حاول مجددا', home: 'العودة إلى الرئيسية' },
};
// Fixed code only. Set the document before first paint on a direct Arabic error URL.
const localeScript = "{const l=new URLSearchParams(location.search).get('lang');if(l==='ar'||l==='en'){document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';}}";

/** Standalone recovery also works when the root layout and its styles failed. */
export function RecoveryScreen({ missing = false, retry }: { missing?: boolean; retry?: () => void }) {
  useEffect(() => {
    const lang = new URLSearchParams(location.search).get('lang');
    if (lang === 'ar' || lang === 'en') { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; }
  }, []);
  return <main className="nz-recovery">
    <script>{localeScript}</script>
    <style>{`
      .nz-recovery { color: #202124; background: #f5f6f8; font-family: system-ui, sans-serif; font-size: 16px; line-height: 1.6; min-height: 100dvh; padding: 48px 24px; box-sizing: border-box; }
      .nz-recovery section { max-width: 560px; margin-inline: auto; }
      .nz-recovery h1 { font-size: 28px; font-weight: 600; }
      .nz-recovery button, .nz-recovery a { font: inherit; display: inline-flex; align-items: center; min-height: 44px; padding: 8px 20px; border: 0; border-radius: 28px; background: #202124; color: #ffffff; cursor: pointer; text-decoration: none; margin-block: 8px; }
      .nz-recovery a:focus-visible, .nz-recovery button:focus-visible { outline: 2px solid #202124; outline-offset: 3px; }
      .nz-recovery [lang=ar] { display: none; }
      html[lang=ar] .nz-recovery [lang=en] { display: none; }
      html[lang=ar] .nz-recovery [lang=ar] { display: block; }
    `}</style>
    {(['en', 'ar'] as const).map((lang) => <section key={lang} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <p>Nazir</p><h1>{missing ? copy[lang].missing : copy[lang].error}</h1>
      <p>{missing ? copy[lang].missingNote : copy[lang].errorNote}</p>
      {!missing && retry ? <button type="button" onClick={retry}>{copy[lang].retry}</button> : null}
      <p><a href={`/?lang=${lang}`}>{copy[lang].home}</a></p>
    </section>)}
  </main>;
}
