// Shows which public key each Virtuals signer secret belongs to, so it can be
// compared with the key shown under the signer's name on app.virtuals.io.
// Public keys aren't secret; the private keys themselves are never printed.
import crypto from "node:crypto";

for (const name of ["ACP_SIGNER_PRIVATE_KEY", "ACP_BUYER_SIGNER_PRIVATE_KEY"]) {
  const t = (process.env[name] ?? "").trim();
  if (!t) {
    console.log(`${name}: not set`);
    continue;
  }
  const body = t.replace(/^wallet-auth:/, "").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  try {
    const key = crypto.createPrivateKey({ key: Buffer.from(body, "base64"), format: "der", type: "pkcs8" });
    const pub = crypto.createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64");
    console.log(`${name}: belongs to the signer whose public key ends ...${pub.slice(-12)}`);
  } catch {
    const hint = t.startsWith("MFkw") ? " It looks like a public key; the secret needs the private key." : "";
    console.log(`${name}: not a readable private key.${hint}`);
  }
}
