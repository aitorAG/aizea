import Link from "next/link";
import { ArrowLeft, ExternalLink, KeyRound, Brain, Hash, Server, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { getSettingsAction } from "@/lib/actions/settings";
import { SettingsForm } from "./settings-client";
import { getRequestLocale } from "@/lib/i18n-server";
import { translate } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const current = await getSettingsAction();
  const locale = await getRequestLocale();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {translate(locale, "backHome")}
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{translate(locale, "settings")}</h1>
        <p className="mt-1 text-muted-foreground">{translate(locale, "settingsDescription")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            OpenRouter
          </CardTitle>
          <CardDescription>
            {translate(locale, "openRouterDescription")} {" "}
            <a
              href="https://openrouter.ai"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              data-testid="openrouter-link"
            >
              openrouter.ai
              <ExternalLink className="h-3 w-3" />
            </a>
            {translate(locale, "encryptedKeyDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            initial={{
              apiKey: current.openrouterApiKey ?? "",
              apiKeyPresent: current.apiKeyPresent,
              chatModel: current.chatModel,
              embedModel: current.embedModel,
              doclingBaseUrl: current.doclingBaseUrl,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {translate(locale, "currentStatus")}
          </CardTitle>
          <CardDescription>
            {translate(locale, "currentStatusDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Brain className="h-3.5 w-3.5" />
                {translate(locale, "chatModel")}
              </dt>
              <dd className="mt-1 text-sm" data-testid="current-chat-model">
                {current.chatModel}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                {translate(locale, "embedModel")}
              </dt>
              <dd className="mt-1 text-sm" data-testid="current-embed-model">
                {current.embedModel}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Check className="h-3.5 w-3.5" />
                {translate(locale, "apiKey")}
              </dt>
              <dd className="mt-1 text-sm" data-testid="current-apikey-status">
                {current.apiKeyPresent ? translate(locale, "configured") : translate(locale, "notConfigured")}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
