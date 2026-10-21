import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="es">
      <body className="min-h-screen transition-colors duration-200">
        {children}
      </body>
    </html>
  );
}
