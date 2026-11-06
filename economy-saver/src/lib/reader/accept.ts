// The one way an uploaded file is read from a request (D61): /api/upload and /api/ask/document both use it, so a file is checked the same way
// wherever it comes from. Throws `ReaderError` with the words the person sees.
import { matchesFileType, mediaTypes, uploadMime } from "./extract";
import { limitedBody, MAX_DOCUMENT_BYTES, ReaderError } from "./settings";

export async function readUpload(request: Request): Promise<{ mime: (typeof mediaTypes)[number]; bytes: ArrayBuffer; form: FormData }> {
  const body = await limitedBody(request, MAX_DOCUMENT_BYTES + 8192);
  const type = request.headers.get("content-type");
  if (!type?.startsWith("multipart/form-data;")) throw new ReaderError("Select a file to upload.");
  const form = await new Response(body, { headers: { "content-type": type } }).formData().catch(() => null);
  const file = form?.get("document");
  const mime = file instanceof File ? uploadMime.safeParse(file.type) : null;
  if (!form || !(file instanceof File) || !mime?.success) throw new ReaderError("Select a PDF, JPEG, PNG or WebP file.");
  const bytes = await file.arrayBuffer();
  if (!matchesFileType(bytes, file.type)) throw new ReaderError("File contents do not match the selected file type.");
  return { mime: mime.data, bytes, form };
}
