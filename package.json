import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "IZZA SMART | Administración de servicios",
  description: "Agenda, clientes, cotizaciones, órdenes de servicio y pagos para IZZA Servicios de Mantenimiento.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/logo_izza.png", apple: "/logo_izza.png" },
  applicationName: "IZZA SMART",
  openGraph: {
    title: "IZZA SMART",
    description: "Soluciones confiables, resultados que duran.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "IZZA SMART, administración integral de servicios" }],
    locale: "es_MX",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "IZZA SMART",
    description: "Soluciones confiables, resultados que duran.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#06233F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
