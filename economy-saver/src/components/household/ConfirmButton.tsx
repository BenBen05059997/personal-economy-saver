import { ApiForm } from "@/components/ui/ApiForm";

export function ConfirmButton({ kind, id, title, onCheckPage = false, returnTo = "/to-check" }: {
  kind: "bill" | "charge" | "balance" | "pot"; id: string; title: string; onCheckPage?: boolean; returnTo?: string;
}) {
  return <ApiForm action="/api/confirm">
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="id" value={id} />
    {onCheckPage && <input type="hidden" name="returnTo" value={returnTo} />}
    <button className={onCheckPage ? "ui-button" : "home-confirm"} aria-label={`Confirm ${title}`}>Confirm</button>
  </ApiForm>;
}
