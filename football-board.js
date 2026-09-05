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
    var N = cfg.model, D = cfg.data, C = cfg.copy || {};
    var app = document.getElementById("app");
    if (!D || !D.players) {
      app.innerHTML = '<div class="empty"><div class="big">No board yet</div>' +
        '<div>Run <code>node ' + cfg.fetcher + '</code> to build the board.</div></div>';
      return;
    }

    var VIEWS = [{id:'td',label:'Anytime TD'},{id:'yds',label:'Receiving yards'},{id:'game',label:'Spread & total'}];
    var LINES = [{id:0.7,label:'Low'},{id:1,label:'Projection'},{id:1.3,label:'High'}];
    var state = { view:'td', lineMult:1, open:null };

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
    var yardPool  = D.yardPool  && D.yardPool.length  ? D.yardPool  : null;

    /* Team codes come from the schedule now. They used to be recovered by
       searching each abbreviation inside the full team name, which dropped
       six of sixteen games ("San Francisco 49ers" contains no "SF") and
       misattributed two more ("Arizona Cardinals" contains "CAR"). */
    var oppFactorFor=function(team){
      var f=D.teamFactors[team];
      return f&&isFinite(f.def)?f.def:1;
    };

    function renderTD(){
      var rows=[];
      (D.players||[]).forEach(function(p){
        var tf=(D.teamFactors[p.team]||{}).off||1;
        // The opponent's defence, the same term the backtest used.
        var of=p.opp?oppFactorFor(p.opp):1;
        var s=N.scoreAnytimeTD(p,{teamFactor:tf, oppFactor:of, usagePool:usagePool});
        if(!s) return;
        rows.push({p:p,s:s});
      });
      rows.sort(function(a,b){return b.s.prob-a.s.prob;});
      rows=rows.slice(0,80);

      var html='<div class="game"><div class="ghead"><h2 class="gtitle">Most likely to score</h2>'+
        '<div class="gmeta">'+rows.length+' players · '+seasons+' form</div></div>';
      rows.forEach(function(r,i){
        html+='<button class="row" aria-expanded="false" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.p.name)+'<span class="pos">'+esc(r.p.team)+
            (r.p.opp?' vs '+esc(r.p.opp):'')+'</span></span>'+
          '<span class="prob">'+pct(r.s.prob,0)+'</span>'+
          '<span class="be">'+sgn(N.fairPrice(r.s.prob))+'<small>fair</small></span>'+
          '<span class="caret">›</span></button>'+
          '<div class="why" id="why'+i+'" hidden></div>';
      });
      app.innerHTML=html+'</div>';
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
        return t+'</table>';
      };
    }

    function renderYards(){
      var rows=[];
      (D.players||[]).forEach(function(p){
        // The one gate, shared with the tracker: see nfl.js yardsEligible.
        var y=N.yardsEligible(p);
        if(!y) return;
        var line=Math.round(y.exp*state.lineMult)+0.5;
        var over=N.empiricalOver(y.exp,line,yardPool);
        if(over==null) return;
        rows.push({p:p,exp:y.exp,line:line,over:over});
      });
      rows.sort(function(a,b){return b.exp-a.exp;});
      rows=rows.slice(0,80);
      var html='<div class="game"><div class="ghead"><h2 class="gtitle">Receiving yards</h2>'+
        '<div class="gmeta">'+rows.length+' players · over the line shown</div></div>';
      rows.forEach(function(r,i){
        html+='<button class="row" aria-expanded="false" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.p.name)+'<span class="pos">'+esc(r.p.team)+' · o'+r.line+'</span></span>'+
          '<span class="prob">'+pct(r.over,0)+'</span>'+
          '<span class="be">'+sgn(N.fairPrice(r.over))+'<small>fair</small></span>'+
          '<span class="caret">›</span></button>'+
          '<div class="why" id="why'+i+'" hidden></div>';
      });
      app.innerHTML=html+'</div>';
      app.__rows=rows;
      app.__detail=function(r){
        var t='<table>';
        t+='<tr><td>season</td><td><b>'+r.p.recYds+'</b> yards on <b>'+N.receivingOpportunity(r.p)+
          '</b> '+oppWord+' over <b>'+r.p.games+'</b> games</td></tr>';
        t+='<tr><td>projection</td><td><b>'+r.exp.toFixed(1)+'</b> yards, regressed toward a replacement-level '+N.DEFAULTS.yardPrior+'</td></tr>';
        t+='<tr><td>line</td><td><b>'+r.line+'</b></td></tr>';
        t+='<tr><td>over</td><td><b>'+pct(r.over)+'</b>, read off <b>'+yardPool.length+
          '</b> real receiver games rather than any bell curve</td></tr>';
        t+='<tr><td>fair price</td><td><b>'+sgn(N.fairPrice(r.over))+'</b></td></tr>';
        return t+'</table>';
      };
    }

    function renderGames(){
      var html='<div class="banner"><h3>Read this before betting a side</h3>'+C.gameBanner+'</div>';
      html+='<div class="game"><div class="ghead"><h2 class="gtitle">Week '+D.week+'</h2>'+
        '<div class="gmeta">'+(D.games||[]).length+' games · model projection only, no line attached</div></div>';
      var rows=[];
      (D.games||[]).forEach(function(g){
        if(!g.home||!g.away) return;
        var pr=N.projectGame(D.ratings,g.home,g.away,{neutral:!!g.neutral});
        if(!pr) return;
        rows.push({g:g,h:g.home,a:g.away,pr:pr});
      });
      rows.forEach(function(r,i){
        var m=r.pr.margin;
        html+='<button class="row" aria-expanded="false" data-i="'+i+'">'+
          '<span class="slot">'+(i+1)+'</span>'+
          '<span class="who">'+esc(r.a)+(r.g.neutral?' vs ':' at ')+esc(r.h)+
            '<span class="pos">'+esc(String(r.g.name||''))+(r.g.neutral?' · neutral site':'')+'</span></span>'+
          /* "SEA -7.2" in a 74px column wrapped for every team but the
             two-letter ones, so row heights alternated on abbreviation length
             and nothing else. Number on top, team as the block sublabel under
             it -- the same shape .be already uses for "43.3 / total". */
          '<span class="prob">-'+Math.abs(m).toFixed(1)+
            '<small>'+esc(m>=0?r.h:r.a)+'</small></span>'+
          '<span class="be">'+r.pr.total.toFixed(1)+'<small>total</small></span>'+
          '<span class="caret">›</span></button>'+
          '<div class="why" id="why'+i+'" hidden></div>';
      });
      app.innerHTML=html+'</div>';
      app.__rows=rows;
      app.__detail=function(r){
        var t='<table>';
        t+='<tr><td>projection</td><td><b>'+esc(r.h)+' '+r.pr.homePts.toFixed(1)+
          '</b> — <b>'+esc(r.a)+' '+r.pr.awayPts.toFixed(1)+'</b></td></tr>';
        t+='<tr><td>margin</td><td><b>'+(r.pr.margin>=0?'+':'')+r.pr.margin.toFixed(1)+'</b> to the home side'+
          (r.g.neutral?' (neutral site: no home field applied)':' (home field is worth '+D.ratings.homeField.toFixed(2)+')')+'</td></tr>';
        t+='<tr><td>total</td><td><b>'+r.pr.total.toFixed(1)+'</b></td></tr>';
        t+='<tr><td>ratings</td><td>'+esc(r.h)+' offence <b>'+(D.ratings.off[r.h]||0).toFixed(2)+
          '</b>, defence <b>'+(D.ratings.def[r.h]||0).toFixed(2)+'</b><br>'+
          esc(r.a)+' offence <b>'+(D.ratings.off[r.a]||0).toFixed(2)+
          '</b>, defence <b>'+(D.ratings.def[r.a]||0).toFixed(2)+'</b></td></tr>';
        t+='<tr><td>honestly</td><td>'+C.gameHonestly+'</td></tr>';
        return t+'</table>';
      };
    }

    function render(){
      seg(document.getElementById('view'),VIEWS,state.view,function(v){state.view=v;state.open=null;render();});
      seg(document.getElementById('lineseg'),LINES,state.lineMult,function(v){state.lineMult=v;state.open=null;render();});
      document.getElementById('controls').hidden = state.view!=='yds';
      document.getElementById('tagline').textContent=cfg.league+' — '+D.season+' week '+D.week;

      var note=document.getElementById('note');
      if(state.view==='td') note.innerHTML=C.noteTD;
      else if(state.view==='yds') note.innerHTML=C.noteYards;
      else note.innerHTML=C.noteGames;

      if(state.view==='td') renderTD();
      else if(state.view==='yds') renderYards();
      else renderGames();
    }

    app.addEventListener('click',function(e){
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
      return '<p><b>Live record</b> — '+R.total+' graded prediction'+(R.total===1?'':'s')+
        ' over '+R.days.length+' week'+(R.days.length===1?'':'s')+', measured against what this '+
        'board actually published:</p><table>'+rows+'</table>'+
        (R.total<400?'<p>Far too few to mean anything yet. Bias needs n in the thousands.</p>':'');
    }

    document.getElementById('foot').innerHTML =
      C.footer +
      liveRecord()+
      '<p>Data: ESPN, no key required. Built '+esc((D.generated||'').slice(0,16).replace('T',' '))+
      ' UTC from '+D.gamesCached+' games.</p>';

    render();
  }

  window.BetHouseFootballBoard = { mount: mount };
})();
