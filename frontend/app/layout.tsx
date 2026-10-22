import type { Metadata } from "next";
import { Instrument_Sans, Literata } from "next/font/google";
import "./globals.css";
import { KeepAlive } from "@/components/KeepAlive";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Letha — Lector y Audiolibro Sincronizado",
  description: "Lee tus libros en PDF mientras los escuchas con voces neurales sincronizadas",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${instrumentSans.variable} ${literata.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('letha_ui_theme') || 'light';
                if (t === 'dark') {
                  document.documentElement.classList.add('dark');
                  document.body.classList.add('theme-dark');
                } else if (t === 'sepia') {
                  document.body.classList.add('theme-sepia');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen transition-colors duration-200 font-sans">
        <KeepAlive />
        {children}
      </body>
    </html>
  );
}
