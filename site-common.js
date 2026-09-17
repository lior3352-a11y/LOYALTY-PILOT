(()=>{
 const ready=()=>{
  const main=document.querySelector('main')||document.querySelector('.content')||document.querySelector('.app');
  if(main){if(!main.id)main.id='main-content';if(main.tagName!=='MAIN')main.setAttribute('role','main')}
  if(main&&!document.querySelector('.skip-link')){const skip=document.createElement('a');skip.className='skip-link';skip.href='#'+main.id;skip.textContent='Skip to main content';document.body.prepend(skip)}
  document.querySelectorAll('label:not([for])').forEach((label,index)=>{let field=label.nextElementSibling;if(!field||!/^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName))return;if(!field.id)field.id='field-'+index;label.htmlFor=field.id});
  document.querySelectorAll('button:not([type])').forEach(button=>button.type='button');
  ['result','loginResult','dashboardStatus','customersStatus','historyStatus','redeemResult','qrShareStatus','msg','status','billingNotice'].forEach(id=>{const el=document.getElementById(id);if(el){el.setAttribute('role','status');el.setAttribute('aria-live','polite')}});
  const qr=document.getElementById('businessQr');if(qr&&!qr.alt)qr.alt='Business loyalty QR code';
  if(!document.querySelector('.legal-links')){const nav=document.createElement('nav');nav.className='legal-links';nav.setAttribute('aria-label','Legal and accessibility');nav.innerHTML='<a href="accessibility.html">Accessibility</a><a href="terms.html">Terms of Service</a>';document.body.append(nav)}

  // Loyalty US is English-only. Repair any stale/mixed-language labels left by an older cached build.
  document.documentElement.lang='en';document.documentElement.dir='ltr';
  document.querySelectorAll('label').forEach(label=>{if(/[\u0590-\u05FF]/.test(label.textContent||'')){const field=label.htmlFor?document.getElementById(label.htmlFor):label.nextElementSibling;if(field?.type==='email')label.textContent='Email';else if(field?.type==='password')label.textContent='Password'}});
  const hello=document.getElementById('businessHello');const login=document.getElementById('loginCard');if(hello&&login&&!login.classList.contains('hidden')&&/Loading/i.test(hello.textContent||''))hello.textContent='Business owner login';

  // Black + refined gold visual system for Loyalty US, including mobile.
  const style=document.createElement('style');style.id='loyalty-us-black-gold';style.textContent=`
   :root{--navy:#090909!important;--navy2:#171717!important;--gold:#c9a24a!important;--bg:#111!important;--text:#f5f1e8!important;--muted:#b8b0a0!important;--line:#3a3428!important}
   body{background:#111!important;color:#f5f1e8!important} .app{background:#151515!important}
   .top{background:linear-gradient(135deg,#050505,#17130b)!important;border-bottom:1px solid #4b3b1d!important}.brand{color:#fff!important}.hello{color:#d8c28d!important}
   .card,.modal-box{background:#1d1d1d!important;color:#f5f1e8!important;box-shadow:0 8px 24px rgba(0,0,0,.28)!important}
   input,select,textarea,.readonly,.dash,.metric,.history-row,.customer-row,.customer-stat{background:#252525!important;color:#fff!important;border-color:#4a4438!important}
   input:focus,select:focus,textarea:focus{outline:2px solid #c9a24a!important;outline-offset:1px}
   .btn{background:#c9a24a!important;color:#111!important}.btn.secondary{background:#242424!important;color:#e5c878!important;border-color:#6a5428!important}.btn.redeem,.share-primary{background:#c9a24a!important;color:#111!important}
   .small,.dash span,.metric span,.history-meta,.customer-meta,.customer-stat span{color:#b8b0a0!important}.warn{background:#33270f!important;color:#f3d58c!important}.ok{background:#173025!important;color:#bce8ce!important}
   .qr-wrap{border-color:#c9a24a!important}.legal-links{background:#111!important;color:#d8c28d!important}.legal-links a{color:#d8c28d!important}
   @media(max-width:520px){.content{padding:16px!important}.top{padding:24px 18px!important}.card{padding:18px!important}.brand{font-size:27px!important}h2{font-size:25px!important}input{font-size:16px!important;min-height:52px}.btn{min-height:52px!important}}
  `;document.head.append(style);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
