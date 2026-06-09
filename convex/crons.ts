import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily governance sweep: reminder ladder (T+2/+4/+6 business days), stall
// escalation (T+7), and off-script escalation (>=3 answered & <40% substantive).
// 13:00 UTC ~= 08:00/09:00 ET, before the FDC workday.
crons.daily("governance-sweep", { hourUTC: 13, minuteUTC: 0 }, internal.governance.sweepGovernance);

export default crons;
