/**
 * Development and demo accounts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DEVELOPMENT CREDENTIALS — DO NOT USE OUTSIDE A LOCAL DATABASE.
 *
 *  Every password below is a throwaway value chosen so the seed is obviously
 *  non-production. They exist so a developer can sign in and see the app.
 *
 *  Production hardening (deliberately NOT implemented here):
 *    • the seed refuses to run when NODE_ENV=production
 *    • deployment creates the first ADMIN through a one-time bootstrap token,
 *      never through this file
 *    • these hashes are not present in the production image
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface SeedUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  roleCode: 'ADMIN' | 'LIBRARIAN' | 'MEMBER';
  /** Present for MEMBER seeds; creates the linked member record. */
  member?: {
    membershipNumber: string;
    memberTypeCode: string;
    branchCode: string;
    joinedAtOffsetDays: number;
    status?: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  };
  /** Staff are scoped to these branches. ADMIN holds all of them. */
  branchCodes: readonly string[];
  verified: boolean;
}

export const SEED_PASSWORD = 'DevOnly#Library2026';

export const SEED_USERS: readonly SeedUser[] = [
  {
    email: 'admin@library.test',
    password: SEED_PASSWORD,
    firstName: 'Amara',
    lastName: 'Okafor',
    phone: '+254700000001',
    roleCode: 'ADMIN',
    branchCodes: ['MAIN', 'WEST', 'RESEARCH'],
    verified: true,
  },
  {
    email: 'librarian@library.test',
    password: SEED_PASSWORD,
    firstName: 'Brian',
    lastName: 'Mwangi',
    phone: '+254700000002',
    roleCode: 'LIBRARIAN',
    branchCodes: ['MAIN'],
    verified: true,
  },
  {
    email: 'librarian.west@library.test',
    password: SEED_PASSWORD,
    firstName: 'Chelsea',
    lastName: 'Njeri',
    phone: '+254700000003',
    roleCode: 'LIBRARIAN',
    // Deliberately scoped to a single non-main branch so branch isolation can
    // be verified by signing in as both librarians.
    branchCodes: ['WEST'],
    verified: true,
  },
  {
    email: 'student@library.test',
    password: SEED_PASSWORD,
    firstName: 'Dianne',
    lastName: 'Wambui',
    phone: '+254700000004',
    roleCode: 'MEMBER',
    member: {
      membershipNumber: 'STU-0001',
      memberTypeCode: 'STUDENT',
      branchCode: 'MAIN',
      joinedAtOffsetDays: -120,
    },
    branchCodes: ['MAIN'],
    verified: true,
  },
  {
    email: 'staff@library.test',
    password: SEED_PASSWORD,
    firstName: 'Elias',
    lastName: 'Kiptoo',
    phone: '+254700000005',
    roleCode: 'MEMBER',
    member: {
      membershipNumber: 'STF-0001',
      memberTypeCode: 'STAFF',
      branchCode: 'MAIN',
      joinedAtOffsetDays: -400,
    },
    branchCodes: ['MAIN'],
    verified: true,
  },
  {
    email: 'public@library.test',
    password: SEED_PASSWORD,
    firstName: 'Fatuma',
    lastName: 'Abdi',
    phone: '+254700000006',
    roleCode: 'MEMBER',
    member: {
      membershipNumber: 'PUB-0001',
      memberTypeCode: 'PUBLIC',
      branchCode: 'WEST',
      joinedAtOffsetDays: -30,
    },
    branchCodes: ['WEST'],
    verified: true,
  },
  {
    // Deliberately UNVERIFIED and EXPIRED: exercises the states that block
    // sign-in and borrowing, so both are testable without hand-editing the DB.
    email: 'expired@library.test',
    password: SEED_PASSWORD,
    firstName: 'Grace',
    lastName: 'Mwende',
    phone: '+254700000007',
    roleCode: 'MEMBER',
    member: {
      membershipNumber: 'STU-0002',
      memberTypeCode: 'STUDENT',
      branchCode: 'MAIN',
      joinedAtOffsetDays: -800,
      status: 'EXPIRED',
    },
    branchCodes: ['MAIN'],
    verified: false,
  },
];
