// ISettingsRepository — port for Settings persistence (singleton row).

export interface SettingsRow {
  id: string;
  openrouterApiKey: string | null;
  chatModel: string;
  embedModel: string;
  doclingBaseUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISettingsRepository {
  get(): Promise<SettingsRow | null>;
  upsert(data: {
    openrouterApiKey?: string | null;
    chatModel?: string;
    embedModel?: string;
    doclingBaseUrl?: string;
  }): Promise<SettingsRow>;
}
