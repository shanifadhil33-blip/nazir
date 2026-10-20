import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import './globals.css';

const display = Fraunces({ subsets: ['latin'], weight: '600', variable: '--font-serif', display: 'swap' });
const sans = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans', display: 'swap' });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '600'], variable: '--font-arabic', display: 'swap' });

export const metadata: Metadata = {
  title: 'Nazir',
  description: 'Nazir tests government service AI agents in Arabic and English using fictional services and synthetic cases.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${display.variable} ${sans.variable} ${arabic.variable}`}><body>{children}</body></html>;
}
