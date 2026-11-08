"use client";

import { useId, useState, type ReactNode } from "react";
import { householdMoment, type ClockHousehold } from "@/db/clock";
import type { KeepOffer } from "@/lib/agent/keep-offer";
import type { Currency } from "@/lib/catalogue/types";
import { readAmount } from "@/lib/money/amount";
import { minorMoney } from "@/lib/money/format";
import { readRule, ruleWords } from "@/lib/money/rules";
import { MEMORY_KINDS } from "@/lib/schema/memory";
import { addDeviceMemory } from "@/lib/store/device";
import { ApiForm } from "@/components/ui/ApiForm";

export function KeepOfferCard({ offer, householdId, clock, currency, deviceMemory, returnTo, onDeviceMemoryKept, hidden }: {
  offer: KeepOffer; householdId: string; clock: ClockHousehold; currency: Currency; deviceMemory: boolean; returnTo: string;
  onDeviceMemoryKept?: () => void; hidden: boolean;
}) {
  const [status, setStatus] = useState<"ready" | "saving" | "kept" | "dismissed">("ready");
  const [problem, setProblem] = useState("");
  const [potId] = useState(() => offer.kind === "goal" ? crypto.randomUUID() : "");
  const description = useId();

  if (status === "dismissed" || hidden) return null;

  let action: string;
  let words: string;
  let fields: ReactNode;
  if (offer.kind === "memory") {
    action = "/api/memory";
    words = `${MEMORY_KINDS[offer.memoryKind].label} · ${offer.text}`;
    fields = <>
      <input type="hidden" name="kind" value="add" />
      <input type="hidden" name="memoryKind" value={offer.memoryKind} />
      <input type="hidden" name="text" value={offer.text} />
      {offer.spaceId && <input type="hidden" name="spaceId" value={offer.spaceId} />}
    </>;
  } else if (offer.kind === "goal") {
    const amount = readAmount(offer.target, currency, false);
    if (!("minor" in amount)) return null;
    action = "/api/pots";
    words = `Goal · ${offer.name} · ${minorMoney(amount.minor, currency)} by ${offer.targetDate}`;
    fields = <>
      <input type="hidden" name="id" value={potId} />
      <input type="hidden" name="name" value={offer.name} />
      <input type="hidden" name="target" value={offer.target} />
      <input type="hidden" name="targetDate" value={offer.targetDate} />
    </>;
  } else {
    const value = offer.value ?? "";
    const rule = readRule(offer.ruleKind, offer.enabled, value, currency);
    if ("problem" in rule) return null;
    action = "/api/rules";
    words = "Rule · " + ruleWords(offer.ruleKind, rule);
    fields = <>
      <input type="hidden" name="kind" value="set" />
      <input type="hidden" name="ruleKind" value={offer.ruleKind} />
      {offer.spaceId && <input type="hidden" name="spaceId" value={offer.spaceId} />}
      {offer.enabled && <input type="hidden" name="enabled" value="on" />}
      <input type="hidden" name="value" value={value} />
    </>;
  }

  async function keepOnDevice() {
    if (offer.kind !== "memory" || status !== "ready") return;
    setStatus("saving");
    setProblem("");
    try {
      await addDeviceMemory(householdId, { kind: offer.memoryKind, text: offer.text, spaceId: offer.spaceId }, householdMoment(clock));
      onDeviceMemoryKept?.();
      setStatus("kept");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn’t save on this device. Try again.");
      setStatus("ready");
    }
  }

  const no = <button type="button" className="ui-button" aria-describedby={description} disabled={status === "saving"} onClick={() => setStatus("dismissed")}>No</button>;
  return <div className="ask-keep">
    <p id={description}>Keep this? {words}</p>
    {status === "kept" ? <p role="status" className="ui-hint">Kept.</p> : deviceMemory && offer.kind === "memory" ? <>
      <div className="ask-choices">
        <button type="button" className="ui-button primary" aria-describedby={description} disabled={status === "saving"} onClick={() => void keepOnDevice()}>Keep</button>
        {no}
      </div>
      {problem && <p role="status" className="ui-problem">{problem}</p>}
    </> : <ApiForm action={action} onDone={() => setStatus("kept")}>
      {fields}
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="ask-choices">
        <button type="submit" className="ui-button primary" aria-describedby={description}>Keep</button>
        {no}
      </div>
    </ApiForm>}
  </div>;
}
