const form=document.querySelector('#search'), results=document.querySelector('#results'), status=document.querySelector('#status'), more=document.querySelector('#more'), submit=document.querySelector('#submit');
let query=null,offset=0,loading=false;
function node(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
async function search(append=false){
 if(loading)return;loading=true;submit.disabled=true;more.disabled=true;
 if(!append){query={city:form.city.value.trim(),state:form.state.value.trim()};offset=0;results.replaceChildren();more.hidden=true;}
 status.textContent='Looking for participating stores…';
 try{
 const r=await fetch('/api/neon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'directory_search',...query,offset})});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Search unavailable');
 for(const b of d.businesses){const card=node('article','');card.className='store';card.append(node('h2',b.name),node('p',b.address+', '+b.city+', '+b.state));const link=node('a','View rewards and join');link.href='join.html?business_id='+encodeURIComponent(b.id);card.append(link);results.append(card);}
 offset+=d.businesses.length;more.hidden=!d.has_more;
 status.textContent=offset?offset+' participating stores shown in '+query.city+'.':'No participating stores listed in this city yet. Try a nearby city.';
 }catch(e){status.textContent='Unable to load stores. Please try again.';}finally{loading=false;submit.disabled=false;more.disabled=false;}
}
form.addEventListener('submit',e=>{e.preventDefault();search();});more.addEventListener('click',()=>search(true));
