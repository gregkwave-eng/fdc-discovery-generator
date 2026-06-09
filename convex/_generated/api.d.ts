/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ViktorSpacesEmail from "../ViktorSpacesEmail.js";
import type * as _phase1Test from "../_phase1Test.js";
import type * as _transitionsTest from "../_transitionsTest.js";
import type * as archetypes from "../archetypes.js";
import type * as auth from "../auth.js";
import type * as constants from "../constants.js";
import type * as http from "../http.js";
import type * as llm from "../llm.js";
import type * as magiclink from "../magiclink.js";
import type * as owner from "../owner.js";
import type * as rollup from "../rollup.js";
import type * as scenarioGen from "../scenarioGen.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as stage3 from "../stage3.js";
import type * as tenancy from "../tenancy.js";
import type * as testAuth from "../testAuth.js";
import type * as transitions from "../transitions.js";
import type * as users from "../users.js";
import type * as viktorTools from "../viktorTools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ViktorSpacesEmail: typeof ViktorSpacesEmail;
  _phase1Test: typeof _phase1Test;
  _transitionsTest: typeof _transitionsTest;
  archetypes: typeof archetypes;
  auth: typeof auth;
  constants: typeof constants;
  http: typeof http;
  llm: typeof llm;
  magiclink: typeof magiclink;
  owner: typeof owner;
  rollup: typeof rollup;
  scenarioGen: typeof scenarioGen;
  seedTestUser: typeof seedTestUser;
  stage3: typeof stage3;
  tenancy: typeof tenancy;
  testAuth: typeof testAuth;
  transitions: typeof transitions;
  users: typeof users;
  viktorTools: typeof viktorTools;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
