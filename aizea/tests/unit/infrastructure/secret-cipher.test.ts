import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  resolveMasterSecret,
} from "@/lib/infrastructure/crypto/secret-cipher";

const SECRET = "test-master-secret-abc";

describe("secret-cipher (Fase 5-A encryption at rest)", () => {
  it("round-trips a value through encrypt → decrypt", () => {
    const plaintext = "sk-or-v1-1234567890abcdef";
    const enc = encryptSecret(plaintext, { masterSecret: SECRET });
    expect(enc).not.toBe(plaintext);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc, { masterSecret: SECRET })).toBe(plaintext);
  });

  it("produces the versioned envelope prefix", () => {
    const enc = encryptSecret("hello", { masterSecret: SECRET });
    expect(enc.startsWith("enc:v1:")).toBe(true);
  });

  it("uses a random IV so two encryptions of the same value differ", () => {
    const a = encryptSecret("same", { masterSecret: SECRET });
    const b = encryptSecret("same", { masterSecret: SECRET });
    expect(a).not.toBe(b);
    // Both still decrypt to the same plaintext.
    expect(decryptSecret(a, { masterSecret: SECRET })).toBe("same");
    expect(decryptSecret(b, { masterSecret: SECRET })).toBe("same");
  });

  it("is backward-compatible: decrypting legacy plaintext returns it unchanged", () => {
    // A value NOT in envelope format is legacy plaintext.
    expect(decryptSecret("sk-legacy-plaintext", { masterSecret: SECRET })).toBe(
      "sk-legacy-plaintext"
    );
  });

  it("is idempotent: encrypting an already-encrypted value is a no-op", () => {
    const enc = encryptSecret("value", { masterSecret: SECRET });
    const twice = encryptSecret(enc, { masterSecret: SECRET });
    expect(twice).toBe(enc);
  });

  it("returns empty string unchanged (nothing to protect)", () => {
    expect(encryptSecret("", { masterSecret: SECRET })).toBe("");
  });

  it("fails to decrypt when the master secret is wrong (auth tag mismatch)", () => {
    const enc = encryptSecret("secret-value", { masterSecret: SECRET });
    expect(() => decryptSecret(enc, { masterSecret: "wrong-secret" })).toThrow();
  });

  it("throws on a tampered ciphertext", () => {
    const enc = encryptSecret("secret-value", { masterSecret: SECRET });
    // Flip the last char of the ciphertext segment.
    const tampered = enc.slice(0, -1) + (enc.endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(tampered, { masterSecret: SECRET })).toThrow();
  });

  it("resolveMasterSecret prefers AIZEA_SECRET_KEY when present", () => {
    expect(
      resolveMasterSecret({ AIZEA_SECRET_KEY: "from-env" } as unknown as NodeJS.ProcessEnv)
    ).toBe("from-env");
  });

  it("resolveMasterSecret falls back to a constant when no env secret", () => {
    const fallback = resolveMasterSecret({} as unknown as NodeJS.ProcessEnv);
    expect(fallback.length).toBeGreaterThan(0);
  });
});
