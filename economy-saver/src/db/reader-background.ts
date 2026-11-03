import { withOwnedDatabase } from "./client";
import { readDocument } from "./reader-job";

/** Runs after the response, with a client that the foreground cannot close. */
export function readDocumentInBackground(hid: string, documentId: string, retry = false) {
  return withOwnedDatabase(database => readDocument(database, hid, documentId, retry));
}
