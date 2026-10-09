import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/toast";
import { JobsOnlyPipelineBanner } from "@/components/PipelineProgress/JobsOnlyPipelineBanner";
import { NavJobsButton } from "@/components/NavJobsButton";
import { JobsSidebar } from "@/components/JobsSidebar";
import { Home, Settings } from "lucide-react";
import { getRequestLocale } from "@/lib/i18n-server";
import { translate } from "@/lib/i18n";
import { LocaleProvider } from "@/components/LocaleProvider";
import { LanguageSelector } from "@/components/LanguageSelector";

const sharedMetadata: Metadata = {
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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    ...sharedMetadata,
    title: translate(locale, "appTitle"),
    description: translate(locale, "appDescription"),
  };
}

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background">
        <LocaleProvider locale={locale}>
        {/*
         * v0.11.0 — Pipeline progress banner, confined to the Jobs tab
         * (/jobs) so the Jobs page is the single source of truth for
         * process visibility. Renders nothing on any other route.
         */}
        <JobsOnlyPipelineBanner />
        <header
          className="sticky z-50 border-b bg-white/80 backdrop-blur-sm"
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
            <nav className="flex items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
              <a
                href="/"
                aria-label={translate(locale, "home")}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                 <Home className="h-4 w-4" />
                 <span className="hidden sm:inline">{translate(locale, "home")}</span>
              </a>
              {/* v1.11 — Jobs nav button. Client component; opens
                  the right-side drawer on click and shows a hover
                  preview of active jobs for the current course. */}
               <NavJobsButton />
              <a
                href="/settings"
                aria-label={translate(locale, "settings")}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                data-testid="nav-settings"
              >
                <Settings className="h-4 w-4" />
                 <span className="hidden sm:inline">{translate(locale, "settings")}</span>
               </a>
               <LanguageSelector />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        {/* v1.11 — Jobs drawer. Mounted once at the layout level
            so any page (including the dedicated /jobs page) can
            pop the drawer open. Renders nothing when closed. */}
        <JobsSidebar />
        <Toaster />
        </LocaleProvider>
      </body>
    </html>
  );
}
