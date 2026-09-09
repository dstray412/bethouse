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
    var N = cfg.model, D = cfg.data, C = cfg.copy || {}, P = window.BetHouseParlay, E = window.BetHouseEdge;
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
    var NEEDS = ['STATS','statEligible','statOppFactor','allowOf','scoreAnytimeTD','empiricalOver','fairPrice','availability','playerMatches'];
    var missing = NEEDS.filter(function(k){ return typeof N[k] !== 'function' && k !== 'STATS' || (k === 'STATS' && !N.STATS); });
    if (missing.length) {
      app.innerHTML = '<div class="empty"><div class="big">Reload this page</div>' +
        '<div>Your browser has a newer page than model script. A hard refresh (Cmd/Ctrl+Shift+R) fixes it.</div></div>';
      return;
    }

    /* One view per counting prop, from the model's own stat table, so a
       stat the model gains is a view the page gains. */
    var STAT_IDS = Object.keys(N.STATS);
    var VIEWS = [{id:'td',label:'Anytime TD'}].concat(STAT_IDS.map(function(k){return {id:k,label:N.STATS[k].label};}))
      .concat([{id:'game',label:'Spread & total'}]);
    var LINES = [{id:0.7,label:'Low'},{id:1,label:'Projection'},{id:1.3,label:'High'}];
    var state = { view:'td', lineMult:1, open:null, showAll:false, q:'',
      /* The parlay slip: what the suggester built, or why it could not. */
      candidates:[], slip:null, slipError:null, slipLegs:null, slipScope:'slate', slipGame:null, slipPrice:null,
      /* Which kinds of leg the suggester may draw on: touchdowns, the counting props, the game lines. */
      kinds:{ td:true, props:true, game:true } };
    /* Which game each team plays this week, and whether it is still open. */
    var gameOf={}; (D.games||[]).forEach(function(g){ gameOf[g.home]=g; gameOf[g.away]=g; });
    var openGame=function(team){ var g=gameOf[team]; return g&&!g.completed&&Date.parse(g.date)>Date.now()?g:null; };
    /* Twenty rows is a board; eighty is a spreadsheet. The rest are one tap away. */
    var SHOW=20, MAX=80;
    var trim=function(rows){ var n=(state.showAll||state.q)?MAX:SHOW; return { rows:rows.slice(0,n), hidden:Math.min(rows.length,MAX)-Math.min(rows.length,n) }; };
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
    var poolFor=function(stat){ var p=D.pools&&D.pools[stat]; return p&&p.length?p:null; };

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
        if(!available(p)||!find(p)) return;
        var tf=(D.teamFactors[p.team]||{}).off||1;
        // The opponent's defence, the same term the backtest used.
        var of=p.opp?oppFactorFor(p.opp):1;
        var s=N.scoreAnytimeTD(p,{teamFactor:tf, oppFactor:of, usagePool:usagePool});
        if(!s) return;
        rows.push({p:p,s:s});
      });
      rows.sort(function(a,b){return b.s.prob-a.s.prob;});
      var t=trim(rows); rows=t.rows;

      var html=slipHtml()+'<div class="game"><div class="ghead"><h2 class="gtitle">Most likely to score</h2>'+
        '<div class="gmeta">'+rows.length+' players · '+seasons+' form</div></div>';
      rows.forEach(function(r,i){
        html+='<button class="row" aria-expanded="false" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.p.name)+'<span class="pos">'+esc(r.p.team)+
            (r.p.opp?' vs '+esc(r.p.opp):'')+'</span>'+qTag(r.p)+'</span>'+
          '<span class="prob">'+pct(r.s.prob,0)+'</span>'+
          '<span class="be">'+sgn(N.fairPrice(r.s.prob))+'<small>fair</small></span>'+
          '<span class="caret">›</span></button>'+
          '<div class="why" id="why'+i+'" hidden></div>';
      });
      app.innerHTML=html+(rows.length?'':nothing())+moreBtn(t.hidden)+'</div>';
      app.__rows=rows;
      app.__detail=function(r){
        var t='<table>';
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
        if(!available(p)||!find(p)) return;
        // The one gate, shared with the tracker: see nfl.js statEligible.
        var y=N.statEligible(stat,p,null,{oppFactor:allowFor(p.opp,stat)});
        if(!y) return;
        var line=Math.round(y.exp*state.lineMult)+0.5;
        var over=N.empiricalOver(y.exp,line,pool);
        if(over==null) return;
        rows.push({p:p,exp:y.exp,base:y.base,oppFactor:y.oppFactor,line:line,over:over});
      });
      rows.sort(function(a,b){return b.exp-a.exp;});
      var t=trim(rows); rows=t.rows;
      var strength=N.DEFAULTS[ST.oppShrinkKey], word=ST.label.toLowerCase();
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
        '</div></div>';
      rows.forEach(function(r,i){
        html+='<button class="row" aria-expanded="false" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.p.name)+'<span class="pos">'+esc(r.p.team)+(r.p.opp?' vs '+esc(r.p.opp):'')+' · o'+r.line+'</span>'+badge(r.p)+qTag(r.p)+'</span>'+
          '<span class="prob">'+Math.round(r.exp)+'<small>'+(stat==='recs'?'catches':'yards')+'</small></span>'+
          '<span class="be'+(atProj?' dim':'')+'">'+pct(r.over,0)+'<small>'+sgn(N.fairPrice(r.over))+' fair</small></span>'+
          '<span class="caret">›</span></button>'+
          '<div class="why" id="why'+i+'" hidden></div>';
      });
      app.innerHTML=html+(rows.length?'':nothing())+moreBtn(t.hidden)+'</div>';
      app.__rows=rows;
      /* The panel: the decision first, in two lines, then the arithmetic
         in words a bettor already uses. The constants behind each step
         are in nfl.js and the README; they do not belong here. */
      app.__detail=function(r){
        var fair=sgn(N.fairPrice(r.over)), games=r.p.games, avg=r.p[ST.total]/games;
        var oppWordFor = ST.opportunity==='receiving' ? oppWord : ST.opportunity==='carries' ? 'carries' : 'attempts';
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
          w+='The opponent is not in this number: on the replay it made no difference for '+word+'. ';
        }
        w+='Projects to <b>'+r.exp.toFixed(0)+'</b>. The chance of the over is read off '+pool.length.toLocaleString('en-US')+' real games by '+
          (stat==='passyds'?'quarterbacks':stat==='rushyds'?'backs':'receivers')+' against their own projections.</p>';
        var s=statusRow(r.p);
        if(s) s='<p>'+s.replace(/<\/?t[rd]>/g,'').replace(/^status/,'')+'</p>';
        return h+w+s;
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
        html+='<button class="row" aria-expanded="false" data-i="'+i+'">'+
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
          '<span class="caret">›</span></button>'+
          '<div class="why" id="why'+i+'" hidden></div>';
      });
      app.innerHTML=html+'</div>';
      app.__rows=rows;
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
        return t+'</table>';
      };
    }

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
          var pool=poolFor(stat); if(!pool||pool.length<300) return;
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
      state.slipLegs=n; state.open=null; render();
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
      var col=ev>0.02?'var(--good)':ev>=0?'var(--warn)':'var(--bad)';
      return '<span class="big" style="color:'+col+'">'+E.formatPct(ev)+'</span><span class="lbl">edge at that price</span>';
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

    function render(){
      seg(document.getElementById('view'),VIEWS,state.view,function(v){state.view=v;state.open=null;state.showAll=false;render();});
      seg(document.getElementById('lineseg'),LINES,state.lineMult,function(v){state.lineMult=v;state.open=null;render();});
      document.getElementById('controls').hidden = !N.STATS[state.view];
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
    }

    var q=document.getElementById('q');
    if(q){
      q.addEventListener('input',function(){ state.q=q.value.trim(); state.open=null; render(); });
      // "/" jumps to the box from anywhere on the page, like a search engine.
      document.addEventListener('keydown',function(e){
        if(e.key==='/'&&document.activeElement!==q&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){ e.preventDefault(); q.focus(); }
      });
    }
    app.addEventListener('input',function(e){
      if(e.target.id!=='slipprice') return;
      var v=parseFloat(e.target.value); state.slipPrice=isFinite(v)?v:null;
      var s=state.slip, box=document.getElementById('slipedge');
      if(s&&box) box.innerHTML=edgeHtml(s.combined.adjusted!=null?s.combined.adjusted:s.combined.prob);
    });
    app.addEventListener('click',function(e){
      if(e.target.closest('[data-clearslip]')){ state.slip=null; state.slipError=null; state.slipLegs=null; render(); return; }
      if(e.target.closest('[data-more]')){ state.showAll=true; render(); return; }
      var btn=e.target.closest('.row'); if(!btn) return;
      var i=+btn.getAttribute('data-i');
      var box=document.getElementById('why'+i);
      var open=btn.getAttribute('aria-expanded')==='true';
      btn.setAttribute('aria-expanded',open?'false':'true');
      if(open){box.hidden=true;return;}
      if(!box.innerHTML) box.innerHTML=app.__detail(app.__rows[i]);
      box.hidden=false;
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
  }

  window.BetHouseFootballBoard = { mount: mount };
})();
