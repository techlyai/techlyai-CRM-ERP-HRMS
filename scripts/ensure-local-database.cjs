const {Client}=require('pg');
async function main(){
 const original=new URL(process.env.DATABASE_ADMIN_URL);
 if(original.hostname!=='127.0.0.1'||original.port!=='55432'||original.pathname!=='/techly') throw Error('This helper only supports the dedicated local Techly cluster.');
 original.pathname='/postgres';
 const c=new Client({connectionString:original.href,connectionTimeoutMillis:8000});
 await c.connect();
 try {if(!(await c.query("select 1 from pg_database where datname='techly'")).rows.length) await c.query('create database techly');}
 finally {await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
