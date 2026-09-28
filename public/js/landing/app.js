function escapeHtml(v) {
  return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function getCurrentUser() {
  try {
    var res = await fetch('/api/auth/me');
    if (!res.ok) return null;
    var data = await res.json();
    return data.user || null;
  } catch {
    return null;
  }
}

(async function syncLandingAuthState(){
  var user = await getCurrentUser();
  if (!user) return;

  window.location.replace('/dashboard');

  var nav = document.getElementById('nav-actions');
  if (!nav) return;
  nav.innerHTML =
    '<span class="nav-greeting">Hi, ' + escapeHtml(user.firstname || user.email || 'there') + '</span>' +
    '<a class="btn btn-ghost" href="/dashboard">Home</a>' +
    '<button class="btn btn-primary" id="logout-btn" type="button">Log out</button>';

  var logout = document.getElementById('logout-btn');
  if (logout) {
    logout.addEventListener('click', async function(){
      await fetch('/api/auth/logout', { method: 'POST' });
      location.reload();
    });
  }
})();

document.querySelectorAll('.js-generate-cta').forEach(function(link){
  link.addEventListener('click', async function(event){
    event.preventDefault();
    var user = await getCurrentUser();
    window.location.href = user ? '/dashboard' : '/login';
  });
});

// reveal on scroll
var io = new IntersectionObserver(function(es){
  es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in-view'); io.unobserve(e.target); } });
}, {threshold:.12, rootMargin:'0px 0px -40px'});
document.querySelectorAll('.rv').forEach(function(el,i){ el.style.transitionDelay=(i%3)*70+'ms'; io.observe(el); });

// count-up
function countUp(el){
  var target=+el.dataset.count, start=performance.now(), dur=1200;
  (function tick(now){
    var p=Math.min((now-start)/dur,1);
    el.textContent=Math.round(target*(1-Math.pow(1-p,3))).toLocaleString();
    if(p<1) requestAnimationFrame(tick);
  })(performance.now());
}
var io2=new IntersectionObserver(function(es){
  es.forEach(function(e){ if(e.isIntersecting){ countUp(e.target); io2.unobserve(e.target); } });
},{threshold:.5});
document.querySelectorAll('[data-count]').forEach(function(el){ io2.observe(el); });

// fill macro bars + calorie ring
setTimeout(function(){
  document.querySelectorAll('.bar i').forEach(function(b,i){
    setTimeout(function(){ b.style.width=b.dataset.w+'%'; }, i*130);
  });
  var arc=document.getElementById('arc');
  if(arc){ arc.style.transition='stroke-dashoffset 1.5s cubic-bezier(.2,.7,.3,1)'; arc.style.strokeDashoffset=270*0.02; }
}, 380);

// meal-arrow demo: cycle the "3 of 20" counter
(function(){
  var counters=document.querySelectorAll('.meal-count, .demo-nav .lbl');
  document.querySelectorAll('.arrow').forEach(function(btn){
    btn.addEventListener('click', function(){
      var next=btn.getAttribute('aria-label')==='Next'||btn.getAttribute('aria-label')==='Next meal';
      counters.forEach(function(c){
        var n=parseInt(c.textContent,10)||3;
        n = next ? (n%20)+1 : (n===1?20:n-1);
        c.textContent=n+' of 20';
      });
    });
  });
})();
