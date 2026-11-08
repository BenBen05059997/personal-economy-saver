import { eq } from "drizzle-orm";
import { type Db, requireHousehold, withHousehold } from "@/db/household";
import { households } from "@/db/schema";
import { ReaderError, readerSetting } from "./settings";

const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes: Uint8Array) {
  let output = "", bits = 0, buffer = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
    }
  }
  return output;
}
function unbase32(value: string) {
  const out = new Uint8Array(40);
  let bits = 0, buffer = 0, offset = 0;
  for (const char of value) {
    bits += 5;
    buffer = (buffer << 5) | alphabet.indexOf(char);
    if (bits >= 8) {
      bits -= 8;
      out[offset++] = buffer >>> bits;
    }
  }
  return out;
}
function routingDomain() {
  const domain = readerSetting("FORWARDING_DOMAIN").toLowerCase();
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain)) throw new ReaderError("FORWARDING_DOMAIN must be a domain name.");
  return domain;
}
async function routingKey() {
  const key = readerSetting("INBOUND_ADDRESS_KEY");
  if (!/^[\da-f]{64}$/i.test(key)) throw new ReaderError("INBOUND_ADDRESS_KEY must be a 256-bit hexadecimal key.");
  return crypto.subtle.importKey("raw", Buffer.from(key, "hex"), "AES-GCM", false, ["encrypt", "decrypt"]);
}

// The 64-character local part is a random nonce, a 16-byte encrypted UUID and a 96-bit authentication tag.
export async function forwardingAddress(db: Db, id: string) {
  const hid = requireHousehold(id);
  const domain = routingDomain();
  const key = await routingKey();
  return withHousehold(db, hid, async tx => {
    const [row] = await tx.select({ local: households.forwardingLocalpart }).from(households)
      .where(eq(households.id, hid)).for("update");
    if (!row) throw new ReaderError("Household not found.");
    if (row.local) return row.local + "@" + domain;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 96 }, key, Buffer.from(hid.replaceAll("-", ""), "hex"));
    const token = base32(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
    await tx.update(households).set({ forwardingLocalpart: token }).where(eq(households.id, hid));
    return token + "@" + domain;
  });
}

export async function householdForRecipient(db: Db, recipient: string) {
  const [local, domain, extra] = recipient.toLowerCase().split("@");
  if (extra !== undefined || domain !== routingDomain() || !/^[a-z2-7]{64}$/.test(local)) return null;
  const key = await routingKey();
  const bytes = unbase32(local);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), tagLength: 96 }, key, bytes.slice(12));
  } catch { return null; }
  const hex = Buffer.from(plain).toString("hex");
  const hid = requireHousehold(hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"));
  const [row] = await withHousehold(db, hid, async tx =>
    tx.select({ local: households.forwardingLocalpart }).from(households).where(eq(households.id, hid)));
  return row?.local === local ? hid : null;
}
