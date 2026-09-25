import mongoose from 'mongoose';
import { z } from 'zod';
import { Department, Cohort, User, initializeIndexes } from './models.js';
import { hashPassword } from './security.js';
import { usernameSchema, passwordSchema, nameSchema } from '@residency/domain';

export async function setupCatalog(definitions = [{ code: 'PMR', name: 'Physical Medicine & Rehabilitation', nameFa: 'طب فیزیکی و توانبخشی', years: 4 }, { code: 'NEU', name: 'Neurology', nameFa: 'نورولوژی', years: 4 }]) {
  const departments = []; const cohorts = [];
  for (const definition of definitions) {
    const { years, ...data } = definition;
    const department = await Department.findOneAndUpdate({ code: data.code }, { $setOnInsert: data }, { upsert: true, new: true }).lean();
    departments.push(department);
    for (let year = 1; year <= years; year++) cohorts.push(await Cohort.findOneAndUpdate({ departmentId: department._id, year }, { $setOnInsert: { name: `Year ${year}` } }, { upsert: true, new: true }).lean());
  }
  return { departments, cohorts };
}
export async function provisionAdmins(entries, catalog) {
  for (const entry of entries) {
    const v = z.object({ department: z.string(), year: z.number().int().positive(), username: usernameSchema, name: nameSchema, password: passwordSchema }).strict().parse(entry);
    const department = catalog.departments.find(d => d.code === v.department);
    const cohort = catalog.cohorts.find(c => c.departmentId === department?._id && c.year === v.year);
    if (!cohort) throw new Error(`Unknown department/year: ${v.department}/${v.year}`);
    if (await User.exists({ username: v.username })) throw new Error(`Username already exists; setup does not overwrite accounts: ${v.username}`);
    await User.create({ username: v.username, name: v.name, passwordHash: await hashPassword(v.password), departmentId: department._id, cohortId: cohort._id, kind: 'admin', status: 'active', mustChangePassword: true });
    console.log(`Created admin ${v.username} for ${v.department} year ${v.year}`);
  }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI); await initializeIndexes();
  const definitions = process.env.SETUP_DEPARTMENTS_JSON ? JSON.parse(process.env.SETUP_DEPARTMENTS_JSON) : undefined;
  const catalog = await setupCatalog(definitions);
  await provisionAdmins(JSON.parse(process.env.SETUP_ADMINS_JSON || '[]'), catalog);
  console.log(`Configured ${catalog.departments.length} departments and ${catalog.cohorts.length} cohorts. Existing credentials were not changed.`);
  await mongoose.disconnect();
}
