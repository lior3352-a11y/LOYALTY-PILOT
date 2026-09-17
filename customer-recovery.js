(() => {
  const he = document.documentElement.lang === 'he';
  const area = document.getElementById('merchantArea'); if (!area) return;
  const panel = document.createElement('section'); panel.className = 'card';
  const heading = document.createElement('h3'); heading.textContent = he ? 'שחזור גישה ללקוח' : 'Restore customer access';
  const help = document.createElement('p'); help.textContent = he ? 'לבעל העסק בלבד: יש לאמת את זהות הלקוח באופן אישי לפני מסירת הקישור. מספר טלפון לבדו אינו אימות.' : 'Business owners only: verify the customer identity in person before handing over the link. A phone number alone is not verification.';
  const phone = document.createElement('input'); phone.type = 'tel'; phone.placeholder = he ? 'טלפון הלקוח' : 'Customer phone'; phone.setAttribute('aria-label', phone.placeholder);
  const label = document.createElement('label'), verified = document.createElement('input'); verified.type = 'checkbox'; label.append(verified, he ? ' אימתתי את זהות הלקוח' : ' I verified the customer identity');
  const button = document.createElement('button'); button.className = 'btn'; button.textContent = he ? 'יצירת קישור חד־פעמי להגדרת סיסמה' : 'Create one-time password setup link';
  const result = document.createElement('p'); result.setAttribute('role','status');
  button.onclick = async () => {
    if (!verified.checked || !phone.value.trim()) return;
    button.disabled = true; result.textContent = '';
    try {
      const response = await fetch('/api/neon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'customer_setup',phone:phone.value.trim(),identity_verified:true,access_token:token()})});
      const data = await response.json(); if (!response.ok) throw Error();
      const link = document.createElement('input'); link.readOnly = true; link.setAttribute('aria-label',he ? 'קישור להגדרת סיסמה' : 'Password setup link'); link.value = new URL('join.html',location.href).href + '#setup=' + data.setup_token;
      result.textContent = he ? 'תקף ל־15 דקות. מסרו רק ללקוח שזהותו אומתה: ' : 'Valid for 15 minutes. Give only to the verified customer: ';
      result.append(link); verified.checked = false;
    } catch { result.textContent = he ? 'לא ניתן ליצור קישור. נדרשת כניסת בעל העסק ולקוח קיים.' : 'Unable to create a link. Sign in as the business owner and use an existing customer.'; }
    finally { button.disabled = false; }
  };
  panel.append(heading,help,phone,label,button,result); area.append(panel);
})();
