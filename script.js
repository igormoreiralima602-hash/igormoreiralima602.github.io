// =============== 1. DADOS DAS REGRAS (edite aqui se o sistema mudar) ===============
const KEY = 'ficha-aw-v2';
const SAN_MIN = -45, SAN_MAX = 45;   // limites da sanidade (definidos pelo livro)
const ATTRS = [['corpo','Corpo'],['agi','Agilidade'],['int','Inteligência'],['per','Percepção'],['vit','Vitalidade'],['car','Carisma']];
const PECADOS = ['Ira','Gula','Ganância','Luxúria','Inveja','Preguiça','Orgulho','Outro'];

// Status effects. s: +1 positivo / -1 negativo; p: tem Potency?; end: o que acontece no fim do turno;
// act: ação manual ('dmg' = causa dano em quem tem o efeito, 'use' = só gasta 1 Count); h: texto calculado.
const FX = {
  rupture:{n:'Rupture',s:-1,p:1,act:'dmg',d:'Ao ser acertado: dano igual à Potency e −1 Count.',h:(c,p)=>`Próximo acerto: ${p} de dano`},
  tremor:{n:'Tremor',s:-1,p:1,end:'dec',d:'Fim do turno: −1 Count. Burst: reduz a Stamina do alvo em Potency (−2 Count). Reverb: dano blunt de metade da Potency (zera o Count).',h:(c,p)=>`Burst: −${p} stamina · Reverb: ${Math.floor(p/2)} blunt`},
  burn:{n:'Burn',s:-1,p:1,end:'burn',d:'Fim do turno: sofre dano igual à Potency e −1 Count.',h:(c,p)=>`Fim do turno: ${p} de dano`},
  bleed:{n:'Bleed',s:-1,p:1,act:'dmg',d:'Ao executar uma ação: recebe dano igual à Potency e −1 Count.',h:(c,p)=>`Ao agir: ${p} de dano`},
  defup:{n:'Defense Level Up',s:1,end:'dec',d:'Reduz o dano recebido em Nível × Count (nível 0 conta como 1). Sem Potency.',h:(c,p,L)=>`−${L*c} de dano recebido`},
  dmgup:{n:'Damage Level Up',s:1,end:'dec',d:'Aumenta o dano causado em Nível × Count. Sem Potency.',h:(c,p,L)=>`+${L*c} de dano causado`},
  dmgdown:{n:'Damage Level Down',s:-1,end:'dec',d:'Reduz o dano causado em Nível × Count. Sem Potency.',h:(c,p,L)=>`−${L*c} de dano causado`},
  fragile:{n:'Fragile',s:-1,end:'dec',d:'Aumenta o dano recebido em Nível × Count.',h:(c,p,L)=>`+${L*c} de dano recebido`},
  poise:{n:'Poise',s:1,act:'use',d:'Causa 50% de dano a mais e gasta 1 Count a cada uso.',h:()=>'Próximo golpe: +50% de dano'},
  haste:{n:'Haste',s:1,end:'dec',d:'+1 de velocidade por Count. Fim do turno: −1 Count.',h:c=>`+${c} velocidade`},
  bind:{n:'Bind',s:-1,end:'dec',d:'−1 de velocidade por Count. Fim do turno: −1 Count.',h:c=>`−${c} velocidade`},
  paralyze:{n:'Paralyze',s:-1,end:'clear',d:'Reduz a quantidade de dados rolados pelo Count. Fim do turno: zera o Count.',h:c=>`−${c} dado(s)`},
  sinking:{n:'Sinking',s:-1,p:1,act:'sa',d:'Ao ser acertado: dano em sanidade igual à Potency e −1 Count.',h:(c,p)=>`−${p} sanidade`},
  outro:{n:'Outro (escrever)',s:0,p:1,custom:1,d:'',h:()=>''}
};

// =============== 2. ESTADO ===============
function padrao(){return{f:{},img:'',lvl:0,xp:0,livres:0,
  hpBase:10,hp:10,st:20,stMax:20,sa:0,movB:0,turno:1,
  attrs:{corpo:0,agi:0,int:0,per:0,vit:0,car:0},
  shin:{pecado:'',lvl:0,xp:0,on:false,passiva:'',frase:''},
  fx:[],inv:[],armas:[],habs:[],equipego:[],
  ego:{estado:'nao',nome:'',desc:'',falhas:0,hab:[{},{},{}]}}}
let S = carregar(), LOG = '', LOGEGO = '';
function carregar(){
  const d = padrao();
  try{ const r = JSON.parse(localStorage.getItem(KEY)||'null');
    if(r) return {...d,...r,attrs:{...d.attrs,...r.attrs},shin:{...d.shin,...r.shin},ego:{...d.ego,...r.ego}}; }catch(e){}
  return d;
}
function salvar(){ try{ localStorage.setItem(KEY,JSON.stringify(S)); }catch(e){} }

// =============== 3. CÁLCULOS AUTOMÁTICOS ===============
function calc(){
  const sh = S.shin.on, X = S.lvl, eff = {};
  let top = ATTRS[0][0];                       // atributo mais alto (o 1º em caso de empate)
  ATTRS.forEach(([k])=>{ if(S.attrs[k] > S.attrs[top]) top = k; });
  ATTRS.forEach(([k])=>{ eff[k] = S.attrs[k] + (sh ? (k===top ? 5+X : X) : 0); });
  const bonus = k => eff[k] - S.attrs[k];
  return { eff, bonus, hpMax: S.hpBase + Math.floor(eff.vit/2), mov: Math.floor(eff.agi/2) + S.movB,
    aneis: Math.floor(S.shin.lvl/6), L: Math.max(S.lvl,1) };
}
const need = lvl => 15 + 3*lvl;                // XP para o próximo nível
function estadoSan(v){
  if(v<=-41) return '⚠ Distorção (mestre assume)';
  if(v<=-26) return '⚠ Pânico (−1d20 em tudo)';
  if(v<=-10) return 'Instável (desv. no mental)';
  return 'Estável';
}
const d = n => 1+Math.floor(Math.random()*n);

// =============== 4. DESENHO ===============
const get = p => p.split('.').reduce((o,k)=>o?.[k],S);
const set = (p,v) => { const ks=p.split('.'), l=ks.pop(); ks.reduce((o,k)=>o[k],S)[l]=v; };
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const inp = (p,t='text',ph='') => `<input data-b="${p}" type="${t}" placeholder="${ph}" value="${esc(get(p))}">`;
const btn = (a,x,t,c='g',dis='') => `<button class="${c}" data-a="${a}" data-x="${x??''}" ${dis}>${t}</button>`;
const slider = (p, min, max) => {
  const v = get(p);
  const preenchido = max > min ? Math.max(0, Math.min(100, (v-min)/(max-min)*100)) : 0;
  return `<input type="range" class="slider" data-b="${p}" min="${min}" max="${max}" value="${v}" style="--p:${preenchido}%">`;
};
const $ = s => document.querySelector(s);

function render(){
  const C = calc(), ativo = S.shin.on;

  const topo = `<section class="card top">
    <div class="pic" id="pic" style="background-image:${S.img?`url(${S.img})`:'none'}">${S.img?'':'Clique para<br>enviar imagem'}</div>
    <input type="file" id="file" accept="image/*" hidden>
    <div class="grid">
      ${[['nome','Nome'],['idade','Idade'],['afiliacao','Afiliação'],['financeiro','Estado financeiro'],['ego','EGO']].map(([k,l])=>`<div><label>${l}</label>${inp('f.'+k)}</div>`).join('')}
      <div><label>Nível</label>${inp('lvl','number')}</div>
      <div><label>XP (próximo nível: ${need(S.lvl)})</label>${inp('xp','number')}</div>
      <div><label>Pontos livres de atributo</label>${inp('livres','number')}</div>
      <div style="align-self:end">${btn('lvlup','','⬆ Subir de nível','au',S.xp>=need(S.lvl)?'':'disabled')}</div>
    </div></section>`;

  const vitais = `<section class="card"><h2>Vitais</h2>
    <div class="vit"><b>♥ Vida</b>${btn('adj','hp,-1','−')}${inp('hp','number')} / <b style="min-width:0">${C.hpMax}</b>${btn('adj','hp,1','+')}
      <span class="mu">base</span><input type="number" data-b="hpBase" value="${S.hpBase}"></div>
    ${slider('hp', -10, C.hpMax)}
    <div class="mu" style="margin:-8px 0 10px">${S.hp<-10?'☠ Abaixo de −10: morte permanente':S.hp<=0?'⚠ Estado crítico (precisa de cura)':''}</div>
    <div class="vit"><b>♣ Stamina</b>${btn('adj','st,-1','−')}${inp('st','number')} / ${inp('stMax','number')}${btn('adj','st,1','+')}</div>
    ${slider('st', 0, S.stMax)}
    <div class="vit"><b>♠ Sanidade</b>${btn('adj','sa,-1','−')}${inp('sa','number')} / <b style="min-width:0">${SAN_MAX}</b>${btn('adj','sa,1','+')}
      <span class="mu">${estadoSan(S.sa)}</span></div>
    ${slider('sa', SAN_MIN, SAN_MAX)}
    <div class="vit"><b>♦ Movimentação</b><b style="min-width:0">${C.mov} m</b><span class="mu">(Agilidade ÷ 2 + bônus)</span>
      <input type="number" data-b="movB" value="${S.movB}"></div></section>`;

  const atrs = `<section class="card"><h2>Atributos</h2>
    <table><tr><th></th><th>Base</th><th>${ativo?'Shin':''}</th><th>Total</th><th>1d20+</th></tr>
    ${ATTRS.map(([k,l])=>`<tr><td>${l}</td>
      <td>${btn('attr',k+',-1','−')} <b>${S.attrs[k]}</b> ${btn('attr',k+',1','+')}</td>
      <td style="color:var(--gold)">${C.bonus(k)?'+'+C.bonus(k):''}</td><td><b>${C.eff[k]}</b></td>
      <td>${btn('roll',k,'🎲')}</td></tr>`).join('')}</table>
    <p class="mu">+ gasta e − devolve 1 ponto livre. Vida máx. = base + Vitalidade ÷ 2.</p></section>`;

  const combate = `<section class="card"><h2>Combate · Turno ${S.turno}</h2>
    <div class="acts">${btn('init','','Iniciativa (1d6+Agi)')}${btn('block','','Bloqueio ((1d20+Vit)÷2)')}${btn('endturn','','Fim de turno ▶','au')}${btn('turn0','','Reiniciar turnos')}</div>
    <div id="log">${esc(LOG)||'Os resultados das rolagens aparecem aqui.'}</div>
    <p class="mu">Fim de turno aplica Burn, reduz Counts, remove efeitos zerados e devolve +5 de stamina a cada 2 turnos.</p></section>`;

  const fxHtml = `<section class="card"><h2>Status Effects</h2>
    ${S.fx.length ? S.fx.map((e,i)=>{const F=FX[e.k];return `<div class="fx ${F.s>0?'p':F.s<0?'n':''}">
      <div class="row">${F.custom?`<input style="flex:1;min-width:140px" placeholder="Nome do efeito" data-b="fx.${i}.nome" value="${esc(e.nome)}">`:`<b style="flex:1">${F.n}</b>`}
        <span class="mu">Count</span>${btn('fx',i+',c,-1','−')}<b>${e.c}</b>${btn('fx',i+',c,1','+')}
        ${F.p?`<span class="mu">Potency</span>${btn('fx',i+',p,-1','−')}<b>${e.p}</b>${btn('fx',i+',p,1','+')}`:''}
        ${F.act?btn('apply',i,F.act==='use'?'Usar':'Aplicar','au'):''}${btn('del','fx,'+i,'✕')}</div>
      <div><b style="color:var(--gold)">${F.h(e.c,e.p,C.L)}</b></div>
      <div class="mu">${F.d}</div>${F.custom?`<textarea rows="2" placeholder="Descreva o efeito (Count e Potency são controlados por você)…" data-b="fx.${i}.desc">${esc(e.desc)}</textarea>`:''}</div>`}).join('') : '<p class="mu">Nenhum efeito ativo.</p>'}
    <div class="row"><select id="fxsel">${Object.entries(FX).map(([k,F])=>`<option value="${k}">${F.s>0?'＋':F.s<0?'－':'✎'} ${F.n}</option>`).join('')}</select>${btn('addfx','','Adicionar','au')}</div></section>`;

  const sh = S.shin, need2 = need(sh.lvl);
  const shin = `<section class="card shin"><h2>Shin 心 e Mang 望</h2>
    <div class="grid">
      <div><label>Pecado (apenas um)</label><select data-b="shin.pecado"><option value=""></option>${PECADOS.map(p=>`<option ${sh.pecado===p?'selected':''}>${p}</option>`).join('')}</select></div>
      <div><label>Nível de Shin</label>${inp('shin.lvl','number')}</div>
      <div><label>XP de Shin (próx.: ${need2})</label>${inp('shin.xp','number')}</div>
      <div style="align-self:end">${btn('shinup','','⬆ Subir Shin','au',sh.xp>=need2?'':'disabled')}</div>
    </div>
    <div style="margin-top:10px"><label>Frase de efeito (aparece ao ativar o Shin)</label>${inp('shin.frase','text','Ex.: Meu coração é a minha luz.')}</div>
    <div class="acts"><span class="tag">${ativo?'✦ SHIN ATIVO':'Shin inativo'}</span>
      ${btn('cena','','👁 Pré-visualizar')}${ativo?btn('shin','off','Desativar'):btn('shin','st','Ativar (−15 stamina)','au')+btn('shin','dano','Ativar (50 de dano causado)','au')}</div>
    <p class="mu">Ativo: maior atributo +${5+S.lvl} (+5 + nível), os demais +${S.lvl} (nível). Em empate, só o primeiro recebe o bônus maior.</p>
    <div class="row"><b>Anéis de Mang:</b> <span class="ring">${C.aneis?'◯'.repeat(C.aneis):'—'}</span>
      <span class="mu">(1 anel a cada 6 níveis de Shin)</span></div>
    <div><b style="color:var(--gold)">Dano extra de Mang: +${C.aneis*(10+S.lvl)}</b> <span class="mu">(${C.aneis} × (10 + nível))</span></div>
    <label style="margin-top:8px">Passiva de Shin (definida com o mestre)</label>
    <textarea data-b="shin.passiva" rows="2">${esc(sh.passiva)}</textarea></section>`;

  const eg = S.ego;
  const egoHtml = `<section class="card shin"><h2>EGO</h2>
    <div class="grid">
      <div><label>Nome do EGO</label>${inp('ego.nome')}</div>
      <div><label>Estado</label><select data-b="ego.estado">${[['nao','Não manifestado'],['man','Manifestado'],['dis','Distorcido']].map(([v,l])=>`<option value="${v}" ${eg.estado===v?'selected':''}>${l}</option>`).join('')}</select></div>
    </div>
    <label style="margin-top:8px">Aparência e descrição (como o EGO reflete o interior do personagem)</label>
    <textarea data-b="ego.desc" rows="2">${esc(eg.desc)}</textarea>
    <div class="acts">${btn('egoman','','Teste de manifestação (1d20 + Carisma)')}${btn('egosan','','Teste de sanidade (1d20 + Carisma)')}</div>
    <div id="logego">${esc(LOGEGO)||'Os resultados dos testes de EGO aparecem aqui.'}</div>
    ${eg.estado==='dis'?`<div class="vit" style="margin-top:8px"><b>Falhas p/ sair da Distorção</b>${btn('adj','ego.falhas,-1','−')}<b style="min-width:0">${eg.falhas}</b>${btn('adj','ego.falhas,1','+')}</div>
      <p class="mu">Em Distorção o jogador perde o controle até resolver o conflito (testes de sanidade). Cada falha reduz as chances; pouca vida ou um aliado próximo ajudam. Ao resolver sozinho, o EGO se manifesta normalmente.</p>`:''}
    <h2 style="margin-top:14px">Habilidades de EGO</h2>
    ${[0,1,2].map(i=>`<div class="fx" style="border-left-color:var(--gold)">
      <div class="row"><input style="flex:1;min-width:140px" placeholder="Habilidade ${i+1}" data-b="ego.hab.${i}.n" value="${esc(eg.hab[i]?.n)}">
        <input style="width:130px" placeholder="Dados (ex.: 3d8+5)" data-b="ego.hab.${i}.d" value="${esc(eg.hab[i]?.d)}"></div>
      <textarea rows="2" placeholder="Efeito, descrição, status effects aplicados…" data-b="ego.hab.${i}.e">${esc(eg.hab[i]?.e)}</textarea></div>`).join('')}
    <p class="mu">Todo personagem tem 3 habilidades de EGO, que podem ser trocadas a cada 2 níveis (próxima troca: nível ${(Math.floor(S.lvl/2)+1)*2}).</p></section>`;

  const lista = (nome,tit,cols,add) => `<section class="card"><h2>${tit}</h2>
    ${S[nome].map((it,i)=>`<div class="row">${cols.map(([k,ph,t])=>`<input type="${t}" ${t==='number'?'style="width:80px;flex:none"':''} placeholder="${ph}" data-b="${nome}.${i}.${k}" value="${esc(it[k])}">`).join('')}${btn('del',nome+','+i,'✕')}</div>`).join('')}
    ${btn('add',nome,add)}</section>`;

  const io = `<section class="card"><h2>Salvar / Compartilhar</h2>
    <p class="mu">A ficha é salva sozinha neste navegador. Para levar a outro aparelho: Exportar, copie o texto e cole lá em Importar.</p>
    <textarea id="io" rows="3" placeholder="O código da ficha aparece aqui"></textarea>
    <div class="acts">${btn('exp','','Exportar','')}${btn('imp','','Importar')}${btn('clr','','Limpar ficha')}</div></section>`;

  const foco = document.activeElement?.id;
  $('#app').innerHTML = topo+vitais+atrs+combate+fxHtml+shin
    +egoHtml
    +lista('equipego','Equipamentos de EGO',[['n','Equipamento','text'],['d','Efeito / notas','text']],'+ Equipamento')
    +habs()
    +lista('armas','Armas',[['n','Arma','text'],['d','Dano / tipo (slash, pierce, blunt)','text']],'+ Arma')
    +lista('inv','Inventário',[['n','Item','text'],['q','Qtd.','number']],'+ Item')+io
    +(ativo?'<div class="aura"></div>':'')
    +(CENA?`<div class="cena" data-a="fechar"><div class="halo"></div><p>${esc(S.shin.frase||'Shin!')}</p></div>`:'');
  document.body.classList.toggle('on',ativo);
  $('#pic').onclick = () => $('#file').click();
  $('#file').onchange = carregarImagem;
}

// Seção de habilidades: texto livre escrito pelo jogador
// Cena de ativação do Shin: tela preta + frase escolhida pelo jogador
let CENA=false, TCENA;
function cena(){ CENA=true; clearTimeout(TCENA); TCENA=setTimeout(()=>{ CENA=false; render(); },4500); }
function habs(){ return `<section class="card"><h2>Habilidades</h2>
    ${S.habs.map((h,i)=>`<div class="fx n" style="border-left-color:var(--gold)">
      <div class="row"><input style="flex:1;min-width:140px" placeholder="Nome da habilidade" data-b="habs.${i}.n" value="${esc(h.n)}">
        <input type="number" style="width:80px" placeholder="Custo" title="Custo de stamina" data-b="habs.${i}.c" value="${esc(h.c)}">
        <input style="width:130px" placeholder="Dados (ex.: 2d6+3)" data-b="habs.${i}.d" value="${esc(h.d)}">
        ${btn('use',i,'Usar','au')}${btn('del','habs,'+i,'✕')}</div>
      <textarea rows="2" placeholder="Efeito, descrição, status effects aplicados…" data-b="habs.${i}.e">${esc(h.e)}</textarea></div>`).join('')}
    ${btn('add','habs','+ Habilidade')}
    <p class="mu">Custo = stamina. O botão Usar desconta o custo da stamina.</p></section>`; }

// =============== 5. AÇÕES ===============
function ler(){ return {C:calc()}; }
// Mantém a sanidade dentro dos limites do livro
function limitarSanidade(){ S.sa = Math.max(SAN_MIN, Math.min(SAN_MAX, S.sa)); }

function fimTurno(){
  const msgs = [];
  S.fx.forEach(e=>{
    const F = FX[e.k];
    if(F.end==='burn'){ S.hp -= e.p; msgs.push(`Burn: −${e.p} de vida`); e.c--; }
    else if(F.end==='dec') e.c--;
    else if(F.end==='clear') e.c = 0;
  });
  const antes = S.fx.length;
  S.fx = S.fx.filter(e=>e.c>0);
  if(antes!==S.fx.length) msgs.push(`${antes-S.fx.length} efeito(s) acabaram`);
  if(S.turno%2===0){ S.st = Math.min(S.stMax,S.st+5); msgs.push('+5 stamina'); }
  S.turno++;
  return `Turno ${S.turno-1} encerrado. ${msgs.join(' · ')}`;
}
function acao(a,x){
  const C = calc(), [p1,p2,p3] = String(x).split(',');
  switch(a){
    case 'adj': set(p1,get(p1)+(+p2)); break;
    case 'attr': S.attrs[p1]=Math.max(0,S.attrs[p1]+(+p2)); S.livres-=(+p2); break;
    case 'lvlup': if(S.xp>=need(S.lvl)){ S.xp-=need(S.lvl); S.lvl++; S.livres+=4; LOG=`Nível ${S.lvl}! +4 pontos livres de atributo.`; } break;
    case 'shinup': if(S.shin.xp>=need(S.shin.lvl)){ S.shin.xp-=need(S.shin.lvl); S.shin.lvl++; LOG=`Shin nível ${S.shin.lvl}!`+(S.shin.lvl%6===0?' Novo anel de Mang!':''); } break;
    case 'shin': if(p1==='st'){ if(S.st<15){LOG='Stamina insuficiente (precisa de 15).';break;} S.st-=15; S.shin.on=true; cena(); LOG='Shin ativado (−15 stamina).'; }
                 else if(p1==='dano'){ S.shin.on=true; cena(); LOG='Shin ativado (50 de dano causado).'; } else { S.shin.on=false; LOG='Shin desativado.'; } break;
    case 'egoman': { const r=d(20); LOGEGO=`Manifestação de EGO: 1d20 (${r}) + Carisma ${C.eff.car} = ${r+C.eff.car}. O mestre define a dificuldade; em falha pode ocorrer Distorção.`; break; }
    case 'egosan': { const r=d(20); LOGEGO=`Teste de sanidade: 1d20 (${r}) + Carisma ${C.eff.car} = ${r+C.eff.car}`; break; }
    case 'cena': cena(); break;
    case 'fechar': CENA=false; clearTimeout(TCENA); break;
    case 'roll': { const r=d(20), m=C.eff[p1], nome=ATTRS.find(a=>a[0]===p1)[1]; LOG=`${nome}: 1d20 (${r}) + ${m} = ${r+m}`; break; }
    case 'init': { const r=d(6), h=S.fx.filter(e=>e.k==='haste').reduce((s,e)=>s+e.c,0), b=S.fx.filter(e=>e.k==='bind').reduce((s,e)=>s+e.c,0);
                   LOG=`Velocidade: 1d6 (${r}) + Agi ${C.eff.agi}${h?` + Haste ${h}`:''}${b?` − Bind ${b}`:''} = ${r+C.eff.agi+h-b}`; break; }
    case 'block': { const r=d(20); LOG=`Bloqueio: (1d20 (${r}) + Vit ${C.eff.vit}) ÷ 2 = ${Math.floor((r+C.eff.vit)/2)} de vida extra neste turno`; break; }
    case 'endturn': LOG = fimTurno(); break;
    case 'turn0': S.turno=1; LOG='Turnos reiniciados.'; break;
    case 'addfx': { const k=$('#fxsel').value, ex=FX[k].custom?null:S.fx.find(e=>e.k===k); if(ex) ex.c++; else S.fx.push({k,c:1,p:1}); break; }
    case 'fx': { const e=S.fx[+p1]; e[p2]=Math.max(0,e[p2]+(+p3)); if(e.c<=0) S.fx.splice(+p1,1); break; }
    case 'apply': { const e=S.fx[+p1], F=FX[e.k];
                    if(F.act==='dmg'){ S.hp-=e.p; LOG=`${F.n}: −${e.p} de vida`; }
                    else if(F.act==='sa'){ S.sa=Math.max(SAN_MIN,S.sa-e.p); LOG=`${F.n}: −${e.p} de sanidade`; }
                    else LOG=`${F.n} usado: +50% de dano`;
                    e.c--; if(e.c<=0) S.fx.splice(+p1,1); break; }
    case 'use': { const h=S.habs[+p1], c=h.c||0; if(S.st<c){ LOG='Stamina insuficiente.'; break; } S.st-=c; LOG=`${h.n||'Habilidade'} usada (−${c} stamina).`; break; }
    case 'add': S[p1].push({}); break;
    case 'del': S[p1].splice(+p2,1); break;
    case 'exp': render(); $('#io').value=JSON.stringify(S); $('#io').select(); return;
    case 'imp': try{ S={...padrao(),...JSON.parse($('#io').value)}; S.attrs={...padrao().attrs,...S.attrs}; S.shin={...padrao().shin,...S.shin}; S.ego={...padrao().ego,...S.ego}; }catch(e){ alert('Código inválido.'); } break;
    case 'clr': if(confirm('Apagar toda a ficha?')) S=padrao(); break;
  }
  limitarSanidade(); S.ego.falhas = Math.max(0, S.ego.falhas|0);
  salvar(); render();
}
document.addEventListener('click', e=>{ const b=e.target.closest('[data-a]'); if(b && !b.disabled) acao(b.dataset.a,b.dataset.x); });
document.addEventListener('change', e=>{
  const el=e.target; if(!el.dataset.b) return;
  set(el.dataset.b, (el.type==='number' || el.type==='range') ? (+el.value||0) : el.value);
  limitarSanidade();
  salvar(); render();
});
// Enquanto arrasta um controle deslizante: atualiza cor e número ao vivo (sem redesenhar a tela)
document.addEventListener('input', e=>{
  const el = e.target; if(el.type!=='range') return;
  el.style.setProperty('--p', ((el.value-el.min)/((el.max-el.min)||1)*100)+'%');
  const num = document.querySelector(`input[type="number"][data-b="${el.dataset.b}"]`);
  if(num) num.value = el.value;
});

function carregarImagem(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ const im=new Image(); im.onload=()=>{
      const k=Math.min(1,400/Math.max(im.width,im.height)), c=document.createElement('canvas');
      c.width=im.width*k; c.height=im.height*k; c.getContext('2d').drawImage(im,0,0,c.width,c.height);
      S.img=c.toDataURL('image/jpeg',.8); salvar(); render(); };
    im.src=r.result; };
  r.readAsDataURL(f);
}
render();
