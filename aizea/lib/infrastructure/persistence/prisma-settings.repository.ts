// PrismaSettingsRepository — concrete implementation of ISettingsRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ISettingsRepository, SettingsRow } from "@/lib/application/ports/settings-repository.port";

export class PrismaSettingsRepository implements ISettingsRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async get(): Promise<SettingsRow | null> {
    return this.prisma.settings.findUnique({ where: { id: "default" } }) as Promise<SettingsRow | null>;
  }

  async upsert(data: {
    openrouterApiKey?: string | null;
    chatModel?: string;
    embedModel?: string;
    doclingBaseUrl?: string;
  }): Promise<SettingsRow> {
    return this.prisma.settings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        openrouterApiKey: data.openrouterApiKey ?? null,
        chatModel: data.chatModel ?? "deepseek/deepseek-chat",
        embedModel: data.embedModel ?? "openai/text-embedding-3-small",
        doclingBaseUrl: data.doclingBaseUrl ?? "http://127.0.0.1:5001",
      },
      update: {
        ...(data.openrouterApiKey !== undefined ? { openrouterApiKey: data.openrouterApiKey } : {}),
        ...(data.chatModel ? { chatModel: data.chatModel } : {}),
        ...(data.embedModel ? { embedModel: data.embedModel } : {}),
        ...(data.doclingBaseUrl ? { doclingBaseUrl: data.doclingBaseUrl } : {}),
      },
    }) as Promise<SettingsRow>;
  }
}
