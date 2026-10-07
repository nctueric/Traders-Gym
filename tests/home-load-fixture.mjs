import {emptyDataset} from '../lib/auth-core.mjs';
export function homeLoadFixture(now){const dataset=emptyDataset();dataset.cashActivities=[{id:'cash',currency:'USD',amount:1000000,type:'DEPOSIT',timestamp:'2025-10-01T00:00:00Z'}];
dataset.fills=Array.from({length:574},(_,i)=>({id:`f${i}`,accountId:'synthetic',symbol:['AAPL','MSFT'][i%2],market:'NASDAQ',currency:'USD',side:'BUY',quantity:1,price:200,fee:0,timestamp:'2025-10-01T00:00:00Z'}));
// Generated bars are solely load-test padding, never shown as real market data.
dataset.marketBars=Array.from({length:46688},(_,i)=>({symbol:['AAPL','MSFT'][i%2],date:'2025-10-01',open:200.12345678912345,high:205.12345678912345,low:195.12345678912345,close:202.12345678912345,volume:1234567}));dataset.marketSnapshot={version:1,quotes:{AAPL:{price:202,updatedAt:now,source:'synthetic-load-test-only'},MSFT:{price:202,updatedAt:now,source:'synthetic-load-test-only'}}};
return dataset;}
