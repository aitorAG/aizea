"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Save, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { updateSettingsAction } from "@/lib/actions/settings";

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

  const apiKeyPlaceholder = initial.apiKeyPresent
    ? "•••••••• (dejar vacío para conservar)"
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
          title: "Configuración guardada",
          description: "Los nuevos valores se aplicarán en la siguiente llamada al LLM.",
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
          API Key
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
            aria-label={showKey ? "Ocultar API key" : "Mostrar API key"}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {initial.apiKeyPresent
            ? "Ya hay una API key guardada. Escribe una nueva para reemplazarla, o deja el campo vacío para mantener la actual."
            : "Pega aquí tu key de OpenRouter (comienza con sk-or-v1-)."}
        </p>
      </div>

      <Input
        id="chatModel"
        name="chatModel"
        type="text"
        label="Chat model"
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
        label="Embed model"
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
        label="Docling base URL"
        value={doclingBaseUrl}
        onChange={(e) => setDoclingBaseUrl(e.target.value)}
        placeholder="http://127.0.0.1:5001"
        required
        data-testid="input-docling-url"
      />

      <div className="flex justify-end">
        <Button type="submit" loading={pending} data-testid="settings-submit">
          <Save className="h-4 w-4" />
          {pending ? "Guardando..." : "Aplicar"}
        </Button>
      </div>
    </form>
  );
}
