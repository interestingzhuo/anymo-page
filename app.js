/* AnyMo project page. Buildless and local-first. */
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const config = window.ANYMO_CONFIG || {};
  const validLink = value => {
    try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) ? u.href : ""; }
    catch { return ""; }
  };
  const embedded = window.ANYMO_EMBEDDED_FIGURES || {};
  const source = path => embedded[path.split("/").pop()] || path;
  $$("img[src]").forEach(img => { if (embedded[img.getAttribute("src").split("/").pop()]) img.src = source(img.getAttribute("src")); });
  for (const [name, key] of Object.entries({paper:"paperUrl",arxiv:"arxivUrl",dataset:"datasetUrl",code:"codeUrl"})) {
    $$(`[data-link="${name}"]`).forEach(el => {
      const url = validLink(config[key]);
      if (url) { el.href = url; el.hidden = false; el.target = "_blank"; el.rel = "noopener noreferrer"; }
      else if (name === "code") el.hidden = true;
    });
  }
  $$("[data-venue]").forEach(el => { if (config.venue) el.textContent = config.venue; });
  $$("[data-author]").forEach(el => {
    const url = validLink((config.authorUrls || {})[el.dataset.author]);
    if (!url) return;
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    while (el.firstChild) a.appendChild(el.firstChild);
    el.appendChild(a);
  });
  function setupTabs(list, select) {
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    const activate = tab => {
      tabs.forEach(t => {t.setAttribute("aria-selected", String(t === tab));t.tabIndex=t===tab?0:-1;});
      select(tab.dataset.key);
    };
    tabs.forEach((tab,index) => {
      tab.addEventListener("click",()=>activate(tab));
      tab.addEventListener("keydown",event=>{
        let next;
        if(event.key==="ArrowRight") next=(index+1)%tabs.length;
        if(event.key==="ArrowLeft") next=(index-1+tabs.length)%tabs.length;
        if(event.key==="Home") next=0;
        if(event.key==="End") next=tabs.length-1;
        if(next===undefined)return;
        event.preventDefault(); tabs[next].focus(); activate(tabs[next]);
      });
    });
    activate(tabs[0]);
  }
  const galleryInfo = {text:[6,"Text-conditioned motion"],speech:[8,"Speech-conditioned gestures"],music:[7,"Music-conditioned dance"],trajectory:[6,"Text and trajectory control"]};
  setupTabs($('[data-tabs="gallery"]'),key=>{
    $$(".gallery-panel").forEach(panel=>panel.hidden=panel.id!==`panel-${key}`);
    const link=$("#gallery-source");link.textContent=`Figure S${galleryInfo[key][0]} ↗`;link.href=`https://arxiv.org/html/2605.29488v1#A5.F${galleryInfo[key][0]}`;
    $$(".gallery-panel video").forEach(video=>video.pause());
  });
  // Optional author-supplied videos replace only the corresponding static preview.
  for(const [key,path] of Object.entries(config.media || {})) {
    if(!path)continue;
    let url;
    try {url=new URL(path,location.href);if(!["http:","https:","file:"].includes(url.protocol))continue;} catch {continue;}
    const slot=key==="teaser"?$("#teaser-video-slot"):$(`[data-media-slot="${key}"]`);
    if(!slot)continue;
    const video=document.createElement("video");video.className="research-video";video.controls=true;video.playsInline=true;video.preload="metadata";video.src=url.href;
    const label=document.createElement("p");label.className="video-caption";label.textContent=key==="teaser"?"AnyMo · Research video":galleryInfo[key]?.[1] || "AnyMo research video";
    slot.replaceChildren(video,label); if(key==="teaser")slot.hidden=false;
  }
  const dialog=$("#figure-dialog");let lastFigure;
  $$("[data-enlarge]").forEach(button=>button.addEventListener("click",()=>{
    lastFigure=button;$("#dialog-title").textContent=button.dataset.caption;$("#dialog-caption").textContent=button.dataset.caption;
    $("#dialog-image").src=source(button.dataset.enlarge);$("#dialog-image").alt=button.querySelector("img").alt;
    dialog.showModal();document.body.style.overflow="hidden";
  }));
  $("#close-dialog").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener("close",()=>{document.body.style.overflow="";lastFigure?.focus();});
  let toastTimer;
  function notify(text){clearTimeout(toastTimer);$("#toast").textContent=text;$("#toast").hidden=false;toastTimer=setTimeout(()=>$("#toast").hidden=true,3000);}
  $("#copy-bibtex").addEventListener("click",async()=>{
    const text=$("#bibtex-code").textContent.trim();let copied=false;
    try{await navigator.clipboard.writeText(text);copied=true;}catch{}
    if(!copied){const el=document.createElement("textarea");el.value=text;el.style.cssText="position:fixed;left:-9999px";document.body.appendChild(el);el.select();try{copied=document.execCommand("copy");}catch{}el.remove();}
    if(copied){$("#copy-bibtex").textContent="Copied!";notify("BibTeX copied to clipboard.");setTimeout(()=>$("#copy-bibtex").textContent="Copy BibTeX",2200);}
    else{const range=document.createRange();range.selectNodeContents($("#bibtex-code"));const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);notify("Citation selected. Press ⌘C or Ctrl+C to copy.");}
  });
})();
