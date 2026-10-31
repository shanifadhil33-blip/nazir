import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';

export default function Loading() {
  return <main className="nz-loading" role="status" aria-live="polite">
    <p>{en.openingWorkspace}</p>
    <p lang="ar" dir="rtl">{ar.openingWorkspace}</p>
  </main>;
}
