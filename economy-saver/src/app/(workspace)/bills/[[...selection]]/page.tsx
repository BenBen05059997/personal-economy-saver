import { DirectoryPage } from "@/components/household/DirectoryPage";

export default function Page({ params }: { params: Promise<{ selection?: string[] }> }) {
  return <DirectoryPage params={params} section="bills" />;
}
