// Numbered pager: ← 1 … 4 5 6 … 20 →. Shared by the dashboard and the
// customer page; each list asks the server for one page at a time.
(function definePagination() {
  const chevron = (direction) => `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="${direction === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}"/>
    </svg>`;

  // Always show the first and last page, plus the current page and its
  // neighbours; gaps become an ellipsis.
  function visiblePages(page, totalPages) {
    const pages = new Set([1, totalPages, page - 1, page, page + 1]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const result = [];
    sorted.forEach((p, index) => {
      if (index > 0 && p - sorted[index - 1] > 1) result.push(null);
      result.push(p);
    });
    return result;
  }

  function renderPagination(container, { page = 1, totalPages = 1 } = {}, onChange) {
    if (!container) return;
    if (totalPages <= 1) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const pageButtons = visiblePages(page, totalPages).map((p) => (
      p === null
        ? '<span class="list-pager__gap" aria-hidden="true">…</span>'
        : `<button type="button" class="list-pager__page" data-page="${p}"${p === page ? ' aria-current="page"' : ''}>${p}</button>`
    )).join('');
    container.innerHTML = `
      <button type="button" class="list-pager__arrow" data-page="${page - 1}" aria-label="Previous page"${page <= 1 ? ' disabled' : ''}>${chevron('prev')}</button>
      ${pageButtons}
      <button type="button" class="list-pager__arrow" data-page="${page + 1}" aria-label="Next page"${page >= totalPages ? ' disabled' : ''}>${chevron('next')}</button>
    `;
    container.onclick = (event) => {
      const button = event.target.closest('button[data-page]');
      if (!button || button.disabled) return;
      const target = Number(button.dataset.page);
      if (target >= 1 && target <= totalPages && target !== page) onChange(target);
    };
  }

  window.renderPagination = renderPagination;
}());
