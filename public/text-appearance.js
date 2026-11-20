import {restoreFocus} from "./interaction.js";
import {drawingColor, isHexDrawingColor} from "./drawing-palette.js";
import {appearanceThemes,canvasBackdrop,compositeColor,contrastRatio,fallbackEdge,fallbackInk,luminance,readableColor,renderDrawingColor,textFillColor,textFillColors as fillColors,textFillToken,themeColor,unpackColor} from "./theme-colors.js";
import {colorDot,paletteMarkup,pickerHex,setSwatch,onSwatch} from "./color-control.js";
import {segmentedHTML,setSegmented,onSegmented,focusSegmented} from "./ui-segmented.js";
import {choiceHTML,setChoice,onChoice} from "./ui-toolbar.js";
import {tips,setTip} from "./tips.js";
import {mountPresetScrub} from "./preset-scrub.js";

export const isHexColor = isHexDrawingColor;
const presetValues = [["small","S","Small",18,4],["medium","M","Medium",21,12],["large","L","Large",36,24]];
const sizePresets = presetValues.map(([id,label,ariaLabel,value])=>({id,label,ariaLabel,value}));
const paddingPresets = presetValues.map(([id,label,ariaLabel,,value])=>({id,label,ariaLabel,value}));
const faces = [["serif","Serif"],["sans","Sans"],["mono","Mono"]];
export function textStyleVariables(decoration, ink, backdrop = theme => [canvasBackdrop(null, theme)]) {
  const styles=[];
  if(Number.isInteger(decoration.textSize)&&decoration.textSize>=10&&decoration.textSize<=144)
    styles.push(`--text-font-size:${decoration.textSize}px`);
  if(Number.isInteger(decoration.textPadding)&&decoration.textPadding>=0&&decoration.textPadding<=64)
    styles.push(`--text-padding:${decoration.textPadding}px`);
  const edgeStyle=decoration.textBorder?.style;
  if(edgeStyle==="solid"||edgeStyle==="dashed")styles.push(`--text-border-style:${edgeStyle}`);
  const backingFor = theme => {
    const fill = textFillColor(decoration.textFill, theme);
    const backing = backdrop(theme);
    return {fill, backing: fill ? backing.map(base => compositeColor(fill, base)) : backing};
  };
  const lightBackings = backingFor("light").backing;
  const lightInk = renderDrawingColor(ink,"ink","light") ?? fallbackInk("light");
  const intendedContrast = Math.min(...lightBackings.map(base =>
    contrastRatio(luminance(compositeColor(lightInk, base)), luminance(base))));
  for (const theme of appearanceThemes) {
    const {fill, backing} = backingFor(theme);
    // a named fill paints from its token, so it follows the ground; the maths uses its colour on the desk
    if(fill)styles.push(`--text-fill-${theme}:${textFillToken(decoration.textFill) ?? fill}`);
    const edge=renderDrawingColor(decoration.textBorder?.color,"stroke",theme)??fallbackEdge(theme);
    if(edgeStyle)styles.push(`--text-edge-${theme}:${readableColor(edge, backing, 3).color}`);
    const min = theme === "dark" ? Math.max(4.5, Math.min(7, intendedContrast)) : 4.5;
    const result = readableColor(renderDrawingColor(ink,"ink",theme) ?? fallbackInk(theme), backing, min);
    styles.push(`--text-ink-${theme}:${result.color}`);
    if (!result.meetsContrast && !readableColor(result.color, backing, 4.5).meetsContrast) {
      const halo = luminance(unpackColor(result.color)[0]) < .18 ? "#ffffff" : "#000000";
      styles.push(`--text-halo-${theme}:${halo}`);
    }
  }
  return styles.join(";")+";";
}

const colorRoles = {ink:"ink",fill:"fill",border:"stroke"};
// The chosen swatch is the group's Tab stop (the first when a custom colour is chosen). The SDK gives the radios their
// role and tab stop a moment after they are inserted, so focus waits for that.
const focusSwatch=group=>{const go=()=>(group?.querySelector("[data-swatch][data-checked]")??group?.querySelector("[data-swatch]"))?.focus({preventScroll:true});queueMicrotask(go);};
const colorLabels = {ink:"Ink",fill:"Fill",border:"Border"};
const formatTitles = {size:"Text size",ink:"Ink",advanced:"Advanced text"};
const fills = [["none","None"],["paper","Paper"],["tint","Tint"],["strong","Strong"]];
const borders = [["none","None"],["solid","Solid"],["dashed","Dashed"]];
const closeIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg>';
const insetIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><rect x="5.5" y="5.5" width="5" height="5" rx=".5"/></svg>';
const autoHeightIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2"/><path d="M8 4.1v7.8M6.1 6 8 4.1 9.9 6m-3.8 4L8 11.9 9.9 10"/></svg>';

const colorStyles = id => `--preview-light:${textFillToken(id)};--preview-dark:${textFillToken(id)}`;
const storedSize = d => d.textSize??"medium";
const currentSize = d => Number.isInteger(d.textSize)?d.textSize:sizePresets.find(({id})=>id===storedSize(d))?.value??21;
const sizeSelection = d => ({preset:Number.isInteger(d.textSize)?null:storedSize(d)});
const currentPadding = d => d.textPadding??12;
const currentFill = d => d.textFill??"none";
const currentBorder = d => d.textBorder?.style??"none";

const sizeMarkup = `<div class="text-size-controls">
  <div data-text-size-scrub></div>
  <button type="button" data-auto-height>${autoHeightIcon}</button>
</div>`;

// Each set of options is one choice. Typeface, fill and border are keys (raised, as depth.css draws pressed buttons): a
// single-choice toggle group of real buttons, one Tab stop, arrows move and Space or Enter chooses. Which channel the
// palette paints (Fill or Border) is a segmented control. The palette is a radio group (color-control.js).
function advancedMarkup() {
  const roles=segmentedHTML({label:"Color applies to",className:"text-format-roles",value:"fill",items:[
    {value:"fill",html:'<span data-role-dot></span>Fill',attrs:{"data-role":"fill"}},
    {value:"border",html:'<span data-role-dot></span>Border',attrs:{"data-role":"border"}}]});
  return choiceHTML({label:"Typeface",className:"text-format-faces",items:faces.map(([id,label])=>({value:id,attrs:{"data-face":id},tip:label,html:`<span class="text-format-specimen" aria-hidden="true">Aa</span><span>${label}</span>`}))})+`
    <div class="text-format-colors">
      ${roles}
      ${choiceHTML({label:"Fill style",className:"text-format-options",attrs:{"data-fill-options":"",hidden:""},items:fills.map(([id,label])=>({value:id,attrs:{"data-fill":id},html:`<span class="text-format-fill-preview"${fillColors[id]?` style="${colorStyles(id)}"`:""} aria-hidden="true"></span>${label}`}))})}
      ${choiceHTML({label:"Border style",className:"text-format-options",attrs:{"data-border-options":"",hidden:""},items:borders.map(([id,label])=>({value:id,attrs:{"data-border":id},html:`<span class="text-format-border-preview" aria-hidden="true"></span>${label}`}))})}
      ${paletteMarkup(["fill","border"])}
      <button type="button" data-border-auto data-tip="Use the default border color" hidden>Automatic border color</button>
    </div>`;
}

export function mountTextAppearance(popover, decoration, {save, close, layout, previewSize, previewPadding, mode="advanced"}) {
  const title=formatTitles[mode];
  const content=mode==="size"?sizeMarkup:mode==="ink"?paletteMarkup(["ink"]):advancedMarkup();
  popover.innerHTML=`<div class="text-format-controls" data-text-format-mode="${mode}">
    <div class="text-format-header"><strong>${title}</strong>
      <button type="button" data-format-close aria-label="Close ${title.toLowerCase()}" data-tip="Close">${closeIcon}</button>
    </div>
    ${content}
    ${mode==="advanced"?`<div class="text-format-inset">
      <span class="text-format-inset-label" aria-hidden="true">${insetIcon}Padding</span>
      <div data-padding-scrub></div>
    </div>`:""}
    <div data-style-feedback hidden><span data-style-status role="status"></span><button type="button" data-style-retry hidden>Retry</button></div>
  </div>`;

  const surface=popover.querySelector(".text-format-controls");
  tips(surface);
  const get=selector=>surface.querySelector(selector);
  const custom=get("[name=custom]");
  const autoHeightToggle=get("[data-auto-height]");
  const customTarget=get(".text-format-custom"),status=get("[data-style-status]");
  const swatches=get("[data-color-swatches]");
  const fillOptions=get("[data-fill-options]"),borderOptions=get("[data-border-options]"),autoBorder=get("[data-border-auto]");
  const facesGroup=get(".text-format-faces"),rolesControl=get(".text-format-roles");
  const pending=[];
  let saved={...decoration},channel=mode==="ink"?"ink":"fill";
  let active=true,writing=false,failed=null;
  const events=new AbortController();
  const on=(target,event,handler)=>target.addEventListener(event,handler,{signal:events.signal});
  const optimistic=()=>pending.reduce((d,change)=>({...d,...change(d)}),saved);
  const borderFor=(d,color)=>({style:d.textBorder?.style??"solid",...(color?{color}:{})});

  function update() {
    if(!active)return;
    const d=optimistic();
    if(mode==="advanced"){
      setChoice(facesGroup,d.textFace??"serif");
      setSegmented(rolesControl,channel);
      setChoice(fillOptions,currentFill(d));
      setChoice(borderOptions,currentBorder(d));
      get("[data-role=fill] [data-role-dot]").innerHTML=colorDot(d.textFill,"fill",fillColors[d.textFill]);
      get("[data-role=border] [data-role-dot]").innerHTML=colorDot(d.textBorder?.color,"stroke",
        d.textBorder?{light:fallbackEdge("light"),dark:fallbackEdge("dark")}:undefined);
      fillOptions.hidden=channel!=="fill";
      borderOptions.hidden=channel!=="border";
      autoBorder.hidden=channel!=="border"||!d.textBorder;
      autoBorder.setAttribute("aria-pressed",String(!d.textBorder?.color));
    }
    if(swatches){
      const selected=channel==="ink"?d.color:channel==="fill"?d.textFill:d.textBorder?.color;
      setSwatch(swatches,selected);
      swatches.dataset.channel=channel;
      swatches.setAttribute("aria-label",`${colorLabels[channel]} color palette`);
      const theme=document.documentElement.dataset.appearance==="dark"?"dark":"light";
      customTarget.classList.toggle("is-selected",isHexColor(selected));
      for (const theme of appearanceThemes) {
        const preview = isHexColor(selected) ? renderDrawingColor(selected, colorRoles[channel], theme) : "transparent";
        customTarget.style.setProperty(`--custom-preview-${theme}`, preview);
      }
      custom.value=pickerHex(isHexColor(selected) ? selected : renderDrawingColor(selected,colorRoles[channel],theme)??fillColors[selected]?.[theme],
        {ink:fallbackInk,fill:theme=>themeColor("tint",theme),border:fallbackEdge}[channel](theme));
    }
    if(sizeControl){
      const autoHeight=d.textSizing==="auto";
      const action=autoHeight?"Disable auto height":"Enable auto height";
      autoHeightToggle.setAttribute("aria-pressed",String(autoHeight));
      autoHeightToggle.setAttribute("aria-label",action);
      setTip(autoHeightToggle,action);
      sizeControl.setValue(currentSize(d),sizeSelection(d));
    }
    paddingControl?.setValue(currentPadding(d));
    const message=failed?"Change wasn’t saved.":"";
    get("[data-style-feedback]").hidden=!message;
    get("[data-style-retry]").hidden=!failed;
    if(status.textContent!==message)status.textContent=message;
    layout?.();
  }

  function enqueue(change) {
    if(!Object.keys(change(optimistic())).length){update();return;}
    pending.push(change);
    update();
    void drain();
  }

  // Re-evaluate each intent against the last confirmed result, so a rejected
  // border/style write cannot leak into the next queued patch.
  async function drain() {
    if(writing)return;
    writing=true;
    while(pending.length){
      const change=pending[0],patch=change(saved);
      if(Object.keys(patch).length){
        try {
          if(await save(patch)===false)throw new Error("Style change was rejected");
          saved={...saved,...patch};
          if(failed&&JSON.stringify(failed.patch)===JSON.stringify(patch))failed=null;
        } catch {failed={change,patch};}
      }
      pending.shift();
      update();
    }
    writing=false;
  }

  const field=(key,value,read=d=>d[key])=>enqueue(d=>read(d)===value?{}:{[key]:value});
  const sizeControl=mode==="size"?mountPresetScrub(get("[data-text-size-scrub]"),{
    label:"Text size",inputLabel:"Adjust text size",unit:"px",presets:sizePresets,min:10,max:144,
    value:currentSize(decoration),selection:sizeSelection(decoration),preview:previewSize,
    commit:(value,{preset})=>field("textSize",preset??value,storedSize),
  }):null;
  const paddingControl=mode==="advanced"?mountPresetScrub(get("[data-padding-scrub]"),{
    label:"Padding",inputLabel:"Adjust padding",unit:"px",presets:paddingPresets,min:0,max:64,
    value:currentPadding(decoration),preview:previewPadding,
    commit:value=>field("textPadding",value,currentPadding),
  }):null;
  const setColor=(channel,value)=>channel==="ink"?field("color",value):
    channel==="fill"?field("textFill",value,currentFill):
    enqueue(d=>d.textBorder?.color===value?{}:{textBorder:borderFor(d,value)});

  const choose=event=>{
    const button=event.target.closest("button");
    if(!button)return;
    const {face,role,fill,border,swatch}=button.dataset;
    if(button.hasAttribute("data-format-close")){close();return;}
    if(button.hasAttribute("data-style-retry")&&failed){
      const {change}=failed;
      failed=null;
      enqueue(change);
      return;
    }
    if(button===autoHeightToggle){
      const sizing=optimistic().textSizing==="auto"?"fixed":"auto";
      field("textSizing",sizing,d=>d.textSizing??"fixed");
      return;
    }
    if(button.hasAttribute("data-border-auto"))setColor("border",undefined);
  };
  on(surface,"click",choose);
  // The choices report through valuechange (it does not bubble): listen on each control.
  if(facesGroup){
    onChoice(facesGroup,face=>field("textFace",face,d=>d.textFace??"serif"));
    onSegmented(rolesControl,role=>{channel=role;update();});
    onChoice(fillOptions,fill=>field("textFill",fill,currentFill));
    onChoice(borderOptions,border=>enqueue(d=>currentBorder(d)===border?{}:{textBorder:border==="none"?null:{...d.textBorder,style:border}}));
  }
  if(swatches)onSwatch(swatches,id=>setColor(channel,id));
  if(custom)on(custom,"change",()=>setColor(channel,custom.value));
  update();
  return {
    destroy({commit=true}={}) {
      if(!active)return;
      active=false;
      sizeControl?.destroy({commit});
      paddingControl?.destroy({commit});
      events.abort();
    },
    focus() {
      if(sizeControl)sizeControl.focus();
      else if(facesGroup)restoreFocus(get("[data-face][aria-pressed=true]")??get("[data-face]"));
      else focusSwatch(swatches);
    },
  };
}
