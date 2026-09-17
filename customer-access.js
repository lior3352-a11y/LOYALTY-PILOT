const isHebrew = document.documentElement.lang === 'he';
const words = (he, en) => isHebrew ? he : en;
const params = new URLSearchParams(location.search);
const businessId = Number(params.get('business_id') || localStorage.getItem('loyalty_business_id') || 0);
const setupToken = new URLSearchParams(location.hash.slice(1)).get('setup');
let mode = setupToken ? 'setup' : params.get('mode') === 'login' ? 'login' : 'register';
let businessReady = false;
history.replaceState(null, '', location.pathname + (businessId ? '?business_id=' + businessId : ''));
localStorage.removeItem('loyalty_wallet_token');
const msg = document.getElementById('msg'), btn = document.getElementById('btn');
function showMode() {
  document.getElementById('name').hidden = mode !== 'register';
  document.getElementById('nameLabel').hidden = mode !== 'register';
  document.getElementById('phone').disabled = mode === 'setup';
  document.getElementById('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  btn.textContent = mode === 'login' ? words('התחברות', 'Sign in') : mode === 'setup' ? words('שמירת סיסמה', 'Set password') : words('הצטרפות עכשיו', 'Join now');
  document.getElementById('modeBtn').hidden = mode === 'setup';
  document.getElementById('modeBtn').textContent = mode === 'login' ? words('חדש כאן — הרשמה', 'New here? Create account') : words('כבר הצטרפתי — התחברות', 'Already joined? Sign in');
  btn.disabled = mode !== 'setup' && !businessReady;
}
function toggleCustomerMode() { mode = mode === 'login' ? 'register' : 'login'; msg.textContent = ''; showMode(); }
async function api(body) {
  const response = await fetch('/api/neon', {method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) { const e = new Error(data.error || 'Unable to connect'); e.status = response.status; throw e; }
  return data;
}
async function submitCustomer() {
  btn.disabled = true;
  try {
    const password = document.getElementById('password').value;
    const phone = document.getElementById('phone').value.trim(), name = document.getElementById('name').value.trim();
    if (password.length < 12 || password.length > 128) throw new Error(words('יש לבחור סיסמה באורך 12–128 תווים.', 'Use 12–128 characters for your password.'));
    await api({ action: mode === 'login' ? 'customer_login' : mode === 'setup' ? 'customer_set_password' : 'register_customer', business_id:businessId, name, phone, password, setup_token:setupToken });
    if (businessId) localStorage.setItem('loyalty_business_id', String(businessId));
    document.getElementById('password').value = '';
    location.replace('customer.html');
  } catch(e) {
    msg.className = 'msg bad';
    msg.textContent = isHebrew && e.status ? (e.status === 429 ? 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.' : e.status === 401 ? 'פרטי ההתחברות אינם נכונים. לחשבון ישן או לאיפוס סיסמה, פנו לבעל העסק לאימות זהות.' : e.status === 409 ? 'לא ניתן להירשם. אם כבר הצטרפתם, בחרו התחברות או פנו לבעל העסק לשחזור גישה.' : 'הפעולה לא הושלמה. בדקו את הפרטים ונסו שוב.') : e.message;
  } finally { showMode(); }
}
document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter' && !btn.disabled) submitCustomer(); });
showMode();
(async () => {
  if (mode === 'setup') { document.getElementById('businessName').textContent = words('הגדרת סיסמה', 'Set your password'); return; }
  if (!businessId) { msg.className = 'msg bad'; msg.textContent = words('לכניסה, סרקו את קוד ה־QR של העסק.', 'Scan your business QR code to sign in.'); return; }
  try {
    const data = await api({action:'public_business',business_id:businessId});
    document.getElementById('businessName').textContent = data.business.name;
    document.getElementById('rewardRate').textContent = Number(data.business.loyalty_rate) + '%';
    businessReady = true; showMode();
  } catch { msg.textContent = words('פרטי העסק אינם זמינים כרגע.', 'Business details are currently unavailable.'); }
})();
