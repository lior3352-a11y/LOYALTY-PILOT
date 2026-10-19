(() => {
  if (window.__loyaltySupportLoaded) return;
  window.__loyaltySupportLoaded = true;
  const copy = {
    he: {open:"דברו עם Loyalty", title:"עוזר התמיכה של Loyalty", intro:"שלום! אני עוזר AI. במה אפשר לעזור?", placeholder:"כתבו שאלה כללית…", send:"שליחה", listen:"דברו", stop:"עצירה", close:"סגירה", language:"שפת השיחה", voiceOff:"הדפדפן לא תומך בזיהוי דיבור. אפשר לכתוב כאן.", busy:"רגע, אני בודק…", stopped:"נעצר.", err:"לא הצלחתי להתחבר כרגע. נסו שוב בעוד רגע.", micError:"לא ניתן להפעיל את המיקרופון. בדקו הרשאה או כתבו כאן.", limited:"הגעתם למגבלת השימוש בתמיכה. נסו שוב מאוחר יותר.", privacy:"אל תכתבו סיסמאות, קודי אימות או פרטי כרטיס. אין לי גישה לחשבונות."},
    en: {open:"Talk to Loyalty", title:"Loyalty support assistant", intro:"Hi! I’m Loyalty’s AI assistant. How can I help?", placeholder:"Ask a general question…", send:"Send", listen:"Speak", stop:"Stop", close:"Close", language:"Conversation language", voiceOff:"Speech recognition isn't available in this browser. You can type here.", busy:"One moment…", stopped:"Stopped.", err:"I couldn't connect just now. Please try again shortly.", micError:"The microphone could not start. Check permission or type here.", limited:"The support usage limit has been reached. Please try again later.", privacy:"Don't share passwords, verification codes, or card details. I can't access accounts."}
  };
  let lang = document.documentElement.lang.toLowerCase().startsWith("he") ? "he" : "en";
  try { const saved = localStorage.getItem("loyalty-support-language"); if (saved === "he" || saved === "en") lang = saved; } catch {}
  let t = copy[lang], recognition, listeningTimer, speechTimer, controller, pending, generation = 0;
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/support-widget.css?v=2"; document.head.append(css);
  const host = document.createElement("div"); host.id = "loyalty-support-root";
  host.innerHTML = `<button class="ls-launch"><span aria-hidden="true">◉</span><span></span></button><section class="ls-panel" role="dialog" aria-modal="false" hidden><header class="ls-head"><strong></strong><button class="ls-close">×</button></header><div class="ls-controls"><label><span class="ls-language-label"></span> <select class="ls-language"><option value="en">English</option><option value="he">עברית</option></select></label><button class="ls-stop" type="button"></button></div><div class="ls-messages" aria-live="polite"></div><p class="ls-privacy"></p><form class="ls-form"><button type="button" class="ls-mic">🎙</button><input maxlength="1000" required><button class="ls-send" type="submit"></button></form></section>`;
  document.body.append(host);
  const panel = host.querySelector(".ls-panel"), launch = host.querySelector(".ls-launch"), list = host.querySelector(".ls-messages"), form = host.querySelector("form"), input = form.querySelector("input"), mic = host.querySelector(".ls-mic"), select = host.querySelector(".ls-language"), stop = host.querySelector(".ls-stop"), close = host.querySelector(".ls-close"), send = host.querySelector(".ls-send");
  const locale = () => lang === "he" ? "he-IL" : "en-US";
  function add(text, who, language = lang) {
    const p = document.createElement("p"); p.className = "ls-bubble " + (who === "user" ? "ls-user" : "ls-agent"); p.textContent = text; p.lang = language; p.dir = language === "he" ? "rtl" : "ltr"; list.append(p); list.scrollTop = list.scrollHeight; return p;
  }
  function busy(value) { input.disabled = send.disabled = mic.disabled = value; }
  function halt() {
    generation++;
    clearTimeout(listeningTimer); clearTimeout(speechTimer);
    const active = recognition; recognition = null;
    if (active) { try { active.abort(); } catch {} }
    mic.classList.remove("listening");
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (controller) controller.abort(); controller = null;
    if (pending) { pending.textContent = t.stopped; pending = null; }
    busy(false);
  }
  function translate() {
    t = copy[lang]; panel.lang = lang; panel.dir = lang === "he" ? "rtl" : "ltr";
    panel.setAttribute("aria-label", t.title); launch.setAttribute("aria-label", t.open); launch.title = t.open;
    launch.querySelector("span:last-child").textContent = t.open;
    panel.querySelector("strong").textContent = t.title; close.setAttribute("aria-label", t.close);
    host.querySelector(".ls-language-label").textContent = t.language; select.setAttribute("aria-label", t.language); select.value = lang;
    stop.textContent = t.stop; input.placeholder = t.placeholder; input.setAttribute("aria-label", t.placeholder);
    send.textContent = t.send; mic.setAttribute("aria-label", t.listen); host.querySelector(".ls-privacy").textContent = t.privacy;
  }
  translate(); add(t.intro, "agent");
  launch.onclick = () => { panel.hidden = false; launch.hidden = true; input.focus(); };
  close.onclick = () => { halt(); panel.hidden = true; launch.hidden = false; launch.focus(); };
  stop.onclick = () => { halt(); input.focus(); };
  select.onchange = () => { halt(); lang = select.value === "he" ? "he" : "en"; translate(); try { localStorage.setItem("loyalty-support-language", lang); } catch {} input.focus(); };
  panel.onkeydown = event => { if (event.key === "Escape") close.click(); };
  window.addEventListener("pagehide", halt);
  mic.onclick = () => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return add(t.voiceOff, "agent");
    halt();
    const rec = new Rec(); recognition = rec; rec.lang = locale(); rec.interimResults = false;
    mic.classList.add("listening");
    rec.onresult = event => {
      if (recognition !== rec) return;
      const text = event.results?.[0]?.[0]?.transcript;
      recognition = null; clearTimeout(listeningTimer); mic.classList.remove("listening");
      if (text) { input.value = text; form.requestSubmit(); }
    };
    rec.onerror = () => { if (recognition === rec) { recognition = null; clearTimeout(listeningTimer); mic.classList.remove("listening"); add(t.micError, "agent"); } };
    rec.onend = () => { if (recognition === rec) { recognition = null; clearTimeout(listeningTimer); mic.classList.remove("listening"); } };
    try { rec.start(); listeningTimer = setTimeout(() => { if (recognition === rec) halt(); }, 30000); }
    catch { recognition = null; mic.classList.remove("listening"); add(t.micError, "agent"); }
  };
  form.onsubmit = async event => {
    event.preventDefault(); const message = input.value.trim(); if (!message || input.disabled) return;
    halt(); const id = generation, language = lang, labels = t;
    input.value = ""; add(message, "user"); const bubble = add(labels.busy, "agent"); pending = bubble;
    const request = new AbortController(); controller = request; busy(true);
    const timer = setTimeout(() => request.abort(), 16000);
    try {
      const response = await fetch("/api/support", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({message, lang:language}), signal:request.signal});
      if (id !== generation) return;
      if (response.status === 429) { bubble.textContent = labels.limited; return; }
      if (!response.ok) throw new Error("Support unavailable");
      const data = await response.json(); if (id !== generation) return;
      if (typeof data.answer !== "string" || !data.answer.trim()) throw new Error("Invalid answer");
      bubble.textContent = data.answer;
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(data.answer); utterance.lang = language === "he" ? "he-IL" : "en-US";
        const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(language)); if (voice) utterance.voice = voice;
        utterance.onend = utterance.onerror = () => { if (id === generation) clearTimeout(speechTimer); };
        window.speechSynthesis.speak(utterance);
        speechTimer = setTimeout(() => window.speechSynthesis.cancel(), 60000);
      }
    } catch { if (id === generation) bubble.textContent = labels.err; }
    finally { clearTimeout(timer); if (id === generation) { pending = null; controller = null; busy(false); if (!panel.hidden) input.focus(); } }
  };
})();
