// Token Radar 02 — the dashboard. Reads window.RADAR (written by main.ts into
// ../data.js), renders the velocity leaders, the filterable board, the detail
// drawer, the model panel and the live-token table. No network: every byte the
// page needs ships beside it. Hash state: #detail=<slug>, #cat=<category>,
// #chain=<chain>, #watchlist=1, #q=<text>, #sort=<key>, #minvel=<0..100>.
(function () {
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p style="padding:20px">No radar data (data.js missing).</p>'; return; }
  var rows = D.rows, live = D.live;
  var watch = new Set(D.watchlist || []);
  // The watchlist slugs ride in the board rows' own flag: rows built from the
  // snapshot's watchlist are the first watchlist_size of the unfiltered board
  // only when sorted by rank — so mark them from the board itself.
  var wl = {};
  rows.forEach(function (r) { wl[r.slug] = r.watchlist === true; });

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n >= 0 ? 'pos' : 'neg') + '">' + s + '</span>';
  }
  function ageFmt(d) {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return (d / 30).toFixed(0) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Meta line + footer.
  $('meta').innerHTML = 'Snapshot <b>' + esc(D.as_of) + '</b> · ' + D.board_size + ' rows · ' +
    D.watchlist_size + ' watchlist · model <b>' + esc(D.model_version) + '</b>';
  $('footstats').textContent = D.board_size + ' ranked rows (' + D.watchlist_size + ' watchlist + ' +
    D.early_size + ' early), ' + D.live_size + ' live tokens set aside';

  // Leaders: the top 5 by implied value.
  $('leaders').innerHTML = rows.slice(0, 5).map(function (r) {
    return '<div class="leader" data-slug="' + esc(r.slug) + '"><div class="rk">RANK ' + r.rank +
      ' · ' + esc(r.tge_label.toUpperCase()) + '</div><div class="nm">' + esc(r.name) +
      '</div><div class="vl">' + esc(r.category || 'Uncategorised') + ' · velocity ' + r.velocity +
      '</div><div class="vbar"><i style="width:' + r.velocity + '%"></i></div>' +
      '<div class="iv">' + money(r.implied_value_usd) + '</div></div>';
  }).join('');

  // Filter controls.
  var cats = {}, chs = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chs[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
  });
  Object.keys(chs).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });

  var state = { q: '', cat: '', chain: '', minvel: 0, watchonly: false, sort: 'implied', detail: null };

  function hash() {
    var h = location.hash.slice(1), out = {};
    h.split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) out[p[0]] = decodeURIComponent(p[1] || '');
    });
    return out;
  }
  function pushHash() {
    var parts = [];
    if (state.detail) parts.push('detail=' + state.detail);
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watchonly) parts.push('watchlist=1');
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.minvel > 0) parts.push('minvel=' + state.minvel);
    history.replaceState(null, '', '#' + parts.join('&'));
  }
  function readHash() {
    var h = hash();
    if (h.detail) state.detail = h.detail;
    if (h.cat) { state.cat = h.cat; $('cat').value = h.cat; }
    if (h.chain) { state.chain = h.chain; $('chain').value = h.chain; }
    if (h.watchlist) { state.watchonly = true; $('watchonly').checked = true; }
    if (h.q) { state.q = h.q; $('q').value = h.q; }
    if (h.sort) { state.sort = h.sort; $('sort').value = h.sort; }
    if (h.minvel) { state.minvel = +h.minvel || 0; $('minvel').value = state.minvel; $('minvelval').textContent = state.minvel; }
  }

  var SORTS = {
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    velocity: function (a, b) { return b.velocity - a.velocity || b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : 1; },
    category: function (a, b) { return (a.category || '') < (b.category || '') ? -1 : 1; },
    chains: function (a, b) { return b.chains.length - a.chains.length; },
    tge: function (a, b) { return b.tge_pct - a.tge_pct; },
  };

  function filtered() {
    var q = state.q.toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watchonly && !wl[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.velocity < state.minvel) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    list.sort(SORTS[state.sort] || SORTS.implied);
    return list;
  }

  function render() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + rows.length + ' rows';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
        '<td>' + ageFmt(r.age_days) + '</td>' +
        '<td><span class="pill' + (r.tge_label === 'Overdue' || r.tge_label === 'Due window' ? ' hot' : '') + '">' +
        esc(r.tge_label) + ' ' + r.tge_pct + '%</span></td>' +
        '<td><span class="velcell"><span class="vbar"><i style="width:' + r.velocity + '%"></i></span>' +
        r.velocity + '</span></td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    $('shownote').textContent = list.length === rows.length
      ? 'Showing the full board, ranked by implied value. Click a row for its model breakdown and farm plan.'
      : 'Filtered view — ' + list.length + ' rows match. Clear the filters to see the full board.';
    renderDetail();
    pushHash();
  }

  function renderDetail() {
    var box = $('detail');
    var r = state.detail ? rows.find(function (x) { return x.slug === state.detail; }) : rows[0];
    if (!r) { box.innerHTML = '<h2>No protocol</h2><p class="sub">Pick a row on the board.</p>'; return; }
    var f = function (label, val, pctw, note) {
      return '<div class="fact"><span>' + label + '</span><b>' + val + '</b></div>' +
        '<div class="fbar"><i style="width:' + Math.round(pctw) + '%"></i></div>' +
        (note ? '<p class="sub">' + note + '</p>' : '');
    };
    box.innerHTML = '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank ' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
      esc(r.chains.join(', ')) + ' · records no token</p>' +
      '<div class="big">' + money(r.implied_value_usd) + '<small>implied value · velocity ' + r.velocity + '/100</small></div>' +
      f('Growth ×' + r.growth_multiplier.toFixed(2), (r.change_7d === null ? 'no 7d change reported' : pct(r.change_7d)),
        Math.min(100, Math.max(0, ((r.growth_multiplier - 0.45) / 1.1) * 100)), '7-day TVL momentum, clamped and concave.') +
      f('Overdue ×' + r.overdue_multiplier.toFixed(2), esc(r.tge_label) + ' · ' + ageFmt(r.age_days) + ' with no token',
        r.tge_pct, 'Launch likeliest inside a window around 700 days.') +
      f('Breadth ×' + r.breadth_multiplier.toFixed(2), r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'),
        Math.min(100, (r.chains.length / 9) * 100), 'Each extra chain up to 8 adds 4%.') +
      f('Category ×' + r.category_multiplier.toFixed(2), esc(r.category || '—'),
        Math.min(100, Math.max(0, ((r.category_multiplier - 0.92) / 0.14) * 100)), 'Small prior by family, never by name.') +
      '<h3>Farm plan — 6 steps</h3><ol class="steps">' +
      (r.farm_steps || []).map(function (s) {
        var m = s.match(/^(.*?) Cost: (.*?) Time: (.*?)\.?$/);
        if (!m) return '<li>' + esc(s) + '</li>';
        return '<li>' + esc(m[1]) + '<span class="ct">Cost: ' + esc(m[2]) + ' · Time: ' + esc(m[3]) + '</span></li>';
      }).join('') + '</ol>';
  }

  // Live tokens, by market cap.
  $('liverows').innerHTML = live.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.category || '—') + '</td>' +
      '<td>' + esc(p.chains.slice(0, 3).join(', ')) + '</td><td>' + money(p.tvl_usd) + '</td>' +
      '<td><b>' + money(p.mcap_usd) + '</b></td><td>' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  // Events.
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) { state.detail = tr.getAttribute('data-slug'); render(); }
  });
  document.querySelectorAll('.leader').forEach(function (el) {
    el.addEventListener('click', function () { state.detail = el.getAttribute('data-slug'); render(); });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; render(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; render(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; render(); });
  $('watchonly').addEventListener('change', function () { state.watchonly = $('watchonly').checked; render(); });
  $('minvel').addEventListener('input', function () {
    state.minvel = +$('minvel').value; $('minvelval').textContent = state.minvel; render();
  });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; render(); });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      state.sort = SORTS[k] ? k : 'implied';
      $('sort').value = state.sort in { implied: 1, velocity: 1, tvl: 1, growth: 1, age: 1 } ? state.sort : 'implied';
      render();
    });
  });

  // The watchlist flags ride on the rows: main.ts marks each row's membership.
  readHash();
  render();
})();
