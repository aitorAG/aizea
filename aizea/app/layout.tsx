import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/toast";
import { GlobalPipelineBanner } from "@/components/PipelineProgress/GlobalPipelineBanner";
import { Home, Settings } from "lucide-react";

export const metadata: Metadata = {
  title: "AIzea — Preparación de Materiales Docentes",
  description:
    "Asistente IA para generar diapositivas, narrativas y ejercicios a partir de libros de texto en PDF.",
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
          className="sticky border-b bg-white/80 backdrop-blur-sm"
          style={{ top: "var(--pipeline-banner-h, 0px)" }}
        >
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <a
              href="/"
              className="flex items-center gap-2 font-semibold text-lg tracking-tight"
            >
              <span className="text-primary">AI</span>
              <span>zea</span>
            </a>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <a
                href="/"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">Inicio</span>
              </a>
              <a
                href="/settings"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                data-testid="nav-settings"
              >
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Configuración</span>
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}