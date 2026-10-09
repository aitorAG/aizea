"use client";

// SettingsForm — API key first, everything technical behind a collapsed
//
// UX redesign:
//   - The API key is the ONE thing every user must configure. It gets the
//     top of the form plus a "Probar conexión" button so credentials are
//     validated immediately instead of failing minutes later inside a
//     pipeline run.
//   - Chat model / embed model / Docling URL are power-user knobs. They
//     move into a collapsed <details> "Ajustes avanzados" section with
//     sensible defaults — teachers should never have to see them.
//   - Labels are in Spanish (project convention: UI in Spanish), with the
//     technical value visible in the placeholder.

import { useState, useTransition } from "react";
import {
  Eye,
  EyeOff,
  Save,
  Loader2,
  ChevronDown,
  PlugZap,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import {
  updateSettingsAction,
  testConnectionAction,
} from "@/lib/actions/settings";
import { cn } from "@/lib/utils";

export interface SettingsFormInitial {
  apiKey: string;
  apiKeyPresent: boolean;
  chatModel: string;
  embedModel: string;
  doclingBaseUrl: string;
}

interface SettingsFormProps {
  initial: SettingsFormInitial;
}

export function SettingsForm({ initial }: SettingsFormProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState(initial.chatModel);
  const [embedModel, setEmbedModel] = useState(initial.embedModel);
  const [doclingBaseUrl, setDoclingBaseUrl] = useState(initial.doclingBaseUrl);

  // --- "Probar conexión" state ---
  const [testing, setTesting] = useState(false);
  // null = not tested yet; true/false = last test outcome.
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const apiKeyPlaceholder = initial.apiKeyPresent
    ? "•••••••• (dejar vacío para conservar)"
    : "sk-or-v1-...";

  async function handleTestConnection() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setTestMessage(null);
    try {
      // Test the typed key if present (so the user validates BEFORE
      // saving); otherwise test whatever is persisted.
      const result = await testConnectionAction(apiKey.trim() || undefined);
      if (result.ok) {
        setTestResult(true);
        setTestMessage(
          result.label
            ? `Conexión correcta${result.label ? ` (${result.label})` : ""}.`
            : "Conexión correcta. Tu clave funciona."
        );
      } else {
        setTestResult(false);
        setTestMessage(result.error);
      }
    } catch {
      setTestResult(false);
      setTestMessage("No se pudo realizar la comprobación. Inténtalo de nuevo.");
    } finally {
      setTesting(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const trimmed = apiKey.trim();
      const result = await updateSettingsAction({
        // null means "clear", undefined means "leave as-is", string means "set".
        apiKey: trimmed.length === 0 ? undefined : trimmed,
        chatModel,
        embedModel,
        doclingBaseUrl,
      });
      if (result.ok) {
        toast({
          title: "Configuración guardada",
          description: "Los nuevos valores se aplicarán en la siguiente generación.",
        });
        setApiKey("");
      } else {
        toast({
          title: "Error al guardar",
          description: result.error,
          variant: "error",
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" data-testid="settings-form">
      <div className="space-y-1.5">
        <label
          htmlFor="apiKey"
          className="block text-sm font-medium text-foreground"
        >
          Clave de API de OpenRouter
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="apiKey"
              name="apiKey"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                // A new value invalidates the previous test verdict.
                setTestResult(null);
                setTestMessage(null);
              }}
              placeholder={apiKeyPlaceholder}
              data-testid="input-apikey"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => setShowKey((s) => !s)}
            aria-label={showKey ? "Ocultar clave" : "Mostrar clave"}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {initial.apiKeyPresent
            ? "Ya hay una clave guardada. Escribe una nueva para reemplazarla, o deja el campo vacío para mantener la actual."
            : "Pega aquí tu clave de OpenRouter (empieza por sk-or-v1-)."}
        </p>
      </div>

      {/* UX — validate the credentials NOW, before any pipeline run can
          fail minutes later with an opaque LLM error. Tests the typed key
          when present; otherwise the persisted one. */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleTestConnection}
          disabled={testing || (!initial.apiKeyPresent && apiKey.trim().length === 0)}
          data-testid="test-connection"
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlugZap className="h-4 w-4" />
          )}
          Probar conexión
        </Button>
        {testResult !== null && (
          <p
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-sm",
              testResult ? "text-emerald-700" : "text-red-700"
            )}
            data-testid="connection-test-result"
            data-result={testResult ? "ok" : "error"}
            role="status"
          >
            {testResult ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 break-words">{testMessage}</span>
          </p>
        )}
      </div>

      {/* Power-user knobs. Collapsed by default so the required setup is
          just "paste your key and go". Uses <details> so it works without
          JS and is natively keyboard-accessible. */}
      <details className="group rounded-lg border border-border bg-muted/20" data-testid="advanced-settings">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          Ajustes avanzados
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            Modelos y servicios — no hace falta tocarlos
          </span>
        </summary>
        <div className="space-y-4 border-t border-border px-4 py-4">
          <Input
            id="chatModel"
            name="chatModel"
            type="text"
            label="Modelo de chat (IA de texto)"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            placeholder="deepseek/deepseek-chat"
            required
            data-testid="input-chat-model"
          />

          <Input
            id="embedModel"
            name="embedModel"
            type="text"
            label="Modelo de embeddings (búsqueda semántica)"
            value={embedModel}
            onChange={(e) => setEmbedModel(e.target.value)}
            placeholder="openai/text-embedding-3-small"
            required
            data-testid="input-embed-model"
          />

          <Input
            id="doclingBaseUrl"
            name="doclingBaseUrl"
            type="text"
            label="URL del servicio de análisis de PDFs (Docling)"
            value={doclingBaseUrl}
            onChange={(e) => setDoclingBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:5001"
            required
            data-testid="input-docling-url"
          />
        </div>
      </details>

      <div className="flex justify-end">
        <Button type="submit" loading={pending} data-testid="settings-submit">
          <Save className="h-4 w-4" />
          {pending ? "Guardando..." : "Aplicar"}
        </Button>
      </div>
    </form>
  );
}
