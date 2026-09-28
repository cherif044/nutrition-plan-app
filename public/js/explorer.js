const svg = (body) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  home: svg('<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>'),
  user: svg('<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  folder: svg('<path d="M4 5h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>'),
};

const params = new URLSearchParams(location.search);
// Ids from the URL go into fetch paths, so only plain numeric ids are used;
// anything else (e.g. "1/../../customers/5") is treated as the root folder.
const rawFolderId = params.get('folderId');
const folderId = /^\d{1,18}$/.test(rawFolderId || '') ? rawFolderId : null;
const pageMessage = document.getElementById('page-message');
let currentFolderId = folderId;

// Auth
(async () => {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.replace('/login'); return; }
    const { user } = await res.json();
    document.getElementById('planner-nav-user').innerHTML = `
      <span class="planner-nav__greeting">Hi, ${esc(user.firstname)}</span>
      <a class="planner-nav__link" href="/dashboard" aria-label="Home">${ICONS.home}<span>Home</span></a>
      <a class="planner-nav__link" href="/explorer" aria-label="Explorer" aria-current="page">${ICONS.folder}<span>Explorer</span></a>
      <a class="planner-nav__link" href="/account" aria-label="Account">${ICONS.user}<span>Account</span></a>
      <button class="planner-nav__link" id="logout-btn" type="button" aria-label="Log out">${ICONS.logout}<span>Log out</span></button>
    `;
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.replace('/');
    });
  } catch { window.location.replace('/login'); }
})();

// ── Load contents ──────────────────────────────────────────────────────

async function load() {
  const url = currentFolderId ? `/api/folders/${currentFolderId}` : '/api/folders';
  const res = await fetch(url);
  if (!res.ok) { pageMessage.textContent = 'Failed to load.'; return; }
  const data = await res.json();
  renderContents(data);
  await renderBreadcrumb();
  updateActions();
}

function renderContents({ subfolders, plans }) {
  const grid = document.getElementById('folder-grid');
  const planList = document.getElementById('plan-list');
  const plansSection = document.getElementById('plans-section');
  const emptyState = document.getElementById('empty-state');
  const rootEmpty = document.getElementById('root-empty');
  grid.innerHTML = '';
  planList.innerHTML = '';
  emptyState.hidden = true;
  rootEmpty.hidden = true;
  plansSection.hidden = true;

  if (!subfolders.length && !plans.length) {
    if (currentFolderId) emptyState.hidden = false;
    else rootEmpty.hidden = false;
    return;
  }


  subfolders.forEach((folder) => {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.innerHTML = `
      <span class="folder-icon" aria-hidden="true">${ICONS.folder}</span>
      <span class="folder-name">${esc(folder.name)}</span>
      <button class="item-menu-btn" type="button" title="Folder options" data-folder-id="${folder.id}" data-folder-name="${esc(folder.name)}">⋯</button>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.item-menu-btn')) return;
      window.location.href = `/explorer?folderId=${folder.id}`;
    });
    card.querySelector('.item-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderMenu(e, folder.id, folder.name);
    });
    grid.append(card);
  });

  if (plans.length) {
    plansSection.hidden = false;
    plans.forEach((plan) => {
      const row = document.createElement('div');
      row.className = 'plan-row';
      row.innerHTML = `
        <span class="plan-icon" aria-hidden="true">${ICONS.file}</span>
        <div class="plan-info">
          <div class="plan-row-name">${esc(plan.name)}</div>
          <div class="plan-row-date">${new Date(plan.updated_at || plan.created_at).toLocaleDateString()}</div>
        </div>
        <button class="item-menu-btn" type="button" title="Plan options" data-plan-id="${plan.id}" data-plan-name="${esc(plan.name)}">⋯</button>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.item-menu-btn')) return;
        window.location.href = plannerHref(plan.id);
      });
      row.querySelector('.item-menu-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        showPlanMenu(e, plan.id, plan.name);
      });
      planList.append(row);
    });
  }
}

async function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';
  const homeLink = document.createElement('a');
  homeLink.href = '/explorer';
  homeLink.textContent = 'Home';
  bc.append(homeLink);

  if (!currentFolderId) {
    bc.querySelector('a').outerHTML = '<strong>Home</strong>';
    bc.innerHTML = '<strong>Home</strong>';
    return;
  }

  const res = await fetch(`/api/folders/${currentFolderId}/breadcrumb`);
  if (!res.ok) return;
  const { breadcrumb } = await res.json();

  bc.innerHTML = '';
  bc.append(makeLink('/explorer', 'Home'));

  breadcrumb.forEach((item, i) => {
    const sep = document.createElement('span');
    sep.textContent = ' / ';
    bc.append(sep);

    if (i === breadcrumb.length - 1) {
      const strong = document.createElement('strong');
      strong.textContent = item.name;
      bc.append(strong);
    } else {
      bc.append(makeLink(`/explorer?folderId=${item.id}`, item.name));
    }
  });
}

function makeLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}

function plannerHref(planId) {
  return currentFolderId
    ? `/planner?planId=${planId}&view=plan&folderId=${currentFolderId}`
    : `/planner?planId=${planId}&view=plan`;
}

// Empty-state CTAs mirror the toolbar actions so the call to action sits
// with the message rather than only in the header.
document.querySelectorAll('[data-empty-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.emptyAction === 'new-folder') openFolderModal();
    else window.location.href = currentFolderId ? `/planner?folderId=${currentFolderId}` : '/planner';
  });
});

function updateActions() {
  const actions = document.getElementById('explorer-actions');
  actions.innerHTML = '';
  const newFolderBtn = document.createElement('button');
  newFolderBtn.className = 'btn btn-ghost';
  newFolderBtn.type = 'button';
  newFolderBtn.textContent = '+ New folder';
  newFolderBtn.addEventListener('click', () => openFolderModal());
  actions.append(newFolderBtn);

  const newPlanBtn = document.createElement('button');
  newPlanBtn.className = 'btn btn-primary';
  newPlanBtn.type = 'button';
  newPlanBtn.textContent = '+ New plan';
  newPlanBtn.addEventListener('click', () => {
    window.location.href = currentFolderId ? `/planner?folderId=${currentFolderId}` : '/planner';
  });
  actions.append(newPlanBtn);
}

// ── Context menus ──────────────────────────────────────────────────────

const ctxMenu = document.getElementById('context-menu');
document.addEventListener('click', () => { ctxMenu.hidden = true; });

function positionMenu(e) {
  ctxMenu.hidden = false;
  const rect = ctxMenu.getBoundingClientRect();
  let x = e.clientX, y = e.clientY;
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
}

function showFolderMenu(e, folderId, folderName) {
  e.stopPropagation();
  ctxMenu.innerHTML = `
    <button data-action="rename">Rename</button>
    <button data-action="delete" class="danger">Delete</button>
  `;
  ctxMenu.querySelector('[data-action="rename"]').addEventListener('click', () => {
    ctxMenu.hidden = true;
    openFolderModal(folderId, folderName);
  });
  ctxMenu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    ctxMenu.hidden = true;
    if (!confirm(`Delete folder "${folderName}" and all its contents?`)) return;
    const r = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
    if (r.ok) load();
    else pageMessage.textContent = 'Failed to delete folder.';
  });
  positionMenu(e);
}

function showPlanMenu(e, planId, planName) {
  e.stopPropagation();
  ctxMenu.innerHTML = `
    <button data-action="open">Open</button>
    <button data-action="export">Export as PDF</button>
    <button data-action="dup">Duplicate</button>
    <button data-action="delete" class="danger">Delete</button>
  `;
  ctxMenu.querySelector('[data-action="open"]').addEventListener('click', () => {
    ctxMenu.hidden = true;
    window.location.href = plannerHref(planId);
  });
  ctxMenu.querySelector('[data-action="export"]').addEventListener('click', () => {
    ctxMenu.hidden = true;
    window.location.href = `/api/plans/${encodeURIComponent(planId)}/export.pdf`;
  });
  ctxMenu.querySelector('[data-action="dup"]').addEventListener('click', () => {
    ctxMenu.hidden = true;
    openDupModal(planId, planName);
  });
  ctxMenu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    ctxMenu.hidden = true;
    if (!confirm(`Delete plan "${planName}"?`)) return;
    const r = await fetch(`/api/plans/${planId}`, { method: 'DELETE' });
    if (r.ok) load();
    else pageMessage.textContent = 'Failed to delete plan.';
  });
  positionMenu(e);
}

// ── Folder modal (create / rename) ─────────────────────────────────────

let editingFolderId = null;

function openFolderModal(folderId = null, existingName = '') {
  editingFolderId = folderId;
  document.getElementById('folder-modal-title').textContent = folderId ? 'Rename folder' : 'New folder';
  document.getElementById('folder-modal-save').textContent = folderId ? 'Rename' : 'Create';
  document.getElementById('folder-name-input').value = existingName;
  document.getElementById('folder-modal-error').textContent = '';
  document.getElementById('folder-modal').hidden = false;
  document.getElementById('folder-name-input').focus();
}

document.getElementById('folder-modal-cancel').addEventListener('click', () => {
  document.getElementById('folder-modal').hidden = true;
});
document.getElementById('folder-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('folder-modal')) document.getElementById('folder-modal').hidden = true;
});

document.getElementById('folder-modal-save').addEventListener('click', async () => {
  const name = document.getElementById('folder-name-input').value.trim();
  const errEl = document.getElementById('folder-modal-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Enter a folder name.'; return; }

  let res;
  if (editingFolderId) {
    res = await fetch(`/api/folders/${editingFolderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } else {
    res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId: currentFolderId }),
    });
  }
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; return; }
  document.getElementById('folder-modal').hidden = true;
  load();
});

document.getElementById('folder-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('folder-modal-save').click();
});

// ── Duplicate modal ────────────────────────────────────────────────────

let dupPlanId = null;
let selectedDupFolderId = null;

async function openDupModal(planId, planName) {
  dupPlanId = planId;
  selectedDupFolderId = undefined;
  document.getElementById('dup-name-input').value = planName + ' (copy)';
  document.getElementById('dup-modal-error').textContent = '';

  const res = await fetch('/api/folders/tree');
  const { tree } = await res.json();
  const treeEl = document.getElementById('dup-tree');
  treeEl.innerHTML = '';
  renderRootTreeItem(treeEl);
  renderTree(tree, treeEl, 0);
  document.getElementById('dup-modal').hidden = false;
}

function renderRootTreeItem(container) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.dataset.folderId = '';
  item.innerHTML = `<span class="tree-item__icon" aria-hidden="true">${ICONS.file}</span>Home`;
  item.addEventListener('click', () => {
    container.querySelectorAll('.tree-item').forEach((el) => el.classList.remove('selected'));
    item.classList.add('selected');
    selectedDupFolderId = null;
  });
  container.append(item);
}

function renderTree(nodes, container, depth) {
  nodes.forEach((node) => {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.paddingLeft = (10 + depth * 18) + 'px';
    item.dataset.folderId = node.id;
    item.innerHTML = `<span class="tree-item__icon" aria-hidden="true">${ICONS.folder}</span>${esc(node.name)}`;
    item.addEventListener('click', () => {
      container.querySelectorAll('.tree-item').forEach((el) => el.classList.remove('selected'));
      item.classList.add('selected');
      selectedDupFolderId = node.id;
    });
    container.append(item);
    if (node.children.length) renderTree(node.children, container, depth + 1);
  });
}

document.getElementById('dup-modal-cancel').addEventListener('click', () => {
  document.getElementById('dup-modal').hidden = true;
});
document.getElementById('dup-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('dup-modal')) document.getElementById('dup-modal').hidden = true;
});

document.getElementById('dup-modal-save').addEventListener('click', async () => {
  const errEl = document.getElementById('dup-modal-error');
  errEl.textContent = '';
  if (selectedDupFolderId === undefined) { errEl.textContent = 'Select a destination.'; return; }
  const newName = document.getElementById('dup-name-input').value.trim();
  if (!newName) { errEl.textContent = 'Enter a name for the copy.'; return; }

  const res = await fetch(`/api/plans/${dupPlanId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolderId: selectedDupFolderId, newName }),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; return; }
  document.getElementById('dup-modal').hidden = true;
  pageMessage.style.color = 'var(--accent)';
  pageMessage.textContent = `Copied to folder successfully.`;
  setTimeout(() => { pageMessage.textContent = ''; pageMessage.style.color = ''; }, 3000);
  load();
});

function esc(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();
