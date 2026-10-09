"use client";

import { useState, useTransition, useCallback } from "react";
import { Eye, EyeOff, Save, Loader2, PlugZap, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { useTranslations } from "@/components/LocaleProvider";
import {
  updateSettingsAction,
  testConnectionAction,
  type ConnectionTestResult,
} from "@/lib/actions/settings";

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
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState(initial.chatModel);
  const [embedModel, setEmbedModel] = useState(initial.embedModel);
  const [doclingBaseUrl, setDoclingBaseUrl] = useState(initial.doclingBaseUrl);

  // v0.14.0 — resultado del pre-flight "Probar conexión".
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
    null
  );

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Prueba con el valor actual del input: si el usuario acaba de corregir
      // la URL quiere validarla sin tener que guardar primero.
      const result = await testConnectionAction(doclingBaseUrl);
      setTestResult(result);
    } catch (err) {
      console.error("[settings] connection test failed:", err);
      toast({
        title: t("connectionTestError"),
        description:
          t("connectionTestFailed"),
        variant: "error",
      });
    } finally {
      setTesting(false);
    }
  }, [doclingBaseUrl, toast, t]);

  const apiKeyPlaceholder = initial.apiKeyPresent
    ? t("keepApiKey")
    : "sk-or-v1-...";

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
          title: t("settingsSaved"),
          description: t("settingsSavedDescription"),
        });
        setApiKey("");
      } else {
        console.error("[settings] save failed:", result.error);
        toast({
          title: t("settingsSaveError"),
          description: t("settingsSaveError"),
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
          {t("apiKey")}
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
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyPlaceholder}
              data-testid="input-apikey"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => setShowKey((s) => !s)}
            aria-label={showKey ? t("hideApiKey") : t("showApiKey")}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {initial.apiKeyPresent
            ? t("apiKeyHintPresent")
            : t("apiKeyHintMissing")}
        </p>
      </div>

      <Input
        id="chatModel"
        name="chatModel"
        type="text"
        label={t("chatModel")}
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
        label={t("embedModel")}
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
        label={t("doclingBaseUrl")}
        value={doclingBaseUrl}
        onChange={(e) => setDoclingBaseUrl(e.target.value)}
        placeholder="http://127.0.0.1:5001"
        required
        data-testid="input-docling-url"
      />

      <div className="flex items-center justify-end gap-3">
        {/* v0.14.0 — Pre-flight: valida API key + docling ANTES de arrancar
            un pipeline, para descubrir la config rota aquí y no a mitad del
            proceso. Prueba con el valor actual del input de docling (aunque
            no esté guardado aún). */}
        {testResult && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${
                testResult.openRouter.ok
                  ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
              data-testid="connection-openrouter"
            >
              {testResult.openRouter.ok ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
              OpenRouter: {testResult.openRouter.message}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${
                testResult.docling.ok
                  ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
              data-testid="connection-docling"
            >
              {testResult.docling.ok ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Docling: {testResult.docling.message}
            </span>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={handleTestConnection}
          disabled={testing}
          data-testid="connection-test-button"
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlugZap className="h-4 w-4" />
          )}
          {testing ? t("testingConnection") : t("testConnection")}
        </Button>
        <Button type="submit" loading={pending} data-testid="settings-submit">
          <Save className="h-4 w-4" />
          {pending ? t("applying") : t("apply")}
        </Button>
      </div>
    </form>
  );
}
