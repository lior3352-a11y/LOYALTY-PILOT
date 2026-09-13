
(function(){
  const script=document.currentScript;
  const biz=script.getAttribute('data-business');
  if(!biz) return;
  const wrap=document.createElement('div');
  wrap.style.cssText='font-family:Arial,sans-serif;background:#0b1220;color:#fff;border:1px solid #e5bf6350;border-radius:18px;padding:18px;max-width:320px;text-align:center;box-shadow:0 12px 30px #0002';
  const url=(script.src ? new URL(script.src).origin : location.origin)+'/claim.html?biz='+encodeURIComponent(biz);
  wrap.innerHTML='<div style="font-weight:900;font-size:20px">LOYALTY</div><div style="font-size:22px;font-weight:900;color:#e5bf63;margin:8px 0">Scan to See What You Earn</div><img alt="LOYALTY QR" style="width:180px;height:180px;background:white;padding:8px;border-radius:14px" src="https://api.qrserver.com/v1/create-qr-code/?size=360x360&data='+encodeURIComponent(url)+'"><div style="font-size:12px;color:#aab4c9;margin-top:8px">Rewards powered by LOYALTY</div>';
  script.parentNode.insertBefore(wrap,script.nextSibling);
})();
