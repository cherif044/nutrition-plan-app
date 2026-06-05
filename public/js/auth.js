const isRegisterPage = document.getElementById('register-form') !== null;
const form = document.getElementById(isRegisterPage ? 'register-form' : 'login-form');
const messageEl = document.getElementById('form-message');

// Redirect if already logged in
(async () => {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) window.location.replace('/customers');
  } catch { /* not logged in */ }
})();

// ── Password strength (register only) ──────────────────────────────────────
if (isRegisterPage) {
  const passwordInput = form.querySelector('input[name="password"]');
  const strengthEl = document.getElementById('password-strength');
  const strengthLabel = document.getElementById('strength-label');
  const segments = strengthEl.querySelectorAll('.password-strength__segment');
  const strengthNames = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  let zxcvbnModule = null;

  async function loadZxcvbn() {
    if (zxcvbnModule) return zxcvbnModule;
    const mod = await import('/js/zxcvbn.browser.js').catch(() => null);
    zxcvbnModule = mod?.default || mod?.zxcvbn || null;
    return zxcvbnModule;
  }

  passwordInput.addEventListener('input', async () => {
    const val = passwordInput.value;
    if (!val) {
      strengthEl.hidden = true;
      return;
    }
    strengthEl.hidden = false;

    const zxcvbn = await loadZxcvbn();
    if (!zxcvbn) return;

    const result = zxcvbn(val);
    const score = result.score;

    segments.forEach((seg, i) => {
      seg.className = 'password-strength__segment';
      if (i <= score) seg.classList.add(`filled-${score}`);
    });

    strengthLabel.textContent = strengthNames[score] || '';
    const hint = form.querySelector('[data-hint="password"]');
    if (hint) {
      const suggestion = result.feedback.suggestions[0] || '';
      const warning = result.feedback.warning || '';
      hint.textContent = score < 2 ? (warning || suggestion) : '';
    }
  });
}

// ── Form submission ─────────────────────────────────────────────────────────
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearHints();
  messageEl.textContent = '';
  messageEl.className = 'auth-message';

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.querySelector('span').textContent = isRegisterPage ? 'Creating account…' : 'Logging in…';

  try {
    const body = isRegisterPage ? getRegisterData() : getLoginData();
    const url = isRegisterPage ? '/api/auth/register' : '/api/auth/login';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await res.json();

    if (!res.ok) {
      messageEl.textContent = payload.error || 'Something went wrong.';
      return;
    }

    messageEl.className = 'auth-message success';
    messageEl.textContent = isRegisterPage
      ? `Account created! Welcome, ${escapeHtml(payload.user.firstname)}.`
      : `Welcome back, ${escapeHtml(payload.user.firstname)}!`;

    setTimeout(() => window.location.replace('/customers'), 600);
  } catch {
    messageEl.textContent = 'Network error. Please try again.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = isRegisterPage ? 'Create account' : 'Log in';
  }
});

function getLoginData() {
  return {
    username: form.elements.username.value.trim(),
    password: form.elements.password.value,
  };
}

function getRegisterData() {
  return {
    firstname: form.elements.firstname.value.trim(),
    lastname: form.elements.lastname.value.trim(),
    username: form.elements.username.value.trim(),
    password: form.elements.password.value,
  };
}

function clearHints() {
  form.querySelectorAll('[data-hint]').forEach((el) => {
    el.textContent = '';
  });
  form.querySelectorAll('.input-error').forEach((el) => {
    el.classList.remove('input-error');
  });
}

function escapeHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
