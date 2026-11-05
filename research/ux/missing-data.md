# Showing missing and uncertain data

A cash forecast has holes: a bill with a date but no amount, an amount with no date, a client with no pay date, a card statement not yet closed. This note collects how products outside finance handle the same problem and distils principles for the forecast.

Evidence grade: the academic papers (Kay 2016, Fernandes 2018, Padilla 2017, van der Bles 2020) are primary. The product behaviour below comes mostly from help pages, forums and secondary write-ups found by search, not from vendors' design docs; where a claim is thin it says so. Items marked "inference" are this note's reading, not a documented fact.

## Patterns by industry

### Airlines and flight trackers
- What it does: keeps two times side by side, the scheduled time (fixed, from the timetable) and an estimated time (a moving projection). Trackers adjust the estimate from air traffic control feedback and observed delays at the airport. Delay is simply estimated minus scheduled.
- How it shows: the scheduled time stays visible, the estimate is a separate field and a status word (on time / delayed / cancelled) is derived from the gap.
- Weakness (documented in user forums): estimates flip back and forth within minutes (on time, delayed, on time), and some data fields keep returning the original time after a delay. A revised number that jitters erodes trust.
- Not confirmed: whether any tracker shows a literal "new time TBD"; the search found no source. The "delayed, no new time yet" state is real in airline practice but not documented here.
- Gap prompt / escalation: none for the user to fill; escalation is the status word changing and push alerts.

### Parcel delivery (Amazon, Yamato, Japan Post)
- What it does: promises a date (Amazon "arriving by"), then replaces it with a new estimate and often a reason when the parcel runs late. Shipping stages (label created, in transit, out for delivery) act as progress markers that make the estimate more or less credible. Estimates can move for benign reasons, and a date may be padded as a buffer.
- How it shows: a date or a window, a status word, and a reason for a delay where known.
- Default / assumption: the original date is a carrier assumption; it is replaced, not hidden, when it breaks.
- Escalation: community guidance (not Amazon's own text) says to wait 48 to 72 hours past the date and then contact support, with no single agreed threshold, i.e. the "when to worry" point is left to the user.
- Not verified: Yamato and Japan Post status wording. The search found only third-party pages; the Japanese carriers' own status definitions (for example absent / re-delivery states) need a direct look at their tracking pages.

### Ride-hailing and map ETAs
- What it does: shows one number that is recomputed constantly.
- Documented problem: a 2019 study of Uber and Google ETAs in Delhi found that constant, jumping ETAs displayed while waiting can increase passenger stress. Errors against actual wait were similar between the two services.
- Research alternative: a patent describes giving the user a distribution instead of a single value. The bus-arrival research below tests exactly that. No official Uber or Google design documentation was found; do not assume either shows ranges in the product.

### Weather
- Probability of precipitation (PoP): described by NWS-derived sources as forecaster confidence multiplied by the share of the area expected to get rain. Hidden factors make it easy to misread: the area share, the "measurable" threshold (0.01 inch) and point-versus-area meaning. A University of Georgia study cited by secondary sources found people, including meteorologists, giving different definitions. Calibration is the real promise: when 70% is forecast, rain should occur about 7 times in 10.
- Hurricane cone: the cone shows where the centre of the storm may track (about two thirds of the time per a University of Miami paper), not how large or severe the storm is. Padilla et al. (2017) found viewers read it as the storm growing in size and intensity, and the hard border as a boundary between safe and unsafe. Ensemble displays (many possible tracks) were misread less in summary judgements but created their own bias: a location on a drawn line looked riskier than one between lines.
- What transfers: a range drawn with a hard edge invites "inside the line / outside the line" thinking, and a range of one quantity is read as a range of another (position range read as size).

### Healthcare
- Lab results: results are now released to patient portals right away in most US centres, often before a clinician has reviewed them. A recent study reports 57.6 percent felt less anxious after seeing them, 37.8 percent no change and 4.6 percent more worried; 95 percent of 8,000-plus surveyed wanted immediate access (2023 study). Patients still describe days of repeated checking while a result is "pending". Documented practical advice: ask when the team will review, so the waiting has an end date.
- Reference ranges: a result is shown against a normal range, so a number is always read in context rather than alone (general practice, not sourced in the search).
- Medication refill when the dose is unknown: no documented pattern was found. Not covered.
- What transfers: showing the truth early helps more people than it harms, and a "pending" state with an expected review time is calmer than silence.

### E-commerce stock
- Baymard: a bare "out of stock" is a UX dead end; 68 percent of sites studied do not let shoppers buy a temporarily unavailable product with a longer delivery time. Pairing the status with a restock date or range, a pre-order with a ship date, or a back-in-stock alert is the recommended handling.
- Scarcity labels ("only 3 left"): research on their effect on sales is mixed (Yin et al., 2020, Journal of Operations Management examines it; results not retrieved). Vendor guidance stresses the message must be true or it costs trust.
- Not confirmed: "usually ships in" wording and thresholds.
- What transfers: an unavailable item should offer the next best fact (a date or range) and a way to be told when it changes.

### Project management (Jira, Linear)
- Jira: items with no estimate silently drop out of burndown maths. Atlassian's own articles show burndown charts with missing baselines or guidelines when parent issues are unestimated, and a known defect where the "unestimated" percentage counted closed items. Community advice is not to start a sprint with unestimated items. Changing an estimate mid-sprint shows up as a visible jump in the chart rather than being absorbed.
- Linear: the search returned nothing; not covered.
- What transfers: a total built from partly unestimated items is wrong in a quiet way (it looks fine and is too low). The count of missing items must travel with the total.

### Calendars
- Tentative events: Outlook and Google Calendar have a "tentative / maybe" response; free/busy views can show tentative time differently from busy time, but sources conflict on the exact visual (stripes for Maybe per one source, the opposite per another). The principle is documented, the specific rendering is not settled here.
- What transfers: a distinct, lighter state for "might happen" that still occupies space is understood by almost everyone.

## Research on communicating uncertainty to lay people
- Kay, Kola, Hullman, Munson (CHI 2016, "When(ish) is my bus?"): for transit predictions on a small phone screen, they introduced quantile dotplots (a handful of dots, each one an equal slice of probability) and found them to give lower-variance, more confident estimates than density plots.
- Fernandes, Walls, Munson, Hullman, Kay (CHI 2018): in an incentivised experiment on when to catch a bus, quantile dotplots (50 outcomes) and CDFs improved decisions; dotplot decisions reached 97 percent of the optimal payoff, 5 points above the no-uncertainty control. Textual uncertainty did worse and was sensitive to which probability interval was quoted. Because "probability that the bus has already gone" can be read off by counting dots, people reason with frequencies, not abstract percentages.
- van der Bles, van der Linden, Freeman, Spiegelhalter (PNAS 2020, five experiments, 5,780 people including a BBC News field test): stating uncertainty numerically (a range or percentage) cost only a small drop in trust in the number and no significant drop in trust in the source; verbal hedging cost more than a numeric range. Spiegelhalter's position: be upfront; do not pretend things are known when they are not.
- Padilla et al. (2017) as above: ensembles beat summaries on some misreadings, but each display has its own bias.

## Principles for the cash forecast

1. Show what is known and what is not as two different things, never one blended number. Like scheduled versus estimated in flights: the confirmed part (bills with amounts, client invoices with dates) is one figure; the guessed part is labelled and kept apart. (Sources: FlightAware forum threads on estimated versus filed times; Spiegelhalter, van der Bles 2020.)

2. Give a range, in numbers, with a plain-words anchor. A numeric range costs little trust (van der Bles 2020) and beats vague wording, which hurts more and is read inconsistently (PoP studies, Fernandes 2018 textual displays). Example: "¥8,000 to ¥14,000, based on your last three bills", not "around ¥11,000" and not "maybe a bit".

3. Always state the basis of any assumed number and let the user replace it. "Estimated from the last 3 electricity bills" names the assumption, the way PoP is only readable once you know what it is a probability of (NWS PoP misreadings; Baymard's advice to pair a status with a date or range). Never assume without saying so.

4. Show the worst case that matters, not the whole distribution. The cone and PoP studies show wide displays get misread. For a freelancer the useful range is usually "if it comes in low / if it comes in high" at the points that change the answer; use frequency-style wording ("in about 2 of 10 months this bill was above ¥14,000"), which Kay 2016 and Fernandes 2018 support over percentages. (Inference on the specific wording.)

5. Do not draw hard edges around ranges. A line or boundary invites inside / outside reading (Padilla 2017 cone findings). Use soft shading or two-sided phrasing, and make clear a range is not a prediction of size or severity.

6. Keep unknown items visible in place, with a distinct "to be confirmed" state. Don't hide an item whose amount is missing, and don't let it count as zero (Jira burndowns that ignore unestimated work look fine and are wrong; Baymard's out-of-stock dead end; tentative calendar events still occupy time). A light, dashed or "pending" style is the transferable idea.

7. Say when the gap will close, and who can close it. Pending labs are calmer with an expected review time; parcel pages give a new date and reason; Baymard recommends restock dates and alerts. "The electricity bill usually arrives around the 12th; we'll update then" turns a hole into a dated event. Offer one tap to enter the amount, and ask for the date or amount, whichever is missing, not both.

8. Don't jitter. Recompute when something real changes, show a "last updated" and say why it moved ("Acme paid, so..."). Flapping estimates raised stress in ETA studies and annoyed flight-tracker users. (Delhi Uber and Google ETA study; FlightAware threads.)

9. Escalate on consequence, not on missing data alone. Missing data only becomes a warning when the worst case in range crosses a line (short on the 27th), and a lapsed expected date (client "should have paid by now") is a prompt to act. Parcel guidance sets a wait (48 to 72 hours) before contacting support; the app should set its own clear thresholds and say them.

10. Show the bad news early and plainly. Immediate lab results leave most people less anxious, and trust survives honest uncertainty (JAMA Network Open studies, van der Bles 2020). Lead with "you're fine if..." and "if they're late..." as the product already does, then the missing-data note beneath.

## Anti-patterns
- One precise number for an unknown ("¥11,342" for a bill not yet issued). It reads as fact and breaks trust when wrong.
- Silently assuming zero, or dropping an unestimated item from a total (Jira burndown without baselines).
- Hiding the item until it is known; the sentence then looks safer than it is.
- A range nobody can read: a very wide span, a probability with hidden terms (PoP), a hard-edged cone people take as a safe zone.
- Vague words ("roughly", "might") without numbers; they cost more trust and are read differently by each person.
- Estimates that flip between runs with no stated reason.
- A bare "pending" or "out of stock" with no date, no basis and no next step.
- A fake precision of dates: giving a pay date the client never gave.
- Scarcity theatre: warnings that are not tied to a real worst case.

## Sources
https://idl.uw.edu/papers/uncertainty-bus
https://mucollective.northwestern.edu/files/2018-UncertainBusDecisions-CHI.pdf
https://idl.uw.edu/papers/when-ish-is-my-bus
https://vis.mit.edu/classes/6.859/readings/pdfs/Kay-WhenishIsMyBus.pdf
https://www.eurekalert.org/news-releases/558221
https://www.sciencedaily.com/releases/2017/10/171005151140.htm
https://www.aoml.noaa.gov/general/lib/lib1/nhclib/Bibliographies/Cone%20of%20Uncertainty%20Literature%20Review_4_10_19%20%281%29%20%281%29.pdf
https://bmcnoldy.earth.miami.edu/papers/MMCMEB2022_IJHCI.pdf
https://escholarship.org/content/qt96s9t7g5/qt96s9t7g5.pdf?t=sggz3w
https://www.admin-csap.csap.cam.ac.uk/news/article-communicating-uncertainty/
https://sciencedaily.com/releases/2020/03/200323152106.htm
https://publicaccountant.com.au/features/communicating-risk-uncertainty-builds-trust-spiegelhalter/
https://discussions.flightaware.com/t/how-is-a-flights-estimated-on-off-calculated-and-when-is-it-likely-to-be-accurate/85091/1
https://discussions.flightaware.com/t/tracking-estimated-arrival-time/19718
https://cdn.iiit.ac.in/cdn/precog.iiit.ac.in/pubs/TravelTimeEstimation-AW4CITY-TheWebConf19.pdf
https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9057622
https://www.shipscience.com/blog/when-do-amazon-packages-go-out-for-delivery
https://boards.straightdope.com/t/anyone-else-experiencing-amazon-tracking-weirdness/714443
https://webarchive.library.unt.edu/eot2008/20090506014446/http://www.crh.noaa.gov/arx/fcst1.php
https://www.wrdw.com/content/news/Weather-Blog-What-does-a-20-chance-of-rain-mean-465698093.html
https://patientengagementhit.com/news/patients-want-doc-counsel-under-cures-act-patient-data-access-rules
https://www.epocrates.com/online/article/most-patients-felt-calmer-after-seeing-test-results-right-away
https://baymard.com/research-articles/handling-out-of-stock-products
https://support.atlassian.com/jira/kb/jira-burndown-chart-is-missing-the-guideline-or-estimation-data/
https://jira.atlassian.com/browse/JSWSERVER-11384
https://gitlab.gnome.org/GNOME/gnome-calendar/-/issues/833
https://www.cmu.edu/computing/services/comm-collab/email-calendar/google/how-to/migration/quick-ref/get-started-with-google---calendar.pdf
