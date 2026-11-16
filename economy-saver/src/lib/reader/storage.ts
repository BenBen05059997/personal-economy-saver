import { supabaseService } from "@/lib/supabase-auth";
import { ReaderError, readerSetting } from "./settings";

export async function documentBucket() {
  const storage = supabaseService(readerSetting("SUPABASE_URL"), readerSetting("SUPABASE_SERVICE_ROLE_KEY")).storage;
  const name = readerSetting("SUPABASE_DOCUMENT_BUCKET");
  const { data, error } = await storage.getBucket(name);
  if (error || !data || data.public) throw new ReaderError("SUPABASE_DOCUMENT_BUCKET must name an accessible private bucket.", 503);
  return storage.from(name);
}
