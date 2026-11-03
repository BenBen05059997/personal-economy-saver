# Sample bills (demo fixtures)

**Everything here is fictional.** The companies (Hikari Denki 光電気, 架空区役所, Card A / サンプルカード株式会社, Zilker Valley Power), people (Ben Sample, Maya Sample), addresses, account numbers, phone numbers (0120-000-xxx, (512) 555-01xx), barcodes and URLs (`.example` only) are invented. No real logos, trademarks or personal identifiers (D20). Barcodes and the QR-like block are decorative shapes and encode nothing. Each paper bill carries a "SAMPLE / 架空" stamp and footer.

Inbound addresses used in the emails: `ben.bills@in.saver.example` (Ben, the product's one person, D8) and `maya.bills@in.saver.example` (the US-dollar fixture, never shown in the product). Each mail is forwarded by its sample sender.

## Files and expected extraction

| File | What it is | Biller | Amount | Currency | Due date | Period | Category | Recurring | Demo path |
|---|---|---|---|---|---|---|---|---|---|
| `hikari-denki-2026-11.eml` | Japanese electricity bill email forwarded by Ben, with the PDF attached (base64) | Hikari Denki (光電気) | 11,220 (tax incl.; 消費税等 1,020) | JPY | 2026-11-27 | 2026-09-29 to 2026-10-29 (31 days), billed 2026-11-01 | Utilities · Electricity | Recurring (monthly) | Forward-by-email path, bill with amount. Reader also finds usage 412 kWh, previous month 371 kWh / ¥10,020 (the "bill is higher than last month" card: +1,200) |
| `hikari-denki-2026-11.pdf` | Same bill as the paper slip (A4, 1 page, JP font embedded) | same | same | JPY | same | same | same | same | PDF upload path |
| `hikari-denki-2026-11.png` | Same slip rendered as an image (1588x2246) | same | same | JPY | same | same | same | same | Photo-upload path (clean scan) |
| `kokuho-2026-nouhusho.png` | 国民健康保険料 納付書 from fictional 架空区役所, FY令和8 第6期 (of 10) | 架空区役所 国保年金課 (fictional ward, National Health Insurance) | 24,500 (医療分 18,300 + 後期高齢者支援金分 6,200) | JPY | 2026-12-10 | Installment 6 of 10, assessment year 2026-04 to 2027-03 | Insurance · Health (kokuho) | Recurring (10 installments per year) | Photo-upload path with a government payment slip |
| `kokuho-2026-nouhusho.pdf` | Same slip as PDF | same | same | JPY | same | same | same | same | PDF upload path |
| `statement-ready-only.eml` | Card A "ご利用明細のお知らせ" email, **no amount**, only "明細が確定しました" and a link `https://mypage.card-a.example/statements/202611` | Card A (サンプルカード株式会社) | **none in the email** (reader should estimate from last month; Ben's seed has Card A at 58,000) | JPY | 2026-11-26 | Usage 2026-09-16 to 2026-10-15; statement date 2026-11-01 | Card bill | Recurring (monthly) | "Statement ready, amount unknown" path: estimate from last month, ask the user to confirm |
| `austin-power-2026-11.eml` | English electricity bill email forwarded by Maya Sample, PDF attached (base64) | Zilker Valley Power (fictional; the same bill is in `maya.ts`) | 142.00 | USD | 2026-12-03 | 2026-10-10 to 2026-11-10 (32 days), statement 2026-11-12; 864 kWh; previous bill $131.40 | Utilities · Electricity | Recurring (monthly) | US-dollar fixture, forward-by-email path |
| `austin-power-2026-11.pdf` | Same bill as a Letter-size PDF | same | same | USD | same | same | same | same | US PDF upload path |

Notes on consistency:
- Ben's figures match `src/lib/sample/ben.ts`: Hikari Denki ¥11,220 due 2026-11-27, previous ¥10,020; Card A due 2026-11-26.
- The kokuho ¥24,500 and 12/10 date are not in `ben.ts` (it only sets `healthInsurance: "jp_kokuho"`); they are new fixture values.
- `maya.ts` holds the same bill: Zilker Valley Power $142.00 due 2026-12-03, previous $131.40, pending. The statement date (2026-11-12) is just before that fixture's today (2026-11-14).
- Hikari line items (all tax included): 基本料金 1,247; 電力量料金 第1段階 1,800 + 第2段階 3,422 + 第3段階 2,654; 燃料費調整額 659; 再エネ賦課金 1,438 (412 kWh x 3.49). Total 11,220.
- Austin line items: customer charge 12.50, energy 67.39, power supply adjustment 26.78, delivery 18.58, regulatory 2.42, community solar 4.00, city franchise and service fee 10.33. Total 142.00.

## Regenerating

`python3 _make/make_bills.py` (Python 3 standard library only, plus Google Chrome headless for PDF/PNG and a system Japanese font; Hiragino on macOS). Set `CHROME=/path/to/chrome` if Chrome is elsewhere. The intermediate HTML pages are kept in `_make/html/`.
