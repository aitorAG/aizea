import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Toaster } from "@/components/toast";
import { GlobalPipelineBanner } from "@/components/PipelineProgress/GlobalPipelineBanner";
import { NavJobsButton } from "@/components/NavJobsButton";
import { JobsSidebar } from "@/components/JobsSidebar";
import { Home, Settings } from "lucide-react";

export const metadata: Metadata = {
  title: "AIzea — Preparación de Materiales Docentes",
  description:
    "Asistente IA para generar diapositivas, narrativas y ejercicios a partir de libros de texto en PDF.",
  applicationName: "AIzea",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AIzea",
  },
  icons: {
    icon: [
      { url: "/icons/pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/pwa-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background">
        {/*
         * Global pipeline progress banner — fixed at the bottom of every
         * page. Renders nothing when no job is active in the store, so
         * it is safe to leave in the layout unconditionally. The banner
         * sits below the sticky header, so no layout offset variable is
         * needed.
         */}
        <GlobalPipelineBanner />
        <header
          className="sticky z-50 border-b bg-white/80 backdrop-blur-sm"
          style={{ top: "var(--pipeline-banner-h, 0px)" }}
        >
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold text-lg tracking-tight"
            >
              <span className="text-primary">AI</span>
              <span>zea</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link
                href="/"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">Inicio</span>
              </Link>
              {/* v1.11 — Jobs nav button. Client component; opens
                  the right-side drawer on click and shows a hover
                  preview of active jobs for the current course. */}
              <NavJobsButton />
              <Link
                href="/settings"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                data-testid="nav-settings"
              >
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Configuración</span>
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        {/* v1.11 — Jobs drawer. Mounted once at the layout level
            so any page (including the dedicated /jobs page) can
            pop the drawer open. Renders nothing when closed. */}
        <JobsSidebar />
        <Toaster />
      </body>
    </html>
  );
}