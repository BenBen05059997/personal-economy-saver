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
- C2. Add a bill: type the name "Fictional power" → open More › → the Category select shows Utilities with "Guessed from the name, change if wrong" under it; type "Zebra Supplies" instead → it shows Other with the same hint (the form still submits). Under "For work?" choose Personal / Work / Part work (Part work asks "How much of it is work (%)"). Add a bill (¥5,000, due Nov 25, category Other, Personal) → it appears in Coming up and the shortfall moves from ¥18,780 to ¥23,780. Later checks assume it is not there: start a fresh household, or add ¥5,000 to the shortfalls below.
- C3. Add a bill with Repeats set to "Every month on the 25th" (under More ›; the day follows the due date) → Coming up shows "Every month"; Settings lists it.
- C4. Card charge ¥3,800 on Card B (merchant "Noodle shop", category Food, Personal) → Card B owed now rises to ¥64,800 and limit left falls to ¥235,200; the sentence and the low point do not move (Card B is billed after the window).
- C0. The + Add menu lists, in this order, Add a bill, Add a card charge, Forward a bill, Upload a receipt, New invoice. From Home, "Add a bill" opens the "Add a bill or charge" form on the Bill tab and "Add a card charge" on the Card charge tab. From another page (Plan, Cards) the same items go to Home and the form is already open on the right tab and scrolled into view when Home appears.
- C5. Add a client → it appears on Clients and in the new-invoice list.
- C6. A form that is refused shows the route's message under the form, keeps what was typed, and saves nothing; the page does not leave. Bill amount 0 → "The amount must be more than zero"; a pot with 101% → "Enter a share between 0.01 and 100 percent, such as 25"; an invoice draft amount 0 → "The amount must be more than zero"; a client with a bad email stops at the browser's own message. Editing any field clears the message (also when the browser's own validation then blocks the next send). Correct the field and send again → it goes through. Without JavaScript the same forms still post and answer with the route's text.
- C7. Amounts and dates have limits. "1,000" and "1,000.50" (and full-width １，０００) are taken as 1000 and 1000.50 in every amount box (a bill, a charge, an invoice, the bank balance, a pot). ¥100,000,001 (or $1,000,001) → "Enter an amount up to ¥100,000,000" (or "$1,000,000"). A bill or charge dated more than two years after Nov 14, 2026 (Nov 15, 2028) → "Choose a date within the next two years"; Nov 14, 2028 is accepted and Activity reads "… added, due Nov 14, 2028".
- C8. Remove. Settings → Bills (Ben alone: each bill has Remove; with two people, open the bill and use Remove): Remove on a bill asks "Remove Rent ¥82,000? It repeats every month, so every month goes." with Keep and Remove; Keep closes the question and changes nothing; Remove takes the bill (all its months) off Coming up and the runway, and Activity says "Removed bill Rent ¥82,000". Cards → Card A → Recent charges: Remove on "Yamabiko Outdoor ¥6,400" asks first, then Card A's owed now falls from ¥86,450 to ¥80,050 and Activity says "Removed charge Yamabiko Outdoor ¥6,400". Start a fresh household afterwards.

## D. To check

- D1. The Hikari Denki row reads "Utilities · 30% business · due Nov 27". Confirm it → it leaves To check, Coming up shows it as a bill, the shortfall becomes ¥30,000 on the 27th, and the To check count drops to 0. Nov 27 now has two rows (Hikari Denki and Rent); only the last of them reads "Short by ¥30,000 if clients pay late", the other shows neither that nor a Covered tick.
- D2. Needs the AI settings: an item the agent drafted (a bill, charge, bank balance or pot) waits here with its details and changes nothing until Confirm.

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
- H5. Mark settled → "Nobody owes anyone anything" while a shared bill is still coming up, otherwise "All settled. New shared items split from here."; a household with no shared item reads "Choose Shared on a bill or charge to split it by shares."; Activity: "Wife paid Ben ¥9,000", "settled through Nov 14"; the sentence does not move.
- H6. A shared item dated before the day Aki joined does not count.
- H7. Settings → Shared & personal bills: a bill with no owner reads "Shared"; its payer choice "Nobody (not split by shares)" leaves it out of who owes whom.

## I. Settings

- I1. Household name and bank balance save and stay after a reload; the bank balance shows on Home.
- I2. Add a card, edit a card's closing and due days → Home's card rows follow. Change Card A's closing day from 31 to 10 → Card A still reads ¥86,450 owed now and ¥413,550 limit left, the sentence and safe to spend do not move, and Coming up gains no new row inside 30 days (the Nov 4 and Nov 9 charges, ¥22,050, are a statement due Dec 26). Set it back to 31.
- I3. Export my data → a file `personal-economy-saver-2026-11-14.json` downloads; it opens as JSON with the household, cards, bills, clients and events, and no AI key, tokens, sign-in email or uploaded files (clients' billing emails are the household's own data and belong in it).
- I4. Settings → Your AI model: Provider (This app's default, Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, Other), Model for questions, "Use the same model for documents", Key ("Only the last four characters are shown again.") and "Save and check". On a Try it household, Other is disabled and the sign-in sentence ("A custom address needs an account. Sign in from Settings → Account.") shows. Under the form: "Your questions and documents go to {host}." and either "Tested" or "Custom, untested · passed {n} of 3 checks on {date}" with each failed check in words. A saved key shows only its last four characters, and "Use this app's default" clears the model and the key. (Saving needs a working model and key, so the full run is with the owner's key.)
- I5. Needs `MCP_TOKEN_KEY`: Connect another AI assistant → Create key → the key is shown once (the endpoint and "bearer token" sit under For developers); an MCP client can call `where_am_i` and `who_owes_whom`, and `draft_invoice` opens as a draft in the app.
- I6. Settings → Account → Reset to Ben's starting numbers asks "Everything you added goes. Reset?"; Keep changes nothing; Reset returns to Home with Ben's expected numbers.
- I7. Needs a signed-in account: Delete my data → everything is gone, including uploaded files.

## J. Upload and forwarded email

- J1. Upload accepts JPEG, PNG, WebP and PDF up to 6 MiB, and refuses other files with a message on the Upload page (never a bare text page).
- J2. Needs the AI settings: upload `samples/bills/kokuho-2026-nouhusho.png` → "Document ready to read" at once → a To check row in ≤ 30 s → confirm → safe to spend changes.
- J3. Needs Email Routing: forward a mail with the PDF attached → the same as J2.

## K. Ask

Ask is the page `/canvas` (sidebar label "Ask"). The top bar's Ask box is a link to `/canvas#ask`; there is no popover.

- K0. The top bar's Ask box (a link, "Ask or say: …" and an "Ask" label on desktop) opens the Ask page with the cursor in the question box. Tab to the bar and type a letter (say "w"): the page opens with that letter already typed and the cursor after it (the letter travels in the browser's session storage, never in the address). Space, Enter and Ctrl/Cmd shortcuts just open the page. On a phone the Ask row under the top bar does the same. Opening `/canvas#ask` puts the cursor in the box.
- K1. Without the AI settings, Ask shows "Ask isn’t available on this server yet (AI_TEXT_MODEL)." and nothing breaks.
- K2. Enter sends; Shift+Enter adds a line; Japanese input (IME) does not send mid-word.
- K3. Needs the AI settings: "can I afford ¥4,000 tonight", "what's due", "where am I", "who owes whom" and one free-form question each get one or two sentences in ≤ 8 s, with numbers equal to Home's, and "Based on:" links to the pages they came from.
- K4. Needs the AI settings: "I paid ¥3,800 at the noodle place on Card B" → a pending charge in To check; confirming it matches C4.
- K5. Voice, in your own Chrome or Safari with a microphone (the desktop app's browser pane blocks it):
  - Open Ask → Use microphone → the browser asks for the microphone once; allow it. The button reads "Stop listening".
  - Say "What's due this week?" → the button returns to "Use microphone", the words appear in the Ask box, and nothing is sent until Enter or Ask.
  - With the browser set to Japanese, say 「今週の支払いは？」 → the Japanese words appear in the box.
  - Stop listening part-way, or leave the page → listening stops and nothing is sent.
  - Block the microphone and try again → "Speech wasn’t captured. Try again or type below.", and typing still works.
  - In Firefox → "This browser doesn't offer speech recognition. Type your question below."
  - Needs the AI settings: a spoken "I paid ¥3,800 at the noodle place on Card B", then Ask → the same pending charge as K4.

## L. Every screen, both widths, light and dark

Home, To check, Activity, Cards, Clients, Plan, Options, Settings, Upload, New invoice, Invoice review, Login:

- L1. Nothing scrolls sideways; no text is cut off or overlaps; long names wrap.
- L2. On a phone, every link, button, input and summary row is about 44px tall to tap (measure the box, or its `::after` hit area), and the Ask row never covers the last row. This includes the client links in Home's sentence and in Coming up, the "Later in the month" summary, and Settings' "Allow invoice drafts" checkbox.
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
- M3. On To check, Add a bill or charge → Card charge: "Minato Fresh Market" ¥2,000 on Card B → under More › the form pre-selects Food; choose Part work and 25 → Plan's Food row becomes ¥12,700 (business ¥500 · personal ¥12,200), its items list shows the new charge with "25% business", and Card B owed now rises to ¥63,000.
- M4. Add a bill named "Zebra Supplies" (the table does not know it) → no category is pre-selected and the form will not submit without one. Needs the AI settings: "add a bill for the vet, ¥4,000" → the To check row shows a category and a share, and the answer says whether the category was guessed.
- M5. At 375px each category row is at least 44px tall and opens and closes with a tap; nothing scrolls sideways; light and dark both read clearly.

## N. Start blank

A person with their own numbers, not Ben's. Use a private window (no household cookie), open `/`. The date on Home is the real date in the browser's time zone (only Try it is Nov 14). Run N1 to N8 in order; the Try it numbers above are never touched by this section.

- N1. The landing offers Try it and, beside it, "Start with my numbers" (a link), then "Sign in with email". At 375px they wrap without overlap and each is at least 44px tall.
- N2. "Start with my numbers" → `/start`, headed "Start with my numbers", with two fields, Your name and "What's in your bank today?" (the box shows ¥ in front and the placeholder 420,000), the line "Japanese yen · Asia/Tokyo · Change" and the link "Add a card now ›", and the button "Open my household". Change opens Home currency and Time zone (prefilled from the browser; the ¥ becomes $ and the placeholder 2,800 when you pick US dollars); "Add a card now ›" opens Card name, Statement closes on the, Card bill is paid on the and Credit limit (optional). Opening the card block and giving a name but no days stays on the page and shows "Check your name, timezone, balance and card settings." (a closing day of 40 is refused the same way).
- N3. Enter Mika, bank balance 120,000, open "Add a card now ›" and give "Card N", closing day 25, payment day 10, no limit → Open my household → Home in ≤ 1.5 s. The sentence reads exactly "Add your rent, your bills and the clients who pay you to see your next 30 days. Bank balance ¥120,000." (the second sentence is the emphasis); it never says "You're fine" and has no red shortfall. Under it: "A fictional household that lives in this browser. Start with my numbers ›". Safe to spend ¥120,000; the Next 30 days chart is flat at ¥120,000.
- N4. Under the sentence: First steps · 4 to go, with one open step: "Add your rent, so the day it leaves shows up" (the other steps appear one at a time as each is done). The panel sits above To check (on a phone, directly under the runway panel and above Cards). Empty panels say what to do next: To check "Nothing to check. Forward a bill or upload a receipt ›", Coming up "Nothing due yet. Add your rent ›", Cards shows "Card N ¥0 owed now · No statement due". No Shared costs panel (one person).
- N5. The rent step (and "Add your rent ›") opens the "Add a bill or charge" form on the Bill tab and scrolls to it; the charge step opens it on the Card charge tab; the client step opens Clients.
- N6. Add "Rent" ¥60,000 due Nov 27 (category Housing) → Home reads "You're fine for the next 30 days. Lowest point ¥60,000 on the 27th." (no clients or invoices exist, so it does not say "even if clients pay late"; Ben, who has invoices, still reads "…, even if clients pay late.") Safe to spend ¥60,000. First steps · 3 to go: a ticked line "Bill added" (no link), then the one open step "Add a client who pays you, so late payments show in the sentence". Coming up lists Nov 27 Rent ¥60,000 ✓.
- N7. Add a client (Clients) and a card charge (Home) → each becomes a ticked line and the next step opens ("Add a card charge, so unbilled spend counts", then "Share costs with someone", which opens Settings → People), and the panel is gone once all four are done (the Try it household never shows it). A pending bill (To check) counts as a bill for the step, but not for the sentence: with only a pending bill the sentence is still the empty one.
- N8. Start with my numbers always makes a new blank household and replaces a Try it one. With a Try it household open, `/start` is offered (the landing is not shown, so open the address directly, or use Settings → "Start over with my numbers ›") and the form has this line above it: "This replaces the Try it household in this browser. Reset in Settings brings Ben's numbers back." If the browser holds a blank household instead, the line reads "This replaces your household in this browser and its numbers." Submit N3's numbers → Home is blank as in N3 (not Ben's), and going Back to the old household's pages shows the landing or the new blank household, never Ben's. In a private window (no cookie) the same page has no such line. Settings on any Try it or blank household shows, beside "Reset to Ben's starting numbers", the line "Start over with my numbers ›" (at least 44px tall at 375px); Reset still means Ben's numbers: after it Home reads "…¥18,780 short on the 27th." with no First steps panel. A signed-in person never reaches `/start` (it sends them to `/account`). Signing in by email from a blank demo upgrades it like any Try it household (A5). At 375px and 1440px: nothing scrolls sideways, the First steps rows are at least 44px tall, light and dark both read clearly, no console errors.
- N9. Words with help. Add a bill form: under the Repeats select (under More ›) it says "Counted once, on the due date" for One-off, "Repeats every month on the due date's day" for Every month and "Repeats every year on the due date's month and day" for Every year. The ✓ marks on Coming up rows, Home's and Cards' "Covered ✓" carry a hover/screen-reader text beginning "Covered:" (a bill row: balance stays above zero that day even if clients pay late; a card: the statement can be paid on its due date from the bank or from client payments due by then). Settings → Reset shows "Puts Ben's fictional starting numbers back." and "Start over with my numbers ›" shows "Replaces this household with a blank one and your own numbers." New invoice: under Amount (with a $ inside the field) "Invoices are always in US dollars. Home shows what they are worth in your own currency." A client's page ends with "New invoice for this client ›", which opens New invoice with that client chosen. At 375px, open the bill form on Home and scroll to the bottom: the Add bill button is fully above the Ask bar.

## O. Yearly bills, amount changes, cancel by

A blank household, so the Try it numbers never move: private window, `/start`, the numbers of N3 (Mika, ¥120,000, Card N, closing day 25, payment day 10). Demo date Nov 14. Run O1 to O6 in order. Nothing here cancels, moves or pays anything.

- O1. Add a bill form on Home: the form shows Name, Amount (¥ inside the field) and Due date with Add bill right under them; "More ›" is a closed disclosure under the button; opening it shows Repeats (One-off selected, or Every month on the 25th / Every year on Nov 25 once a due date is chosen), "Changes to", "from" (a date) and "Last day to cancel" (a date) with a line under each pair saying what it does, then Category and "For work?". Add "Fictional Cloud", ¥12,000, Due Dec 1 2026, Repeats Every year, More › Changes to 13,000 from Dec 1 2027, Last day to cancel Nov 20 2026, category Subscriptions, Personal → Add bill → the form comes back closed and empty.
- O2. Home reads "You're fine for the next 30 days. Lowest point ¥108,000 on the 1st." Coming up has two rows in date order: **Nov 20** "Cancel Fictional Cloud by Nov 20 or it renews at ¥12,000 on Dec 1" with the line "Subscriptions · reminder only" under it and no amount or tick; then **Dec 1** "Fictional Cloud" with the line "Yearly" and "¥12,000 ✓". At 375px both rows wrap without overlap and nothing scrolls sideways; light and dark read clearly.
- O3. Activity's newest row is "Fictional Cloud added, due Dec 1" with the line "Every year · Changes to ¥13,000 from Dec 1, 2027 · Cancel by Nov 20", amount ¥12,000, type Bill added.
- O4. An amount that changes. Add "Fictional Gym", ¥5,000, Due Aug 14 2026, Repeat Every month, More › Changes to 6,000 from Sep 1 2026, category Subscriptions → Coming up gains **Nov 14** "Fictional Gym" with the line "Every month" and "¥6,000 ✓" (the November occurrence is on or after Sep 1, so it has the new amount, not ¥5,000); Plan's "Where the month goes · November" shows "All personal this month" and one row "Subscriptions ¥6,000" whose item is "Fictional Gym Nov 14 ¥6,000" (Fictional Cloud is not in November: it is due in December).
- O5. Refusals, each shown under the form with what was typed kept and nothing saved (try each on the Add bill form; Due is Nov 20 2026 unless it says otherwise): Repeats Every year with Changes to 13,000 and no date → "Give the new amount together with the date it starts"; Changes to 13,000 from Dec 1 2027 with Repeats One-off → "A new amount needs a bill that repeats: choose Every month or Every year"; Every year, Changes to 13,000 from Nov 20 2026 → "The new amount must start after the due date"; Every year, Last day to cancel Nov 21 2026 → "Choose a cancel-by date before the bill is next charged on Nov 20"; Cancel by a date more than two years away (the date picker stops at Nov 14 2028; a typed date past it) → "Choose a date within the next two years"; Changes to 100,000,001 from Nov 21 2026 with Every year → "Enter an amount up to ¥100,000,000".
- O6. Removing Fictional Cloud in Settings asks first and says "It repeats every year, so every year goes."; after Remove, Coming up loses both of its rows and Activity says "Removed bill Fictional Cloud ¥12,000" with "Every year, so every occurrence is gone". Needs settings: Upload or forward a bill → the review card has the same Repeats select and More › (Changes to, from, Last day to cancel) and refuses the same schedules with the same words; "add Fictional Cloud, ¥12,000 a year on Dec 1, cancel by Nov 20" typed into Ask leaves a To check row whose second line ends "· due Dec 1 · every year · cancel by Nov 20", and the cancel-by row appears in Coming up only after Confirm.


## P. Privacy

No sign-in needed; open it in a private window and again signed in.

- P1. `/privacy` opens without a household cookie, headed "Privacy", with "Last updated Nov 4, 2026." under it and the sections What is stored, Where, Who processes it (Supabase, Cloudflare, the AI model provider, PayPal), where the provider line names this server's host ("By default, questions and documents go to {host}.", or "This server has no AI model set up.") and says a model chosen in Settings sends them to the host shown there, Clients’ details, Try it and Start with my numbers (mentions "seven days"), How long, and how to delete, and Contact. It is about 450 words, with a "‹ Home" link at the top.
- P2. The page is linked from the landing (a small "Privacy" link under "Sign in with email"), from `/start` ("Your numbers stay in this browser’s demo household. Privacy ›" under the button), from Settings → Account ("Privacy ›" beside Open account) and from the account page (above Delete household for a signed-in person; beside Sign in for a Try it household).
- P3. At 375px and 1440px every one of those links is at least 44px tall, nothing scrolls sideways, and light and dark both read clearly.

## Q. Traceable drafts, client pace, the nudge rule

A fresh Try it household (Ben). Demo date Nov 14. Q3 and Q4 need the daily job, which a demo household never runs from the browser; they are covered by `npm run db:cron-test` and by Q5 once deployed.

- Q1. Invoice review shows the client's pace. Home's action opens the Beacon Studio invoice (E1): under the amount a row reads "Beacon Studio usually pays 2 days after you send, slowest 3". Open Northwind's sent invoice from Clients: "Northwind usually pays 12 days after you send, slowest 16"; Acme Corp's: "14 days … slowest 25". A client with no paid invoice shows no such row. The Clients panel's "Time to pay" row says the same numbers ("12 days usual · 16 slowest" for Northwind). At 375px the row wraps without overlap.
- Q2. Settings → "Late-client nudge" shows the field "Suggest a nudge when a client is N days past due (1–60, empty = off)", empty, with the line "It only suggests. Sending a reminder still needs your tap." Save 5 → "Settings saved", the field keeps 5 after a reload and Activity's newest row is "Nudge suggestions on, 5 days past due" (Type: Settings changed). Save 0 or 61 → the form refuses it and nothing changes. Save it empty → Activity says "Nudge suggestions turned off". The Save button is at least 44px tall at 375px.
- Q3. Needs the daily job (deployed Cron Trigger, or `npm run db:cron-test` here). With the rule at 2 days and a sent invoice whose due date was 2 or more days ago, Activity gains one row "Nudge Northwind: 2 days past due", Type "Nudge suggested", and the bell counts it. It never appears twice for the same invoice, never for an invoice that already has a reminder, and nothing is sent to PayPal.
- Q4. Needs the daily job and a sent invoice linked to PayPal. Home's one action then reads "Nudge Northwind $800" (the first name and the amount) in place of the usual action and opens the invoice review with "Approve reminder"; PayPal is called only after that tap (E4). Once the reminder is sent, or the rule is turned off, Home's action goes back to what it was.
- Q5. Needs the AI settings (K3) or an MCP client (I5). A bill, charge, pot or bank balance the agent drafts waits in To check with a small muted "· Drafted by Ask" after its title (through MCP: "· Drafted through MCP"); Activity's "Waiting in To check" row for it says the same. A bill typed in or read from a document has no such words. After Confirm the row leaves To check and nothing else on screen changes.

## R. The first ten minutes

A private window, no household cookie.

- R-A. The two-field start (D51). `/start` shows Your name and "What's in your bank today?" and the line "<currency> · <your zone> · Change" (Japanese yen · Asia/Tokyo in Tokyo; US dollars and your zone elsewhere); the card is folded under "Add a card now ›". Enter Mika and 250,000 and press Open my household (nothing else) → Home shows today's real date in the date line (not "Sat Nov 14"), "Bank balance ¥250,000.", Cards says "No card yet." and First steps · 5 to go with one open step, "Add your rent, so the day it leaves shows up" (link `/#add-bill`). Add a bill → "Bill added" becomes a ticked line and the open step is "Add a client who pays you, so late payments show in the sentence" (link Clients). With no card, "Add a card, so card bills count" (link Settings → Cards) comes before the card charge step. Settings → "Late-client nudge" shows 3. "Share costs with someone" opens Settings → People. The Shared costs panel is absent until a second person exists. Try it still reads "¥18,780 short on the 27th", date line Nov 14, no First steps. At 375px and 1440px: First steps rows at least 44px tall, nothing scrolls sideways.
- R-A2. Opening the form from a link. On Home, click the open First steps step "Add your rent…", a panel hint "Add a bill ›" or + Add → Add a bill: the "Add a bill or charge" form opens on the Bill tab and scrolls into view, at 1280px and 375px. Click a Coming up bill → Settings opens scrolled to that bill's row; a pot in Activity → Plan scrolled to the pot; a To check row from the bell → To check scrolled to it.
- R-C. Hints and links (D51). On a blank household's Home: Coming up says "Nothing due in the next 30 days. Add a bill ›" (opens the Add bill form); Cards says "No card yet. Add one in Settings ›" (Settings → Cards) or, with a card, "No card charges yet. Add a card charge ›" plus "Change closing day ›"; To check says "Things the app read or drafted, waiting for your OK. Nothing here now." (the To check page says the same); Clients says "No clients yet. Add a client ›" (jumps to the add form). With a second person and a shared bill not yet due, Shared costs says "Rent on Nov 25 splits 50/50 once it is paid."; with none shared, "Mark a bill or charge as shared to split it. Add a bill ›"; "Share costs ›" opens Settings → People. Click a Coming up bill → Settings opens at that bill (its row opens); a statement row → that card's page; a client's payment → the client with "New invoice for this client ›". Click "on the 27th" in the sentence → the chart scrolls into view and a ring shows on that day's point. A To check row opened from Home (`/to-check?from=home`) returns to Home after Confirm; opened from the nav it stays on To check. Activity: a row about an invoice opens `/invoices/<id>`, a bill opens Settings at it, a pot opens Plan at it, a client opens the client; the bell's items open the same places. Try it still reads "¥18,780 short on the 27th". At 375px and 1440px: links at least 44px tall in the panels, nothing scrolls sideways.
### R-B. The add forms
- R-B1. Home → Add a bill or charge → Bill at desktop and 375px: only Name (placeholder "e.g. Rent, Hikari Denki, CloudBox Plus"), Amount (¥ inside the field) and Due date show, with Add bill right under them and a closed "More ›" below it. Type "Rent" → More › shows Repeats "Every month on the 25th" (the day of the due date) and Category Housing with "Guessed from the name, change if wrong"; "Car insurance" → Repeats "Every year on Nov 25", Insurance; "Zebra Supplies" → One-off, Other. "For work?" is Personal · Work · Part work and defaults to Personal; the percent field appears only for Part work. Press Add bill without opening More › → the bill is added with the guessed category and repeat.
- R-B2. Add card charge: What or where, Amount, Date, Add charge, then More › (Category with its hint, For work?). With more than one card the Card select is visible; with one it sits under More ›. With a second person, More › also has "Who is this for?" (Shared by default) and "Who pays it?" (the first person); alone neither exists.
- R-B3. Clients → Add a client: Name, Email, "Days to pay" (30, "0 means due on receipt"). New invoice: Client, What for, Amount ($ inside the field), Review draft, and Note under More ›. Nowhere do "Biller", "Business share", "basis points", "minor" or "occurrence" show.


## S. Family: the month together, shared by link

A Try it household. Settings → People → Add a person "Wife".

- S-A. The month by whose (D52). Plan → Where the month goes shows "Together ¥88,780 · Ben ¥63,450 · Wife ¥0 this month" on top; Housing reads ¥82,000 with "Shared ¥82,000" under it, Food ¥10,700 with "Ben ¥10,700" (no "Shared ¥0"); opening a category marks each item Shared, Ben or Wife. Ben alone (Reset) shows no Together line and no whose lines. At 375px the amount stays on the category's row and nothing scrolls sideways.
- S-B1. Settings → People → Share a family view → Make a link: "Copy this link now. It's shown once." with the link, Copy link, and the LINE message (the sentence, then "See our month: <link> (until Nov 21)" on Try it, seven days after its Nov 14). The list shows "Made Nov 14 · Lasts until Nov 21" with Stop sharing. A sixth live link is refused with "5 family links are already live. Stop sharing one to make another."
- S-B2. Open the link in a private window (no cookie): "Ben · family view", Sat Nov 14, the sentence with Acme and Northwind as plain text, Where the month goes as in S-A, Shared bills coming up (CloudBox Plus Nov 18, Mobaile Tsushin Nov 20, Rent Nov 27 ¥82,000), Who owes whom, and "Nothing can be changed from here." The page has no links, buttons or forms; response headers carry `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`. Stop sharing → the same link shows "This link has ended. Ask for a new one." At 375px nothing scrolls sideways.

## T. Where the money went: search, history, import (D53) and the Nov 5 fixes

A fresh Try it household (today Nov 14). Numbers from the Stage 17 build; walked in the built-in pane after the wording pass.

- T-A. Plan → Where the month goes has "‹ October" (no "›" on the current month). October: heading "Where October went", "‹ September" and "November ›", "Business ¥31,986 of ¥132,060 in October"; Housing ¥82,000, Utilities ¥10,020 (Hikari Denki Oct 25), Phone & internet ¥4,800, Subscriptions ¥1,980, Food ¥11,440 (Kissa Midori Oct 10 ¥1,320, Minato Fresh Market Oct 17 ¥8,640, Kissa Midori Oct 25 ¥1,480), Transport ¥14,340, Other ¥7,480. September totals ¥150,380 (business ¥31,572) with Utilities ¥8,640 and Travel ¥47,000 (Kumokaze Air flight Sep 21 ¥18,400, Hotel Kazemachi Hakone Sep 22 ¥28,600). `?month=2020-01` says "Plan shows the last 12 months, December 2025 to November 2026. Here is November." The current month is unchanged: ¥152,230, business ¥32,830.
- T-B. Search on Plan: the field "Search spending: hotel, food, a shop name" and a Search button on one row at 375px; no Spending panel without a query. "hotel" → `"hotel": ¥28,600 in September (1 item); nothing in the other 11 months. ¥28,600 in all.` with the Hakone row; "travel" → `Travel: ¥47,000 in September (2 items); nothing in the other 11 months. ¥47,000 in all.`; "food" → `Food: ¥10,700 in November (3 items), ¥11,440 in October (3 items), ¥5,960 in September (1 item); nothing in the other 9 months. ¥28,100 in all.` with November's three rows first; "rent" → `"rent": ¥82,000 in October (1 item), ¥82,000 in September (1 item), ¥82,000 in August (1 item); nothing in the other 9 months. ¥246,000 in all.` (Nov 27 is after today); "hikari" → ¥10,020 in October and ¥8,640 in September, ¥18,660 in all; "zzz" → "Nothing matches “zzz” in the last 12 months." Nothing scrolls sideways at 375px.
- T-C. Settings → Import a statement (after Cards): the intro says the file is read on this device; choose Card B and `economy-saver/scripts/fixtures/sample-statement-utf8.csv` → "Read as UTF-8.", the three column selects filled, "7 charges to import · 1 skipped (credits, refunds or no amount) · 1 unreadable", row 10 "The date can't be read as a day", and above the button "Charges after Card B’s last statement (closed Oct 31) count toward what you owe now; older ones are history only." (Card B's owed total on Home rises by the rows after that close); Import 7 charges → "Added 7 charges to Card B. See where the month goes on Plan ›"; the same file again → "Nothing new for Card B (7 already there)."; Activity shows "Imported 7 charges to Card B from a statement". `sample-statement-sjis.csv` → "Read as Shift_JIS, the Japanese encoding most card issuers use.", 2 charges and 1 skipped.
- T-D. Ask (once the AI settings exist): "How much did I spend on hotels in the last three months?" answers ¥28,600 in September through `search_spending`; "Where did October go?" answers through `month_by_category` with "in October".
- T-E. The Nov 5 fixes. Home: Nov 26–27 rows above "Later in the month"; "The lowest your balance gets in the next 30 days, after every bill and card statement, if clients pay late." under Safe to spend; the bill form shows "One-off · Other · Change ›" (typing "Test Gym" → "Every month · Health"); adding Rent ¥60,000 due Nov 27 lands on Coming up with "Added Rent ¥60,000, due Nov 27"; a charge gives "Added Noodle shop ¥3,800 on Card B" and Noodle shop is Food. Invoice review: "PayPal sandbox sends this invoice for $400 to Beacon’s test address. No real money moves."; while sending, the button is disabled and "Sending through PayPal sandbox…" shows. Plan: the room line is followed by what it counts. Settings → Bills: every row shows its amount and has a "▶ Edit" fold (Rent's Edit shows "New amount from" with the first-due-date hint; unticking "Amount changes every month" brings the fields back at once); confirmed one-offs due before today sit under "Past bills (N)" at the bottom; a varying series reads "about ¥6,000 · varies"; "Who pays it?" offers the people then "Nobody (not split by shares)" on both the add form and Edit; Edit also has "Last day to cancel, optional" (Activity: "Last day to cancel Nov 20"); Clients rows with paid history show "Time to pay: 9 days usual · 21 slowest" and Home's nudge action repeats it for its client; a search over 80 characters says "A search is at most 80 characters."; editing Noodle shop to ¥980 Food writes "Amount ¥1,200 → ¥980 · Category Other → Food" in Activity. Settings → People with Wife: "A person can be removed once they owe nobody and nobody owes them."; with a shared bill paid by Wife, Remove says "Settle up with Wife first."; after Mark settled it works and Activity reads "Wife left the household". Account on a cookie household: "Leave this household. It stays on this device for seven days, then it is swept." and the button returns to the landing (a visitor's loading line is "Opening…"; /start mentions bill forwarding only when it is configured). Amount fields accept "12,000円" and "¥12,000"; "$400" in a yen field says "This amount is in yen…". A blank household at 375px: First steps is the first panel, no demo line, no "Forward a bill" anywhere while forwarding isn't configured, Settings says "Email forwarding isn’t available on this server yet (FORWARDING_DOMAIN)." Stop sharing asks "The link stops working for everyone who has it." before stopping, and stopping the link just made clears its "Copy this link now" block; at 375px "Made Nov 14 · Lasts until Nov 21" stays on one line each. Settings → Your AI model says "Ask isn’t available on this server yet (AI_TEXT_MODEL)." while the server has no AI settings; "For developers" folds show a ▶ marker. A bill added for a day inside "Later in the month" stays above the fold on return.

## U. Regular costs and bills whose amount varies (D54)

A fresh Try it household (today Nov 14).

- U-A. Plan → Regular costs (after Where the month goes), before confirming Hikari Denki: "Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far" on top; rows Kissa Midori café Food ¥1,880 so far (Last month ¥2,800 · down ¥920; Sep ¥0 · Oct ¥2,800 · Nov ¥1,880), Minato Fresh Market ¥8,820 so far (up ¥180), Rent ¥82,000 (same), Mobaile Tsushin ¥4,800, CloudBox Plus ¥1,980, and Hikari Denki Utilities "not in yet" (Last month ¥10,020 · usually on the 25th; Sep ¥8,640 · Oct ¥10,020 · Nov not in yet). Up reads in red, down in green, the words carry it too. At 375px each amount stays on its label's line.
- U-B. Confirm Hikari Denki in To check, then Plan: the line starts "Hikari Denki up ¥1,200 · …" and its row reads ¥11,220, Last month ¥10,020 · up ¥1,200, Sep ¥8,640 · Oct ¥10,020 · Nov ¥11,220. The sentence and every Home number are unchanged by the history (¥18,780 short on the 27th before Confirm).
- U-C. Add "Sakura Gas" ¥6,000 due Dec 10, More → Every month, tick "Amount changes every month (electricity, water, gas)": the guess line reads "Every month · varies · Utilities · Change ›" and the Changes to / from fields go away; after saving, Coming up shows Dec 10 Sakura Gas "about ¥6,000".
- U-D. Add one-offs "Sakura Gas 10月分" ¥5,400 due Oct 12 and "Sakura Gas 11月分" ¥6,600 due Nov 12: Activity says "Linked to Sakura Gas: counts toward its estimate" for each; Dec 10 still reads "about ¥6,000". Add a one-off "Sakura Gas" ¥7,100 due Dec 8: "Linked to Sakura Gas: replaces December’s estimate"; Coming up has ¥7,100 once and no "about" row.
- U-E. Settings → Bills → Edit on the Dec 8 bill: "Part of: Sakura Gas (every month)"; None → "No longer part of Sakura Gas" and Dec 10 is "about ¥6,000" again. Choose Sakura Gas again, then edit Sakura Gas and untick varies: "Amount no longer varies · 3 real bills stay as one-offs" (2 if the Dec 8 bill was left unlinked), Dec 10 shows ¥6,000 with no "about". At 375px the checkbox and its hint stack under Repeats.

## V. Missing data: a known bill is never ¥0 (D55)

Each check starts from a fresh Try it household (today Nov 14; Settings → Account → Reset to Ben's starting numbers, or a private window then Try it). Numbers are the engine's, worked out by running `homeSentence`, `timeline`, `openGaps` and `monthByCategory` on Ben's stored bills plus the bill added. Do each at 375px and at 1440px; nothing scrolls sideways and the long estimate words wrap under the name.

- V-A. An unknown amount with history. Home → Add a bill or charge → Bill: Name "Hikari Denki", leave Amount empty and tick "Amount not known yet" under it (the Amount field empties and greys out), Due date Nov 25, More → Category Utilities, Add bill. The estimate comes from the same name's real bills (the Sep ¥8,640 and Oct ¥10,020 one-offs; the pending Nov 27 bill is not real yet), so it is two bills.
  - Before: "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th." After adding: "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥28,800 short on the 27th." (the late case counts the high end, ¥10,020, so ¥18,780 + ¥10,020). No note under the sentence: even the high end does not make the usual case short. Rent's row on Nov 27 reads "Short by ¥28,800 if clients pay late".
  - Coming up: the line "Added Hikari Denki, about ¥9,330 (¥8,640–¥10,020, from your last 2 bills), due Nov 25"; a Nov 25 row "Hikari Denki" with "about ¥9,330 (¥8,640–¥10,020, from your last 2 bills)" in small type under the name and "Enter it ›" where the amount would be. At 375px the words wrap under the name and the right column stays on screen.
  - To check (nav badge, Home panel heading "To check · 2" and the To check page): 2, the pending Hikari Denki ¥11,220 plus this. On /to-check a first section "Missing" has one row: "Hikari Denki, due Nov 25: how much?", under it, muted, "Counted at about ¥9,330 (¥8,640–¥10,020, from your last 2 bills)", no urgent label, then Amount "¥" field and Save (no date field). Home's To check panel shows the same question with "Enter it ›".
  - Plan → Where the month goes: November ¥161,560 in total; Utilities shows Hikari Denki Nov 25 "about ¥9,330".
  - Settings → Bills: the new row reads "Hikari Denki · amount not known" (Settings shows the stored amount, which is empty; the estimate is not shown there); Edit opens with "Amount not known yet" ticked and the amount empty.
  - Enter 11,220 in Missing → Save: the Missing section disappears, the badge is 1, Activity says "Hikari Denki: ¥11,220 (was about ¥9,330)", the sentence reads "… you're ¥30,000 short on the 27th." (¥18,780 + ¥11,220), the Nov 25 row reads ¥11,220 with no "about", month total ¥163,450. Saving an empty Amount shows the browser's "Fill out this field" or the route's "Give the amount or the date".
- V-B. An unknown amount with no history. Add a one-off "Minato Gas" (a name nothing else matches), Amount not known yet ticked, Due date Nov 20, Category Utilities.
  - Home: "Added Minato Gas, amount not known, due Nov 20". The sentence stays "… ¥18,780 short on the 27th." with, under it, one muted line: "Not counted: Minato Gas (amount not known)." The Nov 20 row has "amount not known" under the name and "Enter it ›" at its end.
  - To check: badge 2; Missing → "Minato Gas, due Nov 20: how much?" with a small label "Could change your forecast", muted "Not counted until you enter it".
  - Plan → Where the month goes: on a fresh Try it household Utilities holds only Minato Gas (Ben's pending Hikari Denki ¥11,220 on Nov 27 waits in To check and is not in the month until it is confirmed). Its header therefore reads "amount not known", never ¥0, and it opens to "Minato Gas Nov 20 · amount not known" and a muted line "1 bill not counted: Minato Gas (amount not known)". The November total stays ¥152,230. When a Utilities bill with a known or estimated amount is also in the month (V-A's Hikari Denki, about ¥9,330), the header keeps the counted sum (¥9,330), the list has both rows, and the not-counted line still names Minato Gas.
  - Search "gas" (Plan, even though Nov 20 is after today, Nov 14) shows "Spending", the line `"gas": amount not known in November (1 item); nothing in the other 11 months. 1 bill not counted: Minato Gas (amount not known).`, a November heading with "amount not known" (not ¥0), the group line "Utilities amount not known" and the row "Minato Gas Nov 20 amount not known". It never says "Nothing matches". The family link page shows the same sentence note.
  - Home → Coming up: the Nov 20 Minato Gas row has "Enter it ›" at its end and no ✓; estimated rows (V-A) keep theirs.
  - Ask (needs the AI settings): "Where am I?" answers with the sentence and the note; the `open_gaps` tool lists Minato Gas.
  - Enter 6,800 → Save: the note and the Missing row go, the sentence reads "… ¥25,580 short on the 27th." (¥18,780 + ¥6,800), the month total is ¥159,030, Activity says "Minato Gas: ¥6,800".
- V-C. An unknown date. Add a bill "Minato Water", Amount 6,500, tick "Date not known yet" (the date field empties and greys out), Category Utilities.
  - Home: "Added Minato Water ¥6,500, date not known, counted as due now". The sentence reads "… you're ¥25,280 short on the 27th." (¥18,780 + ¥6,500: an unknown date counts as due today, Nov 14). Coming up has a Nov 14 row "Minato Water" with "date not known, counted as due now" under the name, ¥6,500 and "Enter it ›" below the amount.
  - To check: Missing → "Minato Water, ¥6,500: when is it due?" with the label "Due soon", muted "date not known, counted as due now", a Due date field and Save (no amount field).
  - Choose Nov 30 → Save: the sentence returns to "… ¥18,780 short on the 27th.", Activity says "Minato Water: due Nov 30", the row moves to Nov 30, the Missing section goes. Tick both boxes on a new bill instead: the question reads "Minato Water: how much, and when is it due?" with both fields and one Save; filling only the amount keeps the row with the date question.
- V-D. The form rules and the server's refusals. On the add form: a one-off shows both boxes. More → Repeats Every month hides both boxes; ticking "Amount changes every month (electricity, water, gas)" brings back "Amount not known yet" only; More → Last day to cancel filled hides "Date not known yet"; More → "Changes to, optional" filled hides "Amount not known yet"; emptying them brings the boxes back. Ticking a box then hiding it saves the field as it is shown (empty and required again). In Settings → Bills → Edit on a gap bill the right box is ticked; a repeating bill shows "Amount not known yet" only while "Amount changes every month" is ticked. The guess line "Every month · varies · Utilities · Change ›" still works with the amount not known. Direct posts (no browser): a repeating bill with the amount not known and no "varies" is refused with "A bill that repeats needs its amount, unless the amount changes every month"; with the date not known and Every month "A bill that repeats needs its due date"; with a last day to cancel "A bill with a last day to cancel needs its due date"; filling a bill that has both "This bill has its amount and its date already"; filling someone else's id "Choose a bill of this household".
- V-E. The reader (needs the AI settings). A reading of kind bill shows, under its Amount and Due or charge date, "Amount not known yet" and "Date not known yet"; ticking one disables and clears its field (and, for the amount, the Currency stops being required); a reading of kind charge shows neither. Confirming with the amount ticked saves a bill that appears in Missing.
