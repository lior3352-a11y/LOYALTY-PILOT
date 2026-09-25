(()=>{
 const ready=()=>{
  const main=document.querySelector('main')||document.querySelector('.content')||document.querySelector('.app');
  if(main){if(!main.id)main.id='main-content';if(main.tagName!=='MAIN')main.setAttribute('role','main')}
  if(main&&!document.querySelector('.skip-link')){const skip=document.createElement('a');skip.className='skip-link';skip.href='#'+main.id;skip.textContent='דילוג לתוכן הראשי';document.body.prepend(skip)}
  document.querySelectorAll('label:not([for])').forEach((label,index)=>{const field=label.nextElementSibling;if(!field||!/^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName))return;if(!field.id)field.id='field-'+index;label.htmlFor=field.id});
  document.querySelectorAll('button:not([type])').forEach(button=>button.type='button');
  ['result','loginResult','dashboardStatus','customersStatus','historyStatus','redeemResult','qrShareStatus','msg','status','billingNotice'].forEach(id=>{const el=document.getElementById(id);if(el){el.setAttribute('role','status');el.setAttribute('aria-live','polite')}});
  const qr=document.getElementById('businessQr');if(qr&&!qr.alt)qr.alt='קוד QR של העסק';
  // Legal links are added only when Israel-specific texts are published.
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
