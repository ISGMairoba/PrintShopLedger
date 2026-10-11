// A balanced example sale for previewing receipt settings. Amounts are kobo.
export function sampleReceipt(now=new Date().toISOString()){
 const jobs=[
  {id:'7f3c2a91-0000-4000-8000-000000000001',customerId:'sample',service:'Large format printing',description:'Shop banner, flex with eyelets',amount:1800000,quantity:2,requireSize:true,width:2,height:1,source:'WhatsApp',createdAt:now},
  {id:'b41e9d07-0000-4000-8000-000000000002',customerId:'sample',service:'Business cards',description:'Matte cards, double-sided',amount:750000,quantity:200,requireSize:false,width:null,height:null,source:'In shop / USB',createdAt:now}
 ];
 return {id:'c0ffee12-0000-4000-8000-000000000000',customerId:'sample',newCustomer:null,customerSnapshot:{id:'sample',name:'Adaeze Okafor',phone:'0803 123 4567',address:''},
  jobBalances:[{id:jobs[0].id,description:jobs[0].description,service:jobs[0].service,amount:1800000,paidBefore:0,paidThisCheckout:1800000,outstandingAfter:0},{id:jobs[1].id,description:jobs[1].description,service:jobs[1].service,amount:750000,paidBefore:0,paidThisCheckout:500000,outstandingAfter:250000}],
  jobs,expectedAccount:'',cashReceived:2300000,useWallet:false,override:null,method:'Transfer',methodLabel:'Bank transfer',paidOn:now.slice(0,10),reference:'Balance due on collection',
  createdBy:'sample',createdByLabel:'Joy (Cashier)',createdAt:now,total:2550000,allocations:[],allocated:2300000,walletUsed:0,walletAdded:0,walletAfter:0,outstandingBefore:0,outstandingAfter:250000};
}
