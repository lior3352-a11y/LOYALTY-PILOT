(() => {
  'use strict';
  if (document.getElementById('loyalty-customer-support')) return;
  const he = document.currentScript?.dataset.language === 'he';
  const t = he ? {
    name:'מאיה', launch:'דברו עם מאיה', role:'נציגת AI של Loyalty ישראל', close:'סיום וסגירה',
    intro:'שלום, אני מאיה, נציגת AI. אפשר לשאול אותי על ההרשמה, קוד QR והטבות Loyalty.',
    notice:'אין למסור סיסמאות או פרטי תשלום. שיחה קולית מוגבלת ל־3 דקות ול־30 שניות ללא פעילות. זיהוי דיבור נעשה בשירות הדפדפן; התמליל נשלח ל־AI.',
    placeholder:'איך אפשר לעזור?', send:'שליחה', mic:'דיבור', stop:'עצירת המיקרופון',
    listen:'מקשיבה…', working:'מכינה תשובה…', ready:'אפשר לשאול בכתב או בקול',
    checking:'בודקת זמינות…', offline:'השירות הקולי וה־AI עדיין אינם זמינים. אפשר להמשיך להשתמש באתר כרגיל.',
    unavailable:'לא התקבלה תשובה. אפשר לנסות שוב מאוחר יותר.', limited:'השיחה הסתיימה או שהשירות הגיע למגבלה. אפשר לנסות שוב מאוחר יותר.',
    ended:'השיחה הסתיימה והמיקרופון נסגר.', micError:'לא ניתן להפעיל את המיקרופון. אפשר לכתוב את השאלה.',
    unsupported:'דיבור אינו נתמך בדפדפן הזה. אפשר לשאול בכתב.', playback:'השמעת התשובה', input:'השאלה שלך',
  } : {
    name:'Emma', launch:'Talk to Emma', role:'Loyalty US AI support', close:'End and close',
    intro:'Hi, I’m Emma, an AI representative. Ask me about registration, QR codes and Loyalty rewards.',
    notice:'Do not share passwords or payment details. Voice sessions end after 3 minutes or 30 seconds of inactivity. Your browser’s speech service transcribes speech; the transcript is sent to AI.',
    placeholder:'How can I help?', send:'Send', mic:'Speak', stop:'Stop microphone',
    listen:'Listening…', working:'Preparing an answer…', ready:'Ask by text or voice',
    checking:'Checking availability…', offline:'AI and voice support are not available yet. You can continue using the website.',
    unavailable:'No answer was received. Please try again later.', limited:'This session ended or a service limit was reached. Please try again later.',
    ended:'Session ended. The microphone is off.', micError:'The microphone could not start. You can type your question.',
    unsupported:'Voice input is not supported in this browser. You can type instead.', playback:'Play answer', input:'Your question',
  };
  const host = document.createElement('div'); host.id = 'loyalty-customer-support';
  document.body.append(host);
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    :host{all:initial;font-family:Arial,sans-serif;color:#203d37;font-size:16px}
    *{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.55}
    button:focus-visible,textarea:focus-visible{outline:3px solid #539ac4;outline-offset:3px}
    .launch{position:fixed;inset-inline-end:22px;bottom:88px;z-index:2147483000;background:#286353;color:white;border:1px solid #fff8;border-radius:32px;box-shadow:0 6px 25px #0003;padding:14px 20px;display:flex;gap:10px;align-items:center;font-weight:bold;min-height:52px}
    svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;flex-shrink:0}
    dialog{position:fixed;inset:auto 20px 20px auto;width:400px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 32px);margin:0;padding:0;background:#fff;color:#203d37;border:1px solid #d8e2dc;border-radius:22px;box-shadow:0 20px 80px #0004;overflow:auto}
    dialog::backdrop{background:#12221c55}header{display:flex;gap:12px;align-items:center;background:#eff5f0;padding:18px}
    .avatar{width:46px;height:46px;border-radius:50%;background:#286353;color:#fff;display:grid;place-items:center;font-size:24px}h2{font-size:20px;margin:0 0 4px}header p{font-size:13px;margin:0;color:#49665e}
    .close{margin-inline-start:auto;border:1px solid #cbd9cf;background:white;border-radius:50%;width:38px;height:38px;font-size:24px;color:#203d37}
    .log{padding:16px;min-height:150px;max-height:32dvh;overflow:auto;display:flex;flex-direction:column;gap:12px}
    .message{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:14px;background:#eff4f1;padding:12px 14px;line-height:1.6;font-size:15px}
    .user{background:#286353;color:#fff;margin-inline-start:30px}.notice{padding:0 16px;color:#52655e;font-size:12px;line-height:1.6}
    .status{margin:12px 16px;font-size:13px;line-height:1.5;color:#48655d}form{padding:0 16px 16px}textarea{width:100%;resize:vertical;min-height:60px;max-height:120px;border:1px solid #b4c7bc;border-radius:12px;background:#fff;color:#203d37;padding:12px;font-size:16px}
    .actions{display:flex;gap:8px;margin-top:10px}.actions button,.play{border:1px solid #b4c7bc;background:white;color:#203d37;padding:11px 14px;border-radius:10px;min-height:44px}.actions .send{background:#286353;color:white;border-color:#286353;flex:1}.mic.on{background:#a72c38;color:#fff}.play{margin:0 16px 10px;font-size:13px}
    [hidden]{display:none!important}@media(max-width:480px){dialog{inset:auto 12px 12px;width:calc(100vw - 24px)}.launch{inset-inline-end:16px;bottom:calc(80px + env(safe-area-inset-bottom));padding:12px 16px}}
    @media(prefers-reduced-motion:no-preference){.launch:hover{transform:translateY(-2px)}}
  </style>
  <button class="launch" type="button" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg><span></span></button>
  <dialog aria-labelledby="support-name"><header><div class="avatar" aria-hidden="true"></div><div><h2 id="support-name"></h2><p class="role"></p></div><button class="close" type="button">×</button></header><div class="log" role="log" aria-live="polite" aria-relevant="additions"></div><p class="notice"></p><p class="status" role="status"></p><button class="play" type="button" hidden></button><form><textarea rows="2" maxlength="1200" required></textarea><div class="actions"><button class="mic" type="button"></button><button class="send" type="submit"></button></div></form></dialog>`;
  const $ = s => root.querySelector(s), dialog = $('dialog'), launch = $('.launch'), input = $('textarea');
  host.dir = he ? 'rtl' : 'ltr'; dialog.dir = host.dir; launch.dir = host.dir;
  $('.launch span').textContent = t.launch; $('#support-name').textContent = t.name; $('.avatar').textContent = he ? 'מ' : 'E';
  $('.role').textContent = t.role; $('.close').ariaLabel = t.close; $('.notice').textContent = t.notice;
  input.placeholder = t.placeholder; input.ariaLabel = t.input; $('.send').textContent = t.send; $('.mic').textContent = t.mic; $('.play').textContent = t.playback;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let available = false, busy = false, token = '', history = [], controller, recognition, audio, audioUrl;
  let expiryTimer, idleTimer, recordTimer, generation = 0;
  const status = text => { $('.status').textContent = text; };
  const controls = () => { input.disabled = !available || busy; $('.send').disabled = !available || busy; $('.mic').disabled = !available || busy || !Recognition; };
  function add(text, user = false) { const p = document.createElement('p'); p.className = 'message' + (user ? ' user' : ''); p.textContent = text; $('.log').append(p); p.scrollIntoView({block:'nearest'}); }
  function stopMic() { clearTimeout(recordTimer); if(recognition){ recognition.onend = null; recognition.onresult = null; recognition.onerror = null; recognition.abort(); recognition = null; } $('.mic').classList.remove('on'); $('.mic').textContent = t.mic; }
  function stopAudio() { if(audio){audio.pause();audio.src='';audio=null;} if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;} $('.play').hidden=true; }
  function end() { generation++; clearTimeout(expiryTimer);clearTimeout(idleTimer);stopMic();stopAudio();controller?.abort();token='';history=[];busy=false;available=false;controls();status(t.ended); }
  function idle() { clearTimeout(idleTimer); if(token) idleTimer=setTimeout(end,30000); }
  async function post(body,signal) { const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}); const d=await r.json();if(!r.ok)throw new Error(r.status===429||r.status===410?'limit':'unavailable');return d; }
  async function session() {
    if(token)return;
    const g=generation;const d=await post({action:'start'},controller.signal);
    if(g!==generation)throw new Error('ended');token=d.token;expiryTimer=setTimeout(end,Math.min(180,d.maxSeconds)*1000);idle();
  }
  async function send(message,voice) {
    if(!available||busy||!message.trim())return;busy=true;controls();stopMic();stopAudio();clearTimeout(idleTimer);
    controller=new AbortController();const g=generation;status(t.working);
    try {
      await session();clearTimeout(idleTimer);add(message,true);input.value='';
      const d=await post({token,language:he?'he':'en',message,history,voice},controller.signal);
      if(g!==generation)return;add(d.text);history=[...history,{role:'user',content:message},{role:'assistant',content:d.text}].slice(-6);
      if(d.audio){const bytes=Uint8Array.from(atob(d.audio),c=>c.charCodeAt(0));audioUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));audio=new Audio(audioUrl);$('.play').hidden=false;audio.onended=idle;await audio.play().catch(()=>{});}
      status(t.ready);
    } catch(e) { if(g===generation){status(e.message==='limit'?t.limited:t.unavailable);if(e.message==='limit'){end();status(t.limited);}} }
    finally { if(g===generation){busy=false;controls();idle();} }
  }
  launch.onclick=async()=>{
    end();$('.log').replaceChildren();add(t.intro);dialog.showModal();available=false;status(t.checking);controls();
    const g=generation;controller=new AbortController();
    try{const r=await fetch('/api/support',{signal:controller.signal,cache:'no-store'});const d=await r.json();if(g!==generation||!dialog.open)return;available=r.ok&&d.available===true;status(available?(Recognition?t.ready:t.unsupported):t.offline);controls();if(available)input.focus();}catch{if(g===generation)status(t.offline);}
  };
  $('.close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{end();launch.focus();});
  $('form').onsubmit=e=>{e.preventDefault();send(input.value,false);};input.addEventListener('input',idle);
  $('.play').onclick=()=>{if(audio){audio.currentTime=0;audio.play().catch(()=>status(t.unavailable));idle();}};
  $('.mic').onclick=async()=>{
    if(recognition){stopMic();idle();status(t.ready);return;}if(!Recognition||!available||busy)return;
    controller=new AbortController();const g=generation;busy=true;controls();
    try{await session();if(g!==generation)return;busy=false;controls();recognition=new Recognition();recognition.lang=he?'he-IL':'en-US';recognition.continuous=false;recognition.interimResults=false;
      recognition.onresult=e=>{const message=e.results[0]?.[0]?.transcript?.slice(0,1200)||'';stopMic();if(message)send(message,true);};
      recognition.onerror=()=>{stopMic();status(t.micError);idle();};recognition.onend=()=>{stopMic();status(t.ready);idle();};
      recognition.start();$('.mic').classList.add('on');$('.mic').textContent=t.stop;status(t.listen);recordTimer=setTimeout(()=>{stopMic();status(t.ready);idle();},15000);
    }catch{if(g===generation){status(t.micError);busy=false;controls();}}
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open)end();});window.addEventListener('pagehide',end);controls();
})();
