"use client";

import { useEffect, useRef, useState } from "react";
import { businessBpFromForm, CATEGORY_KEYS, type CategoryKey } from "@/lib/money/categories";
import { correctionText, type Correctable } from "@/lib/reader/correction";

/**
 * D58: inside a reading's review card. When the person changes the name, the category, the work share or the card from what was
 * read, an unticked box offers to tell the assistant the correction (`remember=on`; the confirm writes it in the same
 * transaction). An amount or a date is never offered. Hidden until something changed.
 */
export function CorrectionOffer({ read, cards }: { read: Correctable; cards: { id: string; label: string }[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const update = () => {
      const data = new FormData(form);
      const category = String(data.get("category") ?? "");
      const card = String(data.get("cardId") ?? "");
      const businessBp = businessBpFromForm(data.get("businessShare"), data.get("businessPercent"));
      setText(correctionText(read, {
        kind: data.get("target") === "charge" ? "charge" : "bill", name: String(data.get("name") ?? ""),
        category: (CATEGORY_KEYS as string[]).includes(category) ? category as CategoryKey : null,
        businessBp, cardId: card || null,
      }, cards.find(c => c.id === card)?.label));
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => { form.removeEventListener("input", update); form.removeEventListener("change", update); };
  }, [read, cards]);
  return <span ref={anchor}>{text !== null && <label className="reader-remember"><input type="checkbox" name="remember" key={text} />Also tell the assistant: “{text}”</label>}</span>;
}
