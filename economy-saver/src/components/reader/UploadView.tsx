import Link from "next/link";
import "./reader.css";

export function UploadView() {
  return <section className="reader-upload">
    <h1 className="ui-title">Upload a bill or receipt</h1>
    <p>Choose a photo or PDF. Review its amount and date before it changes your numbers.</p>
    <form method="post" action="/api/upload" encType="multipart/form-data">
      <label className="ui-field">Document<input type="file" name="document" required accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
      <p className="ui-hint">JPEG, PNG, WebP or PDF · up to 6 MiB</p>
      <div className="ui-row"><button className="ui-button primary">Upload and read</button><Link href="/to-check">To check</Link></div>
    </form>
  </section>;
}
