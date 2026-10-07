import {apiUser} from '@/app/account-server';
import {json} from '@/lib/auth-core.mjs';
export async function GET(request:Request){try{await apiUser(request);return json({records:[]});}catch(e){const failure=e as {status?:number;message?:string};return json({error:failure.message},failure.status||503);}}
