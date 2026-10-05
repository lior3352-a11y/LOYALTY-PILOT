const isHebrew = document.documentElement.lang === 'he';
const words = (he, en) => isHebrew ? he : en;
const params = new URLSearchParams(location.search);
let businessId = Number(params.get('business_id') || localStorage.getItem('loyalty_business_id') || 0);
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
function setBusiness(business) {
  businessId = Number(business.id);
  document.getElementById('businessName').textContent = business.name;
  document.getElementById('rewardRate').textContent = Number(business.loyalty_rate) + '%';
  localStorage.setItem('loyalty_business_id', String(businessId));
  history.replaceState(null, '', location.pathname + '?business_id=' + businessId);
  businessReady = true;
  msg.className = '';
  msg.textContent = '';
  showMode();
}
async function loadBusiness() {
  if (mode === 'setup') { document.getElementById('businessName').textContent = words('הגדרת סיסמה', 'Set your password'); return; }
  const picker = document.getElementById('businessPicker');
  const select = document.getElementById('businessSelect');
  if (businessId) {
    try {
      const data = await api({action:'public_business',business_id:businessId});
      if (picker) picker.hidden = true;
      setBusiness(data.business);
    } catch {
      businessReady = false;
      msg.className = 'msg bad';
      msg.textContent = words('פרטי העסק אינם זמינים כרגע.', 'Business details are currently unavailable.');
      showMode();
    }
    return;
  }
  if (picker) picker.hidden = false;
  try {
    const data = await api({action:'public_businesses'});
    const businesses = Array.isArray(data.businesses) ? data.businesses : [];
    if (!businesses.length) {
      if (select) select.innerHTML = '<option value="">עדיין אין עסקים זמינים</option>';
      msg.className = 'msg bad';
      msg.textContent = words('כרגע אין עסק פתוח להצטרפות. בעל עסק צריך לפתוח חשבון קודם.', 'No business is available to join yet.');
      showMode();
      return;
    }
    if (select) {
      select.innerHTML = '<option value="">בחרו עסק להצטרפות</option>' + businesses.map(b => '<option value="' + b.id + '">' + b.name + ' - ' + Number(b.loyalty_rate) + '% צבירה</option>').join('');
      select.addEventListener('change', () => {
        const selected = businesses.find(b => String(b.id) === select.value);
        if (selected) setBusiness(selected);
      });
    }
    document.getElementById('businessName').textContent = words('בחרו עסק להצטרפות', 'Choose a business to join');
    document.getElementById('rewardRate').textContent = '--%';
    msg.className = 'msg bad';
    msg.textContent = words('בחרו עסק מהרשימה ואז מלאו את הפרטים.', 'Choose a business, then enter your details.');
    showMode();
  } catch {
    msg.className = 'msg bad';
    msg.textContent = words('לא ניתן לטעון את רשימת העסקים כרגע.', 'The business list is not available right now.');
    showMode();
  }
}
showMode();
loadBusiness();
