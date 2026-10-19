const KNOWLEDGE = {
  en: [
    "Loyalty US is a QR-code loyalty program for local businesses. The public website says customers do not need an extra app or hardware.",
    "The US business offer shown on the public site is a 30-day free trial, then $49 per month.",
    "Customers can join a business loyalty program, scan its QR code, and view rewards through the Loyalty experience.",
    "Business owners can create an account and manage their loyalty program through the owner and merchant pages."
  ],
  he: [
    "Loyalty ישראל היא תוכנית נאמנות לעסקים מקומיים המבוססת על QR, צבירת הטבות וארנק לקוח.",
    "לקוחות יכולים להצטרף לתוכנית של עסק, לסרוק QR ולצפות בהטבות.",
    "בעלי עסקים יכולים להירשם ולנהל את תוכנית הנאמנות דרך אזור העסק."
  ]
};

const SYSTEM = {
  en: `You are Loyalty's AI voice and chat support assistant for Loyalty US. Be warm, concise, clear, and sound natural when read aloud. You are an AI; say so if asked. Answer only using the supplied verified product facts. Explain benefits honestly without promising results. Never guess about account status, points, charges, refunds, eligibility, or current outages. Do not request passwords, payment card details, or authentication codes. You cannot access, change, or verify any account and must not imply otherwise. For a personal account issue, tell the user to sign in through the official site and use the account's secure support flow; the account lookup / authenticated AI specialist handoff is not connected yet. If facts are insufficient, say you are not certain and invite them to provide a general, non-sensitive description. Do not claim a ticket was created or a specialist was contacted. Keep answers to 2-5 short sentences.`,
  he: `אתה עוזר התמיכה הקולי והכתוב של Loyalty ישראל. דבר בחום, בקצרה ובבהירות, בניסוח טבעי להקראה. אתה AI; אמור זאת אם שואלים. ענה רק לפי העובדות המאומתות שסופקו. הסבר יתרונות ביושר ובלי להבטיח תוצאות. אל תנחש לגבי מצב חשבון, נקודות, חיובים, החזרים, זכאות או תקלות פעילות. לעולם אל תבקש סיסמה, פרטי כרטיס או קוד אימות. אין לך גישה לחשבונות, אינך יכול לשנות או לאמת חשבון ואל תרמוז אחרת. בבעיה אישית, הפנה לכניסה לאתר הרשמי ולערוץ התמיכה המאובטח; בדיקת חשבון והעברה לסוכן AI מומחה עדיין אינן מחוברות. אם אין מספיק מידע, אמור שאינך בטוח ובקש תיאור כללי ללא פרטים רגישים. אל תטען שנפתחה פנייה או שנציג מומחה קיבל אותה. ענה ב-2 עד 5 משפטים קצרים.`
};

function reply(lang, text) {
  const he = lang === "he";
  const q = text.toLowerCase();
  if (/password|סיסמ/.test(q)) return he
    ? "לשמירה על אבטחת החשבון, אל תשלח כאן סיסמה או קוד. היכנס לאתר Loyalty והשתמש באפשרות שחזור הסיסמה במסך הכניסה."
    : "For account security, please don't share a password or verification code here. Go to the official Loyalty site and use the password recovery option on the sign-in page.";
  if (/qr|סריק|scan/.test(q)) return he
    ? "בדרך כלל מצטרפים לתוכנית של העסק וסורקים את קוד ה-QR שלו כדי לצבור או לראות הטבות. אם הסריקה אינה עובדת, נסה לאפשר למצלמה גישה ולפתוח מחדש את הקישור."
    : "Join the business's loyalty program, then scan its QR code to collect or view rewards. If scanning doesn't work, check camera permission and reopen the link.";
  if (/price|cost|מחיר|עלות|49/.test(q)) return he
    ? "האתר האמריקאי מציג 30 ימי ניסיון חינם ולאחריהם $49 לחודש לבעלי עסקים. זו הצעה לאתר האמריקאי; בדוק את האתר הישראלי לפרטי התוכנית בישראל."
    : "The US website lists a 30-day free trial, then $49 per month for businesses. This offer is for the US site; please check the Israeli site for local plan details.";
  if (/point|reward|נקוד|הטב|הטבה/.test(q)) return he
    ? "אפשר לצבור הטבות דרך תוכנית הנאמנות של העסק ולראות אותן בחוויית Loyalty. אין לי גישה ליתרה האישית שלך; אל תשלח כאן פרטים מזהים."
    : "You can collect rewards through the business's loyalty program and view them in Loyalty. I can't access your personal balance; please don't share identifying details here.";
  if (/benefit|why|advantage|יעיל|יתרונ|תועלת/.test(q)) return he
    ? "Loyalty נותנת ללקוחות דרך פשוטה לעקוב אחר הטבות, ולעסקים כלי לתוכנית נאמנות דיגיטלית מבוססת QR. התוצאות תלויות באופן שבו כל עסק מפעיל את התוכנית."
    : "Loyalty gives customers a simple way to keep track of rewards and gives businesses a QR-based digital loyalty program. Results depend on how each business uses it.";
  if (/sign up|register|הרשמה|נרשמ/.test(q)) return he
    ? "לקוחות ובעלי עסקים יכולים להתחיל דרך אפשרויות ההצטרפות באתר. בעלי עסקים בישראל צריכים להשתמש באתר הישראלי; עסקים בארה״ב באתר Loyalty US."
    : "Customers and businesses can get started from the sign-up options on the site. US businesses should use Loyalty US; Israeli businesses should use the Israeli site.";
  return he
    ? "אני לא בטוח בתשובה על סמך המידע המאומת שיש לי. אפשר לתאר את הבעיה באופן כללי, בלי סיסמאות, קודי אימות או פרטי תשלום. עדיין אין לי חיבור לסוכן AI מומחה או לבדיקת חשבון."
    : "I’m not certain based on the verified information available to me. You can describe the issue generally, without passwords, verification codes, or payment details. I’m not yet connected to an AI specialist or account lookup.";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const origin = req.headers.origin ? new URL(req.headers.origin).host.toLowerCase() : host;
  if (origin !== host || !["loyaltyusapp.com", "www.loyaltyusapp.com", "loyaltyapp.company", "www.loyaltyapp.company"].includes(host)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  let body;
  try { body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}"); }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const message = String(body.message || "").trim();
  if (!message || message.length > 1000) return res.status(400).json({ error: "Message must be 1-1000 characters" });
  const lang = host.includes("loyaltyapp.company") ? "he" : "en";

  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.LOYALTY_SUPPORT_MODEL || "gpt-4.1-mini",
          instructions: SYSTEM[lang] + "\nVerified product facts:\n- " + KNOWLEDGE[lang].join("\n- "),
          input: message,
          max_output_tokens: 220,
          store: false
        })
      });
      if (!result.ok) throw new Error("Provider request failed");
      const data = await result.json();
      const answer = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("\n").trim();
      if (answer) return res.status(200).json({ answer, source: "ai", language: lang, specialistHandoff: false });
    } catch (error) {
      console.error("Loyalty support provider error", error.message);
    }
  }
  return res.status(200).json({ answer: reply(lang, message), source: "verified_faq", language: lang, specialistHandoff: /account|charge|refund|locked|points missing|חשבון|חיוב|החזר|נקוד.*חסר/.test(message.toLowerCase()) });
}
