/**
 * 离线演示模式（未配置 API Key 时）使用的内置示例应用。
 * 它们与真实生成结果走同一条流水线（规划 -> 代码 -> 校验 -> 版本），保证 Demo 永远可跑。
 */

import type { Plan } from "./types";

const KANBAN = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>轻量任务看板</title>
<style>
  :root{--bg:#0f1117;--card:#181b24;--line:#262a36;--txt:#e7e9f0;--sub:#8f96ab;--acc:#6c8cff;--ok:#3ed598;--warn:#ffb347;--err:#ff7086}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:28px 18px 60px}
  header{display:flex;align-items:baseline;gap:12px;margin-bottom:18px}
  h1{font-size:20px;margin:0}
  .stat{color:var(--sub);font-size:12px}
  form{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
  input,select,button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px}
  input#title{flex:1;min-width:200px}
  input:focus,select:focus{outline:2px solid rgba(108,140,255,.5);outline-offset:1px}
  button{cursor:pointer;background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
  button:hover{filter:brightness(1.08)}
  .cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  @media(max-width:720px){.cols{grid-template-columns:1fr}}
  .col{background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:13px;padding:10px;min-height:120px}
  .col h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--sub);margin:2px 4px 10px;display:flex;justify-content:space-between}
  .task{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 11px;margin-bottom:8px;display:flex;gap:9px;align-items:flex-start}
  .task.done .t{text-decoration:line-through;color:var(--sub)}
  .t{flex:1;word-break:break-word}
  .tag{font-size:10.5px;padding:1px 7px;border-radius:99px;border:1px solid var(--line);color:var(--sub)}
  .tag.high{color:var(--err);border-color:rgba(255,112,134,.4)}
  .tag.mid{color:var(--warn);border-color:rgba(255,179,71,.4)}
  .tag.low{color:var(--ok);border-color:rgba(62,213,152,.4)}
  .icon{background:none;border:0;color:var(--sub);padding:2px 4px;cursor:pointer}
  .icon:hover{color:var(--err)}
  .empty{color:#5b6276;font-size:12.5px;text-align:center;padding:16px 6px;border:1px dashed var(--line);border-radius:9px}
  #toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);background:#222634;border:1px solid var(--line);padding:9px 15px;border-radius:99px;font-size:12.5px;opacity:0;transition:.25s;pointer-events:none}
  #toast.show{opacity:1;transform:translate(-50%,0)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>轻量任务看板</h1>
    <span class="stat" id="stat"></span>
  </header>
  <form id="form" aria-label="新建任务">
    <input id="title" placeholder="输入任务，例如：写周报" aria-label="任务标题" required>
    <select id="priority" aria-label="优先级">
      <option value="high">高优先级</option>
      <option value="mid" selected>中优先级</option>
      <option value="low">低优先级</option>
    </select>
    <select id="status" aria-label="状态">
      <option value="todo" selected>待办</option>
      <option value="doing">进行中</option>
      <option value="done">已完成</option>
    </select>
    <button type="submit">添加</button>
  </form>
  <div class="cols" id="cols"></div>
</div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
(function(){
  var KEY='app:kanban-tasks';
  var COLS=[{id:'todo',name:'待办'},{id:'doing',name:'进行中'},{id:'done',name:'已完成'}];
  var SEED=[
    {id:1,title:'梳理产品需求清单',priority:'high',status:'todo',done:false},
    {id:2,title:'完成首页视觉稿',priority:'mid',status:'doing',done:false},
    {id:3,title:'接入数据持久化',priority:'mid',status:'done',done:true}
  ];
  function load(){
    try{
      var raw=localStorage.getItem(KEY);
      if(!raw)return SEED.slice();
      var arr=JSON.parse(raw);
      return Array.isArray(arr)?arr:SEED.slice();
    }catch(e){return SEED.slice();}
  }
  function save(list){try{localStorage.setItem(KEY,JSON.stringify(list));}catch(e){}}
  var tasks=load();
  var toastTimer=null;
  function toast(msg){
    var el=document.getElementById('toast');
    el.textContent=msg;el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){el.classList.remove('show');},1800);
  }
  function render(){
    var host=document.getElementById('cols');
    host.innerHTML='';
    COLS.forEach(function(col){
      var items=tasks.filter(function(t){return t.status===col.id;});
      var box=document.createElement('div');
      box.className='col';
      var h=document.createElement('h2');
      h.innerHTML='<span>'+col.name+'</span><span>'+items.length+'</span>';
      box.appendChild(h);
      if(!items.length){
        var e=document.createElement('div');
        e.className='empty';e.textContent='暂无任务';
        box.appendChild(e);
      }
      items.forEach(function(t){
        var row=document.createElement('div');
        row.className='task'+(t.done?' done':'');
        var cb=document.createElement('input');
        cb.type='checkbox';cb.checked=!!t.done;cb.setAttribute('aria-label','切换完成：'+t.title);
        cb.addEventListener('change',function(){
          t.done=cb.checked;
          if(t.done)t.status='done';
          save(tasks);render();toast(t.done?'已完成':'已恢复');
        });
        var title=document.createElement('div');
        title.className='t';title.textContent=t.title;
        var tag=document.createElement('span');
        tag.className='tag '+t.priority;
        tag.textContent=t.priority==='high'?'高':(t.priority==='mid'?'中':'低');
        var del=document.createElement('button');
        del.className='icon';del.type='button';del.textContent='✕';
        del.setAttribute('aria-label','删除任务：'+t.title);
        del.addEventListener('click',function(){
          tasks=tasks.filter(function(x){return x.id!==t.id;});
          save(tasks);render();toast('已删除');
        });
        row.appendChild(cb);row.appendChild(title);row.appendChild(tag);row.appendChild(del);
        box.appendChild(row);
      });
      host.appendChild(box);
    });
    var done=tasks.filter(function(t){return t.done;}).length;
    document.getElementById('stat').textContent='共 '+tasks.length+' 项 · 已完成 '+done+' 项';
  }
  document.getElementById('form').addEventListener('submit',function(ev){
    ev.preventDefault();
    var input=document.getElementById('title');
    var title=input.value.trim();
    if(!title){toast('请先输入任务标题');return;}
    var status=document.getElementById('status').value;
    tasks.push({
      id:Date.now(),title:title,
      priority:document.getElementById('priority').value,
      status:status,done:status==='done'
    });
    save(tasks);input.value='';render();toast('已添加任务');
  });
  render();
})();
</script>
</body>
</html>`;

const LEDGER = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>极简记账本</title>
<style>
  :root{--bg:#f7f8fb;--card:#fff;--line:#e6e8f0;--txt:#1c2130;--sub:#6b7286;--acc:#4f6bff;--in:#12a06a;--out:#e5484d}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:26px 16px 70px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:var(--sub);font-size:12.5px;margin-bottom:16px}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
  @media(max-width:620px){.cards{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .card .k{font-size:11.5px;color:var(--sub)}
  .card .v{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
  .v.in{color:var(--in)}.v.out{color:var(--out)}
  form{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;margin-bottom:14px}
  @media(max-width:620px){form{grid-template-columns:1fr 1fr}}
  input,select,button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 10px;min-width:0}
  input:focus,select:focus{outline:2px solid rgba(79,107,255,.35);outline-offset:1px}
  button{cursor:pointer;background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
  .filters{display:flex;gap:6px;margin-bottom:10px}
  .filters button{background:var(--card);color:var(--sub);border-color:var(--line);font-weight:500;padding:5px 12px;border-radius:99px}
  .filters button.on{background:rgba(79,107,255,.1);border-color:rgba(79,107,255,.4);color:var(--acc)}
  .list{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .row{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line)}
  .row:last-child{border-bottom:0}
  .row .cat{font-size:11px;color:var(--sub);border:1px solid var(--line);padding:1px 7px;border-radius:99px}
  .row .desc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .amt{font-variant-numeric:tabular-nums;font-weight:600}
  .amt.in{color:var(--in)}.amt.out{color:var(--out)}
  .row .del{background:none;border:0;color:#b9bfd0;cursor:pointer;padding:2px 4px}
  .row .del:hover{color:var(--out)}
  .empty{padding:26px;text-align:center;color:var(--sub);font-size:12.5px}
</style>
</head>
<body>
<div class="wrap">
  <h1>极简记账本</h1>
  <div class="sub">数据保存在浏览器本地，刷新不丢</div>
  <div class="cards">
    <div class="card"><div class="k">总收入</div><div class="v in" id="income">¥0.00</div></div>
    <div class="card"><div class="k">总支出</div><div class="v out" id="expense">¥0.00</div></div>
    <div class="card"><div class="k">结余</div><div class="v" id="balance">¥0.00</div></div>
  </div>
  <form id="form" aria-label="记一笔">
    <input id="desc" placeholder="说明，例如：午餐" aria-label="说明" required>
    <select id="type" aria-label="类型"><option value="out">支出</option><option value="in">收入</option></select>
    <select id="cat" aria-label="分类">
      <option>餐饮</option><option>交通</option><option>购物</option><option>工资</option><option>其他</option>
    </select>
    <input id="amount" type="number" min="0" step="0.01" placeholder="金额" aria-label="金额" required>
    <button type="submit">记一笔</button>
  </form>
  <div class="filters" id="filters">
    <button type="button" data-f="all" class="on">全部</button>
    <button type="button" data-f="in">收入</button>
    <button type="button" data-f="out">支出</button>
  </div>
  <div class="list" id="list"></div>
</div>
<script>
(function(){
  var KEY='app:ledger-items';
  var SEED=[
    {id:1,desc:'本月工资',type:'in',cat:'工资',amount:18000,at:'2026-11-05'},
    {id:2,desc:'午餐',type:'out',cat:'餐饮',amount:32,at:'2026-11-12'},
    {id:3,desc:'地铁充值',type:'out',cat:'交通',amount:100,at:'2026-11-13'},
    {id:4,desc:'超市采购',type:'out',cat:'购物',amount:268.5,at:'2026-11-14'}
  ];
  function load(){
    try{
      var raw=localStorage.getItem(KEY);
      if(!raw)return SEED.slice();
      var arr=JSON.parse(raw);
      return Array.isArray(arr)?arr:SEED.slice();
    }catch(e){return SEED.slice();}
  }
  function save(l){try{localStorage.setItem(KEY,JSON.stringify(l));}catch(e){}}
  var items=load();
  var filter='all';
  function money(n){return '¥'+n.toFixed(2);}
  function render(){
    var income=0,expense=0;
    items.forEach(function(it){ if(it.type==='in')income+=it.amount; else expense+=it.amount; });
    document.getElementById('income').textContent=money(income);
    document.getElementById('expense').textContent=money(expense);
    document.getElementById('balance').textContent=money(income-expense);
    var list=document.getElementById('list');
    var shown=items.filter(function(it){return filter==='all'||it.type===filter;})
                   .slice().sort(function(a,b){return a.at<b.at?1:-1;});
    list.innerHTML='';
    if(!shown.length){
      var e=document.createElement('div');
      e.className='empty';e.textContent='还没有记录，先记一笔吧';
      list.appendChild(e);return;
    }
    shown.forEach(function(it){
      var row=document.createElement('div');
      row.className='row';
      var cat=document.createElement('span');
      cat.className='cat';cat.textContent=it.cat;
      var desc=document.createElement('span');
      desc.className='desc';desc.textContent=it.desc;
      var amt=document.createElement('span');
      amt.className='amt '+it.type;
      amt.textContent=(it.type==='in'?'+':'-')+money(it.amount);
      var del=document.createElement('button');
      del.className='del';del.type='button';del.textContent='✕';
      del.setAttribute('aria-label','删除记录：'+it.desc);
      del.addEventListener('click',function(){
        items=items.filter(function(x){return x.id!==it.id;});
        save(items);render();
      });
      row.appendChild(cat);row.appendChild(desc);row.appendChild(amt);row.appendChild(del);
      list.appendChild(row);
    });
  }
  document.getElementById('form').addEventListener('submit',function(ev){
    ev.preventDefault();
    var desc=document.getElementById('desc').value.trim();
    var amount=parseFloat(document.getElementById('amount').value);
    if(!desc){return;}
    if(!(amount>0)){document.getElementById('amount').focus();return;}
    items.push({
      id:Date.now(),desc:desc,
      type:document.getElementById('type').value,
      cat:document.getElementById('cat').value,
      amount:Math.round(amount*100)/100,
      at:new Date().toISOString().slice(0,10)
    });
    save(items);
    ev.target.reset();
    render();
  });
  var filters=document.getElementById('filters');
  filters.addEventListener('click',function(ev){
    var b=ev.target.closest('button[data-f]');
    if(!b)return;
    filter=b.getAttribute('data-f');
    Array.prototype.forEach.call(filters.children,function(c){c.classList.toggle('on',c===b);});
    render();
  });
  render();
})();
</script>
</body>
</html>`;

export function demoApp(prompt: string): { plan: Plan; html: string } {
  const p = prompt.toLowerCase();
  const isLedger = /记账|账本|收支|消费|财务|ledger|expense|budget/.test(p);
  if (isLedger) {
    return {
      plan: {
        name: "极简记账本",
        summary: "记录日常收支，自动汇总收入、支出与结余",
        features: ["新增收支记录", "收入/支出/结余汇总", "按类型筛选", "删除记录"],
      },
      html: LEDGER,
    };
  }
  return {
    plan: {
      name: "轻量任务看板",
      summary: "用三列看板管理任务，支持优先级与完成状态",
      features: ["新建任务", "按状态分列展示", "勾选完成", "删除任务"],
    },
    html: KANBAN,
  };
}
