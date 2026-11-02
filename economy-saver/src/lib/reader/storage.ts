import { createClient } from "@supabase/supabase-js";
import { ReaderError, readerSetting } from "./settings";

export async function documentBucket() {
  const storage = createClient(readerSetting("SUPABASE_URL"), readerSetting("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage;
  const name = readerSetting("SUPABASE_DOCUMENT_BUCKET");
  const { data, error } = await storage.getBucket(name);
  if (error || !data || data.public) throw new ReaderError("SUPABASE_DOCUMENT_BUCKET must name an accessible private bucket.");
  return storage.from(name);
}
