(() => {
  if (window.__loyaltySupportLoaded) return;
  window.__loyaltySupportLoaded = true;
  const he = location.hostname.includes("loyaltyapp.company");
  const t = he ? {open:"צריכים עזרה?",title:"עוזר התמיכה של Loyalty",intro:"שלום! אני עוזר AI. במה אפשר לעזור?",placeholder:"כתבו שאלה כללית…",send:"שליחה",listen:"דברו",stop:"עצירה",close:"סגירה",voiceOff:"הדפדפן לא תומך בזיהוי דיבור. אפשר לכתוב כאן.",busy:"רגע, אני בודק…",err:"לא הצלחתי להתחבר כרגע. נסו שוב בעוד רגע.",privacy:"אל תכתבו סיסמאות, קודי אימות או פרטי כרטיס. כרגע אין לי גישה לחשבונות."}
  : {open:"Need help?",title:"Loyalty support assistant",intro:"Hi! I’m Loyalty’s AI assistant. How can I help?",placeholder:"Ask a general question…",send:"Send",listen:"Speak",stop:"Stop",close:"Close",voiceOff:"Speech recognition isn't available in this browser. You can type here.",busy:"One moment…",err:"I couldn't connect just now. Please try again shortly.",privacy:"Don't share passwords, verification codes, or card details. I can't access accounts."};
  const css=document.createElement("link");css.rel="stylesheet";css.href="/support-widget.css";document.head.append(css);
  const host=document.createElement("div");host.id="loyalty-support-root";
  host.innerHTML=`<button class="ls-launch" aria-label="${t.open}" title="${t.open}"><span aria-hidden="true">◉</span><span>${t.open}</span></button><section class="ls-panel" role="dialog" aria-modal="false" aria-label="${t.title}" hidden><header class="ls-head"><strong>${t.title}</strong><button class="ls-close" aria-label="${t.close}">×</button></header><div class="ls-messages" aria-live="polite"><p class="ls-bubble ls-agent">${t.intro}</p></div><p class="ls-privacy">${t.privacy}</p><form class="ls-form"><button type="button" class="ls-mic" aria-label="${t.listen}">🎙</button><input maxlength="1000" aria-label="${t.placeholder}" placeholder="${t.placeholder}" required><button class="ls-send" type="submit">${t.send}</button></form></section>`;
  document.body.append(host);
  const panel=host.querySelector(".ls-panel"), launch=host.querySelector(".ls-launch"), list=host.querySelector(".ls-messages"), form=host.querySelector("form"), input=form.querySelector("input"), mic=host.querySelector(".ls-mic");
  function add(text,who){const p=document.createElement("p");p.className="ls-bubble "+(who==="user"?"ls-user":"ls-agent");p.textContent=text;list.append(p);list.scrollTop=list.scrollHeight;return p}
  launch.onclick=()=>{panel.hidden=false;launch.hidden=true;input.focus()};
  host.querySelector(".ls-close").onclick=()=>{panel.hidden=true;launch.hidden=false;launch.focus()};
  const Rec=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Rec){mic.title=t.voiceOff;mic.onclick=()=>add(t.voiceOff,"agent")}
  else {const rec=new Rec();rec.lang=he?"he-IL":"en-US";rec.interimResults=false;mic.onclick=()=>{mic.classList.add("listening");rec.start()};rec.onresult=e=>{input.value=e.results[0][0].transcript;mic.classList.remove("listening");form.requestSubmit()};rec.onerror=()=>mic.classList.remove("listening");rec.onend=()=>mic.classList.remove("listening")}
  form.onsubmit=async e=>{e.preventDefault();const message=input.value.trim();if(!message)return;input.value="";add(message,"user");const pending=add(t.busy,"agent");form.querySelectorAll("button,input").forEach(x=>x.disabled=true);
    try{const r=await fetch("/api/support",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});if(!r.ok)throw new Error();const d=await r.json();pending.textContent=d.answer;if("speechSynthesis"in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(d.answer))}}
    catch{pending.textContent=t.err}finally{form.querySelectorAll("button,input").forEach(x=>x.disabled=false);input.focus()}
  };
})();