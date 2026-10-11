import { describe, expect, it } from "vitest";
import { getDatabaseUrl, getDbPath } from "@/lib/paths";

describe("database path resolution", () => {
  it("defaults local runtime to the repository development database", () => {
    expect(getDatabaseUrl({})).toBe("file:./dev.db");
  });

  it("uses an explicit DATABASE_URL for isolated tests and CI", () => {
    expect(getDatabaseUrl({ DATABASE_URL: "file:/tmp/aizea-test.db" })).toBe(
      "file:/tmp/aizea-test.db"
    );
  });

  it("makes the desktop data directory authoritative", () => {
    expect(
      getDatabaseUrl({
        AIZEA_DATA_DIR: "C:\\Users\\test\\AppData\\AIzea",
        DATABASE_URL: "file:/tmp/should-not-be-used.db",
      })
    ).toBe("file:C:/Users/test/AppData/AIzea/db.sqlite");
  });

  it("derives the local database path from the resolved URL", () => {
    expect(getDbPath()).toContain("dev.db");
  });
});
