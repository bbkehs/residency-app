// Fictional local demo only. Never connects to an existing MongoDB database.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../apps/api/src/app.js';
import { setupCatalog } from '../apps/api/src/setup.js';
import { User, ClassSession, Leave, Observation, Thread, Message, Audit, initializeIndexes } from '../apps/api/src/models.js';
import { hashPassword } from '../apps/api/src/security.js';

await mkdir(resolve('.runtime/tmp'), { recursive: true });
process.env.TMPDIR = resolve('.runtime/tmp');
process.env.NODE_ENV = 'development';
// Isolated browser tests use synthetic subscriptions; the demo never starts a push worker.
if (process.env.DEMO_TEST_PUSH === 'true') {
  const { default: webpush } = await import('web-push');
  const keys = webpush.generateVAPIDKeys();
  Object.assign(process.env, { PUSH_ENABLED: 'true', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:demo@example.com' });
} else process.env.PUSH_ENABLED = 'false';
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [
  { args: process.platform === 'win32' ? [] : ['--nounixsocket'] }
], binary: { version: process.env.MONGOMS_VERSION || '7.0.24', downloadDir: resolve('node_modules/.cache/mongodb-binaries') } });
await mongoose.connect(mongo.getUri()); await initializeIndexes();
const { departments, cohorts } = await setupCatalog();
const department = departments.find(d => d.code === 'PMR');
const cohort = cohorts.find(c => c.departmentId === department._id && c.year === 1);
const second = cohorts.find(c => c.departmentId === department._id && c.year === 2);
const password = 'Demo-Only-2026!'; const passwordHash = await hashPassword(password);
async function person(username, name, kind, options = {}) { return User.create({ username, name, kind, passwordHash, departmentId: department._id, cohortId: kind === 'professor' ? undefined : cohort._id, approvalCohortId: cohort._id, status: 'active', ...options }); }
const admin = await person('demo-admin', 'Nika Farzan', 'admin');
const rep = await person('demo-rep', 'Sara Mehr', 'student', { isRep: true });
const student = await person('demo-student', 'Arman Darya', 'student');
const professor = await person('demo-professor', 'Dr. Leila Rad', 'professor');
const professor2 = await person('demo-professor-2', 'Dr. Kian Mehr', 'professor');
const residents = [rep,student];
for (const [i,name] of ['Mina Shayan','Reza Navid','Tara Roshan','Omid Baran','Dena Sepehr','Parsa Nouri'].entries()) residents.push(await person(`demo-resident-${i+1}`,name,'student'));
const resident2 = await person('demo-year2-student','Nima Azar','student',{ cohortId: second._id });
await person('demo-year2-admin','Year 2 Admin','admin',{ cohortId: second._id });
await person('demo-pending','Raha Farid','student',{ status: 'pending' });
const startBase = new Date(); startBase.setUTCDate(startBase.getUTCDate()+1); startBase.setUTCHours(4,30,0,0);
const definitions = [ ['Neuromuscular assessment','Clinical skills · Room 204',0,0], ['Gait analysis workshop','Rehabilitation lab',0,3], ['Rehabilitation case conference','Seminar room A',1,0], ['Spinal cord injury rehabilitation','Lecture hall 2',2,1], ['Clinical examination review','Clinical skills · Room 204',3,0] ];
const sessions=[];
for (const [index,[title,room,days,hours]] of definitions.entries()) {
 const startAt=new Date(startBase.getTime()+(days*24+hours)*3600000), endAt=new Date(startAt.getTime()+90*60000);
 sessions.push(await ClassSession.create({ departmentId: department._id, ownerCohortId: cohort._id, title, room, description: 'Fictional teaching session for the local demonstration.', startAt,endAt,professorIds:[professor._id,professor2._id],createdBy:rep._id,participations:[{cohortId:cohort._id,studentIds:residents.map(r=>r._id),confirmed:true,status:index===4?'pending':'approved'},...(index===0?[{cohortId:second._id,studentIds:[resident2._id],confirmed:true,status:'approved'}]:[])] }));
}
for (const [index,resident] of residents.entries()) if (index<5) await Observation.create({departmentId:department._id,cohortId:cohort._id,sessionId:sessions[0]._id,studentId:resident._id,observerId:rep._id,role:'rep',status:index===3?'absent':'present',recordedAt:new Date(),receivedAt:new Date(),version:1});
await Observation.create({departmentId:department._id,cohortId:cohort._id,sessionId:sessions[0]._id,studentId:student._id,observerId:professor._id,role:'professor',status:'absent',recordedAt:new Date(),receivedAt:new Date(),version:1});
await Leave.create({ departmentId:department._id,cohortId:cohort._id,studentId:residents[2]._id,professorId:professor._id,type:'session',sessionId:sessions[1]._id,startAt:sessions[1].startAt,endAt:sessions[1].endAt,reason:'Personal appointment (fictional example).',status:'pending_admin',professorDecision:{actorId:professor._id,decision:'approve',at:new Date()},version:1 });
await Leave.create({ departmentId:department._id,cohortId:cohort._id,studentId:student._id,professorId:professor._id,type:'session',sessionId:sessions[2]._id,startAt:sessions[2].startAt,endAt:sessions[2].endAt,reason:'Personal leave (fictional example).',status:'pending_professor' });
const thread=await Thread.create({departmentId:department._id,cohortId:cohort._id,professorId:professor._id,subject:'Teaching materials for tomorrow'});
await Message.create({threadId:thread._id,authorId:professor._id,text:'Please remind the residents to review the assessment checklist before our session. (Demo message)'});
await Audit.create({departmentId:department._id,cohortId:cohort._id,actorId:admin._id,action:'session_approved',entityId:sessions[0]._id,detail:{title:sessions[0].title}});
const port=Number(process.env.DEMO_PORT||4000); const origin=`http://localhost:${port}`;
const server=createApp({origin}).listen(port,'127.0.0.1',()=>{ console.log(`LOCAL FICTIONAL DEMO — data disappears on exit.\nOpen ${origin}\nUsers: demo-admin, demo-rep, demo-professor, demo-student\nDemo-only password: ${password}`); });
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{await mongoose.disconnect();await mongo.stop();process.exit(0);}));
