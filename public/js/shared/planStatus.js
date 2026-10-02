// A plan runs from start_date for duration_weeks weeks. Its end date, status
// and current week are worked out here from those two fields; nothing about
// them is stored. ENDING_SOON_DAYS matches src/features/dashboard/repository.js.
(function () {
  var DAY_MS = 86400000;
  var ENDING_SOON_DAYS = 3;
  var DEFAULT_WEEKS = 4;

  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function parseDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function toIsoDate(date) {
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function daysBetween(from, to) {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  function shortDate(date) {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // Returns null when the plan has no schedule (older rows, unsaved drafts).
  function planStatus(plan) {
    var start = parseDate(plan && (plan.start_date || plan.startDate));
    if (!start) return null;
    var weeks = Math.min(8, Math.max(1, Number(plan.duration_weeks || plan.durationWeeks) || DEFAULT_WEEKS));
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7);
    var today = startOfToday();
    var daysLeft = daysBetween(today, end);
    var daysToStart = daysBetween(today, start);
    var state = 'ongoing';
    if (daysLeft <= 0) state = 'expired';
    else if (daysLeft <= ENDING_SOON_DAYS) state = 'ending';
    else if (daysToStart > 0) state = 'upcoming';

    var elapsed = Math.max(0, daysBetween(start, today));
    var week = daysToStart > 0 ? 0 : Math.min(weeks, Math.floor(elapsed / 7) + 1);

    var label;
    if (state === 'expired') {
      label = daysLeft === 0 ? 'Expired today' : daysLeft === -1 ? 'Expired yesterday' : 'Expired ' + (-daysLeft) + ' days ago';
    } else if (state === 'upcoming') {
      label = daysToStart === 1 ? 'Starts tomorrow' : 'Starts in ' + daysToStart + ' days';
    } else {
      label = daysLeft === 1 ? 'Ends tomorrow' : 'Ends in ' + daysLeft + ' days';
    }

    return {
      state: state,
      label: label,
      badge: { ongoing: 'Ongoing', ending: 'Ending soon', expired: 'Expired', upcoming: 'Upcoming' }[state],
      weeks: weeks,
      week: week,
      daysLeft: daysLeft,
      start: start,
      end: end,
      endLabel: shortDate(end),
    };
  }

  window.PlanStatus = {
    ENDING_SOON_DAYS: ENDING_SOON_DAYS,
    status: planStatus,
    todayIso: function () { return toIsoDate(startOfToday()); },
    parseDate: parseDate,
    toIsoDate: toIsoDate,
  };
}());
