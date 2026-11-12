import { AllowanceHint } from "@/components/ui/AllowanceHint";
import { UploadForm } from "./UploadForm";
import "./reader.css";

export function UploadView({ documentsLeft }: { documentsLeft: number | null }) {
  return <section className="reader-upload">
    <h1 className="ui-title">Upload a bill or receipt</h1>
    <p>Choose a photo or PDF. Review its amount and date before it changes your numbers.</p>
    <AllowanceHint kind="documents" left={documentsLeft} />
    <UploadForm />
  </section>;
}
