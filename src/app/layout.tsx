import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nazir',
  description: 'Nazir tests government service AI agents in Arabic and English using fictional services and synthetic cases.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
