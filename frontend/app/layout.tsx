import type { Metadata } from "next";
import "./globals.css";
import { KeepAlive } from "@/components/KeepAlive";

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
    <html lang="es" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('letha_ui_theme') || 'dark';
                if (t === 'light') {
                  document.documentElement.classList.remove('dark');
                  document.body.classList.remove('theme-dark', 'theme-sepia');
                } else if (t === 'sepia') {
                  document.documentElement.classList.remove('dark');
                  document.body.classList.remove('theme-dark');
                  document.body.classList.add('theme-sepia');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen transition-colors duration-200 theme-dark">
        <KeepAlive />
        {children}
      </body>
    </html>
  );
}
