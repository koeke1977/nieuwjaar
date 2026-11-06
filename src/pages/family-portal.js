const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const makeId = () => "lid-" + crypto.randomUUID();
let registration = null, catalog = [], saving = false, notice = "", error = "", activeSection = "overview", editingIndex = null;

function nav() {
  return `<nav class="family-nav" aria-label="Gezinsmenu">${[["overview","⌂","Overzicht"],["family","♧","Gezin"],["meat","♨","Vleesbestelling"],["balance","€","Afrekening"]].map(([id,icon,label])=>`<button type="button" data-section="${id}" class="${activeSection===id?"active":""}"><span>${icon}</span>${label}</button>`).join("")}</nav>`;
}
function renderMembers() {
  const members=registration.members||[];
  return `<section class="panel"><div class="section-heading"><div><h2>Jullie gezin</h2><p>Beheer de personen die bij jullie inschrijving horen.</p></div><span class="status neutral">${members.length} deelnemers</span></div>
  <div class="member-list">${members.map((p,i)=>editingIndex===i?`<form class="family-edit-form" data-index="${i}"><input name="name" maxlength="80" value="${esc(p.name)}" required><select name="type"><option value="Volwassene" ${p.type==="Volwassene"?"selected":""}>Volwassene (18+)</option><option value="Kind" ${p.type==="Kind"?"selected":""}>Kind</option></select><button class="button button-small button-dark" type="submit">Bewaren</button><button class="button button-small button-outline" type="button" data-action="cancel-edit">Annuleren</button></form>`:`<article class="member-row"><div class="person-avatar">${esc((p.name||"?").slice(0,1).toUpperCase())}</div><div class="member-name"><strong>${esc(p.name)}</strong><small>${esc(p.type)}</small></div><button class="button button-small button-outline" data-action="edit-member" data-index="${i}">Wijzigen</button><button class="text-button" data-action="remove-member" data-index="${i}">Verwijderen</button></article>`).join("")||'<p class="catalog-note">Voeg hieronder de eerste persoon toe.</p>'}</div>
  <form id="family-add-member" class="catalog-add-form"><label>Persoon toevoegen</label><div class="family-add-grid"><input name="name" maxlength="80" placeholder="Voornaam en naam" required><select name="type"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select><button class="button button-dark" type="submit">+ Toevoegen</button></div></form></section>`;
}
function renderMeat() {
  const members=registration.members||[];
  const products=catalog;
  const totalPortions=members.reduce((sum,m)=>sum+products.reduce((n,p)=>n+(Number(m.orders?.[p.id])||0),0),0);
  return `<section class="panel family-meat-panel">
    <div class="section-heading"><div><h2>Vleesbestelling</h2><p>Kies hieronder per gezinslid wat hij of zij graag eet.</p></div><span class="status success">${totalPortions} porties</span></div>
    ${members.map((person,index)=>{
      const personTotal=products.reduce((n,p)=>n+(Number(person.orders?.[p.id])||0),0);
      return `<article class="family-person-order">
        <header class="family-person-heading"><span class="person-avatar">${esc((person.name||"?").slice(0,1).toUpperCase())}</span><div><h3>${esc(person.name)}</h3><small>${esc(person.type||"Gezinslid")}</small></div><span class="family-person-count">${personTotal} ${personTotal===1?"portie":"porties"}</span></header>
        <div class="family-product-list">${products.map(p=>{
          const q=Number(person.orders?.[p.id])||0;
          return `<div class="family-product-row"><div class="family-product-thumb">${p.image?`<img src="${p.image}" alt="">`:'<span>♨</span>'}</div><span class="family-product-name">${esc(p.name)}</span><div class="family-quantity" aria-label="Aantal ${esc(p.name)}"><button type="button" aria-label="Minder ${esc(p.name)} voor ${esc(person.name)}" data-action="quantity" data-index="${index}" data-product="${esc(p.id)}" data-delta="-1" ${q===0?"disabled":""}>−</button><strong>${q}</strong><button type="button" aria-label="Meer ${esc(p.name)} voor ${esc(person.name)}" data-action="quantity" data-index="${index}" data-product="${esc(p.id)}" data-delta="1">+</button></div></div>`;
        }).join("")||'<p class="catalog-note">Er zijn momenteel geen actieve vleesproducten.</p>'}</div>
      </article>`;
    }).join("")||'<p class="catalog-note">Voeg eerst gezinsleden toe via het menu Gezin.</p>'}
    <div class="family-order-total"><strong>Totaal voor jullie gezin</strong><b>${totalPortions} porties</b></div>
  </section>`;
}
function renderOverview() {
 const members=registration.members||[];
 const portions=members.reduce((sum,m)=>sum+Object.values(m.orders||{}).reduce((a,v)=>a+(Number(v)||0),0),0);
 return `<section class="welcome"><div><p class="eyebrow">PERSOONLIJKE OMGEVING</p><h1>Welkom, ${esc(registration.name)}!</h1><p>Hier vinden jullie alles voor de nieuwjaarsbijeenkomst.</p></div><div class="welcome-icon">🥂</div></section>
 <section class="stats-grid"><article class="stat-card"><span class="stat-icon">♧</span><strong>${members.length}</strong><small>Deelnemers</small></article><article class="stat-card"><span class="stat-icon">♨</span><strong>${portions}</strong><small>Vleesporties</small></article><article class="stat-card"><span class="stat-icon">€</span><strong>—</strong><small>Afrekening volgt</small></article></section>
 <section class="panel"><div class="section-heading"><div><h2>Jullie inschrijving</h2><p>Controleer wie er meegaat en beheer jullie gegevens.</p></div></div>${members.map(p=>`<div class="member-row"><span class="person-avatar">${esc((p.name||"?").slice(0,1).toUpperCase())}</span><div class="member-name"><strong>${esc(p.name)}</strong><small>${esc(p.type)}</small></div></div>`).join("")}<button class="button button-outline" data-section="family">Gezin beheren →</button></section>
 <section class="panel"><div class="section-heading"><div><h2>Vleesbestelling</h2><p>Bekijk of pas jullie bestelling aan.</p></div></div><button class="button button-dark" data-section="meat">Bestelling beheren →</button></section>`;
}
function render() {
 const root=document.querySelector("#app");
 if(!registration){root.innerHTML=`<main class="admin-login-shell"><section class="admin-login-card"><p class="eyebrow">NIEUWJAAR · GEZIN</p><h1>Gezinslink controleren</h1><p>${esc(error||"We controleren jullie persoonlijke toegang…")}</p></section></main>`;return;}
 const content=activeSection==="family"?renderMembers():activeSection==="meat"?renderMeat():activeSection==="balance"?`<section class="page-heading"><p class="eyebrow">FINANCIEEL OVERZICHT</p><h1>Onze afrekening</h1><p>De organisator vult kosten, voorschotten en betalingen in. De persoonlijke afrekening verschijnt zodra die beschikbaar is.</p></section><section class="panel"><h2>Afrekening</h2><p class="catalog-note">De financiële gegevens worden nog gekoppeld aan jullie persoonlijke inschrijving.</p></section>`:renderOverview();
 root.innerHTML=`<main class="shell family-portal-shell"><header class="family-portal-header"><p class="eyebrow">NIEUWJAAR · DEELNEMERSPORTAAL</p><h1>${esc(registration.name)}</h1><p>Jullie persoonlijke inschrijving voor de nieuwjaarsbijeenkomst.</p></header>${nav()}<div class="content">${content}</div><div class="family-save-status" role="status">${esc(error||notice||(saving?"Opslaan…":"Wijzigingen worden automatisch bewaard."))}</div><footer>Nieuwjaar <span>·</span> Samen vieren, alles geregeld.</footer></main>`;
}
async function save() {
 if(saving||!registration)return;
 saving=true;notice="Wijzigingen opslaan…";error="";render();
 try{const response=await fetch("/api/family/registration",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({members:registration.members||[]})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Opslaan is niet gelukt.");registration=result.registration;notice="Alles is bewaard.";}
 catch(e){error=e.message||"Opslaan is niet gelukt.";}finally{saving=false;render();}
}
async function load(token){
 render();
 try{const login=await fetch("/api/family/session",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});const loginData=await login.json().catch(()=>({}));if(!login.ok)throw new Error(loginData.error||"Deze gezinslink is niet geldig.");const response=await fetch("/api/family/session",{credentials:"same-origin"});const data=await response.json().catch(()=>({}));if(!response.ok||!data.authenticated)throw new Error(data.error||"Aanmelden is niet gelukt.");registration=data.registration;catalog=data.catalog||[];notice="Jullie gegevens worden automatisch bewaard.";render();}
 catch(e){error=e.message||"Deze gezinslink is niet geldig.";render();}
}
document.addEventListener("submit",event=>{
 if(event.target.id==="family-add-member"){event.preventDefault();if(!registration||saving)return;const f=event.target,name=f.elements.name.value.trim(),type=f.elements.type.value;if(!name||!["Volwassene","Kind"].includes(type))return;const orders=Object.fromEntries(catalog.map(p=>[p.id,0]));registration.members=[...(registration.members||[]),{id:makeId(),name,type,orders}];save();return;}
 if(event.target.matches(".family-edit-form")){event.preventDefault();if(saving)return;const f=event.target,i=Number(f.dataset.index),p=registration.members[i];if(!p)return;const name=f.elements.name.value.trim(),type=f.elements.type.value;if(!name||!["Volwassene","Kind"].includes(type))return;p.name=name;p.type=type;editingIndex=null;save();}
});
document.addEventListener("click",event=>{
 const section=event.target.closest("[data-section]");if(section&&registration){activeSection=section.dataset.section;editingIndex=null;render();return;}
 const button=event.target.closest("[data-action]");if(!button||!registration||saving)return;const i=Number(button.dataset.index),members=registration.members||[];
 if(button.dataset.action==="edit-member"){editingIndex=i;render();}
 if(button.dataset.action==="cancel-edit"){editingIndex=null;render();}
 if(button.dataset.action==="remove-member"){if(!members[i]||!window.confirm("Dit gezinslid verwijderen?"))return;members.splice(i,1);save();}
 if(button.dataset.action==="quantity"){const p=members[i],id=button.dataset.product;if(!p||!catalog.some(x=>x.id===id))return;p.orders=p.orders||{};p.orders[id]=Math.max(0,Math.min(99,(Number(p.orders[id])||0)+Number(button.dataset.delta)));save();}
});
export function startFamilyPortal(){const token=decodeURIComponent(location.pathname.split("/").filter(Boolean)[1]||"");if(!token){error="De persoonlijke gezinscode ontbreekt.";render();return;}load(token);}
