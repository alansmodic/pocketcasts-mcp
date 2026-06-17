// Encryption + token helpers.
//
// Every user's Pocket Casts session tokens are encrypted at rest with AES-256-GCM
// using a single master key (ENCRYPTION_KEY). The database alone is useless without it.
// Bearer tokens are never stored — only their SHA-256 hash — so a DB leak yields no
// working credentials.

const b64Key = process.env.ENCRYPTION_KEY;
if (!b64Key) {
  console.error("ENCRYPTION_KEY env var is required (32 bytes, base64). Generate one with: openssl rand -base64 32");
  process.exit(1);
}

const keyBytes = Buffer.from(b64Key, "base64");
if (keyBytes.length !== 32) {
  console.error(`ENCRYPTION_KEY must decode to exactly 32 bytes (got ${keyBytes.length}). Generate one with: openssl rand -base64 32`);
  process.exit(1);
}

const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);

/** Encrypt a string. Returns base64 of `iv ‖ ciphertext+tag`. */
export async function seal(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return Buffer.concat([iv, Buffer.from(ct)]).toString("base64");
}

/** Decrypt a value produced by `seal`. */
export async function open(blob: string): Promise<string> {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const data = raw.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(pt);
}

/** Hex SHA-256. Used to store a non-reversible fingerprint of a bearer token. */
export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Buffer.from(digest).toString("hex");
}

/** Mint a fresh opaque bearer token. Shown to the user once; only its hash is stored. */
export function mintBearer(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "pcm_" + Buffer.from(bytes).toString("base64url");
}
