import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CV Harness',
  description: 'Vacantes → match IA → hoja de vida personalizada',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
