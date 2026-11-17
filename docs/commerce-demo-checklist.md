# Commerce demo: real-phone checklist

Use this to test the commerce demo on real phones, once on an **iPhone** and once on an **Android**. For each check, mark the Result column ✅, ❌ or ⚠️ (works with a caveat). Put anything worth remembering in the observations table at the end.

Setup is in [commerce-demo.md](commerce-demo.md). This checklist assumes you've reached Phase 5 (Flow in draft); sections 3b and 7 need Phases 6 and 7.

## Before you start

| | Record here |
|---|---|
| Date / tester | |
| iPhone model, iOS version, WhatsApp version | |
| Android model, Android version, WhatsApp version | |
| Bot build (`git rev-parse --short HEAD`) | |
| Flow id / mode (draft or published) | |

- **Allowlist:** both phone numbers are in `DEMO_ALLOWED_RECIPIENTS`, and `DEMO_SEND_ENABLED=true`.
- **Bot log open:** keep the log visible (`pnpm dev:bot`, or `journalctl -fu uttarakhand-bot` on the VM). Several checks read the `[flow]`, `[webhook]` and `[commerce]` lines.
- **Message history:** some checks read the database. All examples assume `psql "$DATABASE_URL"`.
- **Phone number in the database:** use the phone's full number in international format without "+", e.g. `919812345678`. It appears in SQL below as `<number>`.
- **Start clean:** send **hi** before each section. Inside the demo, **menu** returns to the demo menu.
- **Screenshots:** name them `NN-short-name-ios.png` / `NN-short-name-android.png` and note the name in the observations table.

---

## 1. Menu and reply buttons render, titles not truncated

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 1.1 | Send **hi**, tap **Proceed**, **English** | Main menu: 3 reply buttons (📝 Apply Certificate, 🔍 Track Status, 📥 Get Certificate) and a **More Options** list | Look at the chat | |
| 1.2 | Open **More Options** | Rows: Help & Support, Chat with Us, Change Language, **🛍️ Commerce demo** | Look at the list | |
| 1.3 | Tap **🛍️ Commerce demo** | Demo menu with **Buy**, **Track order**, **Check balance**, then a **Back to Main Menu** button | Look at the chat | |
| 1.4 | Titles are complete | No "…" on any button or row title | Compare with the text in 1.1 to 1.3 | |
| 1.5 | Repeat 1.1 to 1.3 in **हिंदी** (type **language**) | Hindi titles, not cut off: खरीदें, **ऑर्डर ट्रैक करें** (the longest), बैलेंस देखें | Look; Hindi is where truncation shows up first | |
| 1.6 | A number **not** on the allowlist (if you have one) | No Commerce demo row; the bot sends nothing for demo actions | Look; the bot log shows `demo send … blocked`, with the number masked | |

## 2. Carousel

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 2.1 | Demo menu → **Buy** | Swipeable carousel of 4 cards: Sample brand A to D | Swipe through | |
| 2.2 | Image ratio | 800×600 (4:3) placeholder images: not stretched or squashed, text readable. Record any cropping | Compare with the image opened in a browser (URL in `catalog.ts`) | |
| 2.3 | Card text | Bold brand name, then "Category · Sample gift item", nothing cut | Look | |
| 2.4 | Tap **Select** on card C | Message "*Sample brand C* … Tap *Choose amount* …" with a **Choose amount** Flow button | Look. If the bot log shows `[webhook] quick-reply tap arrived as type=button`, Meta sends carousel taps in the template shape; no such line means `interactive.button_reply`. Note which | |
| 2.5 | Catalog path on only: card buttons | Each card has **Select** and **View product**, and a **Browse catalog** button follows the carousel | Look | |

## 3. Flow: every screen, every branch

Do **3a in draft mode** first. Do 3b after publishing.

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 3.1 | Tap **Choose amount** | Flow opens on **ITEM**: brand heading, amount options ₹250 to ₹5,000 then **Other amount**, Quantity dropdown 1 to 10 | Look | |
| 3.2 | Preset branch: ₹500, quantity 2, **Continue** | **OFFERS** screen; bot log `[flow] data_exchange screen=ITEM -> OFFERS …ms` | Phone + log | |
| 3.3 | Offers list | "No offer" first. For brand A at ₹1,000: WELCOME10 and TREAT5 enabled, GIFT50 enabled; TRAVEL15 isn't shown (it's for the travel brand only) | Look; for brand A at ₹250 × 1, GIFT50 should be **greyed out**, its description reading "Add ₹250 more to unlock" | |
| 3.4 | Promo **invalid**: type `FREE100` | Stays on OFFERS with the error "FREE100 is not a valid promo code" | Look | |
| 3.5 | Promo **wrong brand**: type `TRAVEL15` on brand A | Error "TRAVEL15 can't be used for Sample brand A" | Look | |
| 3.6 | Promo **valid**: type `welcome10` | **REVIEW**: Brand, Amount ₹500 each, Quantity 2, Offer WELCOME10 (-₹100), **Total ₹900** | Look | |
| 3.7 | Custom branch: new Flow (**menu → Buy → Select**), choose **Other amount** | **CUSTOM_AMOUNT** screen, with the helper text "Between ₹100 and ₹10,000 in steps of ₹50" | Look | |
| 3.8 | Custom **invalid**: `125`, then `50`, then `20000` | Each shows "Enter an amount between ₹100 and ₹10,000 in steps of ₹50" and stays on the screen | Look | |
| 3.9 | Custom **valid**: `650` | OFFERS, then REVIEW showing ₹650 | Look | |
| 3.10 | Brand C custom amount `300` | Error with C's own rules: "…between ₹250 and ₹10,000 in steps of ₹250" | Look | |
| 3.11 | **Offers switched off**: `pnpm --filter bot demo:config --set offersScreen=false` (or the admin **Demo flags** page), then send a **new** Flow | ITEM → **REVIEW** directly, no OFFERS | Look; log `screen=ITEM -> REVIEW` | |
| 3.12 | Snapshot: open a Flow, switch offers **on** while it's open, continue | The open Flow keeps the setting it started with; only the next Flow changes | Look | |
| 3.13 | `promoField=false` / `customAmount=false` / `maxQty=3` (one at a time, new Flow each time) | No promo box / no "Other amount" / quantity 1 to 3 | Look. **Reset afterwards:** `demo:config --set offersScreen=true --set promoField=true --set customAmount=true --set maxQty=10` | |
| 3.14 | Back button inside the Flow | Returns to the previous screen with your input kept | Look | |
| 3.15 | **3b:** `demo:flow:publish --yes`, `COMMERCE_FLOW_MODE=published`, restart, repeat 3.1 to 3.6 | Same behaviour in published mode | Look; `demo:flow:send --mode published` | |

## 4. Latency

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 4.1 | Handler time per screen | Every `[flow] … -> SCREEN Nms` line is well under Meta's **10 s** endpoint timeout (expect low single-digit ms: there's no slow work) | Copy the `ms` values for ITEM, OFFERS, REVIEW and SUCCESS into the notes | |
| 4.2 | Wi-Fi feel | Tap Continue → next screen feels immediate (under 1 s) | Stopwatch or screen recording | |
| 4.3 | Mobile data (4G) | Record the tap → next screen time | Turn Wi-Fi off | |
| 4.4 | Weak network (3G / poor signal or the phone's network throttling) | The Flow shows a spinner and then the screen, no error. Record the worst time | Note any `timeout_error` webhook alert | |
| 4.5 | Endpoint far from the phone (ngrok vs VM) | Note which setup you used. Most of the time is the network round trip, not the handler | Compare 4.1 with 4.3 | |

## 5. Completed Flow → nfm_reply → order

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 5.1 | Tap **Confirm** on REVIEW | The Flow closes; the chat shows the Flow's "Sent" bubble, then **🧾 Order summary** with **Pay (demo)** / **Cancel order** | Look | |
| 5.2 | It came in as an nfm_reply | One incoming `flow_reply` row per completed Flow | `select "createdAt", payload->'flowResponse' from message_logs where "mobileNumber"='<number>' and type='flow_reply' order by "createdAt" desc limit 3;`. The `flowResponse` holds `flow_token` (`demo:…`) and `order_ref` (`ORD-…`) | |
| 5.3 | Order exists | The summary's order id matches `order_ref`; **Track order** lists it as "awaiting payment" | Look | |
| 5.4 | Summary content | Amount × quantity = subtotal, the offer line (if any), Total, "Paid with points", "Pay online" | Check the arithmetic | |

## 6. Pay (demo), OTP, delivery, code, tracking

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 6.1 | Tap **Pay (demo)** (points cover part of the total) | "🔐 This payment uses *N points*. Enter the demo OTP *123456*" | Look | |
| 6.2 | Type `000000` | "❌ That OTP is not correct…" | Look | |
| 6.3 | Type `123456` | "✅ *Payment received (demo)*" with the code(s) in **monospace** (`DEMO-ITEM-XXXX-XXXX`), then **Buy another** / **Track order** | Look | |
| 6.4 | **Long-press the code** | Can it be copied? Does the copy include the backticks? Paste it into a note and record what came out | Paste somewhere | |
| 6.5 | **Check balance** | Points went down by the amount used (starts at 2,500) | Look | |
| 6.6 | Tap **Pay (demo)** again on the old summary | "Order … is already delivered", with no second charge | Look | |
| 6.7 | **Track order** → choose the order | ✅ Order placed / ✅ Paid / ✅ Code delivered, plus the code | Look | |
| 6.8 | **Cancel order** on a new, unpaid order | "Order … has been cancelled"; any points held for it come back (check the balance) | Look | |
| 6.9 | Quantity **7** order, pay | "⚠️ We received your payment but couldn't issue your code… refunded (demo)"; balance restored | Look | |
| 6.10 | Quantity **9** order, pay | One delivery message with 9 codes, not two; the log shows `[commerce] duplicate payment event absorbed` | Phone + log | |
| 6.11 | Payment with no points left (spend all 2,500 first) | No OTP; delivered straight away | Look | |

## 7. Catalog path (needs Phase 7)

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 7.1 | `demo:send:catalog`, or **Buy → Browse catalog** | A product list with header "Sample catalog" and 4 sections named after the brands, 5 products each (20 in total); then an **Other amount** button | Look | |
| 7.2 | Open a product | Product view with the image, title "Sample brand A ₹500" and the price | Look | |
| 7.3 | **View product** on a carousel card | A single-product message for that brand at ₹500 | Look | |
| 7.4 | Add 2 items to the cart (e.g. A ₹500 × 2, D ₹1,000 × 1), **send cart** | One order summary per line, each with Pay / Cancel | Look | |
| 7.5 | The order webhook arrived | An incoming `order` row containing the cart | `select payload->'order' from message_logs where "mobileNumber"='<number>' and type='order' order by "createdAt" desc limit 1;` | |
| 7.6 | Pay one of the cart orders | Same OTP / delivery as in section 6 | Look | |
| 7.7 | **Other amount** button | The Flow opens on **OTHER_AMOUNT**: brand choices, each with its range, and an amount field | Look | |
| 7.8 | Other amount: brand C, `300` then `750` | 300: error with C's range. 750: OFFERS → REVIEW → summary shows ₹750 × 1 | Look | |
| 7.9 | Catalog storefront icon / cart icon in the chat header | Present if `demo:commerce --catalog-visible true --cart true` was run | Look; `pnpm --filter bot demo:commerce` prints the settings | |

## 8. CTA URL link behaviour

The commerce demo has no CTA URL button, but the certificate path does. Use that one.

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 8.1 | Main menu → **Apply Certificate** → **Birth Certificate** → tap **📝 Fill Application** | Record **where** it opens: WhatsApp's in-app browser, or the default browser (Safari / Chrome) | Look at the browser UI (in-app usually shows the WhatsApp header and a "…" menu) | |
| 8.2 | Does the form keep its token / prefilled name? | Form loads with your name | Look | |
| 8.3 | Returning to the chat | Note how you get back: a close button, or switching apps | Look | |

## 9. Live total in the Flow

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 9.1 | On ITEM, change the quantity several times | **No total is shown on ITEM.** This Flow computes the total on the server and shows it only on REVIEW | Look | |
| 9.2 | Continue to REVIEW, go **back**, change the quantity, continue again | The REVIEW total reflects the new quantity, so it updates on **screen change** only | Look; the log shows a new `data_exchange` for each Continue | |
| 9.3 | Note for the record | A live total would need the Dropdown's `on-select-action` (Flow JSON 6.0+, `data_exchange` or `update_data`). It isn't built; record whether it's wanted | n/a | |

## 10. Message statuses and error codes

| # | Check | Expected | How to verify | Result |
|---|---|---|---|---|
| 10.1 | Statuses recorded | For messages the bot sent: `sent`, then `delivered`, then `read` (read only if read receipts are on) | `select "waMessageId", status, "createdAt" from message_logs where "mobileNumber"='<number>' and type='status' order by "createdAt" desc limit 20;` | |
| 10.2 | Read receipts **off** on the phone | No `read` rows for that phone | Same query | |
| 10.3 | Any `failed` | The row's `payload->'errorCodes'` holds the code; the bot log shows `[webhook] message … to ********1234 failed, error code(s) …` | `select payload from message_logs where type='status' and status='failed' order by "createdAt" desc limit 5;` | |
| 10.4 | Provoke **131047**: wait more than 24 h after your last message, then `demo:send:carousel` | Send fails with 131047 (outside the 24h window) | Script output / failed status | |
| 10.5 | Codes seen | List every code you saw and what you were doing; the meanings are in [commerce-demo.md](commerce-demo.md#failure-messages-and-what-they-mean) | Notes | |

---

## Observations

| Item | iPhone result | Android result | Notes | Screenshot filename |
|---|---|---|---|---|
| 1. Menu and reply buttons, no truncation (EN + HI) | | | | |
| 2. Carousel: image ratio, quick-reply buttons | | | Webhook shape for carousel taps: `button_reply` or `button`? | |
| 3a. Flow in draft: all screens and branches | | | | |
| 3b. Flow published | | | | |
| 3c. Offers off / promo off / custom off / maxQty (config) | | | | |
| 4. Latency: handler ms per screen | | | ITEM: … OFFERS: … REVIEW: … SUCCESS: … | |
| 4. Latency: Wi-Fi / 4G / weak network feel | | | | |
| 5. nfm_reply → order created | | | | |
| 6. Pay, OTP, delivery | | | | |
| 6. Monospace code: long-press copy (with or without backticks?) | | | | |
| 6. Tracking, cancel, qty 7, qty 9, no-points path | | | | |
| 7. Catalog: product list, cart, order webhook | | | | |
| 7. Catalog: Other amount | | | | |
| 8. CTA URL opens in: in-app or default browser | | | | |
| 9. Live total vs on screen change | | | | |
| 10. Statuses (sent / delivered / read / failed) | | | | |
| 10. Error codes seen | | | | |
