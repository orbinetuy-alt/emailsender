import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — Comunicación comercial",
  description: "Plataforma de campañas y seguimiento comercial con Google Workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
