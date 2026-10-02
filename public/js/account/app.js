// Account page: sign out everywhere, change password, delete account.
// Sensitive actions ask Firebase for a fresh login first, so a stolen session
// cookie on its own cannot change the password or delete the account.

const MIN_PASSWORD_LENGTH = 12;
const FIREBASE_SDK_VERSION = '10.14.1';

let currentUser = null;
let firebase = null;
let auth = null;

function setMessage(id, text, tone = 'error') {
  const el = document.getElementById(id);
  el.textContent = text;
  el.dataset.tone = tone;
}

function setBusy(form, busy) {
  form.querySelectorAll('button, input').forEach((el) => { el.disabled = busy; });
}

async function loadFirebase() {
  if (auth) return;
  const configRes = await fetch('/api/auth/firebase-config');
  const config = await configRes.json();
  if (!configRes.ok) throw new Error(config.error || 'Sign-in is not configured.');
  const [app, authSdk] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
  ]);
  firebase = { ...app, ...authSdk };
  auth = firebase.getAuth(firebase.initializeApp(config));
  await firebase.setPersistence(auth, firebase.inMemoryPersistence);
}

async function reauthWithPassword(password) {
  await loadFirebase();
  const credential = await firebase.signInWithEmailAndPassword(auth, currentUser.email, password);
  return credential.user;
}

async function reauthWithGoogle() {
  await loadFirebase();
  const provider = new firebase.GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: currentUser.email, prompt: 'select_account' });
  const credential = await firebase.signInWithPopup(auth, provider);
  if (credential.user.email?.toLowerCase() !== String(currentUser.email).toLowerCase()) {
    await firebase.signOut(auth);
    throw new Error('That Google account is not the one signed in here.');
  }
  return credential.user;
}

function friendlyError(err) {
  const messages = {
    'auth/wrong-password': 'That password is not correct.',
    'auth/invalid-credential': 'That password is not correct.',
    'auth/invalid-login-credentials': 'That password is not correct.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/popup-closed-by-user': 'The Google window was closed before finishing.',
    'auth/weak-password': `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    'auth/password-does-not-meet-requirements': `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
  };
  return messages[err?.code] || err?.message || 'Something went wrong. Please try again.';
}

async function signOutEverywhere() {
  const res = await fetch('/api/auth/logout-all', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not sign out other devices.');
  }
}

async function handleLogoutAll() {
  const button = document.getElementById('logout-all-btn');
  button.disabled = true;
  try {
    await signOutEverywhere();
    window.location.replace('/login');
  } catch (err) {
    setMessage('sessions-message', friendlyError(err));
    button.disabled = false;
  }
}

async function handleChangePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const current = form.elements.currentPassword.value;
  const next = form.elements.newPassword.value;
  if (!current) return setMessage('password-message', 'Enter your current password.');
  if (next.length < MIN_PASSWORD_LENGTH) {
    return setMessage('password-message', `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (next !== form.elements.confirmPassword.value) {
    return setMessage('password-message', 'New passwords do not match.');
  }

  setBusy(form, true);
  setMessage('password-message', '');
  try {
    const user = await reauthWithPassword(current);
    await firebase.updatePassword(user, next);
    await firebase.signOut(auth);
    await signOutEverywhere();
    window.location.replace('/login?reset=1');
  } catch (err) {
    setMessage('password-message', friendlyError(err));
    setBusy(form, false);
  }
}

async function deleteAccount(firebaseUser) {
  const idToken = await firebaseUser.getIdToken(true);
  const res = await fetch('/api/auth/me', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, confirm: 'DELETE' }),
  });
  const body = await res.json().catch(() => ({}));
  await firebase.signOut(auth).catch(() => {});
  if (!res.ok) throw new Error(body.error || 'Could not delete the account.');
  window.location.replace('/');
}

async function handleDelete(event, method) {
  event.preventDefault();
  const form = document.getElementById('delete-form');
  if (form.elements.confirm.value.trim() !== 'DELETE') {
    return setMessage('delete-message', 'Type DELETE to confirm.');
  }
  if (method === 'password' && !form.elements.password.value) {
    return setMessage('delete-message', 'Enter your password, or confirm with Google.');
  }

  setBusy(form, true);
  setMessage('delete-message', '');
  try {
    const user = method === 'google'
      ? await reauthWithGoogle()
      : await reauthWithPassword(form.elements.password.value);
    await deleteAccount(user);
  } catch (err) {
    setMessage('delete-message', friendlyError(err));
    setBusy(form, false);
  }
}

async function init() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.replace('/login');
    return;
  }
  ({ user: currentUser } = await res.json());
  document.getElementById('account-email').textContent = currentUser.email || '';
  window.Shell?.setUser(currentUser);

  document.getElementById('logout-all-btn').addEventListener('click', handleLogoutAll);
  document.getElementById('password-form').addEventListener('submit', handleChangePassword);
  document.getElementById('delete-form').addEventListener('submit', (event) => handleDelete(event, 'password'));
  document.getElementById('delete-google-btn').addEventListener('click', (event) => handleDelete(event, 'google'));
}

init();
