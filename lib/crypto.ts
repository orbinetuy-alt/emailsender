import crypto from "node:crypto";

function encryptionKey() {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("TOKEN_ENCRYPTION_KEY debe contener 64 caracteres hexadecimales.");
  }
  return Buffer.from(value, "hex");
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error("Secreto cifrado inválido.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
