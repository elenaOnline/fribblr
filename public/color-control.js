import "./vendor/ui-sdk/web/radio.js";
import {drawingPalette,drawingColor,isHexDrawingColor} from "./drawing-palette.js";
import {fallbackInk,renderDrawingColor} from "./theme-colors.js";

const roles={ink:"ink",fill:"fill",border:"stroke"};
const themes=["light","dark"];
const customIcon='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8M4 8h8"/></svg>';

export function colorDot(value, role, fallback) {
  const light=renderDrawingColor(value,role,"light")??fallback?.light??fallback;
  const dark=renderDrawingColor(value,role,"dark")??fallback?.dark??fallback;
  return light&&dark ? `<span class="drawing-color-dot" aria-hidden="true" style="--dot-light:${light};--dot-dark:${dark}"></span>` :
    '<span class="drawing-color-dot drawing-color-dot-mixed" aria-hidden="true"></span>';
}

// The browser picker only shows RGB. Leaving it untouched retains a saved alpha.
export function pickerHex(value, fallback) {
  if(!isHexDrawingColor(value))return fallback;
  return value.length<=5?"#"+[...value.slice(1,4)].map(c=>c+c).join("").toLowerCase():value.slice(0,7).toLowerCase();
}

// A palette is one choice among colours: a radio group (ui-radio-group), so there is one Tab stop on the chosen swatch
// (the first when none is, as for a custom colour) and the arrow keys choose as they move. Each swatch is a ui-radio
// holding its chip. The custom-colour field sits last in the same group box, a label around the system picker.
export function paletteMarkup(channels,{options=drawingPalette,resolve=renderDrawingColor}={}) {
  const swatches=options.map(({id,label})=>{
    const vars=channels.flatMap(channel=>themes.map(theme=>`--${channel}-${theme}:${resolve(id,roles[channel],theme)}`)).join(";");
    return `<ui-radio value="${id}" data-swatch="${id}" aria-label="${label}" data-tip="${label}" style="${vars}"><span aria-hidden="true"></span></ui-radio>`;
  }).join("");
  return `<ui-radio-group class="text-format-swatches" data-color-swatches aria-label="Color">${swatches}
    <label class="text-format-custom" data-tip="Custom color">
      <span class="text-format-custom-chip" aria-hidden="true">${customIcon}</span>
      <input type="color" name="custom" aria-label="Custom color">
    </label>
  </ui-radio-group>`;
}

// Which swatch is chosen: written from our model, so no event fires (a property write). `id` is a swatch's id or null.
export function setSwatch(palette,id) {
  if(!palette)return;
  const next=id==null?null:String(id);
  if(palette.api){if((palette.value??null)!==next)palette.value=next;}
  else if(next==null)palette.removeAttribute("default-value");
  else palette.setAttribute("default-value",next);
}

// Run fn(id) when she chooses a swatch (pointer or arrow keys). valuechange does not bubble: listen on the group.
export function onSwatch(palette,fn) {
  palette.addEventListener("valuechange",event=>{if(event.detail.value!=null)fn(event.detail.value);});
}

export function bindDrawingPalette(palette,{channel,label,value,choose,toValue=id=>id,fallback,previewRole=roles[channel]}) {
  const swatches=[...palette.querySelectorAll("[data-swatch]")],custom=palette.querySelector("input[type=color]");
  const customChip=custom.closest(".text-format-custom");
  palette.dataset.channel=channel;
  palette.setAttribute("aria-label",label);
  const setValue=selected=>{
    const selectedSwatch=swatches.find(button=>toValue(button.dataset.swatch)===selected);
    setSwatch(palette,selectedSwatch?.dataset.swatch);
    const isCustom=isHexDrawingColor(selected)&&!selectedSwatch;
    customChip.classList.toggle("is-selected",isCustom);
    for (const theme of themes)
      customChip.style.setProperty(`--custom-preview-${theme}`,isCustom?renderDrawingColor(selected,previewRole,theme):"transparent");
    const theme=document.documentElement.dataset.appearance==="dark"?"dark":"light";
    custom.value=pickerHex(isHexDrawingColor(selected) ? selected : drawingColor(selected,roles[channel],theme),fallback??fallbackInk(theme));
  };
  onSwatch(palette,id=>choose(toValue(id)));
  custom.onchange=()=>choose(custom.value);
  setValue(value);
  return setValue;
}
