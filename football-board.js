/*
 * BetHouse — football-board.js
 * The football board's page script, shared by nfl.html and cfb.html.
 *
 * The two pages are the same three views -- anytime touchdown, receiving
 * yards, spread and total -- over the same model bound to different
 * constants. When this lived inline in nfl.html a college page would have
 * meant a second copy of three hundred lines that would drift from the
 * first (tasks/lessons.md, "two copies of the same rule will disagree").
 * So each page supplies what is genuinely its own -- the model, the data,
 * the record, and the measured numbers it quotes -- and this renders.
 *
 *   BetHouseFootballBoard.mount({
 *     model:  window.BetHouseNFL,       // or BetHouseCFB
 *     data:   window.BetHouseNFLData,   // written by fetch-<league>.mjs
 *     record: window.BETHOUSE_NFL_RECORD,
 *     league: "NFL",                    // the tagline
 *     fetcher: "fetch-nfl.mjs",
 *     copy: { ... }                     // the measured claims, per league
 *   });
 */
(function () {
  "use strict";

  function mount(cfg) {
    var N = cfg.model, D = cfg.data, C = cfg.copy || {}, P = window.BetHouseParlay, E = window.BetHouseEdge, W = window.BetHouseWatchlist;
    var app = document.getElementById("app");
    if (!D || !D.players) {
      app.innerHTML = '<div class="empty"><div class="big">No board yet</div>' +
        '<div>Run <code>node ' + cfg.fetcher + '</code> to build the board.</div></div>';
      return;
    }
    /* The page, this script and the model are three files, cached for
       ten minutes each by the host, so a browser can hold a new page and
       an old model. Every function this script calls on the model has to
       exist, or the first keystroke fails silently (the search box did,
       2026-09-09). Say so instead. */
    var NEEDS = ['STATS','statEligible','statOppFactor','allowOf','scoreAnytimeTD','empiricalOver','fairPrice','availability','playerMatches',
      'statTotal','statOpportunity','ladder','projectGame','pickGame','poolSize','poolReads','recentValues','recentHits','recentDate'];
    var missing = NEEDS.filter(function(k){ return typeof N[k] !== 'function' && k !== 'STATS' || (k === 'STATS' && !N.STATS); });
    /* The same mix the other way: a fresh model with a data file from
       before the pools were levelled (2026-09-21) would price every prop
       off the whole pool -- the shape the ladder replay measured as wrong
       by size -- and look normal doing it. A flat pool is the tell. */
    var stalePools = Object.keys(D.pools||{}).some(function(k){ return Array.isArray(D.pools[k]); });
    /* ...and an older page than script: the drawer's markup arrived with
       phase 2 (2026-09-29); without it a row click would go nowhere. */
    var stalePage = !document.getElementById('drawer') || !document.getElementById('dbody');
    if (missing.length || stalePools || stalePage) {
      app.innerHTML = '<div class="empty"><div class="big">Reload this page</div>' +
        '<div>Your browser has a '+(stalePools?'newer model than data file':stalePage?'newer script than page':'newer page than model script')+'. A hard refresh (Cmd/Ctrl+Shift+R) fixes it.</div></div>';
      return;
    }

    /* One view per counting prop, from the model's own stat table, so a
       stat the model gains is a view the page gains. */
    var STAT_IDS = Object.keys(N.STATS);
    var VIEWS = [{id:'td',label:'Anytime TD'}].concat(STAT_IDS.map(function(k){return {id:k,label:N.STATS[k].label};}))
      .concat([{id:'game',label:'Spread & total'}]);
    var LINES = [{id:0.7,label:'Low'},{id:1,label:'Projection'},{id:1.3,label:'High'}];
    var state = { view:'td', lineMult:1, showAll:false, q:'',
      /* The parlay slip: what the suggester built, or why it could not. */
      candidates:[], slip:null, slipError:null, slipLegs:null, slipScope:'slate', slipGame:null, slipPrice:null, pin:null,
      sort:'proj', team:'', pos:'', prices:{},
      /* Which kinds of leg the suggester may draw on: touchdowns, the counting props, the game lines. */
      kinds:{ td:true, props:true, game:true } };
    /* Which game each team plays this week, and whether it is still open. */
    var gameOf={}; (D.games||[]).forEach(function(g){ gameOf[g.home]=g; gameOf[g.away]=g; });
    var openGame=function(team){ var g=gameOf[team]; return g&&!g.completed&&Date.parse(g.date)>Date.now()?g:null; };

    /* What the browser remembers: the price typed against a row, keyed by
       watchlist.js so the same player at another line is another price.
       The store can refuse (a private window); then nothing is kept and
       the board still works for the visit. */
    var store=null; try{ store=(typeof window!=='undefined'&&window.localStorage)||null; }catch(e){ store=null; }
    var slate=String(D.season)+'-'+String(D.week);
    var readAll=function(){ if(!W||!store) return {}; try{ return W.parsePrices(store.getItem(W.PRICE_KEY)); }catch(e){ return {}; } };
    /* Save this league's slate over whatever it held before; the other
       board's prices in the same store are left alone. */
    var savePrices=function(){
      if(!W||!store) return;
      var all=readAll();
      Object.keys(all).forEach(function(k){ if(k.indexOf(cfg.league+'|')===0) delete all[k]; });
      Object.keys(state.prices).forEach(function(k){ all[k]=state.prices[k]; });
      try{ store.setItem(W.PRICE_KEY,W.serialise(all)); }catch(e){}
    };
    state.prices=W?W.forSlate(readAll(),cfg.league,slate):{};
    var priceKeyOf=function(p,prop,line){ return W?W.priceKey({league:cfg.league,slate:slate,playerId:p.id,prop:prop,line:line}):null; };
    /* The price typed against a row and the edge at it: edge.js's expected
       value of the model's chance at that price. null when nothing is typed. */
    function priceEdge(prob,pk){
      var price=pk!=null&&state.prices?state.prices[pk]:null;
      if(price==null||!E||!(prob>0&&prob<1)) return null;
      return {price:price, ev:E.evPct(prob,E.americanToDecimal(price))};
    }
    /* One colour rule for an edge, wherever it is shown: the slip, the row, the panel. */
    var edgeClass=function(ev){ return 'edge '+(ev>0.02?'good':ev>=0?'warn':'bad'); };
    /* The row cell: the price and its edge, or an invitation. Nothing at
       all when watchlist.js did not load: no cell that promises an input
       the panel cannot give. */
    var pxInner=function(pe){ return pe?sgn(pe.price)+'<small class="'+edgeClass(pe.ev)+'">'+E.formatPct(pe.ev)+' edge</small>':'<span class="none">price?</span><small>&nbsp;</small>'; };
    var pxCell=function(i,pe){ return W?'<span class="px" id="px'+i+'">'+pxInner(pe)+'</span>':''; };
    var rowClass=W?'row priced':'row';
    var pxEdgeInner=function(pe){ return pe?'<b class="'+edgeClass(pe.ev)+'">'+E.formatPct(pe.ev)+'</b> edge at '+sgn(pe.price):'the edge shows here'; };
    /* The panel's input: type the book's price, the row above follows. */
    var pxInput=function(r){
      if(r.pk==null) return '';
      return '<p class="pxrow"><label>Price you are offered <input class="pxin" data-pk="'+esc(r.pk)+'" data-i="'+r.i+'" inputmode="text" placeholder="-110" autocomplete="off"'+
        (r.pe?' value="'+sgn(r.pe.price)+'"':'')+'></label><span class="pxedge" id="pxe'+r.i+'">'+pxEdgeInner(r.pe)+'</span></p>';
    };

    /* Which rows show: ruled out never, then the search box, the team and
       the position. One gate for every player view. */
    var keep=function(p){
      return available(p)&&find(p)&&(!state.team||p.team===state.team)&&(!state.pos||p.pos===state.pos);
    };
    /* Ranking. Projection is the board's own order. Edge puts the rows a
       price has been typed against first, best edge first, the rest in
       projection order. Boost is projection over his own per-game rate,
       two numbers the panel already prints, so a re-ordering and never a
       price; no rate (a player yet to score) sorts last. */
    function sortRows(rows,by){
      var proj=function(a,b){ return by.proj(b)-by.proj(a); };
      if(state.sort==='edge') rows.sort(function(a,b){
        var ea=a.pe?a.pe.ev:null, eb=b.pe?b.pe.ev:null;
        if(ea!=null&&eb!=null&&ea!==eb) return eb-ea;
        if(ea!=null&&eb==null) return -1; if(ea==null&&eb!=null) return 1;
        return proj(a,b); });
      else if(state.sort==='boost') rows.sort(function(a,b){
        var xa=by.boost(a), xb=by.boost(b);
        if(xa!=null&&xb!=null&&xa!==xb) return xb-xa;
        if(xa!=null&&xb==null) return -1; if(xa==null&&xb!=null) return 1;
        return proj(a,b); });
      else rows.sort(proj);
    }
    /* Twenty rows is a board; eighty is a spreadsheet. The rest are one tap away. */
    var SHOW=20, MAX=80;
    var trim=function(rows){
      var n=(state.showAll||state.q)?MAX:SHOW, kept=rows.slice(0,n);
      /* A deep link to a player under the cap keeps his row on the board. */
      if(state.pin){ var extra=rows.slice(n).filter(function(r){ return r.p&&String(r.p.id)===state.pin; }); kept=kept.concat(extra); }
      return { rows:kept, hidden:Math.min(rows.length,MAX)-Math.min(rows.length,n) };
    };
    /* The search box filters the props views by name, team or opponent
       (nfl.js playerMatches). The game view has no players to find. */
    var find=function(p){ return N.playerMatches(state.q,p); };
    var nothing=function(){ return state.q ? '<div class="empty">No player matches <b>'+esc(state.q)+'</b> on this view.</div>' : ''; };
    var moreBtn=function(hidden){ return hidden>0 ? '<button class="more" type="button" data-more>Show '+hidden+' more</button>' : ''; };

    var pct=function(x,d){return (100*x).toFixed(d==null?1:d)+'%';};
    var sgn=function(n){return n>0?'+'+n:String(n);};
    var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
    var el=function(t,c,txt){var e=document.createElement(t); if(c)e.className=c; if(txt!=null)e.textContent=txt; return e;};

    /* What the model calls receiving opportunity, in words. */
    var oppWord = N.DEFAULTS.receivingStat === 'recs' ? 'receptions' : 'targets';
    var oppUnit = N.DEFAULTS.receivingStat === 'recs' ? 'reception' : 'target';
    var seasons = (D.statsSeasons || []).join('–');

    function seg(host,items,cur,pick){
      host.innerHTML='';
      items.forEach(function(it){
        var b=el('button',null,it.label); b.type='button';
        b.setAttribute('aria-pressed',String(it.id===cur));
        b.addEventListener('click',function(){pick(it.id);});
        host.appendChild(b);
      });
    }

    var usagePool = D.usagePool && D.usagePool.length ? D.usagePool : null;
    /* A pool is a flat list of ratios in an older data file and {exp, ratio}
       sorted by expectation in a newer one, so how many games it holds is
       the model's question, not this file's (nfl.js poolSize). */
    var poolFor=function(stat){ var p=D.pools&&D.pools[stat]; return p&&N.poolSize(p)?p:null; };

    /* Team codes come from the schedule now. They used to be recovered by
       searching each abbreviation inside the full team name, which dropped
       six of sixteen games ("San Francisco 49ers" contains no "SF") and
       misattributed two more ("Arizona Cardinals" contains "CAR"). */
    var allowFor=function(team,stat){ var f=team&&D.teamFactors[team]; return f&&f.allow?f.allow[stat]:null; };
    var oppFactorFor=function(team){
      var f=D.teamFactors[team];
      return f&&isFinite(f.def)?f.def:1;
    };

    /* A player ruled out is not shown: his props are void at every book.
       Questionable is shown and flagged. One rule, the model's, shared
       with the tracker. */
    var available=function(p){ return N.availability(p.status)!=='out'; };
    var qTag=function(p){ return N.availability(p.status)==='questionable' ? '<span class="tag q" title="Listed Questionable">Q</span>' : ''; };
    var statusRow=function(p){
      var t='';
      // He moved: the roster says where he is, the record says what he did.
      if(p.movedFrom) t+='<tr><td>team</td><td>now <b>'+esc(p.team)+'</b> — every number here is from his '+esc(p.movedFrom)+' games; a new offence can change his role</td></tr>';
      if(p.status&&N.availability(p.status)!=='ok')
        t+='<tr><td>status</td><td><b>'+esc(p.status)+'</b>'+(p.injury?' ('+esc(p.injury)+')':'')+
          ' — listed Questionable, about 6 in 10 play; a bet on a player who does not is void, not lost</td></tr>';
      return t;
    };

    function renderTD(){
      var rows=[];
      (D.players||[]).forEach(function(p){
        if(!keep(p)) return;
        var tf=(D.teamFactors[p.team]||{}).off||1;
        // The opponent's defence, the same term the backtest used.
        var of=p.opp?oppFactorFor(p.opp):1;
        var s=N.scoreAnytimeTD(p,{teamFactor:tf, oppFactor:of, usagePool:usagePool});
        if(!s) return;
        var pk=priceKeyOf(p,'td');
        rows.push({p:p,s:s,chance:s.prob,pk:pk,pe:priceEdge(s.prob,pk)});
      });
      sortRows(rows,{proj:function(r){return r.s.prob;}, boost:function(r){return r.s.observedRate>0?r.s.lambda/r.s.observedRate:null;}});
      var t=trim(rows); rows=t.rows;

      var html=slipHtml()+'<div class="game"><div class="ghead"><h2 class="gtitle">Most likely to score</h2>'+
        '<div class="gmeta">'+rows.length+' players · '+seasons+' form · type the book\'s price in a row for your edge</div></div>';
      rows.forEach(function(r,i){
        r.i=i;
        html+='<button class="'+rowClass+'" aria-haspopup="dialog" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.p.name)+'<span class="pos">'+esc(r.p.team)+
            (r.p.opp?' vs '+esc(r.p.opp):'')+'</span>'+qTag(r.p)+'</span>'+
          '<span class="prob">'+pct(r.s.prob,0)+'</span>'+
          '<span class="be">'+sgn(N.fairPrice(r.s.prob))+'<small>fair</small></span>'+
          pxCell(i,r.pe)+
          '<span class="caret">›</span></button>';
      });
      app.innerHTML=html+(rows.length?'':nothing())+moreBtn(t.hidden)+'</div>';
      app.__rows=rows; app.__ladder=null;
      app.__detail=function(r){
        var t=pxInput(r)+'<table>';
        t+='<tr><td>workload</td><td><b>'+r.s.perGameCarries.toFixed(1)+'</b> carries and <b>'+
          r.s.perGameReceiving.toFixed(1)+'</b> '+oppWord+' a game over <b>'+r.p.games+'</b> games</td></tr>';
        t+='<tr><td>from workload</td><td><b>'+r.s.usageRate.toFixed(3)+'</b> touchdowns a game '+
          '('+N.DEFAULTS.tdPerCarry+' per carry, '+N.DEFAULTS.tdPerTarget+' per '+oppUnit+' — measured)</td></tr>';
        t+='<tr><td>his own rate</td><td><b>'+r.s.observedRate.toFixed(3)+'</b> a game — '+
          'kept <b>'+pct(r.s.shrink,0)+'</b> of it, the rest is workload</td></tr>';
        t+='<tr><td>offence</td><td>×<b>'+r.s.teamFactor.toFixed(2)+'</b></td></tr>';
        t+='<tr><td>opponent</td><td>'+(r.p.opp
          ? '<b>'+esc(r.p.opp)+'</b> ×<b>'+r.s.oppFactor.toFixed(2)+'</b> — '+
            (r.s.oppFactor>1.02?'gives up more touchdowns than average'
             :r.s.oppFactor<0.98?'gives up fewer than average':'about average')
          : 'no opponent scheduled')+'</td></tr>';
        t+='<tr><td>expected TDs</td><td><b>'+r.s.lambda.toFixed(3)+'</b> '+
          '(pulled '+Math.round((1-N.DEFAULTS.tdShrink)*100)+'% toward the league average, which is what stops the top of the board running hot)</td></tr>';
        t+='<tr><td>chance to score</td><td><b>'+pct(r.s.prob)+'</b>'+
          (r.s.usageAveraged?', averaged over real week-to-week workload swings':'')+'</td></tr>';
        t+='<tr><td>fair price</td><td><b>'+sgn(N.fairPrice(r.s.prob))+'</b></td></tr>';
        t+=statusRow(r.p);
        return t+'</table>';
      };
    }

    function renderStat(stat){
      var ST=N.STATS[stat], pool=poolFor(stat), unit=stat==='recs'?' catches':' yards';
      var rows=[];
      (D.players||[]).forEach(function(p){
        if(!keep(p)) return;
        // The one gate, shared with the tracker: see nfl.js statEligible.
        var y=N.statEligible(stat,p,null,{oppFactor:allowFor(p.opp,stat)});
        if(!y) return;
        var line=Math.round(y.exp*state.lineMult)+0.5;
        var over=N.empiricalOver(y.exp,line,pool);
        if(over==null) return;
        var pk=priceKeyOf(p,stat,line);
        rows.push({p:p,exp:y.exp,base:y.base,oppFactor:y.oppFactor,line:line,over:over,chance:over,pk:pk,pe:priceEdge(over,pk)});
      });
      sortRows(rows,{proj:function(r){return r.exp;}, boost:function(r){ var avg=N.statTotal(stat,r.p)/r.p.games; return avg>0?r.exp/avg:null; }});
      var t=trim(rows); rows=t.rows;
      var strength=N.DEFAULTS[ST.oppShrinkKey], word=ST.label.toLowerCase();
      /* Whose real games the pool is made of. The board gains a view the
         moment the model gains a stat, so this says the new one too. */
      var poolWord=stat==='passyds'?'quarterbacks':stat==='rushyds'?'backs':stat==='rushrec'?'backs and receivers':'receivers';
      /* A matchup badge on the row, only where the opponent is in the
         number and only when it is clearly soft or tough (7% either side
         of average); in between it says nothing, so that when it shows it
         means something. */
      var badge=function(p){
        if(!strength||!p.opp) return '';
        var a=allowFor(p.opp,stat); if(!a) return '';
        return a>=1.07?'<span class="tag soft">soft D</span>':a<=0.93?'<span class="tag tough">tough D</span>':'';
      };
      /* At the projection line every player's over prices about the same,
         so that column is dimmed and the projection carries the row. Low and
         High are where the odds separate. */
      var atProj=state.lineMult===1;
      var html=slipHtml()+'<div class="game"><div class="ghead"><h2 class="gtitle">'+esc(ST.label)+'</h2>'+
        '<div class="gmeta">'+rows.length+' players · '+(atProj
          ? 'ranked by projection · at his own line every player is near a coin flip, so pick Low or High to see the odds move'
          : 'ranked by projection · the chance of the over at the line shown · <b>fair</b> is the break-even price — bet only if the book beats it')+
        ' · type the book\'s price in a row for your edge</div></div>';
      rows.forEach(function(r,i){
        r.i=i;
        html+='<button class="'+rowClass+'" aria-haspopup="dialog" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.p.name)+'<span class="pos">'+esc(r.p.team)+(r.p.opp?' vs '+esc(r.p.opp):'')+' · o'+r.line+'</span>'+badge(r.p)+qTag(r.p)+'</span>'+
          '<span class="prob">'+Math.round(r.exp)+'<small>'+(stat==='recs'?'catches':'yards')+'</small></span>'+
          '<span class="be'+(atProj?' dim':'')+'">'+pct(r.over,0)+'<small>'+sgn(N.fairPrice(r.over))+' fair</small></span>'+
          pxCell(i,r.pe)+
          '<span class="caret">›</span></button>';
      });
      /* A stat the model has and this data file has no pool for: the view
         arrived with the model, the pool arrives with the next build. Say
         which, rather than showing an empty panel with no explanation. */
      var empty=pool?nothing():'<div class="empty"><div class="big">No pool yet</div>'+
        '<div>Pricing '+esc(word)+' needs a pool of comparable real games. Run <code>node '+cfg.fetcher+'</code> to build it.</div></div>';
      app.innerHTML=html+(rows.length?'':empty)+moreBtn(t.hidden)+'</div>';
      app.__rows=rows;
      /* The alternate lines: every rung of the model's ladder, priced off
         the same pool the row is. The drawer's ladder tab renders them. */
      app.__ladder=function(r){ return N.ladder(stat,r.exp,pool); };
      /* The panel: the decision first, in two lines, then the alternate
         lines, then the arithmetic in words a bettor already uses. The
         constants behind each step are in nfl.js and the README; they do
         not belong here. */
      app.__detail=function(r){
        var fair=sgn(N.fairPrice(r.over)), games=r.p.games, avg=N.statTotal(stat,r.p)/games;
        var oppWordFor = ST.opportunity==='receiving' ? oppWord : ST.opportunity==='carries' ? 'carries'
          : ST.opportunity==='touches' ? 'touches' : 'attempts';
        var onOpp = (stat==='recs' && N.DEFAULTS.receivingStat==='recs') ? '' :
          ' on '+N.statOpportunity(stat,r.p)+' '+oppWordFor;
        var h='<p class="verdict">Over <b>'+r.line+'</b> hits <b>'+pct(r.over,0)+'</b> of the time. Fair price <b>'+fair+'</b>. '+
          'Bet it only if the book is offering better than '+fair+'.</p>';
        var w='<p><b>Why '+Math.round(r.exp)+'</b> — averages <b>'+avg.toFixed(0)+'</b>'+unit+' a game over '+games+' games'+onOpp+'. ';
        if(Math.abs(r.base-avg)>=0.5)
          w+='Regressed to <b>'+r.base.toFixed(0)+'</b>, part of the way toward an ordinary player\'s '+N.DEFAULTS[ST.priorKey]+
            (games<10?' (few games, so a long way)':'')+'. ';
        var allow=allowFor(r.p.opp,stat);
        if(!r.p.opp) w+='No opponent placed yet. ';
        else if(strength&&allow){
          var d=Math.round((allow-1)*100), delta=r.exp-r.base;
          w+=esc(r.p.opp)+' gives up <b>'+Math.abs(d)+'% '+(d>=0?'more':'fewer')+'</b> '+word+' than average, which '+
            (delta>=0?'adds':'takes off')+' <b>'+Math.abs(delta).toFixed(0)+'</b>. ';
        } else if(allow) {
          /* Why the opponent is out of THIS prop is a measured claim and a
             different one per stat and per league, so it is the note above
             the board (copy.noteStat) that says it, once. The panel used to
             repeat "on the replay it made no difference", which was true of
             receiving yards and receptions and never measured for a stat the
             model gained later. */
          w+='The opponent is not in this number. ';
        }
        /* How many games this player's over was actually read off: the
           whole pool in an older data file, the stat's share of the games
           nearest his projection in a levelled one. Asking the model which games
           it used keeps the sentence true under either shape. */
        var used=N.poolReads(pool,r.exp).length, held=N.poolSize(pool);
        w+='Projects to <b>'+r.exp.toFixed(0)+'</b>. The chance of the over is read off '+used.toLocaleString('en-US')+' real games by '+
          poolWord+(used<held?' whose own projection was nearest his':' against their own projections')+'.</p>';
        var s=statusRow(r.p);
        if(s) s='<p>'+s.replace(/<\/?t[rd]>/g,'').replace(/^status/,'')+'</p>';
        return h+pxInput(r)+w+s;
      };
    }

    /* Expected value of a pick at its price, via edge.js. */
    var E = window.BetHouseEdge;
    var evOf=function(k){ return k && E ? E.evPct(k.prob, E.americanToDecimal(k.price)) : NaN; };
    var sideName=function(g,k,prop){
      if(prop==='total') return (k.side==='over'?'o':'u')+k.line;
      var team = k.side==='home'?g.home:g.away;
      if(prop==='ml') return team+' ML';
      var pts = k.side==='home'?k.line:-k.line;
      return team+' '+(pts>0?'+':'')+pts;
    };
    var evStr=function(ev){ return isFinite(ev)?((ev>=0?'+':'')+(100*ev).toFixed(1)+'%'):'—'; };
    /* "−3 → −3.5": where the line opened and where it is. A number that has
       not moved is printed once. */
    var fmtLine=function(v,plain){ return plain?String(v):((v>0?'+':'')+v); };
    var moveStr=function(open,now,plain){
      if(now==null) return '—';
      if(open==null||!isFinite(open)||open===now) return fmtLine(now,plain);
      return fmtLine(open,plain)+' → '+fmtLine(now,plain);
    };

    /* ---- the matchup panel ----
     *
     * tendencies-data.js, written by tendencies.mjs out of nflverse
     * play-by-play: how each offence plays, what each defence gives up,
     * and where the two meet. nfl.html loads it; college has no
     * play-by-play, so cfb.html does not, and everything here is guarded
     * on the file being there rather than on which league this is.
     *
     * It is DESCRIPTIVE. The replay that would say whether any of it
     * belongs in a projection is not run, so no number here reaches one
     * and the panel's last line says so.
     *
     * tendencies.mjs is an ES module and this page is plain scripts, so
     * the two thresholds and the family table are re-typed rather than
     * imported -- the duplication tasks/lessons.md warns about, so
     * dom.test.mjs asserts they still agree with the module.
     */
    var TEND=(function(t){
      return t&&t.current&&t.current.off&&t.current.def&&t.current.league?t:null;
    })(window.BetHouseTendencies);
    /* tendencies.mjs LEAN_SHARE: a share this far from the league's is a
       lean. SOFT_EPA: EPA per play this far from the league's is soft or
       stout. Both chosen there for legibility, not fitted. */
    // TODO(simplify): tendencies.mjs is ESM-only; give it a UMD wrapper like nfl.js and
    // call its rank / matchup / thresholds here instead of re-typing them. Trigger: the
    // third constant or family that has to be copied.
    var LEAN_SHARE=0.03, SOFT_EPA=0.05;
    var FAMILIES=[
      {family:'deep pass',   share:'deepRate',        epa:'deepEpa',       unit:'of throws'},
      {family:'short pass',  share:'shortRate',       epa:'shortEpa',      unit:'of throws'},
      {family:'inside run',  share:'insideRunShare',  epa:'insideRunEpa',  unit:'of runs'},
      {family:'outside run', share:'outsideRunShare', epa:'outsideRunEpa', unit:'of runs'},
      {family:'play action', share:'playActionRate',  epa:'paEpa',         unit:'of dropbacks'},
      {family:'vs blitz',    share:'blitzRate',       epa:'blitzEpa',      unit:'of dropbacks, the defence\'s call', who:'def'}
    ];
    /* Where a team stands among the league on one metric, ties sharing a
       place (tendencies.mjs rank). Solved once per metric, not once per
       game, because every game asks for the same dozen. */
    var rankCache={};
    var rankIn=function(side,key,hi){
      var ck=side+'|'+key+'|'+(hi?1:0);
      if(rankCache[ck]) return rankCache[ck];
      var tbl=TEND.current[side], rows=[];
      Object.keys(tbl).forEach(function(t){ if(tbl[t]&&tbl[t][key]!=null) rows.push([t,tbl[t][key]]); });
      rows.sort(function(a,b){ return hi?b[1]-a[1]:a[1]-b[1]; });
      var out={}, prev=null, place=0;
      rows.forEach(function(row,i){ if(prev===null||row[1]!==prev){ place=i+1; prev=row[1]; } out[row[0]]=place; });
      rankCache[ck]=out; return out;
    };
    var ord=function(n){ var s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
    var rk=function(side,key,team,hi){ var r=rankIn(side,key,hi)[team]; return r?'<span class="rk">'+ord(r)+'</span>':''; };
    var shareOf=function(v){ return v==null?'—':Math.round(v*100)+'%'; };
    var epaOf=function(v){ return v==null?'—':(v>=0?'+':'-')+Math.abs(v).toFixed(2); };
    var pts=function(v){ return (v>=0?'+':'-')+Math.abs(v).toFixed(1); };
    /* One offence against the defence it faces. '' when either side is
       not in the file, so a game of two unprofiled teams shows nothing
       rather than a row of dashes. */
    function matchupSide(offTeam,defTeam){
      var off=TEND.current.off[offTeam], def=TEND.current.def[defTeam], lg=TEND.current.league;
      if(!off||!def) return '';
      var h='<div class="muside"><div class="mutitle">'+esc(offTeam)+' offence vs '+esc(defTeam)+' defence</div>';
      /* Plays a game is this season's raw count, not a blended rate, so a
         team yet to snap the ball has none rather than zero. */
      h+='<div class="mline">'+(off.playsPerGame!=null?'<b>'+Math.round(off.playsPerGame)+'</b> plays a game '+rk('off','playsPerGame',offTeam,true)+' · ':'')+
        'pass <b>'+shareOf(off.passRate)+'</b> '+rk('off','passRate',offTeam,true)+
        (off.proe!=null?' ('+pts(off.proe)+' over expected)':'')+
        ' · deep <b>'+shareOf(off.deepRate)+'</b> '+rk('off','deepRate',offTeam,true)+
        ' · inside run <b>'+shareOf(off.insideRunShare)+'</b> '+rk('off','insideRunShare',offTeam,true)+
        ' · play action <b>'+shareOf(off.playActionRate)+'</b> '+rk('off','playActionRate',offTeam,true)+
        ' · motion <b>'+shareOf(off.motionRate)+'</b> '+rk('off','motionRate',offTeam,true)+'</div>';
      /* The defence's ranks run the other way: 1st is the stingiest. */
      h+='<div class="mline">'+esc(defTeam)+' allows <b>'+epaOf(def.epaPerPlay)+'</b> EPA a play '+rk('def','epaPerPlay',defTeam,false)+
        ' · pass <b>'+epaOf(def.epaPerPass)+'</b> '+rk('def','epaPerPass',defTeam,false)+
        ' · rush <b>'+epaOf(def.epaPerRush)+'</b> '+rk('def','epaPerRush',defTeam,false)+
        ' · blitzes <b>'+shareOf(def.blitzRate)+'</b> '+rk('def','blitzRate',defTeam,true)+
        ' · sees <b>'+shareOf(def.passRate)+'</b> pass '+rk('def','passRate',defTeam,true)+'</div>';
      /* What works against this defence: the families it gives up most,
         relative to the league, with this offence's own appetite beside
         each. Positive EPA allowed is the offence's gain, so softest is
         first and every number in the row reads from the offence's side. */
      var fams=[];
      FAMILIES.forEach(function(f){
        /* The blitz is the defence's call: its share is how often the
           DEFENCE blitzes (tendencies.mjs FAMILIES), and the offence gets
           no leans-in/avoids tag for a choice it did not make. */
        var defsCall=f.who==='def';
        var os=defsCall?def[f.share]:off[f.share], da=def[f.epa], ls=lg[f.share], le=lg[f.epa];
        if(os==null&&da==null) return;
        fams.push({f:f, os:os, da:da, ls:ls, le:le,
          lean:(defsCall||os==null||ls==null)?null:os-ls, edge:(da==null||le==null)?null:da-le});
      });
      if(!fams.length) return h+'</div>';
      fams.sort(function(a,b){ return (b.edge==null?-Infinity:b.edge)-(a.edge==null?-Infinity:a.edge); });
      h+='<div class="mfam"><span class="fh">what works</span><span class="fh fv">'+esc(defTeam)+' allows</span>'+
        '<span class="fh fv">'+esc(offTeam)+' uses</span>';
      fams.forEach(function(x){
        var tags='';
        if(x.edge!=null&&x.edge>=SOFT_EPA) tags+='<span class="tag soft">soft</span>';
        else if(x.edge!=null&&x.edge<=-SOFT_EPA) tags+='<span class="tag tough">stout</span>';
        if(x.lean!=null&&x.lean>=LEAN_SHARE) tags+='<span class="tag lean">leans in</span>';
        else if(x.lean!=null&&x.lean<=-LEAN_SHARE) tags+='<span class="tag lean">avoids</span>';
        /* The unit ("of throws") belongs to the family, not to the number,
           and it is the one string long enough to wrap an 84px column and
           set the row height off the length of a word. It goes in the
           flexible first column, where wrapping costs nothing. */
        h+='<span class="fn">'+x.f.family+tags+'<small>'+x.f.unit+'</small></span>'+
          '<span class="fv">'+epaOf(x.da)+'<small>lg '+epaOf(x.le)+'</small></span>'+
          '<span class="fv">'+shareOf(x.os)+'<small>'+(x.f.who==='def'?esc(defTeam)+' blitzes · ':'')+'lg '+shareOf(x.ls)+'</small></span>';
      });
      return h+'</div></div>';
    }
    /* Both directions of one game, or '' when the file has neither side. */
    function matchupHtml(r){
      if(!TEND) return '';
      var body=matchupSide(r.a,r.h)+matchupSide(r.h,r.a);
      if(!body) return '';
      var w=TEND.through&&TEND.through.week;
      /* The board is week W; play-by-play through W-1 is current. Older than that and the panel says so. */
      var behind=TEND.through&&D.week!=null&&(Number(TEND.through.season)!==Number(D.season)||Number(TEND.through.week)<Number(D.week)-1);
      return '<div class="mu"><h4 class="muhead">Matchup</h4>'+body+
        '<p class="mufoot">Play-by-play'+(w?' through week '+Number(w)+(behind?' — <b>behind this board</b>, the last build failed or has not run':''):'')+' (nflverse); each rate regressed toward last season by '+
        Number(TEND.K||0)+' games. Descriptive: nothing here is in a price yet.</p></div>';
    }

    function renderGames(){
      var html=slipHtml()+'<div class="banner"><h3>Read this before betting a side</h3>'+C.gameBanner+'</div>';
      var rows=[];
      (D.games||[]).forEach(function(g){
        if(!g.home||!g.away) return;
        var pr=N.projectGame(D.ratings,g.home,g.away,{neutral:!!g.neutral});
        if(!pr) return;
        var pick=g.line?N.pickGame(pr,g.line):null;
        /* The row shows the better of the spread and total picks. The
           moneyline is deliberately NOT a candidate: the replay says the
           model's win probabilities are worse than the market's in both
           leagues, and a flat model makes every underdog look like value,
           so ranking by moneyline EV would put the worst bet on top. It is
           in the detail, with the replay's verdict beside it. */
        var best=null;
        if(pick){
          ['spread','total'].forEach(function(prop){
            var k=pick[prop]; if(!k) return;
            var ev=evOf(k);
            if(!best||(isFinite(ev)&&ev>best.ev)) best={prop:prop,k:k,ev:ev};
          });
        }
        rows.push({g:g,h:g.home,a:g.away,pr:pr,pick:pick,best:best});
      });
      /* Best value first; games with no line yet at the bottom, in
         schedule order, showing the projection alone. */
      rows.sort(function(x,y){
        var ex=x.best&&isFinite(x.best.ev)?x.best.ev:-Infinity, ey=y.best&&isFinite(y.best.ev)?y.best.ev:-Infinity;
        if(ex!==ey) return ey-ex;
        return String(x.g.date).localeCompare(String(y.g.date));
      });
      var lined=rows.filter(function(r){return r.best;}).length;
      html+='<div class="game"><div class="ghead"><h2 class="gtitle">Week '+D.week+'</h2>'+
        '<div class="gmeta">'+rows.length+' games · '+(lined?lined+' with a line, best value first · the side, its chance to cover, EV at the price':'no lines yet')+
        (D.linesFetched?' · lines as of '+esc(String(D.linesFetched).slice(0,16).replace('T',' '))+' UTC':'')+'</div></div>';
      rows.forEach(function(r,i){
        var m=r.pr.margin;
        html+='<button class="row" aria-haspopup="dialog" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.a)+(r.g.neutral?' vs ':' at ')+esc(r.h)+
            '<span class="pos">'+(r.g.line
              ? esc(r.h)+' '+moveStr(r.g.line.open&&r.g.line.open.spread,r.g.line.spread)+' · o/u '+moveStr(r.g.line.open&&r.g.line.open.total,r.g.line.total,true)+
                (r.g.line.book?' · '+esc(r.g.line.book):'')
              : esc(String(r.g.name||'')))+(r.g.neutral?' · neutral site':'')+'</span></span>'+
          /* With a line: the best pick, its probability, and its EV at the
             quoted price. Without one: the projection, as before. Number on
             top, label as the block sublabel under it. */
          (r.best
            ? '<span class="prob pick">'+esc(sideName(r.g,r.best.k,r.best.prop))+'<small>'+pct(r.best.k.prob,0)+' cover</small></span>'+
              '<span class="be">'+evStr(r.best.ev)+'<small>EV</small></span>'
            : '<span class="prob">-'+Math.abs(m).toFixed(1)+'<small>'+esc(m>=0?r.h:r.a)+'</small></span>'+
              '<span class="be">'+r.pr.total.toFixed(1)+'<small>total</small></span>')+
          '<span class="caret">›</span></button>';
      });
      app.innerHTML=html+'</div>';
      app.__rows=rows; app.__ladder=null;
      app.__detail=function(r){
        var t='<table>';
        t+='<tr><td>projection</td><td><b>'+esc(r.h)+' '+r.pr.homePts.toFixed(1)+
          '</b> — <b>'+esc(r.a)+' '+r.pr.awayPts.toFixed(1)+'</b> · margin <b>'+(r.pr.margin>=0?'+':'')+r.pr.margin.toFixed(1)+
          '</b> to the home side'+(r.g.neutral?' (neutral site, no home field)':'')+' · total <b>'+r.pr.total.toFixed(1)+'</b></td></tr>';
        if(r.g.line){
          var L=r.g.line;
          if(L.open&&isFinite(L.open.spread)){
            var mv=L.spread-L.open.spread, tmv=(L.open.total!=null&&L.total!=null)?L.total-L.open.total:0;
            t+='<tr><td>movement</td><td>'+(mv===0?'spread unmoved since it opened':
              'spread moved <b>'+Math.abs(mv)+'</b> toward <b>'+esc(mv<0?r.h:r.a)+'</b> since it opened at '+fmtLine(L.open.spread))+
              (tmv?'; total moved <b>'+(tmv>0?'up':'down')+' '+Math.abs(tmv)+'</b> from '+L.open.total:'')+'</td></tr>';
          }
          t+='<tr><td>market</td><td>'+esc(r.h)+' <b>'+(L.spread>0?'+':'')+L.spread+'</b>'+
            (L.homeSpreadOdds?' ('+sgn(L.homeSpreadOdds)+' / '+sgn(L.awaySpreadOdds)+')':'')+
            ' · total <b>'+L.total+'</b>'+(L.overOdds?' ('+sgn(L.overOdds)+' / '+sgn(L.underOdds)+')':'')+
            (L.homeML?' · '+esc(r.h)+' '+sgn(L.homeML)+', '+esc(r.a)+' '+sgn(L.awayML):'')+
            (L.book?' · '+esc(L.book):'')+'</td></tr>';
          var line=function(label,k,prop,extra){
            if(!k){ t+='<tr><td>'+label+'</td><td>no line</td></tr>'; return; }
            var ev=evOf(k), be=E?E.breakEvenProb(k.price):null;
            t+='<tr><td>'+label+'</td><td><b>'+esc(sideName(r.g,k,prop))+'</b> at '+sgn(k.price)+
              ' — model <b>'+pct(k.prob)+'</b>'+(be!=null?', the price needs '+pct(be):'')+
              (k.edge!=null?', edge <b>'+k.edge.toFixed(1)+'</b> points':'')+(extra||'')+
              ' → EV <b>'+evStr(ev)+'</b></td></tr>';
          };
          var pk=r.pick||{};
          line('spread',pk.spread,'spread');
          line('total',pk.total,'total');
          var mlExtra='';
          if(pk.ml&&E&&L.homeML&&L.awayML){
            var nv=E.devigAmerican([L.homeML,L.awayML]);
            if(nv) mlExtra=', the market (no vig) says <b>'+pct(pk.ml.side==='home'?nv[0]:nv[1])+'</b>';
          }
          line('moneyline',pk.ml,'ml',mlExtra);
          if(pk.ml&&C.mlVerdict) t+='<tr><td></td><td>'+C.mlVerdict+'</td></tr>';
        } else {
          t+='<tr><td>market</td><td>no line yet</td></tr>';
        }
        var hurt=function(team){
          var l=(D.injuries||{})[team]||[]; if(!l.length) return esc(team)+': none listed';
          return esc(team)+': '+l.map(function(x){return esc(x.name)+' ('+esc(x.pos)+') <b>'+esc(x.status)+'</b>'+(x.detail?', '+esc(x.detail):'');}).join('; ');
        };
        if(D.injuriesAt) t+='<tr><td>injuries</td><td>'+hurt(r.h)+'<br>'+hurt(r.a)+
          '<br><span style="color:var(--muted)">Skill players not listed Active. The line above already reflects them: injury news is what moves it.</span></td></tr>';
        t+='<tr><td>ratings</td><td>'+esc(r.h)+' offence <b>'+(D.ratings.off[r.h]||0).toFixed(2)+
          '</b>, defence <b>'+(D.ratings.def[r.h]||0).toFixed(2)+'</b><br>'+
          esc(r.a)+' offence <b>'+(D.ratings.off[r.a]||0).toFixed(2)+
          '</b>, defence <b>'+(D.ratings.def[r.a]||0).toFixed(2)+'</b></td></tr>';
        t+='<tr><td>honestly</td><td>'+C.gameHonestly+'</td></tr>';
        return t+'</table>'+matchupHtml(r);
      };
    }

    /* ---- the drawer ----
       A row opens it; the player's id goes in the URL so a row is a link;
       Escape, the scrim, the close button and the back button close it.
       Its tabs: the overview (the row's reasoning), the alternate lines as
       buttons, the recent games the data file carries. Everything about
       the window is feature-detected so the board mounts without one. */
    var hist=(typeof window!=='undefined'&&typeof window.history!=='undefined'&&window.history&&window.history.pushState)?window.history:null;
    var loc=(typeof window!=='undefined'&&window.location)||null;
    var drawerEl=document.getElementById('drawer'), scrimEl=document.getElementById('scrim');
    state.drawer=null;
    var rowIdOf=function(r){ return r.p?String(r.p.id):r.g?String(r.g.id):null; };
    var findRow=function(id){ var rows=app.__rows||[]; for(var i=0;i<rows.length;i++) if(rowIdOf(rows[i])===id) return i; return -1; };
    /* Only a gesture pushes a history entry; the board's own tidying
       (a row that vanished under a filter, a link to nobody) replaces
       the entry it is on, so Back and Forward keep meaning what they did. */
    var setUrl=function(id,kind,replace){
      if(!hist||!loc) return;
      var url=id?'?'+(kind==='g'?'game':'player')+'='+encodeURIComponent(id)+'&prop='+encodeURIComponent(state.view):(loc.pathname||'');
      try{ if(replace&&hist.replaceState) hist.replaceState(null,'',url); else hist.pushState(null,'',url); }catch(e){}
    };
    function openDrawer(i,opener,quiet){
      var r=app.__rows&&app.__rows[i]; if(!r) return;
      var id=rowIdOf(r), kind=r.p?'p':'g', d=state.drawer;
      var same=d&&d.id===id&&d.kind===kind;
      state.drawer={id:id, kind:kind, tab:same?d.tab:'over', rung:same?d.rung:null, opener:opener||(d&&d.opener)||null};
      if(!quiet&&!same) setUrl(id,kind);
      renderDrawer();
      var c=document.getElementById('dclose'); if(c&&c.focus) c.focus();
    }
    /* Focus goes back to the row that opened the drawer -- the live one,
       since a re-render in between rebuilt the rows. */
    var liveOpener=function(d){
      var i=findRow(d.id);
      if(i>=0&&app.querySelector){ var el=app.querySelector('.row[data-i="'+i+'"]'); if(el) return el; }
      return d.opener;
    };
    function closeDrawer(how){
      if(!state.drawer) return;
      var d=state.drawer, op=liveOpener(d); state.drawer=null; state.pin=null;
      if(drawerEl) drawerEl.hidden=true; if(scrimEl) scrimEl.hidden=true;
      if(how==='replace') setUrl(null,null,true); else if(!how) setUrl(null);
      if(op&&op.focus) op.focus();
    }
    /* A player by id. Under the twenty-row cut, the cut lifts; behind a
       filter, the filter clears; under the eighty-row cap, his row is
       pinned. On no view at all: closed, quietly, the board as it was. */
    function openById(id,quiet){
      var i=findRow(id);
      if(i<0){
        var was={showAll:state.showAll,team:state.team,pos:state.pos,q:state.q};
        state.showAll=true; state.team=''; state.pos=''; state.q=''; state.pin=id;
        var qEl=document.getElementById('q'); if(qEl) qEl.value='';
        render(); i=findRow(id);
        if(i<0){ state.showAll=was.showAll; state.team=was.team; state.pos=was.pos; state.q=was.q; state.pin=null; render(); closeDrawer('replace'); return; }
      }
      openDrawer(i,null,quiet);
    }
    var propLabelOf=function(r){
      if(!r.p) return '';
      return state.view==='td'?'Anytime TD':N.STATS[state.view]?N.STATS[state.view].label+' o'+r.line:'';
    };
    function renderDrawer(){
      var d=state.drawer; if(!d||!drawerEl) return;
      var i=findRow(d.id); if(i<0){ closeDrawer('replace'); return; }
      var r=app.__rows[i]; r.i=i;
      document.getElementById('dtitle').textContent = r.p ? r.p.name : (r.a+' at '+r.h);
      document.getElementById('dsub').textContent = r.p ? (r.p.team+(r.p.opp?' vs '+r.p.opp:'')+' · '+propLabelOf(r)) : ('week '+D.week);
      var tabs=[{id:'over',label:'Overview'}];
      if(r.p&&app.__ladder) tabs.push({id:'ladder',label:'Alternate lines'});
      if(r.p) tabs.push({id:'recent',label:'Recent games'});
      if(!tabs.some(function(t){return t.id===d.tab;})) d.tab='over';
      seg(document.getElementById('dtabs'),tabs,d.tab,function(v){ if(state.drawer){ state.drawer.tab=v; renderDrawer(); } });
      document.getElementById('dbody').innerHTML = d.tab==='ladder'?ladderTab(r):d.tab==='recent'?recentTab(r):app.__detail(r);
      drawerEl.hidden=false; if(scrimEl) scrimEl.hidden=false;
    }
    /* The alternate lines as buttons. The rung nearest the row's line is
       pressed first; a press moves the headline and the recent-games
       threshold. */
    function ladderTab(r){
      var rungs=app.__ladder?app.__ladder(r):[];
      if(!rungs.length) return '<p>No alternate lines for this row.</p>';
      var d=state.drawer, near=0;
      rungs.forEach(function(g,i){ if(Math.abs(g.line-r.line)<Math.abs(rungs[near].line-r.line)) near=i; });
      if(d.rung==null||!rungs.some(function(g){return g.at===d.rung;})) d.rung=rungs[near].at;
      var cur=rungs.filter(function(g){return g.at===d.rung;})[0];
      var h='<p class="verdict"><b>'+cur.at+'+</b> hits <b>'+pct(cur.prob,0)+'</b> of the time. Fair price <b>'+sgn(N.fairPrice(cur.prob))+'</b>. '+
        'Bet it only if the book is offering better than that.</p>'+
        '<p class="lhead">Every alternate line the book might offer, priced off the same games as the row. Press one.</p><div class="rungs" id="rungs">';
      rungs.forEach(function(g){
        var on=g.at===d.rung;
        h+='<button class="rung'+(on?' near':'')+'" type="button" data-rung="'+g.at+'" aria-pressed="'+on+'">'+
          '<b>'+g.at+'+</b><span class="rp">'+pct(g.prob,0)+'</span><span class="rf">'+sgn(N.fairPrice(g.prob))+' fair</span></button>';
      });
      return h+'</div>';
    }
    /* The recent games the data file carries: a bar a game, newest on the
       right, the threshold the pressed rung (or the row's line; for a
       touchdown, one), and how many games cleared it. */
    function recentTab(r){
      var rec=r.p&&r.p.recent;
      if(!rec||!rec.length) return '<p>No game log for him yet: the data file carries a player\'s last few games, and he has none on file.</p>';
      var stat=N.STATS[state.view]?state.view:null, d=state.drawer;
      var thr=stat?(d.rung!=null?d.rung:Math.ceil(r.line)):1;
      var vals=stat?N.recentValues(stat,rec):rec.map(function(x){return Number(x[6])||0;});
      var hits=stat?N.recentHits(stat,rec,thr):vals.filter(function(v){return v>=1;}).length;
      var head=stat
        ? '<p class="verdict">He reached <b>'+thr+'+</b> in <b>'+hits+'</b> of the last <b>'+rec.length+'</b> games.</p>'
        : '<p class="verdict">He scored in <b>'+hits+'</b> of the last <b>'+rec.length+'</b> games.</p>';
      var rows=rec.slice().reverse(), vs=vals.slice().reverse();
      var max=Math.max(thr,Math.max.apply(null,vs),1), H=110, step=34, Wd=rows.length*step+8;
      var svg='<svg class="bars" viewBox="0 0 '+Wd+' '+(H+30)+'" role="img" aria-label="The last '+rec.length+' games, newest on the right">';
      rows.forEach(function(x,k){
        var v=vs[k], h=Math.max(1,Math.round(v/max*H)), bx=k*step+6;
        // The value above the bar, or inside its top when the bar reaches the top of the chart.
        var ly=H-h-3, inBar=ly<10; if(inBar) ly=H-h+13;
        svg+='<rect class="bar'+(v>=thr-0.5?' hit':'')+'" x="'+bx+'" y="'+(H-h)+'" width="22" height="'+h+'"></rect>'+
          '<text class="bv'+(inBar?' in':'')+'" x="'+(bx+11)+'" y="'+ly+'" text-anchor="middle">'+v+'</text>'+
          '<text class="bl" x="'+(bx+11)+'" y="'+(H+13)+'" text-anchor="middle">'+esc(x[1])+'</text>';
      });
      var ty=H-Math.round(thr/max*H);
      svg+='<line class="thr" x1="0" x2="'+Wd+'" y1="'+ty+'" y2="'+ty+'"></line></svg>';
      var t='<table class="glog"><tr><td>game</td><td>rec yds (catches)</td><td>rush</td><td>pass</td><td>TD</td></tr>';
      rec.forEach(function(x){
        t+='<tr><td>'+esc(N.recentDate(x[0]))+' '+esc(x[1])+'</td><td>'+x[2]+' ('+x[3]+')</td><td>'+x[4]+'</td><td>'+x[5]+'</td><td>'+x[6]+'</td></tr>';
      });
      return head+svg+t+'</table><p>Newest on the right; the dashed line is the threshold; a bar in the accent cleared it.</p>';
    }
    if(drawerEl&&drawerEl.addEventListener) drawerEl.addEventListener('click',function(e){
      var b=e.target&&e.target.closest?e.target.closest('[data-rung]'):null;
      if(b&&state.drawer){ state.drawer.rung=+b.getAttribute('data-rung'); renderDrawer(); }
    });
    var dcloseEl=document.getElementById('dclose');
    if(dcloseEl&&dcloseEl.addEventListener) dcloseEl.addEventListener('click',function(){ closeDrawer(); });
    if(scrimEl&&scrimEl.addEventListener) scrimEl.addEventListener('click',function(){ closeDrawer(); });
    /* The URL names a player or a game: open on it, and follow the back button. */
    function syncFromUrl(){
      if(!loc) return;
      var q; try{ q=new URLSearchParams(loc.search||''); }catch(e){ return; }
      var id=q.get('player')||q.get('game'), prop=q.get('prop');
      if(!id){ closeDrawer(true); return; }
      /* Whatever is open closes quietly first: the URL is the word now. */
      if(state.drawer&&state.drawer.id!==String(id)) closeDrawer(true);
      if(prop&&prop!==state.view&&(prop==='td'||prop==='game'||Object.prototype.hasOwnProperty.call(N.STATS,prop))){ state.view=prop; render(); }
      openById(String(id),true);
    }
    if(typeof window!=='undefined'&&window.addEventListener) window.addEventListener('popstate',syncFromUrl);

    /* ---- the parlay slip ---- */
    var LEGS=[{id:3,label:'3 legs'},{id:4,label:'4 legs'},{id:5,label:'5 legs'}];
    var SCOPES=[{id:'slate',label:'All games'},{id:'game',label:'One game'}];
    var KINDS=[{id:'td',label:'Touchdowns'},{id:'props',label:'Yards & catches'},{id:'game',label:'Spread & total'}];
    var lift=N.DEFAULTS.parlayLift||{game:1,team:1};
    var eligible=N.DEFAULTS.parlayProps||['td'];
    var kindOf=function(prop){ return prop==='td'?'td':(prop==='spread'||prop==='total')?'game':'props'; };
    var LABEL={td:'Anytime TD',spread:'Spread',total:'Total'};
    /* Every open row the boards would offer, on every parlay-eligible prop,
       whatever the view, the search or the twenty-row cut shows. Counting
       props at the line setting in force. The record (track-football.mjs)
       builds its slips from the same rows the same way. */
    function buildCandidates(){
      var out=[];
      var on=function(prop){ return eligible.indexOf(prop)>=0 && state.kinds[kindOf(prop)]; };
      (D.players||[]).forEach(function(p){
        if(!available(p)) return;
        var g=openGame(p.team); if(!g) return;
        if(on('td')){
          var s=N.scoreAnytimeTD(p,{teamFactor:(D.teamFactors[p.team]||{}).off||1, oppFactor:p.opp?oppFactorFor(p.opp):1, usagePool:usagePool});
          if(s&&isFinite(s.prob)) out.push({key:g.id+'|'+p.id+'|td', playerId:String(p.id), gameId:g.id, team:p.team, opp:p.opp, name:p.name, prob:s.prob, prop:'td', propLabel:LABEL.td});
        }
        STAT_IDS.forEach(function(stat){
          if(!on(stat)) return;
          var y=N.statEligible(stat,p,null,{oppFactor:allowFor(p.opp,stat)}); if(!y) return;
          // The replay counted a counting-prop leg only with 300+ games in its pool; so does the slip.
          // ...and "in its pool" means the games the over is actually read off, the stat's share nearest his level.
          var pool=poolFor(stat); if(N.poolReads(pool,y.exp).length<300) return;
          var line=Math.round(y.exp*state.lineMult)+0.5, over=N.empiricalOver(y.exp,line,pool);
          if(over==null||!isFinite(over)) return;
          out.push({key:g.id+'|'+p.id+'|'+stat, playerId:String(p.id), gameId:g.id, team:p.team, opp:p.opp, name:p.name, prob:over, prop:stat, propLabel:N.STATS[stat].label+' o'+line, line:line});
        });
      });
      (D.games||[]).forEach(function(g){
        if(!g.line||g.completed||Date.parse(g.date)<=Date.now()) return;
        var pr=N.projectGame(D.ratings,g.home,g.away,{neutral:!!g.neutral}), pick=N.pickGame(pr,g.line); if(!pick) return;
        ['spread','total'].forEach(function(prop){
          var k=pick[prop]; if(!on(prop)||!k||!isFinite(k.prob)) return;
          out.push({key:g.id+'|game|'+prop, playerId:'game', gameId:g.id, team:prop==='spread'?(k.side==='home'?g.home:g.away):null, opp:null,
            name:g.away+' at '+g.home, prob:k.prob, prop:prop, propLabel:sideName(g,k,prop), line:k.line!=null?k.line:null, side:k.side});
        });
      });
      return out;
    }
    function suggest(n){
      state.candidates=buildCandidates();
      var out=P?P.suggestParlay(state.candidates,{legs:n,scope:state.slipScope,gameId:state.slipGame,lift:lift}):null;
      if(!out){
        var games={}; state.candidates.forEach(function(c){games[c.gameId]=1;});
        var have=Object.keys(games).length;
        state.slipError = state.slipScope==='game'
          ? (state.slipGame?'That game does not have '+n+' legs of the kinds switched on.':'Pick a game first.')
          : 'Only '+have+' game'+(have===1?'':'s')+' still open — a '+n+'-leg parlay from the slate needs '+n+', one leg per game.';
        state.slip=null;
      } else { state.slip=out; state.slipError=null; }
      state.slipLegs=n; render();
    }
    function slipHtml(){
      var h='';
      if(state.slipError) h+='<div class="slip" style="border-color:rgba(224,163,63,.45);background:rgba(224,163,63,.09)"><h3 style="color:var(--warn)">Cannot build that slip</h3><div>'+esc(state.slipError)+'</div></div>';
      var s=state.slip; if(!s) return h;
      var c=s.combined, g=state.slipScope==='game'&&gameOf[s.legs[0].team];
      h+='<div class="slip"><h3>Suggested parlay — '+s.legs.length+' legs · '+(g?esc(g.away+' at '+g.home):'from '+c.distinctGames+' different games')+'</h3>';
      var kinds=KINDS.filter(function(k){return state.kinds[k.id];}).map(function(k){return k.label.toLowerCase();}).join(', ')||'nothing';
      h+='<div class="how">The '+(g?'best legs in this game, one per player':'best leg from each of '+s.legs.length+' different games')+
        ', drawn from '+esc(kinds)+'. Ranked by chance to cash, <b>not</b> by price: it cannot see what you are being offered.</div>';
      s.legs.forEach(function(l){
        h+='<div class="leg"><div>'+esc(l.name)+' <span class="lp">'+(l.playerId==='game'?'':esc(l.team)+(l.opp?' vs '+esc(l.opp):'')+' · ')+esc(l.propLabel)+'</span></div><div><span class="lp">'+pct(l.prob,0)+'</span></div></div>';
      });
      var shown=c.adjusted!=null?c.adjusted:c.prob;
      h+='<div class="slipsum">';
      h+='<div><span class="big">'+pct(c.prob,c.prob<0.1?2:1)+'</span><span class="lbl">the legs multiplied</span></div>';
      if(c.adjusted!=null&&Math.abs(c.adjusted-c.prob)>1e-9) h+='<div><span class="big">'+pct(c.adjusted,c.adjusted<0.1?2:1)+'</span><span class="lbl">adjusted: same-team legs cash '+lift.team+'× the product on the replay</span></div>';
      h+='<div><span class="big">'+sgn(N.fairPrice(shown))+'</span><span class="lbl">fair price</span></div>';
      h+='<div><input id="slipprice" type="number" step="10" placeholder="offered" aria-label="Parlay price you are offered"'+(state.slipPrice!=null?' value="'+state.slipPrice+'"':'')+'><span class="lbl">price you are offered</span></div>';
      h+='<div id="slipedge">'+edgeHtml(shown)+'</div>';
      h+='</div>';
      var applied=function(k,what){ var m=lift[k]; return m&&m!==1 ? ' The adjusted number applies '+m+'.' : ''; };
      var note={ none:'Legs from different games multiply honestly: on the replay, cross-game slips cashed at or a little above the product.',
        game:'One game, no two legs on one team. On the replay these cashed about the product, the same as different games.'+applied('game'),
        mixed:'One game, some legs on the same team. On the replay these cashed about the product; a quarterback and his receiver rise together, two backs share the carries.'+applied('mixed'),
        team:'Every leg on one team. Touchdowns on one team are shared, so all-touchdown slips like this cashed well under the product on the replay; yards legs on one team rise together.'+applied('team'),
        player:'The same player on more than one prop. His legs rise and fall together: on the replay these cashed well above the product.'+applied('player'),
        severe:'The same player twice: the number is meaningless.' }[c.correlation];
      h+='<div class="slipwarn '+c.correlation+'">'+note+' Shade the top of the board: the legs it likes most run a little hot.</div>';
      h+='<div class="actions"><button type="button" data-clearslip>Clear slip</button></div></div>';
      return h;
    }
    function edgeHtml(p){
      if(state.slipPrice==null||!isFinite(state.slipPrice)||state.slipPrice===0||!E) return '';
      var ev=E.evPct(p,E.americanToDecimal(state.slipPrice));
      return '<span class="big '+edgeClass(ev)+'">'+E.formatPct(ev)+'</span><span class="lbl">edge at that price</span>';
    }
    function renderParlayControls(){
      var box=document.getElementById('parlayctl'); if(!box) return;
      var on=eligible.length>0;
      box.hidden=!on; if(!on) return;
      seg(document.getElementById('plegs'),LEGS,state.slipLegs,suggest);
      /* Kinds are toggles, not a choice: several may be on. Only kinds with an eligible prop are offered. */
      var kh=document.getElementById('pkinds'); kh.innerHTML='';
      KINDS.filter(function(k){ return eligible.some(function(p){return kindOf(p)===k.id;}); }).forEach(function(k){
        var b=el('button',null,k.label); b.type='button'; b.setAttribute('aria-pressed',String(!!state.kinds[k.id]));
        b.addEventListener('click',function(){ state.kinds[k.id]=!state.kinds[k.id]; if(state.slipLegs) suggest(state.slipLegs); else render(); });
        kh.appendChild(b);
      });
      seg(document.getElementById('pscope'),SCOPES,state.slipScope,function(v){ state.slipScope=v; if(v==='slate') state.slipGame=null; if(state.slipLegs) suggest(state.slipLegs); else render(); });
      var wrap=document.getElementById('pgamewrap'), sel=document.getElementById('pgame');
      wrap.hidden=state.slipScope!=='game';
      if(!wrap.hidden){
        var open=(D.games||[]).filter(function(g){return !g.completed&&Date.parse(g.date)>Date.now();});
        if(!state.slipGame&&open.length) state.slipGame=open[0].id;
        sel.innerHTML='';
        open.forEach(function(g){ var o=el('option',null,g.away+' at '+g.home); o.value=g.id; o.selected=g.id===state.slipGame; sel.appendChild(o); });
        sel.onchange=function(){ state.slipGame=sel.value; if(state.slipLegs) suggest(state.slipLegs); };
      }
    }

    var SORTS=[{id:'proj',label:'Projection'},{id:'edge',label:'Edge'},{id:'boost',label:'Boost'}];
    /* The positions the board files under, in depth-chart order. A safety
       with a trick-play record is on the board under All and is not a
       button: roster noise is not navigation. */
    var POS_ORDER=['QB','RB','WR','TE','FB'];
    /* Both lists come from the players, once: a team on a bye has no game
       this week and is still on the board, so it is still a choice. */
    var TEAMS=[], POSS=[];
    (D.players||[]).forEach(function(p){
      if(p.team&&TEAMS.indexOf(p.team)<0) TEAMS.push(p.team);
      if(p.pos&&POS_ORDER.indexOf(p.pos)>=0&&POSS.indexOf(p.pos)<0) POSS.push(p.pos);
    });
    TEAMS.sort(); POSS.sort(function(a,b){ return POS_ORDER.indexOf(a)-POS_ORDER.indexOf(b); });
    var teamSel=document.getElementById('teamsel');
    if(teamSel){
      var allTeams=el('option',null,'All teams'); allTeams.value=''; teamSel.appendChild(allTeams);
      TEAMS.forEach(function(t){ var o=el('option',null,t); o.value=t; teamSel.appendChild(o); });
      teamSel.onchange=function(){ state.team=teamSel.value||''; render(); };
    }
    function renderFilters(){
      if(teamSel) teamSel.value=state.team;
      var wrap=document.getElementById('poswrap'); if(wrap) wrap.hidden=!POSS.length;
      if(POSS.length) seg(document.getElementById('posseg'),[{id:'',label:'All'}].concat(POSS.map(function(x){return {id:x,label:x};})),state.pos,function(v){state.pos=v;render();});
    }

    function render(){
      seg(document.getElementById('view'),VIEWS,state.view,function(v){state.view=v;closeDrawer();state.showAll=false;render();});
      seg(document.getElementById('lineseg'),LINES,state.lineMult,function(v){state.lineMult=v;render();});
      seg(document.getElementById('sortseg'),SORTS,state.sort,function(v){state.sort=v;render();});
      renderFilters();
      document.getElementById('controls').hidden = state.view==='game';
      document.getElementById('linewrap').hidden = !N.STATS[state.view];
      document.getElementById('find').hidden = state.view==='game';
      renderParlayControls();
      document.getElementById('tagline').textContent=cfg.league+' — '+D.season+' week '+D.week;

      /* One plain sentence up front; the replay numbers that back it sit
         behind a disclosure. Users scan, and the first row matters more
         than the bias figure to anyone who has not asked for it. */
      var noteHtml=function(s){
        var i=s.indexOf('Checked against');
        if(i<0) return s;
        return s.slice(0,i)+'<details class="how"><summary>How it was checked</summary><p>'+s.slice(i)+'</p></details>';
      };
      var note=document.getElementById('note');
      if(state.view==='td') note.innerHTML=noteHtml(C.noteTD);
      else if(N.STATS[state.view]) note.innerHTML=noteHtml(C.noteStat[state.view]);
      else note.innerHTML=C.noteGames;

      if(state.view==='td') renderTD();
      else if(N.STATS[state.view]) renderStat(state.view);
      else renderGames();
      renderDrawer();
    }

    var q=document.getElementById('q');
    if(q){
      q.addEventListener('input',function(){ state.q=q.value.trim(); render(); });
      // "/" jumps to the box from anywhere on the page, like a search engine.
      document.addEventListener('keydown',function(e){
        if(state.drawer) return; // the search box is behind the dialog
        if(e.key==='/'&&document.activeElement!==q&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){ e.preventDefault(); q.focus(); }
      });
    }
    document.addEventListener('keydown',function(e){
      if(!state.drawer||!drawerEl) return;
      if(e.key==='Escape'){ e.preventDefault(); closeDrawer(); return; }
      /* Tab stays inside the drawer while it is open. */
      if(e.key==='Tab'&&drawerEl.querySelectorAll){
        var f=drawerEl.querySelectorAll('button,input,select,a[href]'); if(!f.length) return;
        var first=f[0], last=f[f.length-1];
        if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
      }
    });
    var onPriceInput=function(e){
      var t=e.target, pk=t&&t.getAttribute?t.getAttribute('data-pk'):null;
      if(pk){
        /* Type a price, keep it, and let the row above follow at once --
           no re-render, so the box keeps the cursor. */
        var price=W?W.validPrice(t.value):null;
        if(price==null) delete state.prices[pk]; else state.prices[pk]=price;
        savePrices();
        var i=+t.getAttribute('data-i'), r=app.__rows&&app.__rows[i]; if(!r) return;
        r.pe=priceEdge(r.chance,pk);
        var cell=document.getElementById('px'+i); if(cell) cell.innerHTML=pxInner(r.pe);
        var ed=document.getElementById('pxe'+i); if(ed) ed.innerHTML=pxEdgeInner(r.pe);
        return;
      }
      if(t.id!=='slipprice') return;
      var v=parseFloat(t.value); state.slipPrice=isFinite(v)?v:null;
      var s=state.slip, box=document.getElementById('slipedge');
      if(s&&box) box.innerHTML=edgeHtml(s.combined.adjusted!=null?s.combined.adjusted:s.combined.prob);
    };
    app.addEventListener('input',onPriceInput);
    if(drawerEl) drawerEl.addEventListener('input',onPriceInput);
    /* A price committed (blur, Enter) re-orders the rows when the order
       is by edge; a keystroke never does, so the box keeps the cursor. */
    var onPriceCommit=function(e){
      var t=e.target, pk=t&&t.getAttribute?t.getAttribute('data-pk'):null;
      if(pk&&state.sort==='edge'){ render(); }
    };
    app.addEventListener('change',onPriceCommit);
    if(drawerEl) drawerEl.addEventListener('change',onPriceCommit);
    app.addEventListener('click',function(e){
      if(e.target.closest('[data-clearslip]')){ state.slip=null; state.slipError=null; state.slipLegs=null; render(); return; }
      if(e.target.closest('[data-more]')){ state.showAll=true; render(); return; }
      var btn=e.target.closest('.row'); if(!btn) return;
      openDrawer(+btn.getAttribute('data-i'),btn);
    });

    /* The forward record: what this board actually predicted, graded after the
       fact. The table above it is a backtest, and a backtest grades a model
       against history the model was then fitted to. The baseball board looked
       calibrated by that standard right up until its forward record showed it
       was over-confident, so this one gets measured from week 1. */
    function liveRecord(){
      var R = cfg.record;
      if(!R) return '';
      if(!R.total){
        return '<p><b>Live record:</b> nothing graded yet. Predictions are recorded '+
          'before kickoff each week and graded once the games are final — the first '+
          'numbers arrive after week 1.</p>';
      }
      var rows='';
      Object.keys(R.props||{}).forEach(function(k){
        var p=R.props[k];
        rows+='<tr><td>'+esc(p.label)+'</td><td>n <b>'+p.n+'</b> · predicted <b>'+
          p.predicted+'%</b>, actual <b>'+p.actual+'%</b> · off by <b>'+
          (p.bias>=0?'+':'')+p.bias+'pp</b> · Brier <b>'+p.brier+'</b></td></tr>';
      });
      var picks='';
      if(R.picks){
        var lab={spread:'spread',total:'total',ml:'moneyline'};
        Object.keys(R.picks).forEach(function(k){
          var g=R.picks[k];
          picks+='<tr><td>'+lab[k]+' picks</td><td>n <b>'+g.n+'</b> · won <b>'+g.rate+'%</b> ('+g.lo+'–'+g.hi+'%), needs 52.4%'+
            (g.clvPts!=null?' · closing line moved toward the pick <b>'+g.movedToward+'%</b> of the time, <b>'+
              (g.clvPts>=0?'+':'')+g.clvPts+'</b> pts on average':'')+'</td></tr>';
        });
        picks='<p>The sides the board picked, settled the way a book would:</p><table>'+picks+'</table>';
      }
      return '<p><b>Live record</b> — '+R.total+' graded prediction'+(R.total===1?'':'s')+
        ' over '+R.days.length+' week'+(R.days.length===1?'':'s')+', measured against what this '+
        'board actually published:</p><table>'+rows+'</table>'+picks+
        (R.total<400?'<p>Far too few to mean anything yet. Bias needs n in the thousands.</p>':'');
    }

    /* The suggested slips, settled like a book would: the number a parlay

       product sells, measured rather than multiplied. */

    var parlayRecord=function(R){

      if(!R||!R.parlays) return '';

      var rows=Object.keys(R.parlays).map(function(k){ var t=R.parlays[k];

        return '<tr><td>'+(t.scope==='game'?'one game':'slate')+', '+t.legs+' legs'+(t.tag==='td'?' (touchdowns)':'')+'</td><td>'+t.n+' slip'+(t.n===1?'':'s')+' · said <b>'+pct(t.adjusted,1)+'</b> · cashed <b>'+pct(t.cashed/t.n,1)+'</b></td></tr>'; });

      return '<p><b>Suggested parlays</b>, recorded before kickoff and settled like a book would:</p><table>'+rows.join('')+'</table>';

    };

    document.getElementById('foot').innerHTML =
      C.footer + parlayRecord(cfg.record) +
      liveRecord()+
      '<p>Data: ESPN, no key required. Built '+esc((D.generated||'').slice(0,16).replace('T',' '))+
      ' UTC from '+D.gamesCached+' games.</p>';

    render();
    syncFromUrl();
  }

  window.BetHouseFootballBoard = { mount: mount };
})();
