const isRegisterPage = document.getElementById('register-form') !== null;
const form = document.getElementById(isRegisterPage ? 'register-form' : 'login-form');
const messageEl = document.getElementById('form-message');
const googleBtn = document.getElementById('google-auth-btn');
const resendBtn = document.getElementById('resend-verification-btn');
const forgotBtn = document.getElementById('forgot-password-btn');
const forgotForm = document.getElementById('forgot-form');
const forgotEmail = document.getElementById('forgot-email');
const backToLoginBtn = document.getElementById('back-to-login-btn');
const GOOGLE_REDIRECT_PENDING_KEY = 'pinchGoogleRedirectPending';
const GOOGLE_TRANSITION_MIN_MS = 750;

let auth = null;
let firebaseSdk = null;
let pendingVerificationUser = null;

initAuthPage();

async function initAuthPage() {
  const hadPendingGoogleRedirect = sessionStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY) === '1';
  if (hadPendingGoogleRedirect) {
    showAuthTransition({
      title: 'Finishing Google sign-in',
      message: 'Google sent you back successfully. Preparing your dashboard...',
      busy: true,
    });
  }

  try {
    const existing = await fetch('/api/auth/me');
    if (existing.ok) {
      if (hadPendingGoogleRedirect) {
        sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
        showAuthTransition({
          title: 'Google sign-in successful',
          message: 'Opening your dashboard...',
          busy: false,
        });
        window.setTimeout(() => window.location.replace('/dashboard'), GOOGLE_TRANSITION_MIN_MS);
      } else {
        window.location.replace('/dashboard');
      }
      return;
    }
  } catch {
    // Anonymous visitors continue to the auth form.
  }

  try {
    const configRes = await fetch('/api/auth/firebase-config');
    const config = await configRes.json();
    if (!configRes.ok) {
      const missing = Array.isArray(config.missing) ? ` Missing: ${config.missing.join(', ')}.` : '';
      throw new Error(`${config.error || 'Firebase is not configured.'}${missing}`);
    }

    firebaseSdk = await loadFirebaseSdk();
    auth = firebaseSdk.getAuth(firebaseSdk.initializeApp(config));
    await firebaseSdk.setPersistence(auth, firebaseSdk.browserSessionPersistence);
    bindEvents();
    await handleGoogleRedirectResult();
  } catch (err) {
    hideAuthTransition();
    setMessage(err.message || 'Firebase is not configured yet.');
    setDisabled(true);
  }
}

function bindEvents() {
  form.addEventListener('submit', handleEmailSubmit);
  googleBtn?.addEventListener('click', handleGoogle);
  resendBtn?.addEventListener('click', resendVerification);
  forgotBtn?.addEventListener('click', showForgotPassword);
  backToLoginBtn?.addEventListener('click', hideForgotPassword);
  forgotForm?.addEventListener('submit', handleForgotPassword);

  if (isRegisterPage) bindPasswordStrength();
}

async function handleEmailSubmit(event) {
  event.preventDefault();
  clearHints();
  setMessage('');
  setLoading(true, isRegisterPage ? 'Creating account...' : 'Logging in...');

  try {
    if (isRegisterPage) {
      await handleSignup();
    } else {
      await handleLogin();
    }
  } catch (err) {
    setMessage(authErrorMessage(err));
  } finally {
    setLoading(false);
  }
}

async function handleSignup() {
  const data = getRegisterData();
  validateSignup(data);

  const credential = await firebaseSdk.createUserWithEmailAndPassword(auth, data.email, data.password);
  await firebaseSdk.updateProfile(credential.user, {
    displayName: `${data.firstname} ${data.lastname}`.trim(),
  });
  await firebaseSdk.sendEmailVerification(credential.user);
  pendingVerificationUser = credential.user;

  setMessage('Account created. Check your inbox to verify your email before logging in.', 'success');
  setResendVisible(true);
}

async function handleLogin() {
  const { email, password } = getLoginData();
  if (!email || !password) throw new Error('Enter your email and password.');

  const credential = await firebaseSdk.signInWithEmailAndPassword(auth, email, password);
  if (!credential.user.emailVerified) {
    pendingVerificationUser = credential.user;
    setResendVisible(true);
    throw Object.assign(new Error('Please verify your email before continuing.'), { friendly: true });
  }

  await createServerSession(credential.user);
  await firebaseSdk.signOut(auth);
  setMessage('Welcome back. Opening your dashboard...', 'success');
  setTimeout(() => window.location.replace('/dashboard'), 300);
}

async function handleGoogle() {
  setMessage('');
  setLoading(true, 'Connecting...');
  const provider = new firebaseSdk.GoogleAuthProvider();
  try {
    const credential = await firebaseSdk.signInWithPopup(auth, provider);
    showAuthTransition({
      title: 'Google sign-in successful',
      message: 'Creating your secure session...',
      busy: true,
    });
    await createServerSession(credential.user);
    await firebaseSdk.signOut(auth);
    showAuthTransition({
      title: 'Google sign-in successful',
      message: 'Opening your dashboard...',
      busy: false,
    });
    setTimeout(() => window.location.replace('/dashboard'), GOOGLE_TRANSITION_MIN_MS);
  } catch (err) {
    if (err?.code === 'auth/popup-blocked') {
      sessionStorage.setItem(GOOGLE_REDIRECT_PENDING_KEY, '1');
      showAuthTransition({
        title: 'Opening Google sign-in',
        message: 'You will return here once Google confirms your account.',
        busy: true,
      });
      await firebaseSdk.signInWithRedirect(auth, provider);
      return;
    }
    hideAuthTransition();
    setMessage(authErrorMessage(err));
  } finally {
    setLoading(false);
  }
}

async function handleGoogleRedirectResult() {
  const hadPendingRedirect = sessionStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY) === '1';
  try {
    if (hadPendingRedirect) {
      showAuthTransition({
        title: 'Finishing Google sign-in',
        message: 'Google sign-in succeeded. Creating your secure session...',
        busy: true,
      });
    }

    const credential = await firebaseSdk.getRedirectResult(auth);
    if (credential?.user) {
      await finishGoogleSignIn(credential.user);
      return;
    }

    if (!hadPendingRedirect) return;

    const redirectedUser = auth.currentUser || await waitForAuthUser();
    if (redirectedUser && userHasProvider(redirectedUser, 'google.com')) {
      await finishGoogleSignIn(redirectedUser);
      return;
    }

    sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
    hideAuthTransition();
    setMessage('Google sign-in was not completed. Please try again.');
  } catch (err) {
    sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
    hideAuthTransition();
    setMessage(authErrorMessage(err));
  } finally {
    setLoading(false);
  }
}

async function finishGoogleSignIn(user) {
  setLoading(true, 'Finishing sign-in...');
  showAuthTransition({
    title: 'Google sign-in successful',
    message: 'Creating your secure session...',
    busy: true,
  });
  await createServerSession(user);
  sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
  await firebaseSdk.signOut(auth);
  showAuthTransition({
    title: 'Google sign-in successful',
    message: 'Opening your dashboard...',
    busy: false,
  });
  setTimeout(() => window.location.replace('/dashboard'), GOOGLE_TRANSITION_MIN_MS);
}

function userHasProvider(user, providerId) {
  return Array.isArray(user?.providerData)
    && user.providerData.some((provider) => provider.providerId === providerId);
}

function waitForAuthUser(timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const unsubscribe = firebaseSdk.onAuthStateChanged(auth, (user) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(user);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(null);
    }, timeoutMs);
  });
}

async function createServerSession(user) {
  const idToken = await user.getIdToken(true);
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      profile: isRegisterPage ? {
        firstname: form.elements.firstname.value.trim(),
        lastname: form.elements.lastname.value.trim(),
      } : {},
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(payload.error || 'Could not start an authenticated session.'), {
      code: payload.code,
      friendly: true,
    });
  }
  return payload.user;
}

async function resendVerification() {
  if (!pendingVerificationUser) return;
  resendBtn.disabled = true;
  try {
    await firebaseSdk.sendEmailVerification(pendingVerificationUser);
    setMessage('Verification email sent. Check your inbox.', 'success');
  } catch (err) {
    setMessage(authErrorMessage(err));
  } finally {
    resendBtn.disabled = false;
  }
}

function showForgotPassword() {
  if (!forgotForm) return;
  forgotForm.hidden = false;
  form.hidden = true;
  setMessage('');
  const loginEmail = form.elements.email?.value.trim();
  if (loginEmail) forgotEmail.value = loginEmail;
  forgotEmail.focus();
}

function hideForgotPassword() {
  if (!forgotForm) return;
  forgotForm.hidden = true;
  form.hidden = false;
  setMessage('');
}

async function handleForgotPassword(event) {
  event.preventDefault();
  setMessage('');
  const email = forgotEmail.value.trim();
  if (!email) {
    setMessage('Enter your email address.');
    return;
  }

  const submitBtn = forgotForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await firebaseSdk.sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err.code === 'auth/invalid-email') {
      setMessage('Enter a valid email address.');
      submitBtn.disabled = false;
      return;
    }
  }

  setMessage('If an account exists for that email, Firebase will send a reset link.', 'success');
  submitBtn.disabled = false;
}

async function loadFirebaseSdk() {
  const [app, authSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
  ]);
  return { ...app, ...authSdk };
}

function getLoginData() {
  return {
    email: form.elements.email.value.trim(),
    password: form.elements.password.value,
  };
}

function getRegisterData() {
  return {
    firstname: form.elements.firstname.value.trim(),
    lastname: form.elements.lastname.value.trim(),
    email: form.elements.email.value.trim(),
    password: form.elements.password.value,
    confirmPassword: form.elements.confirmPassword.value,
  };
}

function validateSignup(data) {
  if (!data.firstname || !data.lastname) throw new Error('Enter your first and last name.');
  if (!data.email) throw new Error('Enter your email address.');
  if (data.password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (data.password !== data.confirmPassword) throw new Error('Passwords do not match.');
}

function bindPasswordStrength() {
  const passwordInput = form.querySelector('input[name="password"]');
  const strengthEl = document.getElementById('password-strength');
  const strengthLabel = document.getElementById('strength-label');
  const segments = strengthEl.querySelectorAll('.password-strength__segment');
  const strengthNames = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  let zxcvbnModule = null;

  async function loadZxcvbn() {
    if (zxcvbnModule) return zxcvbnModule;
    if (!window.zxcvbn) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/js/zxcvbn.browser.js';
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      }).catch(() => null);
    }
    zxcvbnModule = window.zxcvbn || null;
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

function authErrorMessage(err) {
  if (err?.friendly) return err.message;
  const messages = {
    'auth/account-exists-with-different-credential': 'An account already exists for this email. Sign in using the original provider, then link Google from Firebase if needed.',
    'auth/email-already-in-use': 'An account already exists for this email. Try logging in instead.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/popup-blocked': 'Opening Google sign-in...',
    'auth/popup-closed-by-user': 'Google sign-in was canceled.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'Invalid email or password.',
    'auth/weak-password': 'Choose a stronger password.',
    'auth/wrong-password': 'Invalid email or password.',
  };
  return messages[err?.code] || err?.message || 'Something went wrong. Please try again.';
}

function setMessage(text, tone = 'error') {
  messageEl.textContent = text;
  messageEl.className = `auth-message${tone === 'success' ? ' success' : ''}`;
}

function showAuthTransition({ title, message, busy = true }) {
  let panel = document.getElementById('auth-transition');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'auth-transition';
    panel.className = 'auth-transition';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    form.insertAdjacentElement('beforebegin', panel);
  }
  panel.innerHTML = `
    <span class="auth-transition__spinner" ${busy ? '' : 'hidden'} aria-hidden="true"></span>
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(message)}</span>
  `;
  panel.hidden = false;
  form.hidden = true;
  if (forgotForm) forgotForm.hidden = true;
  document.querySelectorAll('.auth-switch').forEach((el) => { el.hidden = true; });
}

function hideAuthTransition() {
  const panel = document.getElementById('auth-transition');
  if (panel) panel.hidden = true;
  if (form && !isForgotPasswordVisible()) form.hidden = false;
  document.querySelectorAll('.auth-switch').forEach((el) => { el.hidden = false; });
}

function isForgotPasswordVisible() {
  return Boolean(forgotForm && !forgotForm.hidden);
}

function setLoading(loading, label) {
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = loading;
    submitBtn.querySelector('span').textContent = loading
      ? label
      : isRegisterPage ? 'Create account' : 'Log in';
  }
  if (googleBtn) googleBtn.disabled = loading;
}

function setDisabled(disabled) {
  form.querySelectorAll('input, button').forEach((el) => {
    el.disabled = disabled;
  });
  if (googleBtn) googleBtn.disabled = disabled;
}

function setResendVisible(visible) {
  if (resendBtn) resendBtn.hidden = !visible;
}

function clearHints() {
  form.querySelectorAll('[data-hint]').forEach((el) => {
    el.textContent = '';
  });
  form.querySelectorAll('.input-error').forEach((el) => {
    el.classList.remove('input-error');
  });
  setResendVisible(false);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}
