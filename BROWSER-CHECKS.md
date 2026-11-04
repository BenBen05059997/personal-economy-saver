# Browser checks

What to check by hand in a real browser before saying the app works. Each check is something a person does on screen and the result they should see. The automated suites (`npm run db:test` and the three HTTP suites in `scripts/frontend-check.mjs`) cover the maths, household scope and the refused requests; this list covers what only a screen shows. A full run's result goes in [PLAN.md](PLAN.md) under "Browser checks".

## How to run

- Restart `npm run dev -- -p 3123` after any change in `src/db/`, the schema or `next.config.ts`; keep one browser tab open.
- Start from a fresh Try it household: Settings → Account → Reset to Ben's starting numbers → Reset (or a private window, then Try it).
- Run the checks in order; later ones assume the earlier changes.
- Do every screen at 375px and at 1440px. Do section L in light and dark.
- A check fails if the number differs, the screen errors, a button does nothing, or anything scrolls sideways or overlaps.
- "Needs …" checks wait on a setting or account the owner provides; skip them until it exists and note them as skipped.

## Expected numbers on a fresh Try it household

The demo date is Sat Nov 14, 2026; Ben alone; $1 = ¥150.

| Where | Expected |
|---|---|
| Home sentence | "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th." |
| Fix button | Invoice Beacon $400 |
| Safe to spend | ¥0, "Includes ¥61,000 on Card B not yet billed" |
| Bank balance | ¥67,000 |
| Card A | ¥86,450 owed now · ¥413,550 limit left · Statement ¥58,000 due Nov 26 · Covered ✓ |
| Card B | ¥61,000 owed now · ¥239,000 limit left · So far ¥61,000 due Dec 10 · Covered ✓ |
| To check | 1: Hikari Denki ¥11,220, due Nov 27 |
| Coming up | CloudBox Plus ¥1,980 Nov 18 and Mobaile Tsushin ¥4,800 Nov 20 (every month); Acme +$1,200 Nov 22 (if late Dec 3); Northwind +$800 Nov 25 (if late Nov 29); Card A statement ¥58,000 Nov 26; Rent ¥82,000 Nov 27 (every month, "Short by ¥18,780 if clients pay late") |
| Plan | "The next 30 days leave about ¥92,220 if clients pay as usual." No pots. |
| Options | "Cover ¥18,780 by Nov 27."; first option Invoice Beacon Studio, ¥0 extra cost |
| Clients | Acme $1,200 outstanding; Beacon Studio nothing outstanding; Northwind $800 outstanding |

## A. Start and sign-in

- A1. Open `/` with no session → the landing page offers Try it and sign-in by email.
- A2. Try it → Home in ≤ 1.5 s with the expected sentence and numbers above.
- A3. Every sidebar link (Home, To check, Activity, Cards, Clients, Plan, Settings) opens its page; on a phone the menu opens and closes them.
- A4. The bell shows the unread count; opening it lists the events; Mark read clears the count ("You're caught up").
- A5. Needs a working magic link: sign in by email → onboarding (name, timezone, bank balance, one card) → your own sentence; a Try it household is upgraded, not lost.

## B. Home reads right

- B1. Every number in the table above matches, on Home, Cards, Clients, Plan and Options alike (the same number never differs between screens).
- B2. The runway picture marks −¥18,780 on Nov 27, and its dates run Nov 14 to Dec 13.
- B3. "Later in the month · 1 more" opens and shows the Card B statement ¥61,000 on Dec 10; the row that carries the shortfall is never folded into it.
- B4. "Other options ›" opens Options; "All cards ›" opens Cards; "All activity ›" opens Activity.
- B5. Ben alone: no Shared costs panel, and no Whose, Paid by or Shared fields or labels anywhere; Settings has no "Card belongs to" select, its bills panel is headed "Bills" (not "Shared & personal bills"), and the "Add a partner or housemate…" line is still there.

## C. Typing things in

- C1. Bank balance: Update (the cursor is already in the field) → ¥100,000 → Save → "You're fine for the next 30 days, even if clients pay late. Lowest point ¥14,220 on the 27th."; Activity shows "Bank balance set to ¥100,000 (was ¥67,000)". Set it back to ¥67,000. Escape inside the open form closes it and returns focus to Update.
- C2. Add a bill: type the biller "Fictional power" → the Category select picks Utilities by itself; type "Zebra Supplies" instead → it shows "Choose a category" and the form will not submit until you pick one. Choose Personal / Business / Mixed under Business share (Mixed asks for a percent). Add a bill (¥5,000, due Nov 25, category Other, Personal) → it appears in Coming up and the shortfall moves from ¥18,780 to ¥23,780. Later checks assume it is not there: start a fresh household, or add ¥5,000 to the shortfalls below.
- C3. Add a monthly bill → Coming up shows "Every month"; Settings lists it.
- C4. Card charge ¥3,800 on Card B (merchant "Noodle shop", category Food, Personal) → Card B owed now rises to ¥64,800 and limit left falls to ¥235,200; the sentence and the low point do not move (Card B is billed after the window).
- C5. Add a client → it appears on Clients and in the new-invoice list.
- C6. A form that is refused shows the route's message under the form, keeps what was typed, and saves nothing; the page does not leave. Bill amount 0 → "The amount must be more than zero"; a pot with 101% → "Enter a share between 0.01 and 100 percent, such as 25"; an invoice draft amount 0 → "The amount must be more than zero"; a client with a bad email stops at the browser's own message. Editing any field clears the message (also when the browser's own validation then blocks the next send). Correct the field and send again → it goes through. Without JavaScript the same forms still post and answer with the route's text.
- C7. Amounts and dates have limits. "1,000" and "1,000.50" (and full-width １，０００) are taken as 1000 and 1000.50 in every amount box (a bill, a charge, an invoice, the bank balance, a pot). ¥100,000,001 (or $1,000,001) → "Enter an amount up to ¥100,000,000" (or "$1,000,000"). A bill or charge dated more than two years after Nov 14, 2026 (Nov 15, 2028) → "Choose a date within the next two years"; Nov 14, 2028 is accepted and Activity reads "… added, due Nov 14, 2028".
- C8. Remove. Settings → Bills (Ben alone: each bill has Remove; with two people, open the bill and use Remove): Remove on a bill asks "Remove Rent ¥82,000? It repeats every month, so every month goes." with Keep and Remove; Keep closes the question and changes nothing; Remove takes the bill (all its months) off Coming up and the runway, and Activity says "Removed bill Rent ¥82,000". Cards → Card A → Recent charges: Remove on "Yamabiko Outdoor ¥6,400" asks first, then Card A's owed now falls from ¥86,450 to ¥80,050 and Activity says "Removed charge Yamabiko Outdoor ¥6,400". Start a fresh household afterwards.

## D. To check

- D1. The Hikari Denki row reads "Utilities · 30% business · due Nov 27". Confirm it → it leaves To check, Coming up shows it as a bill, the shortfall becomes ¥30,000 on the 27th, and the To check count drops to 0. Nov 27 now has two rows (Hikari Denki and Rent); only the last of them reads "Short by ¥30,000 if clients pay late", the other shows neither that nor a Covered tick.
- D2. Needs the Anthropic settings: an item the agent drafted (a bill, charge, bank balance or pot) waits here with its details and changes nothing until Confirm.

## E. Getting paid

- E1. Invoice Beacon $400 → the review page shows Beacon Studio, Brand refresh milestone 2, On receipt, $400 ≈ ¥60,000, and the note.
- E2. Mark paid outside PayPal → bank balance +¥60,000, the sentence changes (lowest point ¥30,000 on the 27th after D1), and Activity records it.
- E3. New invoice from Clients or Add → Review draft → the review page shows what was typed.
- E4. Needs a deployed app and the PayPal webhook: Approve and send → "Sent" in Activity in ≤ 2 s → PayPal's paid webhook → "Paid" and the sentence changes. A second tap never sends twice.

## F. Lists

- F1. Activity: newest first, dates in "Nov 14" form, every row says in words what changed (no raw ids or ISO dates), and its Type column is in words ("Invoice paid outside PayPal", "Clear for 30 days", "Short", "Settings changed", "Waiting in To check"), never an internal name with underscores.
- F2. Cards: each row matches Home's card row; a row opens its panel with its own link; Card A's panel shows "Limit left ¥413,550" and "Can still go on this card and leave every bill through Dec 26 covered ¥173,770" (with Card A's closing day at 31; I2 moves it), and each of Recent charges has a Remove (C8).
- F3. Clients: a row opens its panel; amounts match Home's Coming up.
- F4. Options: the cheapest fix first; Review invoice opens Beacon's invoice; borrowing options show principal and total repayment.

## G. Plan and pots

- G1. Add a Car pot (¥1,200,000 by Mar 2027, ¥0 saved) → the Plan line says about ¥300,000 a month, more than the next 30 days leave; Home shows one line for the pot.
- G2. Add a Tax pot at 25% of each client payment, then E2 → the pot grows by ¥15,000 and Activity records it.
- G3. Money in pots comes off safe to spend and the runway.
- G4. Edit and remove a pot → Home and Plan follow.

## H. Household split

- H1. Settings → People → add Aki → two rows at 50% each appear at once.
- H2. Set Ben 60, Aki 40 → Save people; a total other than 100% is refused with a message.
- H3. Settings → Cards → Card B belongs to Aki → Activity says "Card B now belongs to Aki".
- H4. Add a shared ¥30,000 bill paid by Ben dated Nov 14, and a shared ¥5,000 charge on Card B dated Nov 14 → Home: "Aki owes Ben ¥9,000". Activity: "Shared, paid by Aki (Card B)".
- H5. Mark settled → "Nobody owes anyone anything"; Activity: "Aki paid Ben ¥9,000", "settled through Nov 14"; the sentence does not move.
- H6. A shared item dated before the day Aki joined does not count.
- H7. Settings → Shared & personal bills: a bill with no payer reads "Household, not split".

## I. Settings

- I1. Household name and bank balance save and stay after a reload; the bank balance shows on Home.
- I2. Add a card, edit a card's closing and due days → Home's card rows follow. Change Card A's closing day from 31 to 10 → Card A still reads ¥86,450 owed now and ¥413,550 limit left, the sentence and safe to spend do not move, and Coming up gains no new row inside 30 days (the Nov 4 and Nov 9 charges, ¥22,050, are a statement due Dec 26). Set it back to 31.
- I3. Export my data → a file `personal-economy-saver-2026-11-14.json` downloads; it opens as JSON with the household, cards, bills, clients and events, and no AI key, tokens, sign-in email or uploaded files (clients' billing emails are the household's own data and belong in it).
- I4. Your AI key: a key not shaped like `sk-ant-…` is refused with "Enter a valid Anthropic API key"; a saved key shows only its last four characters.
- I5. Needs `MCP_TOKEN_KEY`: Create token → the token is shown once; an MCP client can call `where_am_i` and `who_owes_whom`, and `draft_invoice` opens as a draft in the app.
- I6. Settings → Account → Reset to Ben's starting numbers asks "Everything you added goes. Reset?"; Keep changes nothing; Reset returns to Home with Ben's expected numbers.
- I7. Needs a signed-in account: Delete my data → everything is gone, including uploaded files.

## J. Upload and forwarded email

- J1. Upload accepts JPEG, PNG, WebP and PDF up to 6 MiB, and refuses other files with a message on the Upload page (never a bare text page).
- J2. Needs the Anthropic settings: upload `samples/bills/kokuho-2026-nouhusho.png` → "Document ready to read" at once → a To check row in ≤ 30 s → confirm → safe to spend changes.
- J3. Needs Email Routing: forward a mail with the PDF attached → the same as J2.

## K. Ask

- K0. Opening Ask puts the cursor in the question box.
- K1. Without the Anthropic settings, Ask shows the clear "ANTHROPIC_TEXT_MODEL is not set" error and nothing breaks.
- K2. Enter sends; Shift+Enter adds a line; Japanese input (IME) does not send mid-word.
- K3. Needs the Anthropic settings: "can I afford ¥4,000 tonight", "what's due", "where am I", "who owes whom" and one free-form question each get one or two sentences in ≤ 8 s, with numbers equal to Home's.
- K4. Needs the Anthropic settings: "I paid ¥3,800 at the noodle place on Card B" → a pending charge in To check; confirming it matches C4.
- K5. Voice, in your own Chrome or Safari with a microphone (the desktop app's browser pane blocks it):
  - Open Ask → Use microphone → the browser asks for the microphone once; allow it. The button reads "Stop listening".
  - Say "What's due this week?" → the button returns to "Use microphone", the words appear in the Ask box, and nothing is sent until Enter or Ask.
  - With the browser set to Japanese, say 「今週の支払いは？」 → the Japanese words appear in the box.
  - Stop listening part-way, or close the Ask panel → listening stops and nothing is sent.
  - Block the microphone and try again → "Speech wasn't captured. Try again or type below.", and typing still works.
  - In Firefox → "This browser doesn't offer speech recognition. Type your question below."
  - Needs the Anthropic settings: a spoken "I paid ¥3,800 at the noodle place on Card B", then Ask → the same pending charge as K4.

## L. Every screen, both widths, light and dark

Home, To check, Activity, Cards, Clients, Plan, Options, Settings, Upload, New invoice, Invoice review, Login:

- L1. Nothing scrolls sideways; no text is cut off or overlaps; long names wrap.
- L2. On a phone, every link, button, input and summary row is about 44px tall to tap (measure the box, or its `::after` hit area), and the Ask bar never covers the last row. This includes the client links in Home's sentence and in Coming up, the "Later in the month" summary, and Settings' "Allow invoice drafts" checkbox.
- L3. Dark mode: all text is readable, the red shortfall and green Covered stay clear, and form fields and buttons are visible.
- L4. Desktop: the sidebar, top bar (Ask, bell, Add) and panels line up; Settings uses two columns.
- L5. Loading states ("Opening …") give way to the page within a second or two on a visible tab.
- L6. The browser console shows no errors on any page.

## M. Categories and the month view

Demo date Nov 14. Run M1 to M3 on a fresh Try it household that has had none of C2 to C4 (they add a bill and a charge to November).

- M1. Plan shows "Where the month goes · November" and the line "Business ¥32,830 of ¥152,230 this month", then these rows in this order (a row opens to its items):

| Row | Total | Split | Items |
|---|---|---|---|
| Housing | ¥82,000 | business ¥24,600 · personal ¥57,400 | Rent, Nov 27 |
| Phone & internet | ¥4,800 | business ¥2,400 · personal ¥2,400 | Mobaile Tsushin, Nov 20 |
| Subscriptions | ¥1,980 | just the total (all business) | CloudBox Plus, Nov 18 |
| Food | ¥10,700 | just the total (all personal) | Minato Fresh Market Nov 8 ¥7,420 and Nov 13 ¥1,400; Kissa Midori café Nov 12 ¥1,880 |
| Business tools | ¥3,850 | just the total | Sora Cloud Hosting, Nov 4 |
| Other | ¥48,900 | just the total | Kumo Goods Online Nov 2 ¥24,300; Tsuki Electronics Nov 9 ¥18,200; Yamabiko Outdoor Nov 12 ¥6,400 |

  No Utilities row yet and no October charges (Metro Line, Page & Lantern Books, the October Minato and Kissa Midori charges). Every number on Home, Cards and Plan's room line is the same as in "Expected numbers".
- M2. Confirm Hikari Denki in To check → Plan gains Utilities ¥11,220 (business ¥3,366 · personal ¥7,854) after Housing, and the business line becomes "Business ¥36,196 of ¥163,450 this month". The Home shortfall becomes ¥30,000 (D1) and Plan's room line falls from ¥92,220 to ¥81,000 (the bill now counts); the other category rows do not move.
- M3. On To check, Add a bill or charge → Card charge: "Minato Fresh Market" ¥2,000 on Card B → the form pre-selects Food; choose Mixed and 25 → Plan's Food row becomes ¥12,700 (business ¥500 · personal ¥12,200), its items list shows the new charge with "25% business", and Card B owed now rises to ¥63,000.
- M4. Add a bill named "Zebra Supplies" (the table does not know it) → no category is pre-selected and the form will not submit without one. Needs the Anthropic settings: "add a bill for the vet, ¥4,000" → the To check row shows a category and a share, and the answer says whether the category was guessed.
- M5. At 375px each category row is at least 44px tall and opens and closes with a tap; nothing scrolls sideways; light and dark both read clearly.
