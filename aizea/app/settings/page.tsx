import Link from "next/link";
import { ArrowLeft, ExternalLink, KeyRound, Brain, Hash, Server, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { getSettingsAction } from "@/lib/actions/settings";
import { SettingsForm } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const current = await getSettingsAction();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Configuración</h1>
        <p className="mt-1 text-muted-foreground">
          Conecta tu clave de OpenRouter para que la IA pueda generar árboles y
          diapositivas. Los ajustes técnicos viven en la sección avanzada.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            OpenRouter
          </CardTitle>
          <CardDescription>
            Obtén tu API key en{" "}
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
            . La key se guarda cifrada en la base de datos local; nunca se
            muestra en pantalla después de guardar.
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
            Estado actual
          </CardTitle>
          <CardDescription>
            Estos son los valores que se están usando en este momento por los
            servicios de LLM y embeddings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Brain className="h-3.5 w-3.5" />
                Modelo de chat
              </dt>
              <dd className="mt-1 text-sm" data-testid="current-chat-model">
                {current.chatModel}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                Modelo de embeddings
              </dt>
              <dd className="mt-1 text-sm" data-testid="current-embed-model">
                {current.embedModel}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Check className="h-3.5 w-3.5" />
                Clave de API
              </dt>
              <dd className="mt-1 text-sm" data-testid="current-apikey-status">
                {current.apiKeyPresent ? "configurada" : "no configurada"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
