/**
 * Every user-facing string, in both languages, keyed by the same set of
 * keys. States never hardcode text — they call ctx.t("some_key") and this
 * file is the only place that needs editing to change copy or add a
 * language.
 *
 * {{placeholders}} get substituted by `resolveCopy`'s `vars` argument.
 *
 * WhatsApp renders a small markdown subset in body text: *bold*, _italic_,
 * ~strikethrough~, and literal "\n" as a line break — used throughout for
 * headings/structure. Emoji are fine in body text (no length limit worth
 * worrying about there) but button/list-row titles are NOT: WhatsApp caps
 * reply-button and list-button text at 20 characters and list-row titles
 * at 24 — every field with such a limit is annotated with it below, and
 * whatsapp/client.ts throws immediately if one is ever exceeded. Verify
 * with `value.length` (UTF-16 code units, what WhatsApp actually counts),
 * not a visual character count or codepoint count — emoji and Devanagari
 * conjuncts both routinely take 2+ code units per glyph.
 */
export type Lang = "en" | "hi";

const en = {
  welcome_body:
    "🙏 *Welcome to Uttarakhand e-Seva*\n_Government of Uttarakhand · WhatsApp Citizen Service_\n\nApply for and track official Birth, Death & Domicile certificates right here on WhatsApp.\n\nBy continuing, you consent to us using your messages to process your certificate request as per government data-handling guidelines.\n\nTap *Proceed* to continue, or *Opt Out* if you'd rather not use this service.",
  proceed: "✅ Proceed", // reply button title, limit 20
  opt_out: "🚫 Opt Out", // reply button title, limit 20

  language_prompt: "🌐 *Select Your Language*\n\nभाषा चुनें",
  lang_en: "English", // reply button title, limit 20
  lang_hi: "हिंदी", // reply button title, limit 20

  // Main menu is now two messages: Apply/Track/Download as one-tap reply
  // buttons (main_menu_body), everything else in a list right after
  // (main_menu_more_body) — see flow/definition.ts's MAIN_MENU.onEnter.
  main_menu_body: "📋 *Main Menu*\n\nHow can we assist you today?",
  menu_apply_button: "📝 Apply Certificate", // reply button title, limit 20
  menu_track: "🔍 Track Status", // reply button title, limit 20 (also reused as a button on the submission-confirmation message — see routes/internal.ts)
  menu_download_button: "📥 Get Certificate", // reply button title, limit 20
  main_menu_more_body: "🔧 *More Options*",
  main_menu_more_button: "More Options", // list button text, limit 20
  menu_help: "❓ Help & Support", // list row title, limit 24
  menu_chat: "💬 Chat with Us", // list row title, limit 24
  menu_change_language: "🌐 Change Language", // list row title, limit 24

  apply_choose_body:
    "📝 *Certificate Application*\nWhich certificate would you like to apply for?",
  // No emoji here on purpose — a celebratory icon next to Birth and a
  // solemn one next to Death would read as a tonal mismatch either way.
  birth_certificate: "Birth Certificate", // reply button title, limit 20
  death_certificate: "Death Certificate", // reply button title, limit 20
  domicile_certificate: "Domicile Certificate", // reply button title, limit 20 (exactly at it)

  apply_handoff_header: "📄 Certificate Application", // cta_url header, limit 60
  apply_handoff_body:
    "✅ *Almost there, {{name}}!*\n\nTap below to securely fill your *{{service}}* application form. It only takes a few minutes.",
  apply_handoff_button: "📝 Fill Application", // cta_url button text, limit 20

  submission_confirmed_body:
    "✅ *Application Received!*\n\nYour *{{reference}}* application has been submitted successfully.\n\nWe'll notify you here once it's reviewed.",

  certificate_ready_body:
    "🎉 *Good News!*\n\nYour certificate has been approved and is ready. Sending it to you now 👇",

  back_to_menu: "🔙 Back to Main Menu", // reply button title, limit 20 (exactly at it)

  track_ask_body:
    "🔍 *Track Application Status*\nPlease enter your application reference/token number below.",
  track_result_found:
    "✅ *Application Found*\nReference: *{{reference}}*\nStatus: {{status}}",
  track_result_not_found:
    "❌ We couldn't find any application with reference *{{reference}}*.\nPlease double-check the number and try again.",
  status_submitted: "🟡 Submitted",
  status_under_review: "🔵 Under Review",
  status_approved: "🟢 Approved",
  status_rejected: "🔴 Rejected",

  download_ask_body:
    "📥 *Download Certificate*\nPlease enter your application reference/token number below.",
  download_not_ready_body:
    "⏳ *Not Ready Yet*\nApplication *{{reference}}* is currently: {{status}}\nYou'll be able to download it here once it's approved.",
  download_ready_body: "✅ *Your certificate is ready!* Here it is 👇",

  help_body:
    "ℹ️ *Help & Support*\n\nThis service lets you:\n• Apply for a Birth, Death, or Domicile certificate\n• Track your application status\n• Download your approved certificate\n• Chat with us for other questions\n\nFor further assistance, please contact your nearest CSC (Common Service Centre).",

  opted_out_body:
    "🙏 You've opted out of this service. We won't send further messages.\n\nSend us any message anytime to start again.",

  fallback_body:
    "🤔 Sorry, I didn't quite understand that. Here's the menu again:",

  ai_chat_intro:
    "🤖 *You're now chatting with an automated assistant.*\n\nAsk me anything about certificate services — by typing or sending a voice note — and I'll do my best to help. Tap *Back to Main Menu* anytime to return to the regular menu.",
  ai_chat_error_body:
    "🤔 Sorry, I'm having trouble responding right now. Please try again in a moment, or head back to the menu.",
  ai_chat_voice_too_long:
    "🎙️ That voice note is a bit too long for me to process. Please try a shorter one, or just type your question instead.",
  ai_chat_voice_unsupported:
    "🎙️ I can only listen to voice notes recorded here in WhatsApp. Please record one directly, or type your question instead.",

  // ---- Commerce demo (commerce-demo/journeys.ts). All data is fake. ----
  menu_commerce: "🛍️ Commerce demo", // list row title, limit 24
  commerce_menu_body:
    "🛍️ *Commerce demo*\n_Sample brands and fake data only. No real payments._\n\nWhat would you like to do?",
  commerce_buy: "Buy", // reply button title, limit 20
  commerce_track: "Track order", // reply button title, limit 20
  commerce_balance: "Check balance", // reply button title, limit 20
  commerce_help:
    "ℹ️ Tap a button above, or type *menu* to see the demo options. Type *hi* anytime to come back here.",
  commerce_carousel_body: "🛒 *Choose a brand*\nSwipe to see all sample brands.",
  commerce_card_body: "*{{brand}}*\n{{category}} · {{item}}", // carousel card body, limit 160, max 2 line breaks
  commerce_select: "Select", // carousel quick-reply title, limit 20
  commerce_brand_body:
    "*{{brand}}*\n{{item}}\n\nTap *Choose amount* to pick an amount and quantity.",
  commerce_choose_amount: "Choose amount", // flow_cta, limit 30, no emoji
  commerce_flow_unavailable:
    "Sorry, the amount picker isn't available right now. Please try again later.",
  commerce_summary_body:
    "🧾 *Order summary*\nOrder {{order}}\n\n{{brand}} · {{item}}\n{{amount}} × {{qty}} = {{subtotal}}\n{{offer_line}}*Total: {{total}}*\nPaid with points: {{points}}\nPay online: {{online}}\n\n_Demo only. No real money moves._",
  commerce_summary_offer: "Offer {{code}}: -{{discount}}\n",
  commerce_pay: "Pay (demo)", // reply button title, limit 20
  commerce_cancel_order: "Cancel order", // reply button title, limit 20
  commerce_otp_prompt:
    "🔐 This payment uses *{{points}} points*.\nEnter the demo OTP *{{otp}}* to confirm.",
  commerce_otp_wrong: "❌ That OTP is not correct. Enter the demo OTP *{{otp}}*.",
  commerce_delivered:
    "✅ *Payment received (demo)*\nOrder {{order}}\n\nYour {{item}} code:\n{{codes}}\n\n_Long-press a code to copy it._",
  commerce_buy_another: "Buy another", // reply button title, limit 20
  commerce_next_body: "What would you like to do next?",
  commerce_issue_failed:
    "⚠️ We received your payment but couldn't issue your code (order {{order}}). Your payment has been refunded (demo).",
  commerce_cancelled: "Order {{order}} has been cancelled.",
  commerce_cannot_cancel: "Order {{order}} can't be cancelled now. Status: {{status}}.",
  commerce_already: "Order {{order}} is already {{status}}.",
  commerce_order_not_found: "Sorry, we couldn't find that order.",
  commerce_no_orders: "📦 You have no demo orders yet.",
  commerce_orders_body: "📦 *Your recent demo orders*\nChoose one to see its status.",
  commerce_orders_button: "View orders", // list button text, limit 20
  commerce_order_status: "📦 *Order {{order}}*\n{{brand}} · {{total}}\n\n{{steps}}",
  commerce_codes_label: "Code:",
  commerce_step_placed: "Order placed",
  commerce_step_paid: "Paid",
  commerce_step_delivered: "Code delivered",
  commerce_step_cancelled: "Cancelled",
  commerce_step_failed: "Failed, refunded",
  commerce_status_pending_payment: "awaiting payment",
  commerce_status_processing: "processing",
  commerce_status_delivered: "delivered",
  commerce_status_cancelled: "cancelled",
  commerce_status_failed: "failed",
  commerce_balance_body:
    "💰 *Demo points balance: {{points}}*\n_1 point = ₹1. Points are fake and only work in this demo._",

  // Catalog path (COMMERCE_CATALOG_ENABLED)
  commerce_view_product: "View product", // carousel quick-reply title, limit 20
  commerce_catalog_prompt: "🗂️ Prefer to browse the catalog and use a cart?",
  commerce_browse_catalog: "Browse catalog", // reply button title, limit 20
  commerce_catalog_header: "Sample catalog", // product_list header, limit 60
  commerce_catalog_body: "Add items to your cart and send it to order. All products are samples.",
  commerce_other_amount_prompt: "Need an amount that isn't in the catalog?",
  commerce_other_amount: "Other amount", // reply button title (limit 20) and flow_cta (limit 30, no emoji)
  commerce_other_amount_body: "Choose a brand and type any amount within its range.",
  commerce_product_body: "{{item}} worth {{amount}}. Add it to your cart and send it to order.",
  commerce_cart_skipped: "⚠️ Some cart items aren't part of this demo and were skipped: {{items}}",
  commerce_cart_empty: "None of the items in your cart could be ordered. Please browse the catalog again.",
};

const hi: Record<keyof typeof en, string> = {
  welcome_body:
    "🙏 *उत्तराखंड ई-सेवा में आपका स्वागत है*\n_उत्तराखंड सरकार · व्हाट्सएप नागरिक सेवा_\n\nयहीं व्हाट्सएप पर जन्म, मृत्यु और अधिवास प्रमाणपत्र के लिए आवेदन करें और स्थिति ट्रैक करें।\n\nजारी रखने पर, आप सरकारी डेटा-प्रबंधन दिशानिर्देशों के अनुसार अपने प्रमाणपत्र अनुरोध को संसाधित करने के लिए हमें अपने संदेशों का उपयोग करने की सहमति देते हैं।\n\nजारी रखने के लिए *Proceed* दबाएं, या इस सेवा का उपयोग न करना चाहें तो *Opt Out* दबाएं।",
  proceed: "✅ आगे बढ़ें",
  opt_out: "🚫 बाहर निकलें",

  language_prompt: "🌐 *अपनी भाषा चुनें*\nSelect Your Language",
  lang_en: "English",
  lang_hi: "हिंदी",

  main_menu_body: "📋 *मुख्य मेनू*\nआज हम आपकी क्या मदद कर सकते हैं?",
  menu_apply_button: "📝 प्रमाणपत्र आवेदन",
  menu_track: "🔍 स्थिति ट्रैक करें",
  menu_download_button: "📥 प्रमाणपत्र लें",
  main_menu_more_body: "🔧 *अन्य विकल्प*",
  main_menu_more_button: "अन्य विकल्प",
  menu_help: "❓ सहायता और समर्थन",
  menu_chat: "💬 हमसे चैट करें",
  menu_change_language: "🌐 भाषा बदलें",

  apply_choose_body:
    "📝 *प्रमाणपत्र आवेदन*\nआप किस प्रमाणपत्र के लिए आवेदन करना चाहते हैं?",
  birth_certificate: "जन्म प्रमाणपत्र",
  death_certificate: "मृत्यु प्रमाणपत्र",
  domicile_certificate: "अधिवास प्रमाणपत्र",

  apply_handoff_header: "📄 प्रमाणपत्र आवेदन",
  apply_handoff_body:
    "✅ *बस थोड़ा और, {{name}}!*\n\nअपना *{{service}}* आवेदन फॉर्म सुरक्षित रूप से भरने के लिए नीचे टैप करें। इसमें कुछ ही मिनट लगेंगे।",
  apply_handoff_button: "📝 आवेदन फॉर्म भरें",

  submission_confirmed_body:
    "✅ *आवेदन प्राप्त हुआ!*\n\nआपका *{{reference}}* आवेदन सफलतापूर्वक जमा हो गया है।\n\nसमीक्षा होने पर हम आपको यहां सूचित करेंगे।",

  certificate_ready_body:
    "🎉 *शुभ समाचार!*\n\nआपका प्रमाणपत्र स्वीकृत हो गया है और तैयार है। इसे अभी आपको भेजा जा रहा है 👇",

  back_to_menu: "🔙 मुख्य मेनू",

  track_ask_body:
    "🔍 *आवेदन स्थिति ट्रैक करें*\nकृपया अपना आवेदन संदर्भ/टोकन नंबर नीचे दर्ज करें।",
  track_result_found:
    "✅ *आवेदन मिल गया*\nसंदर्भ: *{{reference}}*\nस्थिति: {{status}}",
  track_result_not_found:
    "❌ हमें संदर्भ *{{reference}}* वाला कोई आवेदन नहीं मिला।\nकृपया नंबर जांचकर पुनः प्रयास करें।",
  status_submitted: "🟡 प्रस्तुत",
  status_under_review: "🔵 समीक्षाधीन",
  status_approved: "🟢 स्वीकृत",
  status_rejected: "🔴 अस्वीकृत",

  download_ask_body:
    "📥 *प्रमाणपत्र डाउनलोड*\nकृपया अपना आवेदन संदर्भ/टोकन नंबर नीचे दर्ज करें।",
  download_not_ready_body:
    "⏳ *अभी तैयार नहीं है*\nआवेदन *{{reference}}* अभी: {{status}}\nस्वीकृत होने पर आप इसे यहां डाउनलोड कर सकेंगे।",
  download_ready_body: "✅ *आपका प्रमाणपत्र तैयार है!* यह लीजिए 👇",

  help_body:
    "ℹ️ *सहायता एवं समर्थन*\n\nइस सेवा से आप:\n• जन्म, मृत्यु या अधिवास प्रमाणपत्र के लिए आवेदन कर सकते हैं\n• अपने आवेदन की स्थिति ट्रैक कर सकते हैं\n• अपना स्वीकृत प्रमाणपत्र डाउनलोड कर सकते हैं\n• अन्य सवालों के लिए हमसे चैट कर सकते हैं\n\nअधिक सहायता के लिए अपने नजदीकी सीएससी (कॉमन सर्विस सेंटर) से संपर्क करें।",

  opted_out_body:
    "🙏 आपने इस सेवा से बाहर निकलने का विकल्प चुना है। हम आगे कोई संदेश नहीं भेजेंगे।\n\nफिर से शुरू करने के लिए कभी भी हमें कोई संदेश भेजें।",

  fallback_body:
    "🤔 क्षमा करें, मुझे यह ठीक से समझ नहीं आया। यहां मेनू फिर से है:",

  ai_chat_intro:
    "🤖 *आप अभी एक स्वचालित सहायक से बात कर रहे हैं।*\nप्रमाणपत्र सेवाओं से जुड़ा कोई भी सवाल टाइप करें या वॉइस नोट भेजें, मैं मदद करने की पूरी कोशिश करूंगा। मुख्य मेनू पर लौटने के लिए कभी भी *Back to Main Menu* दबाएं।",
  ai_chat_error_body:
    "🤔 क्षमा करें, अभी जवाब देने में समस्या आ रही है। कृपया थोड़ी देर बाद पुनः प्रयास करें, या मेनू पर वापस जाएं।",
  ai_chat_voice_too_long:
    "🎙️ यह वॉइस नोट थोड़ा लंबा है, मैं इसे प्रोसेस नहीं कर सकता। कृपया छोटा वॉइस नोट भेजें, या अपना सवाल टाइप करें।",
  ai_chat_voice_unsupported:
    "🎙️ मैं केवल यहीं व्हाट्सएप पर रिकॉर्ड किए गए वॉइस नोट सुन सकता हूं। कृपया सीधे रिकॉर्ड करें, या अपना सवाल टाइप करें।",

  // ---- कॉमर्स डेमो (commerce-demo/journeys.ts). सारा डेटा नकली है। ----
  menu_commerce: "🛍️ कॉमर्स डेमो",
  commerce_menu_body:
    "🛍️ *कॉमर्स डेमो*\n_केवल सैंपल ब्रांड और नकली डेटा। कोई असली भुगतान नहीं।_\n\nआप क्या करना चाहेंगे?",
  commerce_buy: "खरीदें",
  commerce_track: "ऑर्डर ट्रैक करें",
  commerce_balance: "बैलेंस देखें",
  commerce_help:
    "ℹ️ ऊपर दिया कोई बटन दबाएं, या डेमो विकल्प देखने के लिए *menu* टाइप करें। यहां लौटने के लिए कभी भी *hi* टाइप करें।",
  commerce_carousel_body: "🛒 *ब्रांड चुनें*\nसभी सैंपल ब्रांड देखने के लिए स्वाइप करें।",
  commerce_card_body: "*{{brand}}*\n{{category}} · {{item}}",
  commerce_select: "चुनें",
  commerce_brand_body:
    "*{{brand}}*\n{{item}}\n\nराशि और संख्या चुनने के लिए *राशि चुनें* दबाएं।",
  commerce_choose_amount: "राशि चुनें",
  commerce_flow_unavailable: "क्षमा करें, राशि चुनने की सुविधा अभी उपलब्ध नहीं है। कृपया बाद में प्रयास करें।",
  commerce_summary_body:
    "🧾 *ऑर्डर सारांश*\nऑर्डर {{order}}\n\n{{brand}} · {{item}}\n{{amount}} × {{qty}} = {{subtotal}}\n{{offer_line}}*कुल: {{total}}*\nपॉइंट्स से भुगतान: {{points}}\nऑनलाइन भुगतान: {{online}}\n\n_केवल डेमो। कोई असली पैसा नहीं कटेगा।_",
  commerce_summary_offer: "ऑफ़र {{code}}: -{{discount}}\n",
  commerce_pay: "भुगतान (डेमो)",
  commerce_cancel_order: "ऑर्डर रद्द करें",
  commerce_otp_prompt: "🔐 इस भुगतान में *{{points}} पॉइंट्स* लगेंगे।\nपुष्टि के लिए डेमो OTP *{{otp}}* दर्ज करें।",
  commerce_otp_wrong: "❌ यह OTP सही नहीं है। डेमो OTP *{{otp}}* दर्ज करें।",
  commerce_delivered:
    "✅ *भुगतान प्राप्त (डेमो)*\nऑर्डर {{order}}\n\nआपका {{item}} कोड:\n{{codes}}\n\n_कोड कॉपी करने के लिए उसे दबाकर रखें।_",
  commerce_buy_another: "फिर से खरीदें",
  commerce_next_body: "आगे आप क्या करना चाहेंगे?",
  commerce_issue_failed:
    "⚠️ हमें आपका भुगतान मिल गया, लेकिन कोड जारी नहीं हो सका (ऑर्डर {{order}})। आपका भुगतान वापस कर दिया गया है (डेमो)।",
  commerce_cancelled: "ऑर्डर {{order}} रद्द कर दिया गया है।",
  commerce_cannot_cancel: "ऑर्डर {{order}} अब रद्द नहीं हो सकता। स्थिति: {{status}}।",
  commerce_already: "ऑर्डर {{order}} पहले से {{status}} है।",
  commerce_order_not_found: "क्षमा करें, यह ऑर्डर नहीं मिला।",
  commerce_no_orders: "📦 आपका अभी कोई डेमो ऑर्डर नहीं है।",
  commerce_orders_body: "📦 *आपके हाल के डेमो ऑर्डर*\nस्थिति देखने के लिए एक चुनें।",
  commerce_orders_button: "ऑर्डर देखें",
  commerce_order_status: "📦 *ऑर्डर {{order}}*\n{{brand}} · {{total}}\n\n{{steps}}",
  commerce_codes_label: "कोड:",
  commerce_step_placed: "ऑर्डर दिया गया",
  commerce_step_paid: "भुगतान हुआ",
  commerce_step_delivered: "कोड भेजा गया",
  commerce_step_cancelled: "रद्द",
  commerce_step_failed: "विफल, राशि वापस",
  commerce_status_pending_payment: "भुगतान बाकी",
  commerce_status_processing: "प्रोसेस हो रहा",
  commerce_status_delivered: "डिलीवर",
  commerce_status_cancelled: "रद्द",
  commerce_status_failed: "विफल",
  commerce_balance_body:
    "💰 *डेमो पॉइंट्स बैलेंस: {{points}}*\n_1 पॉइंट = ₹1। पॉइंट्स नकली हैं और केवल इस डेमो में चलते हैं।_",

  commerce_view_product: "उत्पाद देखें",
  commerce_catalog_prompt: "🗂️ क्या आप कैटलॉग देखकर कार्ट से ऑर्डर करना चाहेंगे?",
  commerce_browse_catalog: "कैटलॉग देखें",
  commerce_catalog_header: "सैंपल कैटलॉग",
  commerce_catalog_body: "आइटम कार्ट में जोड़ें और ऑर्डर के लिए भेजें। सभी उत्पाद सैंपल हैं।",
  commerce_other_amount_prompt: "कैटलॉग में नहीं दी गई कोई और राशि चाहिए?",
  commerce_other_amount: "दूसरी राशि",
  commerce_other_amount_body: "एक ब्रांड चुनें और उसकी सीमा के अंदर कोई भी राशि लिखें।",
  commerce_product_body: "{{amount}} का {{item}}। इसे कार्ट में जोड़ें और ऑर्डर के लिए भेजें।",
  commerce_cart_skipped: "⚠️ कार्ट के कुछ आइटम इस डेमो का हिस्सा नहीं हैं, इसलिए छोड़ दिए गए: {{items}}",
  commerce_cart_empty: "आपके कार्ट का कोई भी आइटम ऑर्डर नहीं हो सका। कृपया कैटलॉग फिर से देखें।",
};

export const copy = { en, hi };

/** Every valid copy key — gives states compile-time typo-checking on ctx.t(...) calls. */
export type CopyKey = keyof typeof en;

/**
 * Looks up `key` for `lang` (defaults to "en" for the pre-language-selection
 * screens, where session.data.lang isn't set yet) and substitutes any
 * {{placeholder}} present in `vars`.
 */
export function resolveCopy(
  lang: Lang | undefined,
  key: CopyKey,
  vars?: Record<string, string>,
): string {
  const template = copy[lang ?? "en"][key];
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    template,
  );
}
