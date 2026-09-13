
require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_FILE = path.join(__dirname,'data.json');

function loadData(){
  try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); }
  catch(e){ return {businesses:[], customers:[]}; }
}
function saveData(data){ fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2)); }
function slug(s='business'){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'business'; }
function id(){ return crypto.randomBytes(5).toString('hex'); }

app.use(express.static(path.join(__dirname,'public')));

// Stripe webhook must use raw body
app.post('/api/stripe/webhook', express.raw({type:'application/json'}), (req,res)=>{
  try{
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_x');
    let event = req.body;
    if(process.env.STRIPE_WEBHOOK_SECRET){
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
    if(event.type === 'checkout.session.completed'){
      const s = event.data.object;
      const data = loadData();
      let biz = data.businesses.find(b=>b.stripeCustomerId===s.customer);
      if(!biz){
        biz = {
          id: 'biz_'+id(),
          name: s.metadata?.businessName || 'New Business',
          category: s.metadata?.category || 'general',
          email: s.customer_details?.email || '',
          stripeCustomerId: s.customer || '',
          subscriptionId: s.subscription || '',
          status: 'active',
          reward: 5,
          createdAt: new Date().toISOString()
        };
        biz.slug = slug(biz.name)+'-'+biz.id.slice(-4);
        data.businesses.push(biz);
        saveData(data);
      }
    }
    res.json({received:true});
  }catch(err){
    console.error(err);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.use(express.json());

app.post('/api/create-checkout-session', async (req,res)=>{
  try{
    const {businessName, category, email} = req.body;
    if(!businessName || !email) return res.status(400).json({error:'Business name and email are required'});
    if(!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID ||
       process.env.STRIPE_SECRET_KEY.includes('replace_me') || process.env.STRIPE_PRICE_ID.includes('replace_me')){
      // Demo mode: create business immediately
      const data = loadData();
      const biz = {
        id:'biz_'+id(), name:businessName, category:category||'general', email,
        status:'demo-active', reward:5, createdAt:new Date().toISOString()
      };
      biz.slug = slug(businessName)+'-'+biz.id.slice(-4);
      data.businesses.push(biz); saveData(data);
      return res.json({demo:true, url:`/success.html?biz=${encodeURIComponent(biz.id)}`});
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode:'subscription',
      line_items:[{price:process.env.STRIPE_PRICE_ID, quantity:1}],
      customer_email:email,
      allow_promotion_codes:true,
      success_url:`${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${BASE_URL}/signup.html?cancelled=1`,
      metadata:{businessName, category:category||'general'}
    });
    res.json({url:session.url});
  }catch(err){
    console.error(err);
    res.status(500).json({error:err.message});
  }
});

app.get('/api/business/:id', (req,res)=>{
  const data=loadData();
  const biz=data.businesses.find(b=>b.id===req.params.id);
  if(!biz) return res.status(404).json({error:'Business not found'});
  res.json(biz);
});

app.get('/api/business-by-session/:sessionId', async (req,res)=>{
  try{
    if(!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('replace_me'))
      return res.status(400).json({error:'Stripe not configured'});
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const s = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const data=loadData();
    let biz=data.businesses.find(b=>b.stripeCustomerId===s.customer);
    if(!biz && s.payment_status){
      biz = {
        id:'biz_'+id(), name:s.metadata?.businessName||'New Business',
        category:s.metadata?.category||'general',
        email:s.customer_details?.email||'', stripeCustomerId:s.customer||'',
        subscriptionId:s.subscription||'', status:'active', reward:5, createdAt:new Date().toISOString()
      };
      biz.slug=slug(biz.name)+'-'+biz.id.slice(-4);
      data.businesses.push(biz); saveData(data);
    }
    if(!biz) return res.status(404).json({error:'Business not ready yet'});
    res.json(biz);
  }catch(err){ res.status(500).json({error:err.message}); }
});

app.post('/api/claim', (req,res)=>{
  const {businessId, phone, reward=5} = req.body;
  if(!businessId || !phone) return res.status(400).json({error:'Missing fields'});
  const data=loadData();
  const biz=data.businesses.find(b=>b.id===businessId);
  if(!biz) return res.status(404).json({error:'Business not found'});
  let c=data.customers.find(x=>x.phone===phone);
  if(!c){ c={phone, wallets:{}, createdAt:new Date().toISOString()}; data.customers.push(c); }
  if(!c.wallets[businessId]) c.wallets[businessId]={businessName:biz.name,balance:0,history:[]};
  c.wallets[businessId].balance += Number(reward);
  c.wallets[businessId].history.push({type:'earn',amount:Number(reward),ts:new Date().toISOString()});
  saveData(data);
  res.json({ok:true,wallet:c.wallets[businessId]});
});

app.get('/api/wallet/:phone', (req,res)=>{
  const data=loadData();
  const c=data.customers.find(x=>x.phone===req.params.phone);
  res.json(c || {phone:req.params.phone,wallets:{}});
});

app.listen(PORT, ()=> console.log(`LOYALTY running on ${BASE_URL}`));
