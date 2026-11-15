/** 预览沙箱注入：捕获生成应用的 console / error，回传给宿主页面（控制台面板 + 一键修复） */

export function instrument(html: string): string {
  const hook = `<script data-atoms-hook="1">
(function(){
  if(window.__atomsHooked)return; window.__atomsHooked=true;
  var P=window.parent;
  function str(v){
    try{
      if(typeof v==='string')return v;
      if(v instanceof Error)return (v.stack||v.message||'Error');
      if(typeof v==='function')return '[Function]';
      return JSON.stringify(v);
    }catch(e){return String(v);}
  }
  function send(level,args){
    try{
      var text=Array.prototype.map.call(args,str).join(' ').slice(0,1200);
      P.postMessage({__atoms:1,level:level,text:text},'*');
    }catch(e){}
  }
  var keys=['log','info','warn','error'];
  for(var i=0;i<keys.length;i++){
    (function(k){
      var orig=console[k]?console[k].bind(console):function(){};
      console[k]=function(){send(k==='info'?'log':k,arguments);orig.apply(null,arguments);};
    })(keys[i]);
  }
  window.addEventListener('error',function(e){
    send('error',['Uncaught ' + (e.message||'error') + (e.filename?(' @ '+e.filename+':'+e.lineno):'')]);
  });
  window.addEventListener('unhandledrejection',function(e){
    send('error',['Unhandled rejection: '+str(e.reason)]);
  });
  P.postMessage({__atoms:1,level:'ready',text:'ready'},'*');
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, (m) => m + hook);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, (m) => m + hook);
  return hook + html;
}
