import {mountPresetScrub} from './preset-scrub.js';
import {segmentedHTML,setSegmented,onSegmented,focusSegmented} from './ui-segmented.js';

export const containerLayouts = [
  ['vertical','Stack','M5 4h10v4H5zm0 8h10v4H5z'],
  ['horizontal','Row','M4 5h4v10H4zm8 0h4v10h-4z'],
  ['grid','Grid','M4 4h4v4H4zm8 0h4v4h-4zM4 12h4v4H4zm8 0h4v4h-4z'],
];
const metrics = {gap:['Gap',[6,12,24]],padding:['Padding',[8,16,32]],columns:['Columns']};
const defaults = {gap:12,padding:16,columns:2};

// Each completed layout or spacing gesture is one undoable operation. Dismissing
// the popover completes a valid in-progress numeric edit before removing its UI.
export function mountContainerLayout(popup, config, {save, preview, reposition, draft={}, failedDraft={}, report}) {
  const state = {...defaults,...config,...draft};
  let metric = 'gap', active = true, failed = {...failedDraft}, control;
  // What to adjust is one choice of Gap, Padding (and Columns, for a grid): a segmented control, a radio group, so
  // arrows choose as they move. The layout can't change while this panel is open, so Columns is simply left out.
  popup.innerHTML = `${segmentedHTML({label:'Layout spacing',className:'container-layout-metrics',value:metric,
    items:Object.entries(metrics).filter(([key])=>key!=='columns'||state.layout==='grid').map(([key,[label]])=>({value:key,label,attrs:{'data-layout-metric':key}}))})}
  <div class="container-layout-adjust"></div>
  <p class="container-layout-status" role="status"></p><button type="button" data-layout-retry hidden>Retry change</button>
  <div class="container-object-actions"><button type="button" data-whiteboard-action="edit">Edit title</button></div>`;
  const adjust = popup.querySelector('.container-layout-adjust');
  const status = popup.querySelector('.container-layout-status');
  const retry = popup.querySelector('[data-layout-retry]');
  const measures = popup.querySelector('.container-layout-metrics');

  function sync() {
    setSegmented(measures,metric);
    const columns = adjust.querySelector('.container-column-options');
    if (columns) setSegmented(columns,String(state.columns));
    retry.hidden = !Object.keys(failed).length;
    reposition();
  }
  function commit(patch) {
    Object.assign(state,patch);
    for (const key of Object.keys(patch)) delete failed[key];
    if (active) {status.textContent=''; sync();}
    save(patch).catch(error=>{
      const latest = Object.fromEntries(Object.entries(patch).filter(([key,value])=>state[key]===value));
      failed = {...failed,...latest};
      if (active) {status.textContent=error.message;retry.hidden=false;reposition();}
      else report(error);
    });
  }
  function mountMetric() {
    const key=metric,[label,values]=metrics[key];
    if (key==='columns') {
      adjust.innerHTML=segmentedHTML({label:'Grid columns',className:'container-column-options',value:String(state.columns),
        items:Array.from({length:8},(_,index)=>{
          const count=index+1;
          return {value:String(count),label:String(count),ariaLabel:`${count} ${count===1?'column':'columns'}`,attrs:{'data-columns':String(count)}};
        })});
      onSegmented(adjust.querySelector('.container-column-options'),value=>{
        const count=Number(value);
        if(count!==state.columns)commit({columns:count});
      });
      return;
    }
    const field=document.createElement('div');
    adjust.replaceChildren(field);
    control=mountPresetScrub(field,{
      label,unit:'px',min:0,max:128,value:state[key],
      presets:values.map((value,index)=>({value,label:['S','M','L'][index],ariaLabel:`${['Small','Medium','Large'][index]} ${label.toLowerCase()}`})),
      preview:value=>preview?.(value===null?null:{...state,[key]:value}),
      commit:value=>{if(value!==state[key])commit({[key]:value});},
    });
  }
  onSegmented(measures,value=>{
    if(metric===value)return;
    control?.destroy({commit:true});
    control=null;
    metric = value;
    mountMetric();
    sync();
  });
  retry.onclick=()=>commit({...failed});
  mountMetric();
  sync();
  return {
    focus:()=>focusSegmented(measures),
    destroy({commit=true}={}) {active=false;control?.destroy({commit});},
  };
}
