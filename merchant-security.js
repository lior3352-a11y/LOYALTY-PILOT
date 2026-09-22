// Reuse existing customer rows; no layout or styling changes.
(() => {
  async function recover(row) {
    if (!confirm('Verify this customer’s identity in person using independent records, not just their phone number. Have you completed that verification?')) return;
    try {
      const result = await api({ action:'customer_setup', access_token:token(), customer_id:Number(row.dataset.recoveryCustomer), identity_verified:true });
      const link = new URL('join.html', location.href);
      link.hash = new URLSearchParams({ setup:result.setup_token });
      // Never send these links automatically. Hand them only to the verified person.
      prompt('Give this one-time link only to the verified customer. It expires in 15 minutes.', link.href);
    } catch (error) { alert(error.message || 'Unable to restore customer access'); }
  }
  document.getElementById('customers').addEventListener('click', event => {
    const row = event.target.closest('[data-recovery-customer]'); if (row) recover(row);
  });
  document.getElementById('customers').addEventListener('keydown', event => {
    const row = event.target.closest('[data-recovery-customer]');
    if (row && ['Enter',' '].includes(event.key)) { event.preventDefault(); recover(row); }
  });
})();
