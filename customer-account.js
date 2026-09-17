const isHebrew = document.documentElement.lang === 'he';
const words = (he, en) => isHebrew ? he : en;
const money = amount => (isHebrew ? '₪' : '$') + Number(amount).toFixed(2);
const status = document.getElementById('status');
let generation = 0, busy = false, signedOut = false, approvalTimer;
history.replaceState(null, '', location.pathname);
localStorage.removeItem('loyalty_wallet_token');
function clearAccount() {
  document.getElementById('hello').textContent = '';
  document.getElementById('total').textContent = '--';
  document.getElementById('businessBalance').textContent = '--';
  document.getElementById('businessName').textContent = 'LOYALTY';
  document.getElementById('history').replaceChildren();
  document.getElementById('approvalCode').textContent = '';
  clearTimeout(approvalTimer);
}
function showLogin() {
  signedOut = true; generation++; clearAccount();
  location.replace('join.html?mode=login&business_id=' + encodeURIComponent(localStorage.getItem('loyalty_business_id') || ''));
}
async function api(body) {
  const response = await fetch('/api/neon', {method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (response.status === 401) { showLogin(); throw new Error('Please sign in'); }
  if (!response.ok) throw new Error(data.error || 'Unable to connect');
  return data;
}
async function refresh() {
  if (busy || signedOut || document.hidden) return;
  busy = true; const started = generation;
  try {
    const data = await api({action:'wallet'});
    if (started !== generation || signedOut) return;
    const c = data.customer;
    localStorage.setItem('loyalty_business_id', String(c.business_id));
    document.getElementById('hello').textContent = words('שלום ', 'Hello ') + c.name;
    document.getElementById('businessName').textContent = c.business_name;
    document.getElementById('businessLogo').textContent = c.business_name.charAt(0);
    document.getElementById('earnRate').textContent = Number(c.loyalty_rate) + words('% צבירה', '% earned');
    document.getElementById('total').textContent = money(c.balance);
    document.getElementById('businessBalance').textContent = money(c.balance);
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString(isHebrew ? 'he-IL' : 'en-US', {hour:'2-digit',minute:'2-digit'});
    const history = document.getElementById('history'); history.replaceChildren();
    for (const tx of data.transactions || []) {
      const row = document.createElement('div'); row.className = 'history';
      const label = document.createElement('span'); label.textContent = tx.type === 'redeem' ? words('מימוש הטבה', 'Reward redeemed') : words('רכישה ', 'Purchase ') + money(tx.purchase_amount);
      const amount = document.createElement('b'); amount.textContent = (Number(tx.earned_amount) >= 0 ? '+' : '−') + money(Math.abs(Number(tx.earned_amount)));
      row.append(label, amount); history.append(row);
    }
    if (!history.children.length) history.textContent = words('עדיין אין פעילות.', 'No activity yet.');
    status.textContent = words('החשבון מעודכן ✓', 'Your rewards are up to date ✓');
  } catch { if (!signedOut) { clearAccount(); status.textContent = words('לא ניתן לטעון את הנתונים. נסו שוב.', 'Unable to load your rewards. Please try again.'); } }
  finally { busy = false; }
}
document.getElementById('logoutBtn').addEventListener('click', async () => {
  generation++; clearAccount(); signedOut = true;
  try { await api({action:'customer_logout'}); localStorage.setItem('loyalty_customer_logout', String(Date.now())); showLogin(); }
  catch { signedOut = false; status.textContent = words('ההתנתקות לא הושלמה. בדקו חיבור ונסו שוב.', 'Sign out did not complete. Check your connection and retry.'); }
});
document.getElementById('approveBtn').addEventListener('click', async () => {
  const button = document.getElementById('approveBtn'); button.disabled = true; const started = generation;
  try {
    const d = await api({action:'customer_approve_redemption',amount:document.getElementById('approvalAmount').value});
    if (started !== generation || signedOut) return;
    document.getElementById('approvalCode').textContent = words('קוד לקופה (תקף ל־5 דקות): ', 'Checkout code (valid for 5 minutes): ') + d.code.match(/.{4}/g).join('-') + ' · ' + money(d.amount);
    clearTimeout(approvalTimer); approvalTimer = setTimeout(() => { document.getElementById('approvalCode').textContent = words('תוקף הקוד פג.', 'Code expired.'); }, d.expires_in * 1000);
  } catch { if (!signedOut) document.getElementById('approvalCode').textContent = words('לא ניתן ליצור קוד. בדקו את היתרה והסכום.', 'Unable to create a code. Check your balance and amount.'); }
  finally { button.disabled = false; }
});
window.addEventListener('storage', e => { if (e.key === 'loyalty_customer_logout') showLogin(); });
window.addEventListener('pagehide', () => { generation++; clearAccount(); });
window.addEventListener('pageshow', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
document.getElementById('installBtn').addEventListener('click', () => { document.getElementById('iosHelp').style.display = 'block'; document.getElementById('iosHelp').textContent = words('בתפריט הדפדפן בחרו הוספה למסך הבית.', 'Choose Add to Home Screen in your browser menu.'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
refresh(); setInterval(refresh, 15000);
