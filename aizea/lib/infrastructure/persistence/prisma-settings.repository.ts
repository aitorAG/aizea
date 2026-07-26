// PrismaSettingsRepository — concrete implementation of ISettingsRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ISettingsRepository, SettingsRow } from "@/lib/application/ports/settings-repository.port";
import { encryptSecret, decryptSecret } from "@/lib/infrastructure/crypto/secret-cipher";

export class PrismaSettingsRepository implements ISettingsRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async get(): Promise<SettingsRow | null> {
    const row = (await this.prisma.settings.findUnique({
      where: { id: "default" },
    })) as SettingsRow | null;
    if (!row) return null;
    // Fase 5-A: the API key is stored encrypted at rest; decrypt on read.
    // `decryptSecret` is backward-compatible with legacy plaintext rows.
    if (row.openrouterApiKey) {
      row.openrouterApiKey = decryptSecret(row.openrouterApiKey);
    }
    return row;
  }

  async upsert(data: {
    openrouterApiKey?: string | null;
    chatModel?: string;
    embedModel?: string;
    doclingBaseUrl?: string;
  }): Promise<SettingsRow> {
    // Fase 5-A: encrypt the API key before it touches the DB. A null clears
    // the field (fall back to env); a value is wrapped in the envelope.
    const encryptedKey =
      data.openrouterApiKey === undefined
        ? undefined
        : data.openrouterApiKey === null
          ? null
          : encryptSecret(data.openrouterApiKey);

    const row = (await this.prisma.settings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        openrouterApiKey: encryptedKey ?? null,
        chatModel: data.chatModel ?? "deepseek/deepseek-chat",
        embedModel: data.embedModel ?? "openai/text-embedding-3-small",
        doclingBaseUrl: data.doclingBaseUrl ?? "http://127.0.0.1:5001",
      },
      update: {
        ...(encryptedKey !== undefined ? { openrouterApiKey: encryptedKey } : {}),
        ...(data.chatModel ? { chatModel: data.chatModel } : {}),
        ...(data.embedModel ? { embedModel: data.embedModel } : {}),
        ...(data.doclingBaseUrl ? { doclingBaseUrl: data.doclingBaseUrl } : {}),
      },
    })) as SettingsRow;

    // Return the DECRYPTED key to callers (they expect plaintext).
    if (row.openrouterApiKey) {
      row.openrouterApiKey = decryptSecret(row.openrouterApiKey);
    }
    return row;
  }
}
