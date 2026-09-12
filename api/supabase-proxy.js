export default async function handler(req,res){
  const base=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_ANON_KEY;
  if(!base||!key)return res.status(500).json({message:'Server auth configuration missing'});
  const path=Array.isArray(req.query.path)?req.query.path.join('/'):(req.query.path||'');
  if(!path||(!path.startsWith('auth/v1/')&&!path.startsWith('rest/v1/')))return res.status(400).json({message:'Invalid path'});
  const q=new URLSearchParams();
  for(const [k,v] of Object.entries(req.query)){if(k==='path')continue;if(Array.isArray(v))v.forEach(x=>q.append(k,x));else if(v!=null)q.set(k,v)}
  const url=base.replace(/\/$/,'')+'/'+path+(q.toString()?'?'+q.toString():'');
  const headers={apikey:key,'Content-Type':'application/json'};
  const auth=req.headers.authorization;if(auth)headers.Authorization=auth;
  try{
    const upstream=await fetch(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body||{})});
    const text=await upstream.text();
    res.status(upstream.status);res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');return res.send(text);
  }catch(e){console.error('Proxy error',e?.message||e);return res.status(502).json({message:'Authentication service unavailable'});}
}