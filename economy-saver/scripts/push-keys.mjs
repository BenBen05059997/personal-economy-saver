// Owner-invoked. Rotate the VAPID pair in both local settings files without printing it.
import { randomUUID, webcrypto } from "node:crypto";
import { lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";

const settings = [".env.local", ".dev.vars"].map(name => new URL("../" + name, import.meta.url));
const lock = new URL("../.env.push-keys.lock", import.meta.url);
const VAPID_ASSIGNMENT = /^\s*(?:export\s+)?WEB_PUSH_(?:PUBLIC|PRIVATE)_KEY\s*=/;

async function previous(path) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error("Expected a regular settings file");
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function updated(original, publicKey, privateKey) {
  const newline = original?.includes("\r\n") ? "\r\n" : "\n";
  const lines = (original ?? "").split(/\r?\n/).filter(line => !VAPID_ASSIGNMENT.test(line));
  if (lines.at(-1) === "") lines.pop();
  lines.push("WEB_PUSH_PUBLIC_KEY=" + publicKey, "WEB_PUSH_PRIVATE_KEY=" + privateKey, "");
  return lines.join(newline);
}

async function rotate() {
  const lockFile = await open(lock, "wx", 0o600);
  const staged = [];
  try {
    const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicText = Buffer.from(await webcrypto.subtle.exportKey("raw", publicKey)).toString("base64url");
    const { d } = await webcrypto.subtle.exportKey("jwk", privateKey);
    if (!d) throw new Error("Could not export a VAPID key");
    for (const path of settings) {
      const original = await previous(path);
      const temporary = new URL(path.href + ".push-keys-" + randomUUID());
      staged.push({ path, original, temporary });
      await writeFile(temporary, updated(original, publicText, d), { mode: 0o600, flag: "wx" });
    }
    await rename(staged[0].temporary, staged[0].path);
    try {
      await rename(staged[1].temporary, staged[1].path);
    } catch (error) {
      const { original, temporary, path } = staged[0];
      if (original === null) await unlink(path);
      else {
        await writeFile(temporary, original, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      }
      throw error;
    }
  } finally {
    await Promise.allSettled(staged.map(({ temporary }) => unlink(temporary)));
    await lockFile.close();
    await unlink(lock);
  }
}

try {
  await rotate();
  console.log("Updated the Web Push key pair in both local settings files.");
} catch {
  console.error("Could not update the Web Push key pair. Check that the local settings files are writable and another key generation is not running.");
  process.exitCode = 1;
}
