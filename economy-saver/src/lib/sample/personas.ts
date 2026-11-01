import type { Profile } from "@/lib/catalogue/types";
import type { MoneyState } from "@/lib/money/types";
import { benMoney, benProfile } from "./ben";
import { mayaMoney, mayaProfile } from "./maya";

// The two demo people. Everything the screen says that depends on who is looking (names, the
// bill in the inbox, the invoice that closes the gap) lives here, so the components stay generic.
// Fictional people and companies only.

export type PersonaId = "ben" | "maya";

export type Persona = {
  id: PersonaId;
  profile: Profile;
  money: MoneyState; // the opening state; the app always works on a copy
  switchLabel: string; // "Ben · Tokyo"
  role: string; // "freelance designer, Tokyo"
  inbox: string; // the forwarding address shown in the top bar
  demo: {
    billId: string; // the bill that arrives unconfirmed
    invoiceId: string; // the unbilled work the demo invoices
    invoiceNumber: string;
    /** The paper bill drawn beside the form. The two lines add up to the bill's amount. */
    slip: { customer: string; usage: { label: string; amount: number }; extra: { label: string; amount: number } };
    ruleLine: string; // the first line of the activity feed
    uploadToast: string;
    /** The travel demo: card-use emails that arrive one by one on one card. Fictional merchants; amounts in the home currency. */
    trip: {
      button: string; // the demo trigger
      cardId: string; // the card the charges land on
      place: string; // the city
      charges: { merchant: string; amount: number; date: string }[];
    };
  };
};

export const PERSONAS: Record<PersonaId, Persona> = {
  ben: {
    id: "ben",
    profile: benProfile,
    money: benMoney,
    switchLabel: "Ben · Tokyo",
    role: "freelance designer, Tokyo",
    inbox: "ben.bills@in.saver.example",
    demo: {
      billId: "b-hikari",
      invoiceId: "i-beacon-m2",
      invoiceNumber: "INV-2026-0107",
      slip: {
        customer: "Ben T. · Contract 0412-77",
        usage: { label: "Usage 412 kWh", amount: 9_870 },
        extra: { label: "Renewable levy", amount: 1_350 },
      },
      ruleLine: "Mobaile Tsushin → Phone. Learned from your correction on Oct 3.",
      uploadToast: "In the app, AI reads the photo or PDF here (milestone M3). This mock uses the emailed bill.",
      trip: {
        button: "Demo: Ben's trip to Taipei",
        cardId: "card-b",
        place: "Taipei",
        charges: [
          { merchant: "Lantern Bay Hotel", amount: 21_000, date: "2026-11-14" },
          { merchant: "Airport Rapid Rail", amount: 1_600, date: "2026-11-14" },
          { merchant: "Ximen Noodle House", amount: 3_800, date: "2026-11-14" },
          { merchant: "Lotus Lane Night Market", amount: 1_200, date: "2026-11-14" },
          { merchant: "Riverside Museum", amount: 600, date: "2026-11-15" },
          { merchant: "Jade Pavilion Souvenirs", amount: 4_500, date: "2026-11-15" },
        ],
      },
    },
  },
  maya: {
    id: "maya",
    profile: mayaProfile,
    money: mayaMoney,
    switchLabel: "Maya · Austin",
    role: "freelance illustrator, Austin",
    inbox: "maya.bills@in.saver.example",
    demo: {
      billId: "b-power",
      invoiceId: "i-copperline-m2",
      invoiceNumber: "INV-2026-0212",
      slip: {
        customer: "Maya R. · Account 7730-1182",
        usage: { label: "Usage 864 kWh", amount: 94 },
        extra: { label: "Delivery and fees", amount: 48 },
      },
      ruleLine: "Lone Star Mobile → Phone. Learned from your correction on Oct 3.",
      uploadToast: "In the app, AI reads the photo or PDF here (milestone M3). This mock uses the emailed bill.",
      trip: {
        button: "Demo: Maya's weekend in New Orleans",
        cardId: "card-b",
        place: "New Orleans",
        charges: [
          { merchant: "Gulf Coast Air", amount: 186, date: "2026-11-14" },
          { merchant: "Bayou Inn Hotel", amount: 264, date: "2026-11-14" },
          { merchant: "Marigny Kitchen", amount: 58, date: "2026-11-15" },
          { merchant: "Frenchmen Street Records", amount: 42, date: "2026-11-15" },
        ],
      },
    },
  },
};

export const PERSONA_ORDER: PersonaId[] = ["ben", "maya"];
