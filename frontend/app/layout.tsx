import type { Metadata } from "next";
import { Instrument_Sans, Literata } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { KeepAlive } from "@/components/KeepAlive";
import { NativeLanguageGate } from "@/components/NativeLanguageGate";
import { MiniPlayer } from "@/components/MiniPlayer";
import { OfflineModeProvider } from "@/components/OfflineMode";
import { PlayerProvider } from "@/components/Player";
import { UpdateNotifier } from "@/components/UpdateNotifier";

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
  title: "Letha — Synchronized reader and audiobook",
  description: "Read your PDF books while you listen to them with synchronized neural voices",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${literata.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              var s = (window.__LETHA__ && window.__LETHA__.settings) || {};
              try {
                var t = s.theme || 'light';
                if (t === 'dark') {
                  document.documentElement.classList.add('dark');
                  document.body.classList.add('theme-dark');
                } else if (t === 'sepia') {
                  document.body.classList.add('theme-sepia');
                }
              } catch (e) {}
              try {
                var l = s.native_language;
                if (['es', 'fr', 'it', 'pt'].indexOf(l) >= 0) {
                  document.documentElement.lang = l;
                  document.documentElement.setAttribute('data-i18n-pending', '');
                  setTimeout(function () { document.documentElement.removeAttribute('data-i18n-pending'); }, 3000);
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-screen transition-colors duration-200 font-sans"
      >
        <I18nProvider>
          <OfflineModeProvider>
            <PlayerProvider>
              <KeepAlive />
              {children}
              <MiniPlayer />
              <NativeLanguageGate />
              <UpdateNotifier />
            </PlayerProvider>
          </OfflineModeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
