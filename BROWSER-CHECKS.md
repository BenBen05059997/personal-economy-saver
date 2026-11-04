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
- A2. Try it → Home in ≤ 1.5 s with the expected sentence and numbers above, and under the sentence the quiet line "A fictional household that lives in this browser. Start with my numbers ›" (a link to `/start`). A signed-in account never shows that line.
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
- C3. Add a bill with Repeat set to Every month → Coming up shows "Every month"; Settings lists it.
- C4. Card charge ¥3,800 on Card B (merchant "Noodle shop", category Food, Personal) → Card B owed now rises to ¥64,800 and limit left falls to ¥235,200; the sentence and the low point do not move (Card B is billed after the window).
- C0. The + Add menu lists, in this order, Add a bill, Add a card charge, Forward a bill, Upload a receipt, New invoice. From Home, "Add a bill" opens the "Add a bill or charge" form on the Bill tab and "Add a card charge" on the Card charge tab. From another page (Plan, Cards) the same items go to Home and the form is already open on the right tab and scrolled into view when Home appears.
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

- G0. A household with no sent invoice (a blank start with only a bill) reads on Plan "No client payments are expected in the next 30 days, so the plan counts your bank balance only." in place of "The next 30 days leave … if clients pay as usual."; Ben keeps "The next 30 days leave about ¥92,220 if clients pay as usual."
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

- K0. Opening Ask puts the cursor in the question box. On desktop the bar ends in an "Ask" button label, so it reads as a button; click it, or Tab to it and type a letter (say "w"): the box opens with that letter already typed and the cursor after it. Space and Enter on the bar still just open it; Ctrl/Cmd shortcuts do nothing.
- K1. Without the Anthropic settings, Ask shows "Ask isn't set up on this server yet (ANTHROPIC_TEXT_MODEL is not set)." and nothing breaks.
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

- M1. Plan shows "Where the month goes · November" and the line "Business ¥32,830 of ¥152,230 this month" (a household with no business share this month reads "All personal this month" instead), then these rows in this order (each has a dark › chevron that turns down when the row opens to its items):

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

## N. Start blank

A person with their own numbers, not Ben's. Use a private window (no household cookie), open `/`. Demo date Nov 14. Run N1 to N8 in order; the Try it numbers above are never touched by this section.

- N1. The landing offers Try it and, beside it, "Start with my numbers" (a link), then "Sign in with email". At 375px they wrap without overlap and each is at least 44px tall.
- N2. "Start with my numbers" → `/start`, headed "Start with my numbers", with the fields Your display name, Home currency, Time zone (Asia/Tokyo), Current bank balance, Card label, Closing day, Payment day, Credit limit (optional) and the button "Open my household". The name field says "Your name. It is also the household's name until you change it in Settings."; the bank balance box shows ¥ in front and the placeholder 420,000, and both change to $ and 2,800 when you pick US dollars; Closing day says "The day your card statement closes, like 15" and Payment day "The day that statement is paid, like 10 of the next month". Submitting with a closing day of 40 stays on the page and shows "Check your name, timezone, balance and card settings." (the field also refuses it before posting).
- N3. Enter Mika, Japanese yen, bank balance 120,000, card "Card N", closing day 25, payment day 10, no limit → Open my household → Home in ≤ 1.5 s. The sentence reads exactly "Add your rent, your bills and the clients who pay you to see your next 30 days. Bank balance ¥120,000." (the second sentence is the emphasis); it never says "You're fine" and has no red shortfall. Under it: "A fictional household that lives in this browser. Start with my numbers ›". Safe to spend ¥120,000; the Next 30 days chart is flat at ¥120,000.
- N4. Under the sentence: First steps · 3 to go, three rows each with an empty circle and a link: "Add a bill" (Rent, phone, a subscription), "Add a client who pays you" (So late payments show up in the sentence), "Add a card charge" (Spend the card has not billed yet). The panel sits above To check (on a phone, directly under the runway panel and above Cards). Empty panels say what to do next: To check "Nothing to check. Forward a bill or upload a receipt ›", Coming up "Nothing due yet. Add your rent ›", Cards shows "Card N ¥0 owed now · No statement due". No Shared costs panel (one person).
- N5. "Add a bill" (and "Add your rent ›") opens the "Add a bill or charge" form on the Bill tab and scrolls to it; "Add a card charge" opens it on the Card charge tab; "Add a client who pays you" opens Clients.
- N6. Add "Rent" ¥60,000 due Nov 27 (category Housing) → Home reads "You're fine for the next 30 days. Lowest point ¥60,000 on the 27th." (no clients or invoices exist, so it does not say "even if clients pay late"; Ben, who has invoices, still reads "…, even if clients pay late.") Safe to spend ¥60,000. First steps · 2 to go: the first row now shows a green tick and "Bill added" (no link); the other two are still open. Coming up lists Nov 27 Rent ¥60,000 ✓.
- N7. Add a client (Clients) and a card charge (Home) → the tick for each appears and the count falls to "First steps · 1 to go", then the panel is gone from Home once all three exist (the Try it household never shows it). A pending bill (To check) counts as a bill for the step, but not for the sentence: with only a pending bill the sentence is still the empty one.
- N8. Start with my numbers always makes a new blank household and replaces a Try it one. With a Try it household open, `/start` is offered (the landing is not shown, so open the address directly, or use Settings → "Start over with my numbers ›") and the form has this line above it: "This replaces the Try it household in this browser. Reset in Settings brings Ben's numbers back." Submit N3's numbers → Home is blank as in N3 (not Ben's), and going Back to the old household's pages shows the landing or the new blank household, never Ben's. In a private window (no cookie) the same page has no such line. Settings on any Try it or blank household shows, beside "Reset to Ben's starting numbers", the line "Start over with my numbers ›" (at least 44px tall at 375px); Reset still means Ben's numbers: after it Home reads "…¥18,780 short on the 27th." with no First steps panel. A signed-in person never reaches `/start` (it sends them to `/account`). Signing in by email from a blank demo upgrades it like any Try it household (A5). At 375px and 1440px: nothing scrolls sideways, the First steps rows are at least 44px tall, light and dark both read clearly, no console errors.
- N9. Words with help. Add a bill form: under the Repeat select it says "Counted once, on the due date" for One-off, "Repeats every month on the due date's day" for Every month and "Repeats every year on the due date's month and day" for Every year. The ✓ marks on Coming up rows, Home's and Cards' "Covered ✓" carry a hover/screen-reader text beginning "Covered:" (a bill row: balance stays above zero that day even if clients pay late; a card: the statement can be paid on its due date from the bank or from client payments due by then). Settings → Reset shows "Puts Ben's fictional starting numbers back." and "Start over with my numbers ›" shows "Replaces this household with a blank one and your own numbers." New invoice: under Amount (USD) "Invoices are always in US dollars. Home shows what they are worth in your own currency." A client's page ends with "New invoice for this client ›", which opens New invoice with that client chosen. At 375px, open the bill form on Home and scroll to the bottom: the Add bill button is fully above the Ask bar.

## O. Yearly bills, amount changes, cancel by

A blank household, so the Try it numbers never move: private window, `/start`, the numbers of N3 (Mika, ¥120,000, Card N, closing day 25, payment day 10). Demo date Nov 14. Run O1 to O6 in order. Nothing here cancels, moves or pays anything.

- O1. Add a bill form on Home: the Repeat select has One-off (selected), Every month and Every year; the old "Every month, on this day" checkbox is gone. "More ›" is a closed disclosure under it; opening it shows "Changes to (JPY)", "from" (a date) and "Cancel by" (a date) with a line under each pair saying what it does. Add "Fictional Cloud", ¥12,000, Due Dec 1 2026, Repeat Every year, More › Changes to 13,000 from Dec 1 2027, Cancel by Nov 20 2026, category Subscriptions, Personal → Add bill → the form comes back closed and empty.
- O2. Home reads "You're fine for the next 30 days. Lowest point ¥108,000 on the 1st." Coming up has two rows in date order: **Nov 20** "Cancel Fictional Cloud by Nov 20 or it renews at ¥12,000 on Dec 1" with the line "Subscriptions · reminder only" under it and no amount or tick; then **Dec 1** "Fictional Cloud" with the line "Yearly" and "¥12,000 ✓". At 375px both rows wrap without overlap and nothing scrolls sideways; light and dark read clearly.
- O3. Activity's newest row is "Fictional Cloud added, due Dec 1" with the line "Every year · Changes to ¥13,000 from Dec 1, 2027 · Cancel by Nov 20", amount ¥12,000, type Bill added.
- O4. An amount that changes. Add "Fictional Gym", ¥5,000, Due Aug 14 2026, Repeat Every month, More › Changes to 6,000 from Sep 1 2026, category Subscriptions → Coming up gains **Nov 14** "Fictional Gym" with the line "Every month" and "¥6,000 ✓" (the November occurrence is on or after Sep 1, so it has the new amount, not ¥5,000); Plan's "Where the month goes · November" shows "All personal this month" and one row "Subscriptions ¥6,000" whose item is "Fictional Gym Nov 14 ¥6,000" (Fictional Cloud is not in November: it is due in December).
- O5. Refusals, each shown under the form with what was typed kept and nothing saved (try each on the Add bill form; Due is Nov 20 2026 unless it says otherwise): Repeat Every year with Changes to 13,000 and no date → "Give the new amount together with the date it starts"; Changes to 13,000 from Dec 1 2027 with Repeat One-off → "A new amount needs a bill that repeats: choose Every month or Every year"; Every year, Changes to 13,000 from Nov 20 2026 → "The new amount must start after the due date"; Every year, Cancel by Nov 21 2026 → "Choose a cancel-by date before the bill is next charged on Nov 20"; Cancel by a date more than two years away (the date picker stops at Nov 14 2028; a typed date past it) → "Choose a date within the next two years"; Changes to 100,000,001 from Nov 21 2026 with Every year → "Enter an amount up to ¥100,000,000".
- O6. Removing Fictional Cloud in Settings asks first and says "It repeats every year, so every year goes."; after Remove, Coming up loses both of its rows and Activity says "Removed bill Fictional Cloud ¥12,000" with "Every year, so every occurrence is gone". Needs settings: Upload or forward a bill → the review card has the same Repeat select and More › (Changes to, from, Cancel by) and refuses the same schedules with the same words; "add Fictional Cloud, ¥12,000 a year on Dec 1, cancel by Nov 20" typed into Ask leaves a To check row whose second line ends "· due Dec 1 · every year · cancel by Nov 20", and the cancel-by row appears in Coming up only after Confirm.


## P. Privacy

No sign-in needed; open it in a private window and again signed in.

- P1. `/privacy` opens without a household cookie, headed "Privacy", with "Last updated Nov 4, 2026." under it and the sections What is stored, Where, Who processes it (Supabase, Cloudflare, Anthropic, PayPal), Clients’ details, Try it and Start with my numbers (mentions "seven days"), How long, and how to delete, and Contact. It is about 450 words, with a "‹ Home" link at the top.
- P2. The page is linked from the landing (a small "Privacy" link under "Sign in with email"), from `/start` ("Your numbers stay in this browser’s demo household. Privacy ›" under the button), from Settings → Account ("Privacy ›" beside Open account) and from the account page (above Delete household for a signed-in person; beside Sign in for a Try it household).
- P3. At 375px and 1440px every one of those links is at least 44px tall, nothing scrolls sideways, and light and dark both read clearly.

## Q. Traceable drafts, client pace, the nudge rule

A fresh Try it household (Ben). Demo date Nov 14. Q3 and Q4 need the daily job, which a demo household never runs from the browser; they are covered by `npm run db:cron-test` and by Q5 once deployed.

- Q1. Invoice review shows the client's pace. Home's action opens the Beacon Studio invoice (E1): under the amount a row reads "Beacon Studio usually pays 2 days after you send, slowest 3". Open Northwind's sent invoice from Clients: "Northwind usually pays 12 days after you send, slowest 16"; Acme Corp's: "14 days … slowest 25". A client with no paid invoice shows no such row. The Clients panel's "Time to pay" row says the same numbers ("12 days usual · 16 slowest" for Northwind). At 375px the row wraps without overlap.
- Q2. Settings → "Late-client nudge" shows the field "Suggest a nudge when a client is N days past due (1–60, empty = off)", empty, with the line "It only suggests. Sending a reminder still needs your tap." Save 5 → "Settings saved", the field keeps 5 after a reload and Activity's newest row is "Nudge suggestions on, 5 days past due" (Type: Settings changed). Save 0 or 61 → the form refuses it and nothing changes. Save it empty → Activity says "Nudge suggestions turned off". The Save button is at least 44px tall at 375px.
- Q3. Needs the daily job (deployed Cron Trigger, or `npm run db:cron-test` here). With the rule at 2 days and a sent invoice whose due date was 2 or more days ago, Activity gains one row "Nudge Northwind: 2 days past due", Type "Nudge suggested", and the bell counts it. It never appears twice for the same invoice, never for an invoice that already has a reminder, and nothing is sent to PayPal.
- Q4. Needs the daily job and a sent invoice linked to PayPal. Home's one action then reads "Nudge Northwind $800" (the first name and the amount) in place of the usual action and opens the invoice review with "Approve reminder"; PayPal is called only after that tap (E4). Once the reminder is sent, or the rule is turned off, Home's action goes back to what it was.
- Q5. Needs the Anthropic settings (K3) or an MCP client (I5). A bill, charge, pot or bank balance the agent drafts waits in To check with a small muted "· Drafted by Ask" after its title (through MCP: "· Drafted through MCP"); Activity's "Waiting in To check" row for it says the same. A bill typed in or read from a document has no such words. After Confirm the row leaves To check and nothing else on screen changes.
