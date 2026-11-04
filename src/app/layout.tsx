import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['300', '400', '700'], variable: '--font-sans', display: 'swap' });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['300', '400', '700'], variable: '--font-arabic', display: 'swap' });

export const metadata: Metadata = {
  title: 'Nazir',
  description: 'Nazir tests government service AI agents in Arabic and English using fictional services and synthetic cases.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning className={`${sans.variable} ${arabic.variable}`}><body>{children}</body></html>;
}
