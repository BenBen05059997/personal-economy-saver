import { redirect } from "next/navigation";
import { SETTINGS_ACCOUNT } from "@/lib/links";

export default function AccountPage() {
  redirect(SETTINGS_ACCOUNT);
}
